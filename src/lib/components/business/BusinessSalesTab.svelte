<script lang="ts">
	import { ingredientCatalog } from '$lib/state/ingredientCatalog.svelte';
	import { otherCatalog } from '$lib/state/otherCatalog.svelte';
	import { recipeStore } from '$lib/state/recipes.svelte';
	import { deleteSale, recordSale, salesStore } from '$lib/state/salesStore.svelte';
	import type { SaleChannel } from '$lib/types/sales';
	import { aggregateSales } from '$lib/utils/businessAnalytics';
	import { formatCatalogDateShort } from '$lib/utils/catalogDisplay';
	import { formatPhp } from '$lib/utils/numberFormat';
	import { computeRecipeAvailability } from '$lib/utils/recipeAvailability';
	import RecipeAvailabilityBadge from '$lib/components/recipes/RecipeAvailabilityBadge.svelte';

	let recipeId = $state('');
	let quantity = $state(1);
	let sellingPrice = $state(0);
	let channel = $state<SaleChannel>('local');
	let notes = $state('');
	let salesView = $state<'day' | 'week' | 'month' | 'year'>('day');

	const recipes = $derived(recipeStore.recipes);
	const activeRecipes = $derived(recipes.filter((r) => !r.archived));
	const selectedRecipe = $derived(recipes.find((r) => r.id === recipeId));
	const selectedAvailability = $derived(
		selectedRecipe
			? computeRecipeAvailability(selectedRecipe, ingredientCatalog.items, otherCatalog.items)
			: null
	);
	const isOverStock = $derived(
		selectedAvailability &&
			selectedAvailability.status !== 'unconfigured' &&
			quantity > selectedAvailability.servingsAvailable
	);

	$effect(() => {
		if (!recipeId && activeRecipes.length) recipeId = activeRecipes[0]!.id;
		if (selectedRecipe && sellingPrice <= 0) sellingPrice = selectedRecipe.pricing.local;
	});

	const periodTotals = $derived(aggregateSales(salesStore.transactions, salesView));
	const todayRevenue = $derived.by(() => {
		const today = new Date().toISOString().slice(0, 10);
		return salesStore.transactions
			.filter((t) => t.soldAt.slice(0, 10) === today)
			.reduce((s, t) => s + t.totalAmount, 0);
	});

	function submitSale(e: Event): void {
		e.preventDefault();
		if (!selectedRecipe) return;
		recordSale({
			recipe: selectedRecipe,
			quantity,
			sellingPrice,
			channel,
			notes,
			ingredientMasters: ingredientCatalog.items,
			otherMasters: otherCatalog.items
		});
		quantity = 1;
		notes = '';
	}
</script>

