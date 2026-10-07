<script lang="ts">
	import NewRecipeQuickModal from '$lib/components/recipes/NewRecipeQuickModal.svelte';
	import RecipeCard from '$lib/components/recipes/RecipeCard.svelte';
	import RecipeCostingDrawer from '$lib/components/recipes/RecipeCostingDrawer.svelte';
	import RecipeDetailsModal from '$lib/components/recipes/RecipeDetailsModal.svelte';
	import TypeToConfirmDeleteModal from '$lib/components/TypeToConfirmDeleteModal.svelte';
	import type { RecipeDTO } from '$lib/types/recipe';
	import {
		addRecipe,
		archiveRecipe,
		deleteRecipePermanently,
		recipeStore,
		unarchiveRecipe
	} from '$lib/state/recipes.svelte';

	let search = $state('');
	let detailRecipeId = $state<string | null>(null);
	let costingRecipeId = $state<string | null>(null);
	let quickAddOpen = $state(false);
	let currentTab = $state<'active' | 'archived'>('active');

	let pendingPermanentDeleteRecipe = $state<RecipeDTO | null>(null);
	let lastArchivedRecipe = $state<RecipeDTO | null>(null);
	let toastMessage = $state<string | null>(null);
	let toastTimer = $state<ReturnType<typeof setTimeout> | null>(null);

	const activeRecipes = $derived(recipeStore.recipes.filter((r) => !r.archived));
	const archivedRecipes = $derived(recipeStore.recipes.filter((r) => !!r.archived));

	const targetList = $derived(currentTab === 'active' ? activeRecipes : archivedRecipes);

	const filtered = $derived(
		targetList.filter((r) => r.name.toLowerCase().includes(search.toLowerCase().trim()))
	);

	const detailRecipe = $derived(
		detailRecipeId ? (recipeStore.recipes.find((r) => r.id === detailRecipeId) ?? null) : null
	);

	const costingRecipe = $derived(
		costingRecipeId ? (recipeStore.recipes.find((r) => r.id === costingRecipeId) ?? null) : null
	);

	function openCosting(id: string): void {
		quickAddOpen = false;
		detailRecipeId = null;
		costingRecipeId = id;
	}

	function closeCosting(): void {
		costingRecipeId = null;
	}

	function openDetail(id: string): void {
		quickAddOpen = false;
		costingRecipeId = null;
		detailRecipeId = id;
	}

	function closeDetail(): void {
		detailRecipeId = null;
	}

	function closeQuickRecipe(): void {
		quickAddOpen = false;
	}

	function onFabAddRecipe(): void {
		detailRecipeId = null;
		costingRecipeId = null;
		quickAddOpen = true;
	}

	function onConfirmAddRecipe(name: string): void {
		addRecipe(name);
		quickAddOpen = false;
		currentTab = 'active';
	}

	function handleArchive(recipe: RecipeDTO): void {
		archiveRecipe(recipe.id);
		lastArchivedRecipe = recipe;
		toastMessage = `Recipe “${recipe.name}” moved to Archive.`;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMessage = null;
			lastArchivedRecipe = null;
		}, 7000);
	}

	function handleRestore(recipe: RecipeDTO): void {
		unarchiveRecipe(recipe.id);
		toastMessage = `Recipe “${recipe.name}” restored to Active.`;
		lastArchivedRecipe = null;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMessage = null;
		}, 4000);
	}

	function handleUndoArchive(): void {
		if (!lastArchivedRecipe) return;
		unarchiveRecipe(lastArchivedRecipe.id);
		toastMessage = `Recipe “${lastArchivedRecipe.name}” restored.`;
		lastArchivedRecipe = null;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMessage = null;
		}, 3000);
	}

	function promptPermanentDelete(recipe: RecipeDTO): void {
		pendingPermanentDeleteRecipe = recipe;
	}

	function executePermanentDelete(): void {
		if (!pendingPermanentDeleteRecipe) return;
		deleteRecipePermanently(pendingPermanentDeleteRecipe.id);
		pendingPermanentDeleteRecipe = null;
	}
</script>

