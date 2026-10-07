<script lang="ts">
	import type { MeasureUnit, RecipeDTO } from '$lib/types/recipe';
	import { ingredientCatalog, MEASURE_UNIT_OPTIONS } from '$lib/state/ingredientCatalog.svelte';
	import { otherCatalog } from '$lib/state/otherCatalog.svelte';
	import AddIngredientMasterModal from '$lib/components/recipes/AddIngredientMasterModal.svelte';
	import AddOtherMasterModal from '$lib/components/recipes/AddOtherMasterModal.svelte';
	import TypeToConfirmDeleteModal from '$lib/components/TypeToConfirmDeleteModal.svelte';
	import { costingSettings } from '$lib/state/costingSettings.svelte';
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
	import { convertQuantity } from '$lib/utils/unitConvert';
	import { recipeIngredientSubtotal, recipeOtherSubtotal } from '$lib/utils/recipeCosting';
	import { batchesForProductName, defaultBatchForProduct, isBatchOutOfStock, productNameKey, recipeBatchOptionLabel, uniqueProductNames } from '$lib/utils/catalogBatch';
	import { formatPhp } from '$lib/utils/numberFormat';

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
	/** Single add form: switch type with segmented control */
	let addMode = $state<'ingredient' | 'other'>('ingredient');
	let addIngredientMasterId = $state('');
	let addIngredientProductName = $state('');
	let addOtherMasterId = $state('');
	let addOtherProductName = $state('');
	let addQty = $state(1);
	let addUnit = $state<MeasureUnit>('g');

	let quickAddIngredientOpen = $state(false);
	let quickAddOtherOpen = $state(false);

	let openedRecipeId = $state<string | null>(null);

	let pendingLineRemove = $state<
		| { kind: 'ingredient'; lineId: string; label: string }
		| { kind: 'other'; lineId: string; label: string }
		| null
	>(null);

	let pendingRecipeDelete = $state(false);
	/** Shown only after user taps Add with a unit that doesn’t convert to the catalog base. */
	let addConversionReportShown = $state(false);
	let costingPathHelpOpen = $state(false);
	/** Taller / wider modal so more recipe lines fit on screen without scrolling. */
	let linesListExpanded = $state(false);

	type CombinedRow =
		| { kind: 'ingredient'; line: RecipeDTO['ingredientLines'][number] }
		| { kind: 'other'; line: RecipeDTO['otherLines'][number] };

	const masters = $derived(ingredientCatalog.items);
	const otherMasters = $derived(otherCatalog.items);

	const combinedLines = $derived.by((): CombinedRow[] => {
		if (!recipe) return [];
		return [
			...recipe.ingredientLines.map((line) => ({ kind: 'ingredient' as const, line })),
			...recipe.otherLines.map((line) => ({ kind: 'other' as const, line }))
		];
	});

	const uniqueIngredientNames = $derived(uniqueProductNames(masters));
	const uniqueOtherNames = $derived(uniqueProductNames(otherMasters));
	const addIngredientBatches = $derived(batchesForProductName(masters, addIngredientProductName));
	const addOtherBatches = $derived(batchesForProductName(otherMasters, addOtherProductName));

	const ingSub = $derived(recipe ? recipeIngredientSubtotal(recipe, masters) : 0);
	const othSub = $derived(recipe ? recipeOtherSubtotal(recipe, otherMasters) : 0);

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
		pendingRecipeDelete = false;
		pendingLineRemove = null;
		onArchive?.(r);
		onClose();
	}

	function executeRecipeRestore(): void {
		if (!recipe) return;
		const r = recipe;
		unarchiveRecipe(r.id);
		pendingRecipeDelete = false;
		pendingLineRemove = null;
		onRestore?.(r);
		onClose();
	}

	function executeRecipeDeletePermanently(): void {
		if (!recipe) return;
		deleteRecipePermanently(recipe.id);
		pendingRecipeDelete = false;
		pendingLineRemove = null;
		onClose();
	}

	$effect(() => {
		if (open && recipe && openedRecipeId !== recipe.id) {
			openedRecipeId = recipe.id;
			addMode = 'ingredient';
			addConversionReportShown = false;
			linesListExpanded = false;
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
			pendingRecipeDelete = false;
			addConversionReportShown = false;
			costingPathHelpOpen = false;
			linesListExpanded = false;
		}
	});

	$effect(() => {
		if (addPreview?.qtyOk) addConversionReportShown = false;
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
			if (batch) addIngredientMasterId = batch.id;
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
			if (batch) addOtherMasterId = batch.id;
		}
	});

	function onAddIngredientProductChange(name: string): void {
		addIngredientProductName = name;
		const batch = defaultBatchForProduct(masters, name);
		addIngredientMasterId = batch?.id ?? '';
	}

	function onAddOtherProductChange(name: string): void {
		addOtherProductName = name;
		const batch = defaultBatchForProduct(otherMasters, name);
		addOtherMasterId = batch?.id ?? '';
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
		if (quickAddIngredientOpen || quickAddOtherOpen || pendingRecipeDelete) return;
		if (e.target === backdrop) onClose();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			if (pendingRecipeDelete) {
				pendingRecipeDelete = false;
				return;
			}
			if (costingPathHelpOpen) {
				costingPathHelpOpen = false;
				return;
			}
			if (linesListExpanded) {
				linesListExpanded = false;
				return;
			}
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
		class="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 backdrop-blur-sm sm:items-center {linesListExpanded
			? 'p-2 sm:p-3'
			: 'p-3 sm:p-4'}"
		onmousedown={onBackdropMouseDown}
		role="dialog"
		aria-modal="true"
		aria-labelledby={linesListExpanded ? 'recipe-lines-slim-title' : 'recipe-name-field'}
		tabindex="-1"
	>
		<div
			class="flex w-full flex-col overflow-hidden rounded-3xl border border-zinc-700/80 bg-white shadow-2xl ring-1 ring-black/5 transition-[max-width,max-height,height] duration-200 ease-out {linesListExpanded
				? 'h-[min(98dvh,60rem)] max-h-[99dvh] max-w-[min(96vw,72rem)] sm:h-[min(96vh,60rem)]'
				: 'h-[min(92dvh,52rem)] max-h-[94vh] max-w-3xl sm:h-[min(90vh,52rem)]'}"
		>
			{#if linesListExpanded}
				<div
					class="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2.5 text-white sm:px-4"
				>
					<p id="recipe-lines-slim-title" class="min-w-0 truncate text-sm font-semibold tracking-tight">
						{draftName.trim() || recipe.name}
					</p>
					<div class="flex shrink-0 items-center gap-1.5">
						<button
							type="button"
							class="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
							aria-label="Compact layout — show add ingredients bar"
							title="Compact layout"
							onclick={() => (linesListExpanded = false)}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 14v2a2 2 0 0 0 2 2h2" />
								<path d="M4 10V8a2 2 0 0 1 2-2h2" />
								<path d="M20 14v2a2 2 0 0 1-2 2h-2" />
								<path d="M20 10V8a2 2 0 0 0-2-2h-2" />
								<path d="M9 9h6v6H9z" />
							</svg>
						</button>
						<button
							type="button"
							class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-lg leading-none text-zinc-300 transition hover:bg-white/10 hover:text-white"
							onclick={onClose}
							aria-label="Close"
						>
							×
						</button>
					</div>
				</div>
			{:else}
			<!-- Recipe Manager–style header -->
			<div
				class="relative shrink-0 overflow-hidden bg-zinc-900 px-4 py-5 text-white sm:px-6 sm:py-6"
			>
				<div
					class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-orange-500/25 blur-3xl"
				></div>
				<div
					class="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-amber-500/10 blur-2xl"
				></div>
				<div class="relative flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-900/30"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
									<path d="M7 2v20" />
									<path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
								</svg>
							</div>
							<div class="min-w-0">
								<p class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Recipe details</p>
								<label for="recipe-name-field" class="sr-only">Recipe name</label>
								<input
									id="recipe-name-field"
									bind:value={draftName}
									onchange={persistName}
									class="mt-0.5 w-full max-w-md border-b border-transparent bg-transparent text-xl font-bold tracking-tight text-white outline-none placeholder-zinc-600 focus:border-orange-400"
								/>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap gap-2">
							<span
								class="inline-flex items-center rounded-lg bg-zinc-800/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 ring-1 ring-white/10"
							>
								{recipe.ingredientLines.length} ingredients
							</span>
							<span
								class="inline-flex items-center rounded-lg bg-zinc-800/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 ring-1 ring-white/10"
							>
								{recipe.otherLines.length} others
							</span>
							<span class="text-xs tabular-nums text-zinc-500">
								Lines total: <span class="font-semibold text-zinc-300">{combinedLines.length}</span>
							</span>
						</div>
					</div>
					<button
						type="button"
						class="rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
						onclick={onClose}
						aria-label="Close"
					>
						<span class="text-xl leading-none">×</span>
					</button>
				</div>
			</div>
			{/if}

			<!-- Scroll: recipe lines + COGS -->
			<div
				class="recipe-details-scroll min-h-0 flex-1 overflow-y-auto overflow-x-auto bg-zinc-50/80 p-4 sm:p-5"
			>
				<div class="mx-auto max-w-4xl">
					{#if recipe.archived}
						<div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/95 p-3.5 text-amber-950 shadow-sm sm:p-4">
							<div class="flex items-center gap-2.5">
								<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-800">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
								</div>
								<div>
									<p class="text-xs font-bold uppercase tracking-wider text-amber-900">Archived Recipe</p>
									<p class="text-xs text-amber-800/90">This recipe is currently archived and hidden from active menu calculations.</p>
								</div>
							</div>
							<button
								type="button"
								class="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700 active:scale-95"
								onclick={executeRecipeRestore}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
								Restore to Active
							</button>
						</div>
					{/if}

					<div class="mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
						<span class="min-w-0" aria-hidden="true"></span>
						<p class="text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
							Recipe lines
						</p>
						<div class="flex justify-end">
							<button
								type="button"
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200/90 bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-100 transition hover:border-orange-300 hover:bg-orange-50/80 hover:text-orange-800"
								aria-pressed={linesListExpanded}
								aria-label={linesListExpanded ? 'Use compact recipe list layout' : 'Expand recipe list (semi full screen)'}
								title={linesListExpanded ? 'Compact layout' : 'Larger list'}
								onclick={() => (linesListExpanded = !linesListExpanded)}
							>
								{#if linesListExpanded}
									<!-- compress / exit expanded -->
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M4 14v2a2 2 0 0 0 2 2h2" />
										<path d="M4 10V8a2 2 0 0 1 2-2h2" />
										<path d="M20 14v2a2 2 0 0 1-2 2h-2" />
										<path d="M20 10V8a2 2 0 0 0-2-2h-2" />
										<path d="M9 9h6v6H9z" />
									</svg>
								{:else}
									<!-- expand outward -->
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M15 3h6v6" />
										<path d="M9 21H3v-6" />
										<path d="m21 3-7 7" />
										<path d="m3 21 7-7" />
									</svg>
								{/if}
							</button>
						</div>
					</div>
					{#if !linesListExpanded}
					<p class="mb-3 text-center text-xs leading-relaxed text-zinc-500">
						Each row is either an <strong class="text-zinc-700">ingredient</strong> or an
						<strong class="text-zinc-700">other</strong> (cups, lids, etc.). Pick the catalog item, qty, and unit.
					</p>
					{/if}

					<div class="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
						<table class="w-full min-w-[36rem] text-left text-sm sm:min-w-0">
							<thead class="bg-zinc-100 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
								<tr>
									<th class="px-3 py-2.5 font-medium">Type</th>
									<th class="px-3 py-2.5 font-medium">Item</th>
									<th class="px-3 py-2.5 font-medium">Qty</th>
									<th class="hidden px-3 py-2.5 font-medium text-right sm:table-cell">₱/u</th>
									<th class="px-3 py-2.5 font-medium text-right">Line</th>
									<th class="w-10 px-2 py-2.5"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-zinc-100">
								{#each combinedLines as row (row.kind + row.line.id)}
									{#if row.kind === 'ingredient'}
										{@const line = row.line}
										{@const m = masters.find((x) => x.id === line.ingredientMasterId)}
										<tr class="bg-white">
											<td class="px-3 py-2.5 align-top">
												<span
													class="inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800 ring-1 ring-emerald-200/80"
												>
													Ingr.
												</span>
											</td>
											<td class="min-w-[10rem] max-w-[min(100vw,22rem)] px-3 py-2.5 align-top sm:min-w-[12rem] sm:max-w-none">
												{#if m}
													<span class="font-medium break-words text-zinc-900">{m.name}</span>
													<span class="mt-0.5 inline-flex flex-wrap items-center gap-1">
														<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">{formatPhp(m.packagePrice)}</span>
														<span class="text-[10px] text-zinc-500">{m.supplier}</span>
														{#if isBatchOutOfStock(m)}
															<span class="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">Out of stock</span>
														{/if}
													</span>
												{:else}
													<span class="text-amber-700">Missing item</span>
												{/if}
												<select
													class="mt-1.5 block w-full min-w-0 rounded-lg border border-zinc-200 px-2 py-1 text-xs"
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
											</td>
											<td class="px-3 py-2.5 align-top">
												<input
													type="number"
													min="0"
													step="any"
													class="mb-1 w-full min-w-[3.5rem] max-w-[5rem] rounded-lg border border-zinc-200 px-1.5 py-1 text-xs"
													value={line.quantity}
													onchange={(e) =>
														updateRecipeIngredientLine(recipe.id, line.id, {
															quantity: +((e.currentTarget as HTMLInputElement).value || 0)
														})}
												/>
												<select
													class="block w-full min-w-0 max-w-[6.5rem] rounded-lg border border-zinc-200 px-1 py-1 text-[10px]"
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
											</td>
											<td class="hidden px-3 py-2.5 text-right align-top tabular-nums text-zinc-600 sm:table-cell">
												{m ? fmt(m.unitCost) : '—'}
											</td>
											<td class="px-3 py-2.5 text-right align-top tabular-nums text-sm font-semibold text-zinc-900">
												{fmt(ingLineCost(line))}
											</td>
											<td class="px-2 py-2.5 align-top">
												<button
													type="button"
													class="text-[11px] font-medium text-red-600 hover:underline"
													onclick={() => askRemoveIngredient(line.id, m?.name ?? 'Line')}
												>
													×
												</button>
											</td>
										</tr>
									{:else}
										{@const line = row.line}
										{@const om = otherMasters.find((x) => x.id === line.otherMasterId)}
										<tr class="bg-white">
											<td class="px-3 py-2.5 align-top">
												<span
													class="inline-flex rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-900 ring-1 ring-sky-200/80"
												>
													Other
												</span>
											</td>
											<td class="min-w-[10rem] max-w-[min(100vw,22rem)] px-3 py-2.5 align-top sm:min-w-[12rem] sm:max-w-none">
												{#if om}
													<span class="font-medium break-words text-zinc-900">{om.name}</span>
													<span class="mt-0.5 inline-flex flex-wrap items-center gap-1">
														<span class="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">{formatPhp(om.packagePrice)}</span>
														<span class="text-[10px] text-zinc-500">{om.supplier}</span>
														{#if isBatchOutOfStock(om)}
															<span class="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">Out of stock</span>
														{/if}
													</span>
												{:else}
													<span class="text-amber-700">Missing item</span>
												{/if}
												<select
													class="mt-1.5 block w-full min-w-0 rounded-lg border border-zinc-200 px-2 py-1 text-xs"
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
											</td>
											<td class="px-3 py-2.5 align-top">
												<input
													type="number"
													min="0"
													step="any"
													class="mb-1 w-full min-w-[3.5rem] max-w-[5rem] rounded-lg border border-zinc-200 px-1.5 py-1 text-xs"
													value={line.quantity}
													onchange={(e) =>
														updateRecipeOtherLine(recipe.id, line.id, {
															quantity: +((e.currentTarget as HTMLInputElement).value || 0)
														})}
												/>
												<select
													class="block w-full min-w-0 max-w-[6.5rem] rounded-lg border border-zinc-200 px-1 py-1 text-[10px]"
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
											</td>
											<td class="hidden px-3 py-2.5 text-right align-top tabular-nums text-zinc-600 sm:table-cell">
												{om ? fmt(om.unitCost) : '—'}
											</td>
											<td class="px-3 py-2.5 text-right align-top tabular-nums text-sm font-semibold text-zinc-900">
												{fmt(otherLineCost(line))}
											</td>
											<td class="px-2 py-2.5 align-top">
												<button
													type="button"
													class="text-[11px] font-medium text-red-600 hover:underline"
													onclick={() => askRemoveOther(line.id, om?.name ?? 'Line')}
												>
													×
												</button>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
						{#if combinedLines.length === 0}
							<p class="border-t border-zinc-100 bg-zinc-50/60 px-4 py-8 text-center text-sm text-zinc-500">
								{#if linesListExpanded}
									No lines yet. Tap <strong class="text-zinc-800">Compact layout</strong> (toolbar or
									above) to show the add row and build this recipe.
								{:else}
									No lines yet. Use <strong class="text-zinc-800">Add ingredient</strong> or
									<strong class="text-zinc-800">Add other</strong> below — add catalog items on the
									<strong>Ingredients</strong> and <strong>Others</strong> pages first if lists are empty.
								{/if}
							</p>
						{/if}
					</div>

					<div
						class="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-white p-3 text-xs shadow-sm sm:grid-cols-3"
					>
						<div>
							<p class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Ingredients</p>
							<p class="mt-0.5 font-bold tabular-nums text-zinc-900">{fmt(ingSub)}</p>
						</div>
						<div>
							<p class="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Others</p>
							<p class="mt-0.5 font-bold tabular-nums text-zinc-900">{fmt(othSub)}</p>
						</div>
						<div class="col-span-2 border-t border-zinc-100 pt-2 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
							<p class="text-[10px] font-bold uppercase tracking-wider text-orange-600">COGS this recipe</p>
							<p class="mt-0.5 text-lg font-bold tabular-nums text-zinc-900">{fmt(ingSub + othSub)}</p>
						</div>
					</div>
				</div>
			</div>

			{#if !linesListExpanded}
			<!-- Add bar: one row + costing clarity -->
			<div
				class="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 shadow-[0_-10px_40px_rgba(0,0,0,0.06)] sm:px-6 sm:py-4"
			>
				<div class="mx-auto max-w-4xl space-y-2">
					<div class="flex rounded-xl bg-zinc-100 p-1 ring-1 ring-zinc-200/80">
						<button
							type="button"
							class="flex-1 rounded-lg py-2 text-xs font-bold uppercase tracking-wide transition sm:text-sm {addMode ===
							'ingredient'
								? 'bg-white text-emerald-800 shadow-sm ring-1 ring-zinc-200/80'
								: 'text-zinc-500 hover:text-zinc-800'}"
							onclick={() => {
								addMode = 'ingredient';
								addConversionReportShown = false;
								costingPathHelpOpen = false;
							}}
						>
							Add ingredient
						</button>
						<button
							type="button"
							class="flex-1 rounded-lg py-2 text-xs font-bold uppercase tracking-wide transition sm:text-sm {addMode ===
							'other'
								? 'bg-white text-sky-900 shadow-sm ring-1 ring-zinc-200/80'
								: 'text-zinc-500 hover:text-zinc-800'}"
							onclick={() => {
								addMode = 'other';
								addConversionReportShown = false;
								costingPathHelpOpen = false;
							}}
						>
							Add other
						</button>
					</div>

					<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
						<div class="flex min-w-0 flex-1 flex-col gap-2">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-[11px] font-bold text-zinc-800">Costing path</span>
								<button
									type="button"
									class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-300/90 bg-white text-[11px] font-bold leading-none text-zinc-600 shadow-sm ring-zinc-200/80 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900"
									aria-expanded={costingPathHelpOpen}
									aria-label="Help: how recipe line costing works"
									onclick={() => (costingPathHelpOpen = !costingPathHelpOpen)}
								>
									?
								</button>
							</div>
							{#if costingPathHelpOpen}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<div
									role="note"
									class="max-w-xl rounded-lg border border-zinc-200/90 bg-white px-2.5 py-2.5 text-left text-[11px] leading-relaxed text-zinc-600 shadow-lg ring-1 ring-zinc-200/60"
									onmousedown={(e) => e.stopPropagation()}
								>
									<p>
										You attach a <strong>catalog {addMode === 'ingredient' ? 'ingredient' : 'other'}</strong>
										(price is already per g, ml, or piece from that item’s package). This recipe then uses
										your <strong>quantity + unit</strong> here — we convert to the catalog’s base unit and
										multiply by its <strong>₱/base</strong> to get this line’s cost.
									</p>
								</div>
							{/if}
						</div>
						<button
							type="button"
							class="shrink-0 self-start rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition {addMode ===
							'ingredient'
								? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
								: 'border-sky-200 bg-sky-50 text-sky-950 hover:bg-sky-100'}"
							onclick={() =>
								addMode === 'ingredient' ? (quickAddIngredientOpen = true) : (quickAddOtherOpen = true)}
						>
							+ New {addMode === 'ingredient' ? 'ingredient' : 'other'}
						</button>
					</div>

					<form class="space-y-2" onsubmit={submitAddLine}>
						{#if addMode === 'ingredient' && !masters.length}
							<p class="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900 ring-1 ring-amber-200">
								Catalog is empty — tap <strong>+ New ingredient</strong> (e.g. matcha), then pick it in the row
								below.
							</p>
						{:else if addMode === 'other' && !otherMasters.length}
							<p class="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900 ring-1 ring-amber-200">
								Catalog is empty — tap <strong>+ New other</strong>, then pick it below.
							</p>
						{/if}

						<div
							class="flex min-w-0 flex-nowrap items-stretch gap-2 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50/40 p-2 ring-1 ring-zinc-100"
							aria-label="Add line: catalog, quantity, unit, add"
						>
							{#if addMode === 'ingredient'}
								<label class="sr-only" for="add-ing-product">Product</label>
								<select
									id="add-ing-product"
									value={addIngredientProductName}
									disabled={uniqueIngredientNames.length === 0}
									class="min-h-[44px] min-w-[min(100%,9rem)] shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 disabled:opacity-50"
									onchange={(e) => onAddIngredientProductChange((e.currentTarget as HTMLSelectElement).value)}
								>
									{#each uniqueIngredientNames as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
								<label class="sr-only" for="add-ing-select">Batch</label>
								<select
									id="add-ing-select"
									bind:value={addIngredientMasterId}
									disabled={addIngredientBatches.length === 0}
									class="min-h-[44px] min-w-[min(100%,11rem)] flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 disabled:opacity-50"
									title="Pick price batch for this product"
								>
									{#if addIngredientBatches.length === 0}
										<option value="">— No batches —</option>
									{:else}
										{#each addIngredientBatches as cat (cat.id)}
											<option value={cat.id} disabled={isBatchOutOfStock(cat)}>
												{recipeBatchOptionLabel(cat)}
											</option>
										{/each}
									{/if}
								</select>
							{:else}
								<label class="sr-only" for="add-oth-product">Product</label>
								<select
									id="add-oth-product"
									value={addOtherProductName}
									disabled={uniqueOtherNames.length === 0}
									class="min-h-[44px] min-w-[min(100%,9rem)] shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 disabled:opacity-50"
									onchange={(e) => onAddOtherProductChange((e.currentTarget as HTMLSelectElement).value)}
								>
									{#each uniqueOtherNames as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
								<label class="sr-only" for="add-oth-select">Batch</label>
								<select
									id="add-oth-select"
									bind:value={addOtherMasterId}
									disabled={addOtherBatches.length === 0}
									class="min-h-[44px] min-w-[min(100%,11rem)] flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 disabled:opacity-50"
									title="Pick price batch for this item"
								>
									{#if addOtherBatches.length === 0}
										<option value="">— No batches —</option>
									{:else}
										{#each addOtherBatches as cat (cat.id)}
											<option value={cat.id} disabled={isBatchOutOfStock(cat)}>
												{recipeBatchOptionLabel(cat)}
											</option>
										{/each}
									{/if}
								</select>
							{/if}

							<label class="sr-only" for="add-line-qty">Recipe quantity</label>
							<input
								id="add-line-qty"
								type="number"
								min="0"
								step="any"
								bind:value={addQty}
								class="min-h-[44px] w-[4.5rem] shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-center text-sm tabular-nums outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15"
								title="How much this recipe uses"
							/>

							<label class="sr-only" for="add-line-unit">Unit for quantity</label>
							<select
								id="add-line-unit"
								bind:value={addUnit}
								class="min-h-[44px] w-[5.75rem] shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15 sm:w-[6.5rem]"
							>
								{#each MEASURE_UNIT_OPTIONS as u}
									<option value={u.value}>{u.label}</option>
								{/each}
							</select>

							<button
								type="submit"
								disabled={!canSubmitAdd}
								class="min-h-[44px] shrink-0 rounded-lg px-4 text-sm font-bold text-white shadow-md transition enabled:hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 {addMode ===
								'ingredient'
									? 'bg-orange-600'
									: 'bg-zinc-900'}"
							>
								{addMode === 'ingredient' ? 'Add ingr' : 'Add other'}
							</button>
						</div>

						{#if addPreview && addPreview.qtyOk && addPreview.lineCost !== null}
							<div
								class="w-full max-w-full rounded-lg border border-zinc-200/90 bg-white px-2.5 py-2.5 text-left text-[11px] leading-relaxed text-zinc-600 shadow-lg ring-1 ring-zinc-200/60"
								role="status"
							>
								<p>
									<strong class="font-semibold text-zinc-800">{addPreview.name}</strong>
									<span> · catalog base </span>
									<span class="font-mono tabular-nums text-zinc-700">{addPreview.baseUnit}</span>
									<span> at </span>
									<span class="font-semibold tabular-nums text-zinc-800">{fmt(addPreview.unitCost)}</span>
									<span> /{addPreview.baseUnit}</span>
									<span> → </span>
									<span class="font-semibold text-zinc-800">this line ≈ {fmt(addPreview.lineCost)}</span>
								</p>
							</div>
						{:else if addConversionReportShown && addPreview && !addPreview.qtyOk}
							<div
								class="rounded-xl border border-amber-300/90 bg-amber-50/95 px-3 py-2.5 text-[11px] leading-snug text-amber-950 shadow-sm ring-1 ring-amber-200/60 sm:px-4"
								role="alert"
							>
								<p class="text-[10px] font-bold uppercase tracking-wider text-amber-900">Report</p>
								<p class="mt-1 font-medium">
									<strong class="text-amber-950">{addPreview.name}</strong>
									<span class="text-amber-900/90">
										· catalog base {addPreview.baseUnit} at {fmt(addPreview.unitCost)} /{addPreview.baseUnit}
										— your quantity/unit can’t convert to this catalog’s base. Try
										<strong>g</strong>, <strong>ml</strong>, or <strong>piece</strong>, or pick another item.
									</span>
								</p>
							</div>
						{/if}

						<div class="flex items-center justify-between pt-1">
							{#if recipe.archived}
								<button
									type="button"
									class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 underline-offset-2 transition hover:text-emerald-700 hover:underline"
									onclick={executeRecipeRestore}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
									Restore to active
								</button>
								<button
									type="button"
									class="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 underline-offset-2 transition hover:text-red-700 hover:underline"
									onclick={() => (pendingRecipeDelete = true)}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
									Completely delete recipe
								</button>
							{:else}
								<span></span>
								<button
									type="button"
									class="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 underline-offset-2 transition hover:text-amber-800 hover:underline"
									onclick={executeRecipeArchive}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
									Archive recipe
								</button>
							{/if}
						</div>
					</form>
				</div>
			</div>
			{/if}
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

<TypeToConfirmDeleteModal
	open={pendingRecipeDelete}
	title="Completely delete this recipe?"
	description={recipe
		? `This permanently removes “${recipe.name}” and every ingredient / other line in it. This action cannot be undone. Type delete to confirm.`
		: ''}
	confirmPhrase="delete"
	onClose={() => (pendingRecipeDelete = false)}
	onConfirm={executeRecipeDeletePermanently}
/>