<div class="space-y-6">
	<div class="grid gap-4 sm:grid-cols-3">
		<div class="rounded-2xl border border-sky-200 bg-sky-50/50 p-5">
			<p class="text-[10px] font-bold uppercase text-sky-700">Today</p>
			<p class="mt-1 text-2xl font-bold tabular-nums text-sky-800">{formatPhp(todayRevenue)}</p>
		</div>
		<div class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
			<p class="text-[10px] font-bold uppercase text-zinc-500">Transactions</p>
			<p class="mt-1 text-2xl font-bold tabular-nums">{salesStore.transactions.length}</p>
		</div>
		<div class="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
			<p class="text-[10px] font-bold uppercase text-emerald-700">Units sold (all time)</p>
			<p class="mt-1 text-2xl font-bold tabular-nums text-emerald-800">
				{salesStore.transactions.reduce((s, t) => s + t.quantity, 0)}
			</p>
		</div>
	</div>

	<form class="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm" onsubmit={submitSale}>
		<h2 class="text-lg font-bold text-zinc-900">Record sale</h2>
		<p class="mt-1 text-xs text-zinc-500">FIFO stock deduction runs automatically per recipe ingredients.</p>
		<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div class="sm:col-span-2">
				<div class="flex items-center justify-between">
					<label class="text-xs font-semibold uppercase text-zinc-500" for="biz-recipe">Product</label>
					{#if selectedAvailability}
						<RecipeAvailabilityBadge availability={selectedAvailability} size="sm" showBottleneck={true} />
					{/if}
				</div>
				<select id="biz-recipe" bind:value={recipeId} class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
					{#each activeRecipes as r (r.id)}
						{@const a = computeRecipeAvailability(r, ingredientCatalog.items, otherCatalog.items)}
						<option value={r.id}>
							{r.name} — {a.status === 'out_of_stock' ? '🔴 Out of stock' : a.status === 'low_stock' ? `🟡 Low stock (${a.servingsAvailable} left)` : `🟢 ${a.servingsAvailable} available`}
						</option>
					{/each}
				</select>
				{#if isOverStock}
					<p class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg p-2 border border-amber-200">
						<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
						<span>Selling <strong>{quantity} units</strong> exceeds ready inventory ({selectedAvailability?.servingsAvailable} servings available).</span>
					</p>
				{/if}
			</div>
			<div>
				<label class="text-xs font-semibold uppercase text-zinc-500" for="biz-qty">Qty</label>
				<input id="biz-qty" type="number" min="1" bind:value={quantity} class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
			</div>
			<div>
				<label class="text-xs font-semibold uppercase text-zinc-500" for="biz-price">Price ₱</label>
				<input id="biz-price" type="number" min="0" step="any" bind:value={sellingPrice} class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
			</div>
			<div>
				<label class="text-xs font-semibold uppercase text-zinc-500" for="biz-ch">Channel</label>
				<select id="biz-ch" bind:value={channel} class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm">
					<option value="local">Local</option>
					<option value="shopee">Shopee</option>
					<option value="lazada">Lazada</option>
				</select>
			</div>
			<div class="sm:col-span-2">
				<label class="text-xs font-semibold uppercase text-zinc-500" for="biz-notes">Notes</label>
				<input id="biz-notes" bind:value={notes} class="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm" />
			</div>
		</div>
		<button type="submit" disabled={!selectedRecipe} class="mt-4 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
			Record sale
		</button>
	</form>

	<div class="rounded-3xl border border-zinc-200 bg-white shadow-sm">
		<div class="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
			<h2 class="font-bold text-zinc-900">Transaction log</h2>
			<select bind:value={salesView} class="rounded-lg border border-zinc-200 px-2 py-1 text-xs">
				<option value="day">Daily rollup</option>
				<option value="week">Weekly</option>
				<option value="month">Monthly</option>
				<option value="year">Yearly</option>
			</select>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
					<tr>
						<th class="px-5 py-2 text-left">Date</th>
						<th class="px-5 py-2 text-left">Product</th>
						<th class="px-5 py-2 text-right">Qty</th>
						<th class="px-5 py-2 text-right">Total</th>
						<th class="px-5 py-2 text-right">Profit</th>
						<th class="px-5 py-2"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-100">
					{#each salesStore.transactions as t (t.id)}
						<tr>
							<td class="px-5 py-2 tabular-nums text-zinc-600">{formatCatalogDateShort(t.soldAt)}</td>
							<td class="px-5 py-2 font-medium">
								{t.recipeName}
								{#if t.stockDeductions?.length}
									<p class="text-[10px] text-zinc-400">Stock: {t.stockDeductions.map((d) => `${d.name} −${d.packages}`).join(', ')}</p>
								{/if}
							</td>
							<td class="px-5 py-2 text-right tabular-nums">{t.quantity}</td>
							<td class="px-5 py-2 text-right tabular-nums font-semibold text-sky-700">{formatPhp(t.totalAmount)}</td>
							<td class="px-5 py-2 text-right tabular-nums text-emerald-700">{formatPhp(t.profit)}</td>
							<td class="px-5 py-2 text-right">
								<button type="button" class="text-xs text-red-600" onclick={() => deleteSale(t.id)}>Delete</button>
							</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-5 py-10 text-center text-zinc-400">No sales yet</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if periodTotals.length > 0}
			<div class="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
				{salesView} rollup: {periodTotals.length} period(s) · latest {formatPhp(periodTotals.at(-1)?.revenue ?? 0)} revenue
			</div>
		{/if}
	</div>
</div>
