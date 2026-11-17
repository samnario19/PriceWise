<script lang="ts">
	import type { MeasureUnit } from '$lib/types/recipe';
	import {
		addIngredientMaster,
		computeCatalogUnitCost,
		MEASURE_UNIT_OPTIONS
	} from '$lib/state/ingredientCatalog.svelte';
	import { toBaseQuantity } from '$lib/utils/baseUnitCost';
	import { formatDecimal, formatPhp } from '$lib/utils/numberFormat';

	let {
		open = $bindable(false)
	}: {
		open?: boolean;
	} = $props();

	let name = $state('');
	let supplier = $state('');
	let packagePrice = $state(0);
	let packageSize = $state(1);
	let shippingFee = $state(0);
	let packageUnit = $state<MeasureUnit>('kg');
	let marketplaceSourcingLocalOnly = $state(false);

	let backdrop: HTMLDivElement | undefined = $state();

	const previewUnitCost = $derived(
		computeCatalogUnitCost({ packagePrice, packageSize, packageUnit, shippingFee })
	);
	const previewBase = $derived(toBaseQuantity(packageSize, packageUnit));

	function reset(): void {
		name = '';
		supplier = '';
		packagePrice = 0;
		packageSize = 1;
		shippingFee = 0;
		packageUnit = 'kg';
		marketplaceSourcingLocalOnly = false;
	}

	function submit(e: Event): void {
		e.preventDefault();
		if (!name.trim()) return;
		addIngredientMaster({
			name: name.trim(),
			supplier: supplier.trim(),
			packagePrice,
			packageSize,
			packageUnit,
			shippingFee,
			marketplaceSourcingLocalOnly
		});
		reset();
		open = false;
	}

	function onBackdropMouseDown(ev: MouseEvent): void {
		if (ev.target === backdrop) open = false;
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') open = false;
	}

	$effect(() => {
		if (open) reset();
	});
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={backdrop}
		class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm"
		onmousedown={onBackdropMouseDown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-ing-title"
		tabindex="-1"
	>
		<form
			class="max-h-[90vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl"
			onsubmit={submit}
		>
			<!-- Header with Visual Badge & Beginner Guidance -->
			<div class="relative overflow-hidden bg-zinc-900 px-5 pb-5 pt-5 text-white sm:px-6 sm:pb-6 sm:pt-6">
				<div class="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-orange-500/20 blur-2xl"></div>
				<div class="relative flex items-start justify-between gap-4">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="rounded-md bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-400 ring-1 ring-orange-500/30">
								Form · Field Types
							</span>
						</div>
						<h2 id="add-ing-title" class="mt-1.5 text-xl font-bold tracking-tight text-white sm:text-2xl">
							Add New Ingredient
						</h2>
						<p class="mt-1 text-xs leading-relaxed text-zinc-400 sm:text-sm">
							Fill in the form fields below. PriceWise calculates your cost per gram, ml, or piece automatically.
						</p>
					</div>
					<button
						type="button"
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg leading-none text-zinc-400 transition hover:bg-white/10 hover:text-white active:scale-95"
						onclick={() => (open = false)}
						aria-label="Close"
					>
						×
					</button>
				</div>
			</div>

			<!-- Form Fields Body -->
			<div class="space-y-4 p-5 sm:p-6">
				<!-- SECTION 1: Item Details -->
				<div class="rounded-2xl border border-zinc-200/90 bg-zinc-50/60 p-4 space-y-3.5">
					<div class="flex items-center justify-between border-b border-zinc-200/80 pb-2">
						<div class="flex items-center gap-2">
							<span class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[11px] font-bold text-white shadow-2xs">
								1
							</span>
							<h3 class="text-xs font-bold uppercase tracking-wider text-zinc-800">Ingredient Details</h3>
						</div>
						<span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Text Fields</span>
					</div>

					<!-- Field: Ingredient Name -->
					<div>
						<div class="flex items-center justify-between">
							<label class="block text-xs font-bold text-zinc-700" for="im-name">
								Ingredient Name <span class="text-rose-500">*</span>
							</label>
							<span class="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-600">Text</span>
						</div>
						<p class="mt-0.5 text-[11px] text-zinc-500">The primary name shown on your recipe costing sheets</p>
						<div class="relative mt-1.5">
							<span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-zinc-400">🧂</span>
							<input
								id="im-name"
								bind:value={name}
								required
								class="w-full rounded-xl border border-zinc-300 bg-white pl-9 pr-3.5 py-2.5 text-sm font-semibold text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
								placeholder="e.g. Whole Milk, Espresso Beans, Matcha Powder, White Sugar"
							/>
						</div>
					</div>

					<!-- Field: Supplier / Store -->
					<div>
						<div class="flex items-center justify-between">
							<label class="block text-xs font-bold text-zinc-700" for="im-sup">
								Supplier / Source <span class="text-[11px] font-normal text-zinc-400">(Optional)</span>
							</label>
							<span class="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-600">Text</span>
						</div>
						<p class="mt-0.5 text-[11px] text-zinc-500">Where or from which vendor you purchased this item</p>
						<div class="relative mt-1.5">
							<span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-zinc-400">🏪</span>
							<input
								id="im-sup"
								bind:value={supplier}
								class="w-full rounded-xl border border-zinc-300 bg-white pl-9 pr-3.5 py-2.5 text-sm font-semibold text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
								placeholder="e.g. S&R Membership Shopping, Shopee Store, Local Market"
							/>
						</div>
					</div>
				</div>

				<!-- SECTION 2: Package & Purchase Cost -->
				<div class="rounded-2xl border border-zinc-200/90 bg-zinc-50/60 p-4 space-y-3.5">
					<div class="flex items-center justify-between border-b border-zinc-200/80 pb-2">
						<div class="flex items-center gap-2">
							<span class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[11px] font-bold text-white shadow-2xs">
								2
							</span>
							<h3 class="text-xs font-bold uppercase tracking-wider text-zinc-800">Package & Cost Info</h3>
						</div>
						<span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Currency & Measurement</span>
					</div>

					<!-- Row: Package Price & Shipping Fee -->
					<div class="grid gap-3 sm:grid-cols-2">
						<!-- Field: Package Price -->
						<div>
							<div class="flex items-center justify-between">
								<label class="block text-xs font-bold text-zinc-700" for="im-packp">
									Package Price (₱) <span class="text-rose-500">*</span>
								</label>
								<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800">₱ Currency</span>
							</div>
							<p class="mt-0.5 text-[11px] text-zinc-500">Total price paid for the package</p>
							<div class="relative mt-1.5">
								<span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-bold text-zinc-400">₱</span>
								<input
									id="im-packp"
									type="number"
									min="0"
									step="any"
									bind:value={packagePrice}
									class="w-full rounded-xl border border-zinc-300 bg-white pl-8 pr-3.5 py-2.5 text-sm font-bold tabular-nums text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
									placeholder="0.00"
								/>
							</div>
						</div>

						<!-- Field: Shipping Fee -->
						<div>
							<div class="flex items-center justify-between">
								<label class="block text-xs font-bold text-zinc-700" for="im-ship">
									Shipping / Delivery (₱)
								</label>
								<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800">₱ Currency</span>
							</div>
							<p class="mt-0.5 text-[11px] text-zinc-500">Enter 0 if picked up or free shipping</p>
							<div class="relative mt-1.5">
								<span class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-bold text-zinc-400">₱</span>
								<input
									id="im-ship"
									type="number"
									min="0"
									step="any"
									bind:value={shippingFee}
									class="w-full rounded-xl border border-zinc-300 bg-white pl-8 pr-3.5 py-2.5 text-sm font-bold tabular-nums text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
									placeholder="0.00"
								/>
							</div>
						</div>
					</div>

					<!-- Row: Package Size & Unit -->
					<div class="grid gap-3 sm:grid-cols-2">
						<!-- Field: Package Size -->
						<div>
							<div class="flex items-center justify-between">
								<label class="block text-xs font-bold text-zinc-700" for="im-packq">
									Package Quantity / Size <span class="text-rose-500">*</span>
								</label>
								<span class="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-800">Decimal</span>
							</div>
							<p class="mt-0.5 text-[11px] text-zinc-500">Net quantity inside one package</p>
							<div class="relative mt-1.5">
								<input
									id="im-packq"
									type="number"
									min="0"
									step="any"
									bind:value={packageSize}
									class="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-bold tabular-nums text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
									placeholder="e.g. 1, 500, 1000"
								/>
							</div>
						</div>

						<!-- Field: Package Unit -->
						<div>
							<div class="flex items-center justify-between">
								<label class="block text-xs font-bold text-zinc-700" for="im-unit">
									Measurement Unit <span class="text-rose-500">*</span>
								</label>
								<span class="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-800">Dropdown</span>
							</div>
							<p class="mt-0.5 text-[11px] text-zinc-500">Unit printed on the packaging label</p>
							<select
								id="im-unit"
								bind:value={packageUnit}
								class="mt-1.5 w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-zinc-900 shadow-2xs outline-none transition focus:border-orange-500 focus:ring-3 focus:ring-orange-500/15"
							>
								{#each MEASURE_UNIT_OPTIONS as u}
									<option value={u.value}>{u.label}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				<!-- SECTION 3: Sourcing Option (Checkbox / Toggle Field) -->
				<div class="rounded-2xl border border-zinc-200/90 bg-zinc-50/60 p-4">
					<div class="flex items-center justify-between border-b border-zinc-200/80 pb-2 mb-3">
						<div class="flex items-center gap-2">
							<span class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[11px] font-bold text-white shadow-2xs">
								3
							</span>
							<h3 class="text-xs font-bold uppercase tracking-wider text-zinc-800">Sourcing Mode</h3>
						</div>
						<span class="rounded bg-zinc-200/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-600">Toggle</span>
					</div>

					<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs transition hover:border-zinc-300">
						<input
							type="checkbox"
							bind:checked={marketplaceSourcingLocalOnly}
							class="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
						/>
						<span class="space-y-0.5">
							<span class="block text-xs font-bold text-zinc-800">Local-only Item (Never bought on Lazada / Shopee)</span>
							<span class="block text-[11px] leading-relaxed text-zinc-500">
								Enable for tap water, fresh ice, locally sourced fresh milk, or fruits you only purchase at local markets. PriceWise will use your local catalog price for all marketplace COGS without requiring an online URL.
							</span>
						</span>
					</label>
				</div>

				<!-- SECTION 4: Live Cost Calculation Breakdown -->
				<div class="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/70 p-4 shadow-xs">
					<div class="flex items-center justify-between border-b border-emerald-200/80 pb-2">
						<div class="flex items-center gap-1.5">
							<span class="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">✓</span>
							<h3 class="text-xs font-bold uppercase tracking-wider text-emerald-900">
								Automatic Unit Cost Calculation
							</h3>
						</div>
						<span class="rounded-full bg-emerald-200/70 px-2 py-0.5 text-[10px] font-bold tabular-nums text-emerald-800">
							Landed: {formatPhp(packagePrice + shippingFee)}
						</span>
					</div>

					<div class="mt-3 flex flex-wrap items-baseline justify-between gap-3">
						<div>
							<p class="text-xs font-medium text-emerald-950">
								Base Quantity: <strong>{formatDecimal(previewBase.quantity)}</strong> {previewBase.unit}
							</p>
							<p class="text-[11px] text-emerald-700">
								({packageSize} {packageUnit} converts to {formatDecimal(previewBase.quantity)} {previewBase.unit})
							</p>
						</div>
						<div class="text-right">
							<p class="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Cost per {previewBase.unit}</p>
							<p class="text-xl font-black tabular-nums text-emerald-950">
								{formatPhp(previewUnitCost)} <span class="text-xs font-semibold text-emerald-700">/ {previewBase.unit}</span>
							</p>
						</div>
					</div>

					<p class="mt-2.5 rounded-lg bg-emerald-100/60 p-2 text-[11px] text-emerald-800">
						💡 Whenever you add this ingredient to any recipe, PriceWise will automatically multiply this unit cost by the quantity used in that recipe.
					</p>
				</div>

				<!-- Form Actions -->
				<div class="flex gap-2.5 border-t border-zinc-100 pt-3">
					<button
						type="button"
						class="flex-1 rounded-xl border border-zinc-300 bg-white py-2.5 text-sm font-semibold text-zinc-700 shadow-2xs transition hover:bg-zinc-50 active:scale-98"
						onclick={() => (open = false)}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="flex-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-950/20 transition hover:from-orange-500 hover:to-amber-500 active:scale-98"
					>
						Save Ingredient
					</button>
				</div>
			</div>
		</form>
	</div>
{/if}
