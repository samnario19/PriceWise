<script lang="ts">
	import type { MeasureUnit } from '$lib/types/recipe';
	import { MEASURE_UNIT_OPTIONS } from '$lib/state/ingredientCatalog.svelte';
	import { addOtherMaster, computeOtherUnitCost } from '$lib/state/otherCatalog.svelte';
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
	let packageSize = $state(100);
	let shippingFee = $state(0);
	let packageUnit = $state<MeasureUnit>('piece');
	let marketplaceSourcingLocalOnly = $state(false);

	let backdrop: HTMLDivElement | undefined = $state();

	const previewUnitCost = $derived(
		computeOtherUnitCost({ packagePrice, packageSize, packageUnit, shippingFee })
	);
	const previewBase = $derived(toBaseQuantity(packageSize, packageUnit));

	function reset(): void {
		name = '';
		supplier = '';
		packagePrice = 0;
		packageSize = 100;
		shippingFee = 0;
		packageUnit = 'piece';
		marketplaceSourcingLocalOnly = false;
	}

	function submit(e: Event): void {
		e.preventDefault();
		if (!name.trim()) return;
		addOtherMaster({
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
		aria-labelledby="add-other-title"
		tabindex="-1"
	>
		<form
			class="max-h-[90vh] w-full max-w-lg overflow-hidden overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl"
			onsubmit={submit}
		>
			<div class="bg-zinc-900 px-5 pb-5 pt-5 text-white sm:px-6 sm:pb-6 sm:pt-6">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<p class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Catalog</p>
						<h2 id="add-other-title" class="mt-1 text-xl font-bold tracking-tight">Add other / packaging</h2>
						<p class="mt-2 text-sm leading-relaxed text-zinc-400">
							Package price, size, shipping, and unit — same flow as adding a line on a recipe.
						</p>
					</div>
					<button
						type="button"
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg leading-none text-zinc-400 transition hover:bg-white/10 hover:text-white"
						onclick={() => (open = false)}
						aria-label="Close"
					>
						×
					</button>
				</div>
			</div>

			<div class="space-y-3 p-6">
				<!-- Step 1: Item Name -->
				<div>
					<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-name">① Packaging / Item name</label>
					<input
						id="ot-name"
						bind:value={name}
						required
						class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
						placeholder="e.g. 16oz Cold Cup, Dome Lid, Kraft Paper Straw, Takeout Bag"
					/>
					<p class="mt-1 text-xs text-zinc-500">What is this packaging or non-ingredient item called?</p>
				</div>

				<!-- Step 2: Supplier -->
				<div>
					<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-sup">② Where do you buy it?</label>
					<input
						id="ot-sup"
						bind:value={supplier}
						class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
						placeholder="e.g. Shopee Packaging Hub, Divisoria Wholesaler, U-Pack"
					/>
					<p class="mt-1 text-xs text-zinc-500">Optional — helps you keep track of which supplier provided this stock.</p>
				</div>

				<!-- Step 3: Purchase info -->
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-packp">③ How much did you pay? (₱)</label>
						<input
							id="ot-packp"
							type="number"
							min="0"
							step="any"
							bind:value={packagePrice}
							class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
							placeholder="e.g. 350"
						/>
						<p class="mt-1 text-xs text-zinc-500">Total purchase price of the pack or sleeve.</p>
					</div>
					<div>
						<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-packq">④ Pieces or quantity in pack</label>
						<input
							id="ot-packq"
							type="number"
							min="0"
							step="any"
							bind:value={packageSize}
							class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
							placeholder="e.g. 100"
						/>
						<p class="mt-1 text-xs text-zinc-500">e.g. 50 cups in a sleeve, or 100 lids in a bag.</p>
					</div>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-ship">⑤ Shipping fee (₱)</label>
						<input
							id="ot-ship"
							type="number"
							min="0"
							step="any"
							bind:value={shippingFee}
							class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
							placeholder="0"
						/>
						<p class="mt-1 text-xs text-zinc-500">Enter 0 if picked up or with free shipping voucher.</p>
					</div>
					<div>
						<label class="text-xs font-semibold uppercase text-zinc-500" for="ot-unit">⑥ Unit of measurement</label>
						<select
							id="ot-unit"
							bind:value={packageUnit}
							class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
						>
							{#each MEASURE_UNIT_OPTIONS as u}
								<option value={u.value}>{u.label}</option>
							{/each}
						</select>
						<p class="mt-1 text-xs text-zinc-500">Usually <strong>piece</strong> for cups, lids, and straws.</p>
					</div>
				</div>

				<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 text-sm">
					<input
						type="checkbox"
						bind:checked={marketplaceSourcingLocalOnly}
						class="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
					/>
					<span>
						<span class="font-semibold text-zinc-800">I never order this online (Lazada/Shopee)</span>
						<span class="mt-0.5 block text-xs leading-snug text-zinc-600">
							Check this if you always source these locally. PriceWise will use your catalog cost directly without requiring an online listing.
						</span>
					</span>
				</label>

				<div class="rounded-xl bg-sky-50 px-4 py-3 text-sm">
					<div class="text-sky-900">
						Base quantity: <strong>{formatDecimal(previewBase.quantity)}</strong> {previewBase.unit}
					</div>
					<span class="text-sky-900">Your cost per {previewBase.unit}:</span>
					<strong class="ml-2 tabular-nums text-sky-950">{formatPhp(previewUnitCost)}</strong>
					<span class="text-sky-800"> / {previewBase.unit}</span>
					<p class="mt-1.5 text-xs text-sky-700">💡 Whenever you assign a cup or lid to a recipe, PriceWise will calculate the packaging cost automatically.</p>
				</div>

				<div class="flex gap-2 border-t border-zinc-100 pt-5">
					<button
						type="button"
						class="flex-1 rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
						onclick={() => (open = false)}
					>
						Cancel
					</button>
					<button
						type="submit"
						class="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white shadow-md hover:bg-sky-500"
					>
						Save
					</button>
				</div>
			</div>
		</form>
	</div>
{/if}