<section class="animate-in relative space-y-8 pb-10">
	<!-- Premium Header Section -->
	<div class="relative overflow-hidden rounded-3xl bg-zinc-900 p-8 text-white shadow-2xl lg:p-12">
		<div class="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-orange-500/20 blur-3xl"></div>
		<div class="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl"></div>

		<div class="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
			<div class="space-y-2">
				<h1 class="text-4xl font-bold tracking-tight sm:text-5xl">
					Recipe <span class="text-orange-400">Manager</span>
				</h1>
				<p class="max-w-2xl text-lg text-zinc-400">
					Create, cost, and price your culinary creations with precision. Sync prices across local and marketplace channels.
				</p>
			</div>

			<div class="flex w-full shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:w-auto">
				<div class="relative">
					<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
						<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
					</div>
					<input
						id="recipe-search"
						type="search"
						bind:value={search}
						placeholder={currentTab === 'active' ? 'Search active recipes…' : 'Search archive…'}
						class="w-full min-w-[min(100%,280px)] rounded-2xl border-none bg-zinc-800/50 py-3 pl-10 pr-4 text-white placeholder-zinc-500 ring-1 ring-white/10 transition-all focus:bg-zinc-800 focus:ring-2 focus:ring-orange-500 sm:max-w-xs"
					/>
				</div>
				<button
					type="button"
					class="flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-orange-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-900/25 transition-all hover:bg-orange-500 hover:-translate-y-0.5 active:scale-95"
					onclick={onFabAddRecipe}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
					Add recipe
				</button>
			</div>
		</div>
	</div>

	<!-- Navigation Tabs: Active vs Archived -->
	<div class="flex items-center justify-between border-b border-zinc-200/80 pb-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold transition-all {currentTab === 'active'
					? 'bg-zinc-900 text-white shadow-md'
					: 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
				onclick={() => (currentTab = 'active')}
			>
				<span>Active Recipes</span>
				<span
					class="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums {currentTab === 'active'
						? 'bg-zinc-700 text-white'
						: 'bg-zinc-200 text-zinc-800'}"
				>
					{activeRecipes.length}
				</span>
			</button>

			<button
				type="button"
				class="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold transition-all {currentTab === 'archived'
					? 'bg-amber-600 text-white shadow-md'
					: 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
				onclick={() => (currentTab = 'archived')}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
				<span>Archived</span>
				<span
					class="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums {currentTab === 'archived'
						? 'bg-amber-700 text-white'
						: 'bg-zinc-200 text-zinc-800'}"
				>
					{archivedRecipes.length}
				</span>
			</button>
		</div>

		{#if currentTab === 'archived' && archivedRecipes.length > 0}
			<p class="hidden text-xs text-zinc-500 sm:block">
				Archived recipes can be restored or deleted permanently.
			</p>
		{/if}
	</div>

	<!-- Recipe Cards or Empty State -->
	{#if filtered.length === 0}
		{#if currentTab === 'archived'}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-amber-50 text-amber-500 shadow-inner">
					<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
				</div>
				<h3 class="text-lg font-bold text-zinc-900">
					{archivedRecipes.length === 0 ? 'No archived recipes' : 'No matches found in archive'}
				</h3>
				<p class="mt-1 max-w-sm text-sm text-zinc-500">
					{archivedRecipes.length === 0
						? 'When you archive recipes, they will appear here so you can restore them anytime or completely delete them.'
						: `No archived recipes match “${search.trim()}”.`}
				</p>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<div class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-zinc-50 shadow-inner">
					<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-300"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
				</div>
				<h3 class="text-lg font-bold text-zinc-900">
					{activeRecipes.length === 0 ? 'No active recipes' : 'No matches found'}
				</h3>
				<p class="mt-1 text-sm text-zinc-500">
					{activeRecipes.length === 0
						? 'Use Add recipe in the header above to create your first one.'
						: `No active recipes match “${search.trim()}”. Try another search or tap Add recipe in the header.`}
				</p>
			</div>
		{/if}
	{:else}
		<div class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
			{#each filtered as recipe (recipe.id)}
				<RecipeCard
					recipe={recipe}
					onCosting={() => openCosting(recipe.id)}
					onSeeRecipe={() => openDetail(recipe.id)}
					onArchive={() => handleArchive(recipe)}
					onRestore={() => handleRestore(recipe)}
					onDeletePermanently={() => promptPermanentDelete(recipe)}
				/>
			{/each}
		</div>
	{/if}
</section>

<!-- Floating Undo Notification Toast -->
{#if toastMessage}
	<div
		class="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white shadow-2xl ring-1 ring-white/10"
		role="alert"
	>
		<div class="flex items-center gap-2">
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-400"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
			<span>{toastMessage}</span>
		</div>
		{#if lastArchivedRecipe}
			<button
				type="button"
				class="rounded-xl bg-orange-600 px-3.5 py-1 text-xs font-bold text-white shadow transition hover:bg-orange-500 active:scale-95"
				onclick={handleUndoArchive}
			>
				Undo
			</button>
		{/if}
		<button
			type="button"
			class="text-zinc-400 hover:text-white"
			onclick={() => {
				toastMessage = null;
				lastArchivedRecipe = null;
			}}
			aria-label="Dismiss"
		>
			×
		</button>
	</div>
{/if}

<NewRecipeQuickModal open={quickAddOpen} onAdd={onConfirmAddRecipe} onClose={closeQuickRecipe} />

<RecipeCostingDrawer recipe={costingRecipe} open={costingRecipeId !== null} onClose={closeCosting} />

<RecipeDetailsModal
	recipe={detailRecipe}
	open={detailRecipeId !== null}
	onClose={closeDetail}
	onArchive={handleArchive}
	onRestore={handleRestore}
/>

<TypeToConfirmDeleteModal
	open={pendingPermanentDeleteRecipe !== null}
	title="Completely delete this recipe?"
	description={pendingPermanentDeleteRecipe
		? `This will permanently remove “${pendingPermanentDeleteRecipe.name}” and all its ingredients and data. This cannot be undone.`
		: ''}
	confirmPhrase="delete"
	onClose={() => (pendingPermanentDeleteRecipe = null)}
	onConfirm={executePermanentDelete}
/>
