<script lang="ts">
	import {
		getRecipeAvailabilityBadge,
		type RecipeProductAvailability
	} from '$lib/utils/recipeAvailability';

	const {
		availability,
		size = 'md',
		showBottleneck = true,
		interactive = false,
		onclick
	}: {
		availability: RecipeProductAvailability;
		size?: 'sm' | 'md' | 'lg';
		showBottleneck?: boolean;
		interactive?: boolean;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const badge = $derived(getRecipeAvailabilityBadge(availability));

	const sizeClasses = $derived.by(() => {
		switch (size) {
			case 'sm':
				return 'px-2 py-0.5 text-[10px] gap-1';
			case 'lg':
				return 'px-3.5 py-1.5 text-sm gap-2 font-bold';
			case 'md':
			default:
				return 'px-2.5 py-1 text-xs gap-1.5 font-semibold';
		}
	});

	const dotSize = $derived(size === 'sm' ? 'h-1.5 w-1.5' : size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2');
</script>

<div class="inline-flex flex-wrap items-center gap-2">
	{#if interactive}
		<button
			type="button"
			class="inline-flex items-center rounded-full border shadow-xs transition-transform active:scale-95 {badge.badgeClass} {sizeClasses}"
			title={badge.summaryText}
			{onclick}
		>
			<span class="rounded-full {dotSize} {badge.dotClass}"></span>
			<span>{badge.label}</span>
		</button>
	{:else}
		<span
			class="inline-flex items-center rounded-full border shadow-xs {badge.badgeClass} {sizeClasses}"
			title={badge.summaryText}
		>
			<span class="rounded-full {dotSize} {badge.dotClass}"></span>
			<span>{badge.label}</span>
		</span>
	{/if}

	{#if showBottleneck && availability.limitingLine && availability.status !== 'unconfigured'}
		<span class="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={badge.summaryText}>
			{#if availability.status === 'out_of_stock'}
				<span class="font-medium text-rose-600 dark:text-rose-400">Needs restock</span>
			{:else}
				Bottleneck: <span class="font-semibold text-zinc-700 dark:text-zinc-300">{availability.limitingLine.name}</span>
			{/if}
		</span>
	{/if}
</div>
