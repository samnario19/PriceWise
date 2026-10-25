<script lang="ts">
	import { browser } from '$app/environment';
	import type { RecipeDTO } from '$lib/types/recipe';
	import { costingSettings } from '$lib/state/costingSettings.svelte';
	import { ingredientCatalog } from '$lib/state/ingredientCatalog.svelte';
	import { otherCatalog } from '$lib/state/otherCatalog.svelte';
	import { updateRecipePricing } from '$lib/state/recipes.svelte';
	import RecipeCostingPanel from '$lib/components/recipes/RecipeCostingPanel.svelte';
	import {
		computeAutoSyncedRecipePricing,
		recipePricingMatchesSuggested
	} from '$lib/utils/recipeCosting';
	import { computeRecipeAvailability } from '$lib/utils/recipeAvailability';
	import RecipeAvailabilityBadge from '$lib/components/recipes/RecipeAvailabilityBadge.svelte';

	const {
		recipe,
		open,
		onClose
	}: {
		recipe: RecipeDTO | null;
		open: boolean;
		onClose: () => void;
	} = $props();

	let backdrop: HTMLDivElement | undefined = $state();

	const masters = $derived(ingredientCatalog.items);
	const otherMasters = $derived(otherCatalog.items);
	const availability = $derived.by(() => {
		if (!recipe) return null;
		return computeRecipeAvailability(recipe, masters, otherMasters);
	});

	/** Persist suggested channel list prices whenever costing opens (keeps recipe cards / summary in sync). */
	$effect(() => {
		if (!browser || !open || !recipe) return;
		void costingSettings.vatRegistered;
		void costingSettings.vatPct;
		void costingSettings.batchSize;
		void costingSettings.targetMarginPct;
		void costingSettings.discountPct;
		void recipe.ingredientLines;
		void recipe.otherLines;
		void recipe.pricing;
		void masters;
		void otherMasters;

		const next = computeAutoSyncedRecipePricing(recipe, masters, otherMasters, {
			vatRegistered: costingSettings.vatRegistered,
			vatPct: costingSettings.vatPct,
			batchSize: costingSettings.batchSize,
			targetMarginPct: costingSettings.targetMarginPct,
			discountPct: costingSettings.discountPct
		});
		const pick = { local: next.local, shopee: next.shopee, lazada: next.lazada };
		if (recipePricingMatchesSuggested(recipe.pricing, pick)) return;
		updateRecipePricing(recipe.id, pick);
	});

	function onBackdropMouseDown(e: MouseEvent): void {
		if (e.target === backdrop) onClose();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open && recipe}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={backdrop}
		class="fixed inset-0 z-50 flex justify-end bg-zinc-950/25 backdrop-blur-[2px] transition-opacity"
		onmousedown={onBackdropMouseDown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/40 bg-white/80 shadow-[-24px_0_80px_rgba(15,23,42,0.12)] backdrop-blur-xl"
			style="animation: slideIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) forwards;"
		>
			<div
				class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/60 bg-gradient-to-br from-white/95 via-teal-50/30 to-emerald-50/40 px-6 py-5 backdrop-blur-md"
			>
				<div class="min-w-0">
					<h2 id="costing-title" class="text-lg font-semibold tracking-tight text-zinc-900">{recipe.name}</h2>
					<div class="mt-1 flex flex-wrap items-center gap-2">
						<p class="text-sm font-medium text-teal-800/80">Costing & pricing</p>
						{#if availability}
							<RecipeAvailabilityBadge {availability} size="sm" showBottleneck={true} />
						{/if}
					</div>
				</div>
				<button
					type="button"
					class="rounded-2xl p-2 text-zinc-500 transition hover:bg-white/80 hover:text-zinc-900"
					onclick={onClose}
					aria-label="Close"
				>
					<span class="text-2xl leading-none">&times;</span>
				</button>
			</div>

			<div class="flex-1 px-5 pb-8 pt-5 sm:px-7">
				<RecipeCostingPanel recipe={recipe} ingredientMasters={masters} otherMasters={otherMasters} />
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0.96;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
