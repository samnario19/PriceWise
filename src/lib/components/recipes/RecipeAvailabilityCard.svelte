<script lang="ts">
	import type { RecipeProductAvailability } from '$lib/utils/recipeAvailability';
	import { getRecipeAvailabilityBadge } from '$lib/utils/recipeAvailability';

	const {
		availability
	}: {
		availability: RecipeProductAvailability;
	} = $props();

	let showLineBreakdown = $state(false);

	const badge = $derived(getRecipeAvailabilityBadge(availability));
</script>

<div
	class="overflow-hidden rounded-2xl border transition-all {availability.status === 'in_stock'
		? 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/30'
		: availability.status === 'low_stock'
			? 'border-amber-200/80 bg-gradient-to-br from-amber-50/70 via-white to-amber-50/30'
			: availability.status === 'out_of_stock'
				? 'border-rose-200/80 bg-gradient-to-br from-rose-50/70 via-white to-rose-50/30'
				: 'border-zinc-200 bg-white'}"
>
	<div class="p-4 sm:p-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-xs {availability.status ===
					'in_stock'
						? 'bg-emerald-600 text-white'
						: availability.status === 'low_stock'
							? 'bg-amber-500 text-white'
							: availability.status === 'out_of_stock'
								? 'bg-rose-600 text-white'
								: 'bg-zinc-200 text-zinc-600'}"
				>
					{#if availability.status === 'in_stock'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					{:else if availability.status === 'low_stock'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					{:else if availability.status === 'out_of_stock'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="15" y1="9" x2="9" y2="15" />
							<line x1="9" y1="9" x2="15" y2="15" />
						</svg>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="12" />
							<line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
					{/if}
				</div>
				<div>
					<div class="flex items-center gap-2">
						<p class="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
							Real-Time Product Availability
						</p>
						<span
							class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {badge.badgeClass}"
						>
							{availability.status.replace('_', ' ')}
						</span>
					</div>
					<h3 class="text-base font-bold text-zinc-900">
						{#if availability.status === 'in_stock'}
							Ready to Serve: <span class="text-emerald-700">{availability.servingsAvailable} servings</span> available
						{:else if availability.status === 'low_stock'}
							Running Low: <span class="text-amber-700">{availability.servingsAvailable} servings</span> remaining
						{:else if availability.status === 'out_of_stock'}
							Out of Stock: <span class="text-rose-700">0 servings</span> ready
						{:else}
							No Recipe Lines Configured
						{/if}
					</h3>
				</div>
			</div>

			<div class="flex items-center gap-2">
				{#if availability.totalLinesCount > 0}
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white/90 px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-xs transition hover:bg-white active:scale-95"
						onclick={() => (showLineBreakdown = !showLineBreakdown)}
					>
						<span>{showLineBreakdown ? 'Hide Breakdown' : 'View Ingredient Stock'}</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="transition-transform duration-200 {showLineBreakdown ? 'rotate-180' : ''}"
							aria-hidden="true"
						>
							<path d="m6 9 6 6 6-6" />
						</svg>
					</button>
				{/if}
			</div>
		</div>

		{#if availability.status === 'out_of_stock'}
			<div class="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-900">
				<p class="font-bold">Missing Ingredients / Packaging:</p>
				<div class="mt-1 flex flex-wrap gap-1.5">
					{#each availability.missingLines as item (item.lineId)}
						<span class="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-0.5 text-xs font-semibold text-rose-700 shadow-2xs border border-rose-200">
							<span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
							{item.name} (0 in stock)
						</span>
					{/each}
				</div>
			</div>
		{:else if availability.limitingLine && availability.status !== 'unconfigured'}
			<div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/80 p-2.5 text-xs border border-zinc-200/60 shadow-2xs">
				<div class="flex items-center gap-2 text-zinc-600">
					<span class="font-bold text-zinc-800">Bottleneck:</span>
					<span><strong>{availability.limitingLine.name}</strong> limits total production to <strong>{availability.servingsAvailable} servings</strong>.</span>
				</div>
				<span class="text-[11px] text-zinc-500">
					Current stock: {availability.limitingLine.totalStockPackages} pkg(s) on hand
				</span>
			</div>
		{/if}
	</div>

	{#if showLineBreakdown && availability.lines.length > 0}
		<div class="border-t border-zinc-200/80 bg-white/95 p-4 sm:p-5">
			<h4 class="text-xs font-bold uppercase tracking-wider text-zinc-500">
				Stock Availability Per Recipe Line
			</h4>
			<p class="mt-0.5 text-xs text-zinc-500">
				Shows how much of each ingredient or packaging item you have in stock and how many servings it supports.
			</p>

			<div class="mt-3 overflow-x-auto">
				<table class="w-full text-left text-xs">
					<thead class="border-b border-zinc-200 bg-zinc-50 text-[10px] font-bold uppercase text-zinc-500">
						<tr>
							<th class="py-2 px-3">Item</th>
							<th class="py-2 px-3">Type</th>
							<th class="py-2 px-3">Qty / Serving</th>
							<th class="py-2 px-3">Stock on Hand</th>
							<th class="py-2 px-3">Servings Supported</th>
							<th class="py-2 px-3">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100">
						{#each availability.lines as item (item.lineId)}
							<tr class="{item.isOutOfStock ? 'bg-rose-50/40' : item.isLowStock ? 'bg-amber-50/40' : ''}">
								<td class="py-2.5 px-3 font-semibold text-zinc-900">
									{item.name}
									{#if item.supplier}
										<span class="block text-[10px] font-normal text-zinc-500">{item.supplier}</span>
									{/if}
								</td>
								<td class="py-2.5 px-3 uppercase text-[10px] font-bold text-zinc-500">
									{item.kind}
								</td>
								<td class="py-2.5 px-3 tabular-nums text-zinc-700">
									{item.requiredQuantity} {item.unit}
								</td>
								<td class="py-2.5 px-3 tabular-nums font-medium text-zinc-700">
									{item.totalStockPackages} pkgs
								</td>
								<td class="py-2.5 px-3 tabular-nums font-bold {item.isOutOfStock ? 'text-rose-600' : item.isLowStock ? 'text-amber-600' : 'text-emerald-700'}">
									{item.servingsSupported} servings
								</td>
								<td class="py-2.5 px-3">
									{#if item.isOutOfStock}
										<span class="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
											Out of stock
										</span>
									{:else if item.isLowStock}
										<span class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
											Low stock
										</span>
									{:else}
										<span class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
											In stock
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
