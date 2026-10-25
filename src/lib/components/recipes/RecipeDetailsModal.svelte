<script lang="ts">
	import type { MeasureUnit, RecipeDTO } from '$lib/types/recipe';
	import { ingredientCatalog, MEASURE_UNIT_OPTIONS } from '$lib/state/ingredientCatalog.svelte';
	import { otherCatalog } from '$lib/state/otherCatalog.svelte';
	import AddIngredientMasterModal from '$lib/components/recipes/AddIngredientMasterModal.svelte';
	import AddOtherMasterModal from '$lib/components/recipes/AddOtherMasterModal.svelte';
	import TypeToConfirmDeleteModal from '$lib/components/TypeToConfirmDeleteModal.svelte';
	import {
		addRecipeIngredientLine,
		addRecipeOtherLine,
		archiveRecipe,
		deleteRecipeIngredientLine,
		deleteRecipeOtherLine,
		deleteRecipePermanently,
		unarchiveRecipe,
		updateRecipeIngredientLine,
		updateRecipeName,
		updateRecipeOtherLine
	} from '$lib/state/recipes.svelte';
	import { convertQuantity, unitLabel } from '$lib/utils/unitConvert';
	import { recipeIngredientSubtotal, recipeOtherSubtotal } from '$lib/utils/recipeCosting';
	import {
		batchesForProductName,
		defaultBatchForProduct,
		isBatchOutOfStock,
		productNameKey,
		recipeBatchOptionLabel,
		uniqueProductNames
	} from '$lib/utils/catalogBatch';
	import { formatPhp } from '$lib/utils/numberFormat';
	import RecipeAvailabilityBadge from '$lib/components/recipes/RecipeAvailabilityBadge.svelte';
	import RecipeAvailabilityCard from '$lib/components/recipes/RecipeAvailabilityCard.svelte';
	import { computeRecipeAvailability } from '$lib/utils/recipeAvailability';

	const {
		recipe,
		open,
		onClose,
		onArchive,
		onRestore
	}: {
		recipe: RecipeDTO | null;
		open: boolean;
		onClose: () => void;
		onArchive?: (recipe: RecipeDTO) => void;
		onRestore?: (recipe: RecipeDTO) => void;
	} = $props();

	let backdrop: HTMLDivElement | undefined = $state();

	let draftName = $state('');
	/** Segmented toggle for line category: ingredient or packaging/other */
	let addMode = $state<'ingredient' | 'other'>('ingredient');
	/** Filter tab inside recipe list: all, ingredient, other */
	let lineFilterTab = $state<'all' | 'ingredient' | 'other'>('all');

	let addIngredientProductName = $state('');
	let addIngredientMasterId = $state('');
	let addOtherProductName = $state('');
	let addOtherMasterId = $state('');
	let addQty = $state<number>(1);
	let addUnit = $state<MeasureUnit>('g');

	let quickAddIngredientOpen = $state(false);
	let quickAddOtherOpen = $state(false);

	let openedRecipeId = $state<string | null>(null);

	let pendingLineRemove = $state<{
		kind: 'ingredient' | 'other';
		lineId: string;
		label: string;
	} | null>(null);

	let addConversionReportShown = $state(false);
	let showCostingHelp = $state(false);

	type CombinedRow =
		| { kind: 'ingredient'; line: RecipeDTO['ingredientLines'][number] }
		| { kind: 'other'; line: RecipeDTO['otherLines'][number] };

	const masters = $derived(ingredientCatalog.items);
	const otherMasters = $derived(otherCatalog.items);

	const availability = $derived.by(() => {
		if (!recipe) return null;
		return computeRecipeAvailability(recipe, masters, otherMasters);
	});

	const combinedLines = $derived.by((): CombinedRow[] => {
		if (!recipe) return [];
		return [
			...recipe.ingredientLines.map((line) => ({ kind: 'ingredient' as const, line })),
			...recipe.otherLines.map((line) => ({ kind: 'other' as const, line }))
		];
	});

	const displayedLines = $derived.by(() => {
		if (lineFilterTab === 'ingredient') {
			return combinedLines.filter((r) => r.kind === 'ingredient');
		}
		if (lineFilterTab === 'other') {
			return combinedLines.filter((r) => r.kind === 'other');
		}
		return combinedLines;
	});

	const uniqueIngredientNames = $derived(uniqueProductNames(masters));
	const uniqueOtherNames = $derived(uniqueProductNames(otherMasters));
	const addIngredientBatches = $derived(batchesForProductName(masters, addIngredientProductName));
	const addOtherBatches = $derived(batchesForProductName(otherMasters, addOtherProductName));

	const ingSub = $derived(recipe ? recipeIngredientSubtotal(recipe, masters) : 0);
	const othSub = $derived(recipe ? recipeOtherSubtotal(recipe, otherMasters) : 0);
	const totalCogs = $derived(ingSub + othSub);

	function askRemoveIngredient(lineId: string, label: string): void {
		pendingLineRemove = { kind: 'ingredient', lineId, label };
	}

	function askRemoveOther(lineId: string, label: string): void {
		pendingLineRemove = { kind: 'other', lineId, label };
	}

	function executeLineRemove(): void {
		if (!recipe || !pendingLineRemove) return;
		if (pendingLineRemove.kind === 'ingredient') {
			deleteRecipeIngredientLine(recipe.id, pendingLineRemove.lineId);
		} else {
			deleteRecipeOtherLine(recipe.id, pendingLineRemove.lineId);
		}
		pendingLineRemove = null;
	}

	function executeRecipeArchive(): void {
		if (!recipe) return;
		const r = recipe;
		archiveRecipe(r.id);
		pendingLineRemove = null;
		onArchive?.(r);
		onClose();
	}

	function executeRecipeRestore(): void {
		if (!recipe) return;
		const r = recipe;
		unarchiveRecipe(r.id);
		pendingLineRemove = null;
		onRestore?.(r);
		onClose();
	}

	function executeRecipeDeletePermanently(): void {
		if (!recipe) return;
		deleteRecipePermanently(recipe.id);
		pendingLineRemove = null;
		onClose();
	}

	$effect(() => {
		if (open && recipe && openedRecipeId !== recipe.id) {
			openedRecipeId = recipe.id;
			addMode = 'ingredient';
			lineFilterTab = 'all';
			addConversionReportShown = false;
			showCostingHelp = false;
		}
		if (!open) openedRecipeId = null;
	});

	$effect(() => {
		if (recipe) draftName = recipe.name;
	});

	$effect(() => {
		if (!open) {
			quickAddIngredientOpen = false;
			quickAddOtherOpen = false;
			addConversionReportShown = false;
			showCostingHelp = false;
		}
	});

	$effect(() => {
		if (!uniqueIngredientNames.length) {
			addIngredientProductName = '';
			addIngredientMasterId = '';
			return;
		}
		if (
			!addIngredientProductName ||
			!uniqueIngredientNames.some((n) => productNameKey(n) === productNameKey(addIngredientProductName))
		) {
			addIngredientProductName = uniqueIngredientNames[0]!;
		}
	});

	$effect(() => {
		const name = addIngredientProductName;
		if (!name) return;
		const batches = batchesForProductName(masters, name);
		if (!batches.some((b) => b.id === addIngredientMasterId)) {
			const batch = defaultBatchForProduct(masters, name);
			if (batch) {
				addIngredientMasterId = batch.id;
				// Auto-pick sensible default unit from the ingredient's base unit
				if (batch.baseUnit && addMode === 'ingredient') {
					addUnit = batch.baseUnit as MeasureUnit;
				}
			}
		}
	});

	$effect(() => {
		if (!uniqueOtherNames.length) {
			addOtherProductName = '';
			addOtherMasterId = '';
			return;
		}
		if (
			!addOtherProductName ||
			!uniqueOtherNames.some((n) => productNameKey(n) === productNameKey(addOtherProductName))
		) {
			addOtherProductName = uniqueOtherNames[0]!;
		}
	});

	$effect(() => {
		const name = addOtherProductName;
		if (!name) return;
		const batches = batchesForProductName(otherMasters, name);
		if (!batches.some((b) => b.id === addOtherMasterId)) {
			const batch = defaultBatchForProduct(otherMasters, name);
			if (batch) {
				addOtherMasterId = batch.id;
				if (batch.baseUnit && addMode === 'other') {
					addUnit = batch.baseUnit as MeasureUnit;
				}
			}
		}
	});

	function onAddIngredientProductChange(name: string): void {
		addIngredientProductName = name;
		const batch = defaultBatchForProduct(masters, name);
		addIngredientMasterId = batch?.id ?? '';
		if (batch?.baseUnit) addUnit = batch.baseUnit as MeasureUnit;
	}

	function onAddOtherProductChange(name: string): void {
		addOtherProductName = name;
		const batch = defaultBatchForProduct(otherMasters, name);
		addOtherMasterId = batch?.id ?? '';
		if (batch?.baseUnit) addUnit = batch.baseUnit as MeasureUnit;
	}

	function onSwitchAddMode(mode: 'ingredient' | 'other'): void {
		addMode = mode;
		addConversionReportShown = false;
		if (mode === 'ingredient') {
			const m = masters.find((x) => x.id === addIngredientMasterId);
			if (m?.baseUnit) addUnit = m.baseUnit as MeasureUnit;
			else addUnit = 'g';
		} else {
			const om = otherMasters.find((x) => x.id === addOtherMasterId);
			if (om?.baseUnit) addUnit = om.baseUnit as MeasureUnit;
			else addUnit = 'piece';
		}
	}

	function fmt(n: number): string {
		return formatPhp(n);
	}

	function ingredientBatchesForLine(current: (typeof masters)[number] | undefined): typeof masters {
		if (!current) return [];
		return batchesForProductName(masters, current.name);
	}

	function otherBatchesForLine(current: (typeof otherMasters)[number] | undefined): typeof otherMasters {
		if (!current) return [];
		return batchesForProductName(otherMasters, current.name);
	}

	function ingLineCost(line: RecipeDTO['ingredientLines'][number]): number {
		const m = masters.find((x) => x.id === line.ingredientMasterId);
		if (!m) return 0;
		const q = convertQuantity(line.quantity, line.unit, m.baseUnit);
		if (q === null) return 0;
		return q * m.unitCost;
	}

	function otherLineCost(line: RecipeDTO['otherLines'][number]): number {
		const m = otherMasters.find((x) => x.id === line.otherMasterId);
		if (!m) return 0;
		const q = convertQuantity(line.quantity, line.unit, m.baseUnit);
		if (q === null) return 0;
		return q * m.unitCost;
	}

	function onBackdropMouseDown(e: MouseEvent): void {
		if (quickAddIngredientOpen || quickAddOtherOpen) return;
		if (e.target === backdrop) onClose();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			if (quickAddIngredientOpen || quickAddOtherOpen) return;
			onClose();
		}
	}

	function persistName(): void {
		if (!recipe) return;
		updateRecipeName(recipe.id, draftName);
	}

	function submitAddLine(e: Event): void {
		e.preventDefault();
		if (!recipe) return;
		if (!addPreview || !addPreview.qtyOk) {
			if (addPreview && !addPreview.qtyOk) addConversionReportShown = true;
			return;
		}
		addConversionReportShown = false;
		if (addMode === 'ingredient') {
			if (!masters.length || !addIngredientMasterId) return;
			addRecipeIngredientLine(recipe.id, addIngredientMasterId, addQty, addUnit);
		} else {
			if (!otherMasters.length || !addOtherMasterId) return;
			addRecipeOtherLine(recipe.id, addOtherMasterId, addQty, addUnit);
		}
		// Reset quantity to 1 for quick subsequent adds
		addQty = 1;
	}

	const selectedAddIngredient = $derived(masters.find((x) => x.id === addIngredientMasterId));
	const selectedAddOther = $derived(otherMasters.find((x) => x.id === addOtherMasterId));
	const canAddIngredient = $derived(
		masters.length > 0 &&
			Boolean(addIngredientMasterId) &&
			Boolean(selectedAddIngredient) &&
			!isBatchOutOfStock(selectedAddIngredient!)
	);
	const canAddOther = $derived(
		otherMasters.length > 0 &&
			Boolean(addOtherMasterId) &&
			Boolean(selectedAddOther) &&
			!isBatchOutOfStock(selectedAddOther!)
	);
	const canSubmitAdd = $derived(addMode === 'ingredient' ? canAddIngredient : canAddOther);

	type AddPreview =
		| {
				kind: 'ingredient' | 'other';
				name: string;
				baseUnit: string;
				unitCost: number;
				lineCost: number | null;
				qtyOk: boolean;
		  }
		| null;

	const addPreview = $derived.by((): AddPreview => {
		if (addMode === 'ingredient') {
			const m = masters.find((x) => x.id === addIngredientMasterId);
			if (!m || !addIngredientMasterId) return null;
			const q = convertQuantity(addQty, addUnit, m.baseUnit);
			const qtyOk = q !== null && q >= 0;
			const lineCost = qtyOk && q !== null ? q * m.unitCost : null;
			return { kind: 'ingredient', name: m.name, baseUnit: m.baseUnit, unitCost: m.unitCost, lineCost, qtyOk };
		}
		const m = otherMasters.find((x) => x.id === addOtherMasterId);
		if (!m || !addOtherMasterId) return null;
		const q = convertQuantity(addQty, addUnit, m.baseUnit);
		const qtyOk = q !== null && q >= 0;
		const lineCost = qtyOk && q !== null ? q * m.unitCost : null;
		return { kind: 'other', name: m.name, baseUnit: m.baseUnit, unitCost: m.unitCost, lineCost, qtyOk };
	});
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open && recipe}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={backdrop}
		class="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/60 p-0 backdrop-blur-sm transition-all sm:items-center sm:p-4 md:p-6"
		onmousedown={onBackdropMouseDown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="recipe-name-field"
		tabindex="-1"
	>
		<!-- Main Modal Card: Responsive full-screen bottom-sheet on phone, centered modal on tablet/desktop -->
		<div
			class="flex max-h-[96dvh] w-full flex-col overflow-hidden rounded-t-[2rem] border border-zinc-200/80 bg-white shadow-2xl ring-1 ring-black/10 transition-all sm:max-h-[92vh] sm:max-w-3xl sm:rounded-3xl lg:max-w-4xl"
		>
			<!-- Modern Gradient Header -->
			<div class="relative shrink-0 overflow-hidden bg-zinc-900 px-4 py-4 text-white sm:px-6 sm:py-5">
				<div class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-500/25 blur-3xl"></div>
				<div class="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-amber-500/15 blur-2xl"></div>

				<div class="relative flex items-center justify-between gap-3">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2.5">
							<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-950/40">
								<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
									<path d="M7 2v20" />
									<path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
								</svg>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400">Recipe Details</p>
								<div class="relative flex items-center">
									<input
										id="recipe-name-field"
										bind:value={draftName}
										onchange={persistName}
										placeholder="Recipe name"
										class="w-full truncate border-b border-white/20 bg-transparent py-0.5 text-lg font-bold tracking-tight text-white outline-none transition-colors focus:border-orange-400 sm:text-2xl"
									/>
								</div>
							</div>
						</div>

						<!-- Quick Badges & Availability -->
						<div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
							<span class="inline-flex items-center rounded-lg bg-zinc-800/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 ring-1 ring-white/10">
								{recipe.ingredientLines.length} ingr
							</span>
							<span class="inline-flex items-center rounded-lg bg-zinc-800/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 ring-1 ring-white/10">
								{recipe.otherLines.length} others
							</span>
							{#if availability}
								<RecipeAvailabilityBadge {availability} size="sm" showBottleneck={false} />
							{/if}
						</div>
					</div>

					<!-- Close Button -->
					<button
						type="button"
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/15 hover:text-white active:scale-95"
						onclick={onClose}
						aria-label="Close"
					>
						<span class="text-2xl leading-none">&times;</span>
					</button>
				</div>
			</div>

			<!-- Scrollable Middle Body -->
			<div class="recipe-details-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-zinc-50/70 p-4 sm:p-6 space-y-5">
				<!-- Archived Banner if applicable -->
				{#if recipe.archived}
					<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 p-3.5 text-amber-950 shadow-xs sm:p-4">
						<div class="flex items-center gap-2.5">
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-800">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
							</div>
							<div>
								<p class="text-xs font-bold uppercase tracking-wider text-amber-900">Archived Recipe</p>
								<p class="text-xs text-amber-800/90">This recipe is hidden from active menu calculations.</p>
							</div>
						</div>
						<button
							type="button"
							class="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-amber-700 active:scale-95"
							onclick={executeRecipeRestore}
						>
							Restore
						</button>
					</div>
				{/if}

				<!-- Real-time Availability Card -->
				{#if availability}
					<RecipeAvailabilityCard {availability} />
				{/if}

				<!-- Recipe Lines Header with Filter Tabs -->
				<div class="space-y-3">
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/80 pb-2">
						<div class="flex items-center gap-2">
							<h3 class="text-sm font-bold uppercase tracking-wider text-zinc-800 sm:text-base">Recipe Items</h3>
							<span class="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-bold tabular-nums text-zinc-700">
								{combinedLines.length}
							</span>
						</div>

						<!-- Filter Tabs: All, Ingredients, Packaging -->
						<div class="flex rounded-xl bg-zinc-200/80 p-0.5 text-xs font-semibold">
							<button
								type="button"
								class="rounded-lg px-2.5 py-1 transition {lineFilterTab === 'all' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}"
								onclick={() => (lineFilterTab = 'all')}
							>
								All ({combinedLines.length})
							</button>
							<button
								type="button"
								class="rounded-lg px-2.5 py-1 transition {lineFilterTab === 'ingredient' ? 'bg-white text-emerald-800 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}"
								onclick={() => (lineFilterTab = 'ingredient')}
							>
								Ingredients ({recipe.ingredientLines.length})
							</button>
							<button
								type="button"
								class="rounded-lg px-2.5 py-1 transition {lineFilterTab === 'other' ? 'bg-white text-sky-900 shadow-xs' : 'text-zinc-600 hover:text-zinc-900'}"
								onclick={() => (lineFilterTab = 'other')}
							>
								Packaging ({recipe.otherLines.length})
							</button>
						</div>
					</div>

					<!-- DESKTOP & TABLET: Clean Modern Table (sm:block) -->
					<div class="hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs sm:block">
						<table class="w-full text-left text-sm">
							<thead class="border-b border-zinc-100 bg-zinc-50/80 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
								<tr>
									<th class="px-4 py-3">Item & Sourcing</th>
									<th class="px-4 py-3">Type</th>
									<th class="px-4 py-3">Qty & Unit</th>
									<th class="px-4 py-3 text-right">Cost / Unit</th>
									<th class="px-4 py-3 text-right">Line Total</th>
									<th class="w-12 px-3 py-3 text-center"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-zinc-100">
								{#each displayedLines as row (row.kind + row.line.id)}
									{#if row.kind === 'ingredient'}
										{@const line = row.line}
										{@const m = masters.find((x) => x.id === line.ingredientMasterId)}
										<tr class="transition hover:bg-zinc-50/60">
											<td class="px-4 py-3 align-middle">
												<div class="min-w-0">
													<p class="font-bold text-zinc-900">{m?.name ?? 'Missing Ingredient'}</p>
													<div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
														{#if m?.supplier}
															<span>{m.supplier}</span>
															<span>·</span>
														{/if}
														<span class="rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-800">
															{m ? formatPhp(m.packagePrice) : '—'}
														</span>
														{#if m && isBatchOutOfStock(m)}
															<span class="rounded bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold uppercase text-rose-700">Out of stock</span>
														{/if}
													</div>
													{#if ingredientBatchesForLine(m).length > 1}
														<select
															class="mt-1.5 block w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus:border-orange-400"
															value={line.ingredientMasterId}
															onchange={(e) =>
																updateRecipeIngredientLine(recipe.id, line.id, {
																	ingredientMasterId: (e.currentTarget as HTMLSelectElement).value
																})}
														>
															{#each ingredientBatchesForLine(m) as cat (cat.id)}
																<option value={cat.id} disabled={isBatchOutOfStock(cat) && cat.id !== line.ingredientMasterId}>
																	{recipeBatchOptionLabel(cat)}
																</option>
															{/each}
														</select>
													{/if}
												</div>
											</td>
											<td class="px-4 py-3 align-middle">
												<span class="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
													Ingr
												</span>
											</td>
											<td class="px-4 py-3 align-middle">
												<div class="flex items-center gap-1.5">
													<input
														type="number"
														min="0"
														step="any"
														class="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-center text-xs font-semibold tabular-nums text-zinc-900 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400"
														value={line.quantity}
														onchange={(e) =>
															updateRecipeIngredientLine(recipe.id, line.id, {
																quantity: +((e.currentTarget as HTMLInputElement).value || 0)
															})}
													/>
													<select
														class="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 outline-none focus:border-orange-400"
														value={line.unit}
														onchange={(e) =>
															updateRecipeIngredientLine(recipe.id, line.id, {
																unit: (e.currentTarget as HTMLSelectElement).value as MeasureUnit
															})}
													>
														{#each MEASURE_UNIT_OPTIONS as u}
															<option value={u.value}>{u.label}</option>
														{/each}
													</select>
												</div>
											</td>
											<td class="px-4 py-3 text-right align-middle text-xs tabular-nums text-zinc-600">
												{m ? fmt(m.unitCost) : '—'}
											</td>
											<td class="px-4 py-3 text-right align-middle text-sm font-bold tabular-nums text-zinc-900">
												{fmt(ingLineCost(line))}
											</td>
											<td class="px-3 py-3 text-center align-middle">
												<button
													type="button"
													class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
													title="Remove ingredient"
													onclick={() => askRemoveIngredient(line.id, m?.name ?? 'Ingredient')}
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
												</button>
											</td>
										</tr>
									{:else}
										{@const line = row.line}
										{@const om = otherMasters.find((x) => x.id === line.otherMasterId)}
										<tr class="transition hover:bg-zinc-50/60">
											<td class="px-4 py-3 align-middle">
												<div class="min-w-0">
													<p class="font-bold text-zinc-900">{om?.name ?? 'Missing Item'}</p>
													<div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
														{#if om?.supplier}
															<span>{om.supplier}</span>
															<span>·</span>
														{/if}
														<span class="rounded bg-sky-50 px-1.5 py-0.2 text-[10px] font-semibold text-sky-800">
															{om ? formatPhp(om.packagePrice) : '—'}
														</span>
														{#if om && isBatchOutOfStock(om)}
															<span class="rounded bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold uppercase text-rose-700">Out of stock</span>
														{/if}
													</div>
													{#if otherBatchesForLine(om).length > 1}
														<select
															class="mt-1.5 block w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus:border-orange-400"
															value={line.otherMasterId}
															onchange={(e) =>
																updateRecipeOtherLine(recipe.id, line.id, {
																	otherMasterId: (e.currentTarget as HTMLSelectElement).value
																})}
														>
															{#each otherBatchesForLine(om) as cat (cat.id)}
																<option value={cat.id} disabled={isBatchOutOfStock(cat) && cat.id !== line.otherMasterId}>
																	{recipeBatchOptionLabel(cat)}
																</option>
															{/each}
														</select>
													{/if}
												</div>
											</td>
											<td class="px-4 py-3 align-middle">
												<span class="inline-flex rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800">
													Other
												</span>
											</td>
											<td class="px-4 py-3 align-middle">
												<div class="flex items-center gap-1.5">
													<input
														type="number"
														min="0"
														step="any"
														class="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-center text-xs font-semibold tabular-nums text-zinc-900 outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400"
														value={line.quantity}
														onchange={(e) =>
															updateRecipeOtherLine(recipe.id, line.id, {
																quantity: +((e.currentTarget as HTMLInputElement).value || 0)
															})}
													/>
													<select
														class="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 outline-none focus:border-orange-400"
														value={line.unit}
														onchange={(e) =>
															updateRecipeOtherLine(recipe.id, line.id, {
																unit: (e.currentTarget as HTMLSelectElement).value as MeasureUnit
															})}
													>
														{#each MEASURE_UNIT_OPTIONS as u}
															<option value={u.value}>{u.label}</option>
														{/each}
													</select>
												</div>
											</td>
											<td class="px-4 py-3 text-right align-middle text-xs tabular-nums text-zinc-600">
												{om ? fmt(om.unitCost) : '—'}
											</td>
											<td class="px-4 py-3 text-right align-middle text-sm font-bold tabular-nums text-zinc-900">
												{fmt(otherLineCost(line))}
											</td>
											<td class="px-3 py-3 text-center align-middle">
												<button
													type="button"
													class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
													title="Remove packaging line"
													onclick={() => askRemoveOther(line.id, om?.name ?? 'Packaging')}
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
												</button>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>

					<!-- MOBILE (PHONE): Touch-Friendly Item Cards (block sm:hidden) -->
					<div class="block space-y-3 sm:hidden">
						{#each displayedLines as row (row.kind + row.line.id)}
							{#if row.kind === 'ingredient'}
								{@const line = row.line}
								{@const m = masters.find((x) => x.id === line.ingredientMasterId)}
								<div class="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-xs space-y-2.5">
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0">
											<div class="flex items-center gap-1.5">
												<span class="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold uppercase text-emerald-800">Ingr</span>
												<p class="font-bold text-zinc-900 truncate">{m?.name ?? 'Missing Ingredient'}</p>
											</div>
											{#if m?.supplier}
												<p class="mt-0.5 text-xs text-zinc-500">{m.supplier}</p>
											{/if}
										</div>
										<button
											type="button"
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
											onclick={() => askRemoveIngredient(line.id, m?.name ?? 'Ingredient')}
											aria-label="Remove"
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
										</button>
									</div>

									<div class="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 p-2 text-xs">
										<div class="flex items-center gap-2">
											<input
												type="number"
												min="0"
												step="any"
												class="w-16 rounded-lg border border-zinc-200 bg-white p-1.5 text-center font-bold tabular-nums text-zinc-900 outline-none focus:border-orange-400"
												value={line.quantity}
												onchange={(e) =>
													updateRecipeIngredientLine(recipe.id, line.id, {
														quantity: +((e.currentTarget as HTMLInputElement).value || 0)
													})}
											/>
											<select
												class="rounded-lg border border-zinc-200 bg-white p-1.5 font-medium text-zinc-700 outline-none focus:border-orange-400"
												value={line.unit}
												onchange={(e) =>
													updateRecipeIngredientLine(recipe.id, line.id, {
														unit: (e.currentTarget as HTMLSelectElement).value as MeasureUnit
													})}
											>
												{#each MEASURE_UNIT_OPTIONS as u}
													<option value={u.value}>{u.label}</option>
												{/each}
											</select>
										</div>

										<div class="text-right">
											<p class="text-[10px] uppercase font-bold text-zinc-400">Line Cost</p>
											<p class="text-sm font-bold tabular-nums text-zinc-900">{fmt(ingLineCost(line))}</p>
										</div>
									</div>
								</div>
							{:else}
								{@const line = row.line}
								{@const om = otherMasters.find((x) => x.id === line.otherMasterId)}
								<div class="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-xs space-y-2.5">
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0">
											<div class="flex items-center gap-1.5">
												<span class="rounded bg-sky-100 px-1.5 py-0.2 text-[9px] font-bold uppercase text-sky-800">Other</span>
												<p class="font-bold text-zinc-900 truncate">{om?.name ?? 'Missing Item'}</p>
											</div>
											{#if om?.supplier}
												<p class="mt-0.5 text-xs text-zinc-500">{om.supplier}</p>
											{/if}
										</div>
										<button
											type="button"
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95"
											onclick={() => askRemoveOther(line.id, om?.name ?? 'Packaging')}
											aria-label="Remove"
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
										</button>
									</div>

									<div class="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 p-2 text-xs">
										<div class="flex items-center gap-2">
											<input
												type="number"
												min="0"
												step="any"
												class="w-16 rounded-lg border border-zinc-200 bg-white p-1.5 text-center font-bold tabular-nums text-zinc-900 outline-none focus:border-orange-400"
												value={line.quantity}
												onchange={(e) =>
													updateRecipeOtherLine(recipe.id, line.id, {
														quantity: +((e.currentTarget as HTMLInputElement).value || 0)
													})}
											/>
											<select
												class="rounded-lg border border-zinc-200 bg-white p-1.5 font-medium text-zinc-700 outline-none focus:border-orange-400"
												value={line.unit}
												onchange={(e) =>
													updateRecipeOtherLine(recipe.id, line.id, {
														unit: (e.currentTarget as HTMLSelectElement).value as MeasureUnit
													})}
											>
												{#each MEASURE_UNIT_OPTIONS as u}
													<option value={u.value}>{u.label}</option>
												{/each}
											</select>
										</div>

										<div class="text-right">
											<p class="text-[10px] uppercase font-bold text-zinc-400">Line Cost</p>
											<p class="text-sm font-bold tabular-nums text-zinc-900">{fmt(otherLineCost(line))}</p>
										</div>
									</div>
								</div>
							{/if}
						{/each}
					</div>

					<!-- Empty State -->
					{#if displayedLines.length === 0}
						<div class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white/70 py-10 px-4 text-center">
							<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
							</div>
							<h4 class="mt-3 text-sm font-bold text-zinc-800">No items added to this recipe yet</h4>
							<p class="mt-1 max-w-sm text-xs text-zinc-500">
								Use the section below to add ingredients or packaging cups, lids, and straws to calculate this recipe's cost and availability.
							</p>
						</div>
					{/if}

					<!-- Cost Totals Summary Banner -->
					<div class="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-3.5 text-xs shadow-xs sm:grid-cols-3">
						<div class="rounded-xl bg-zinc-50 p-2.5">
							<p class="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Ingredients</p>
							<p class="mt-0.5 text-base font-bold tabular-nums text-zinc-900">{fmt(ingSub)}</p>
						</div>
						<div class="rounded-xl bg-zinc-50 p-2.5">
							<p class="text-[10px] font-bold uppercase tracking-wider text-sky-700">Packaging / Other</p>
							<p class="mt-0.5 text-base font-bold tabular-nums text-zinc-900">{fmt(othSub)}</p>
						</div>
						<div class="col-span-2 rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 p-2.5 border border-orange-200/80 sm:col-span-1">
							<p class="text-[10px] font-bold uppercase tracking-wider text-orange-700">Total Recipe COGS</p>
							<p class="mt-0.5 text-xl font-bold tabular-nums text-orange-950">{fmt(totalCogs)}</p>
						</div>
					</div>
				</div>
			</div>

			<!-- User-Friendly Add Ingredient / Packaging Form (Responsive & Intuitive) -->
			<div class="shrink-0 border-t border-zinc-200/90 bg-white px-4 py-3.5 shadow-lg sm:px-6 sm:py-4">
				<form class="space-y-3" onsubmit={submitAddLine}>
					<!-- Add Type Selector & Quick Create Link -->
					<div class="flex flex-wrap items-center justify-between gap-2">
						<!-- Segmented Pill -->
						<div class="flex rounded-xl bg-zinc-100 p-1 ring-1 ring-zinc-200/80">
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition {addMode === 'ingredient'
									? 'bg-white text-emerald-800 shadow-xs ring-1 ring-zinc-200/80'
									: 'text-zinc-600 hover:text-zinc-900'}"
								onclick={() => onSwitchAddMode('ingredient')}
							>
								<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
								<span>Add Ingredient</span>
							</button>
							<button
								type="button"
								class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition {addMode === 'other'
									? 'bg-white text-sky-900 shadow-xs ring-1 ring-zinc-200/80'
									: 'text-zinc-600 hover:text-zinc-900'}"
								onclick={() => onSwitchAddMode('other')}
							>
								<span class="h-2 w-2 rounded-full bg-sky-500"></span>
								<span>Add Packaging</span>
							</button>
						</div>

						<!-- Create new in catalog button -->
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-2xs transition hover:bg-zinc-50 active:scale-95"
							onclick={() => (addMode === 'ingredient' ? (quickAddIngredientOpen = true) : (quickAddOtherOpen = true))}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
							<span>New {addMode === 'ingredient' ? 'Ingredient' : 'Packaging'}</span>
						</button>
					</div>

					<!-- Form Inputs: Responsive Stack on Phone, Clean Inline/Grid on Tablet & Desktop -->
					<div class="grid gap-2.5 sm:grid-cols-12 sm:items-center">
						<!-- Product Name / Item Dropdown -->
						<div class="sm:col-span-5">
							<label class="sr-only" for="modal-add-product">Product Item</label>
							{#if addMode === 'ingredient'}
								<select
									id="modal-add-product"
									value={addIngredientProductName}
									disabled={uniqueIngredientNames.length === 0}
									class="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 disabled:bg-zinc-100 disabled:text-zinc-400"
									onchange={(e) => onAddIngredientProductChange((e.currentTarget as HTMLSelectElement).value)}
								>
									{#if uniqueIngredientNames.length === 0}
										<option value="">— No ingredients in catalog —</option>
									{:else}
										{#each uniqueIngredientNames as name (name)}
											<option value={name}>{name}</option>
										{/each}
									{/if}
								</select>
							{:else}
								<select
									id="modal-add-product"
									value={addOtherProductName}
									disabled={uniqueOtherNames.length === 0}
									class="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 disabled:bg-zinc-100 disabled:text-zinc-400"
									onchange={(e) => onAddOtherProductChange((e.currentTarget as HTMLSelectElement).value)}
								>
									{#if uniqueOtherNames.length === 0}
										<option value="">— No packaging items in catalog —</option>
									{:else}
										{#each uniqueOtherNames as name (name)}
											<option value={name}>{name}</option>
										{/each}
									{/if}
								</select>
							{/if}
						</div>

						<!-- Quantity & Unit (Side-by-side on all screens) -->
						<div class="flex items-center gap-2 sm:col-span-4">
							<div class="relative flex-1">
								<input
									id="modal-add-qty"
									type="number"
									min="0"
									step="any"
									placeholder="Qty"
									bind:value={addQty}
									class="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-center text-sm font-bold tabular-nums text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15"
								/>
							</div>
							<div class="flex-1">
								<select
									id="modal-add-unit"
									bind:value={addUnit}
									class="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15"
								>
									{#each MEASURE_UNIT_OPTIONS as u}
										<option value={u.value}>{u.label}</option>
									{/each}
								</select>
							</div>
						</div>

						<!-- Submit Button -->
						<div class="sm:col-span-3">
							<button
								type="submit"
								disabled={!canSubmitAdd}
								class="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 {addMode ===
								'ingredient'
									? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 shadow-orange-900/20'
									: 'bg-gradient-to-r from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 shadow-zinc-900/20'}"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
								<span>Add {addMode === 'ingredient' ? 'Ingredient' : 'Packaging'}</span>
							</button>
						</div>
					</div>

					<!-- Secondary: Batch/Price tier selector (only shown when multiple price tiers exist) -->
					{#if addMode === 'ingredient' && addIngredientBatches.length > 1}
						<div class="flex items-center gap-2 rounded-xl bg-zinc-50 p-2 text-xs">
							<span class="font-bold text-zinc-500 shrink-0">Price Tier:</span>
							<select
								bind:value={addIngredientMasterId}
								class="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none"
							>
								{#each addIngredientBatches as cat (cat.id)}
									<option value={cat.id} disabled={isBatchOutOfStock(cat)}>
										{recipeBatchOptionLabel(cat)}
									</option>
								{/each}
							</select>
						</div>
					{:else if addMode === 'other' && addOtherBatches.length > 1}
						<div class="flex items-center gap-2 rounded-xl bg-zinc-50 p-2 text-xs">
							<span class="font-bold text-zinc-500 shrink-0">Price Tier:</span>
							<select
								bind:value={addOtherMasterId}
								class="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 outline-none"
							>
								{#each addOtherBatches as cat (cat.id)}
									<option value={cat.id} disabled={isBatchOutOfStock(cat)}>
										{recipeBatchOptionLabel(cat)}
									</option>
								{/each}
							</select>
						</div>
					{/if}

					<!-- Live Cost Preview & Helpful Conversion Notice -->
					{#if addPreview && addPreview.qtyOk && addPreview.lineCost !== null}
						<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
							<div class="flex items-center gap-1.5">
								<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
								<span>
									<strong>{addPreview.name}</strong> · Base {addPreview.baseUnit} at <strong>{fmt(addPreview.unitCost)}/{addPreview.baseUnit}</strong>
								</span>
							</div>
							<div class="font-bold text-emerald-800">
								Line Cost: <span>{fmt(addPreview.lineCost)}</span>
							</div>
						</div>
					{:else if addConversionReportShown && addPreview && !addPreview.qtyOk}
						<div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
							<p class="font-bold">Unit mismatch:</p>
							<p class="mt-0.5">
								Cannot convert <strong>{unitLabel(addUnit)}</strong> to catalog base unit <strong>{addPreview.baseUnit}</strong>. Try choosing <strong>{addPreview.baseUnit}</strong> or compatible units.
							</p>
						</div>
					{/if}
				</form>
			</div>
		</div>
	</div>
{/if}

<AddIngredientMasterModal bind:open={quickAddIngredientOpen} />
<AddOtherMasterModal bind:open={quickAddOtherOpen} />

<TypeToConfirmDeleteModal
	open={pendingLineRemove !== null}
	title={pendingLineRemove?.kind === 'other' ? 'Remove other line?' : 'Remove ingredient line?'}
	description={pendingLineRemove ? `Remove “${pendingLineRemove.label}” from this recipe.` : ''}
	onClose={() => (pendingLineRemove = null)}
	onConfirm={executeLineRemove}
/>
