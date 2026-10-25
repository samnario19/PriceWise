<script lang="ts">
	import type { ChannelMarketplace } from '$lib/types/recipe';
	import type {
		CatalogRowForImport,
		MarketplaceImportPatch,
		MarketplaceListingSubmitResult,
		ShopeeVariantOption
	} from '$lib/utils/marketplaceJsonImport';
	import {
		parseLazadaProductJson,
		parseShopeeItemGetJson
	} from '$lib/utils/marketplaceJsonImport';
	import {
		marketplaceGuideTitle,
		parseShopeeProductUrl,
		shopeeItemGetApiUrl
	} from '$lib/utils/marketplaceUrlHints';
	import { formatPhp } from '$lib/utils/numberFormat';

	const {
		open,
		initialUrl,
		marketplace,
		channelLabel,
		localRow,
		onSubmitListing,
		onApplyImport,
		onClose
	}: {
		open: boolean;
		initialUrl: string;
		marketplace: ChannelMarketplace;
		channelLabel: string;
		localRow: CatalogRowForImport | null;
		/** Save URL + run Playwright scrape via backend, then fill landed pricing */
		onSubmitListing: (url: string) => Promise<MarketplaceListingSubmitResult>;
		onApplyImport: (patch: MarketplaceImportPatch, listingUrl: string) => void;
		onClose: () => void;
	} = $props();

	let backdrop: HTMLDivElement | undefined = $state();
	let draftUrl = $state('');
	let copyFeedback = $state('');
	let pasteJson = $state('');
	let importError = $state('');
	let importOk = $state('');
	let syncSubmitting = $state(false);
	let syncError = $state('');
	/** Shopee multi-SKU: same JSON, user must pick Ceremonial / Culinary / etc. */
	let shopeeVariantBody = $state<{ bodyJson: string; variants: ShopeeVariantOption[] } | null>(null);

	$effect(() => {
		if (open) {
			draftUrl = initialUrl;
			pasteJson = '';
			importError = '';
			importOk = '';
			syncError = '';
			syncSubmitting = false;
			shopeeVariantBody = null;
		}
	});

	const shopeeParsed = $derived(marketplace === 'shopee' ? parseShopeeProductUrl(draftUrl) : null);
	const shopeeApiUrl = $derived(shopeeParsed ? shopeeItemGetApiUrl(shopeeParsed) : null);

	function close(): void {
		copyFeedback = '';
		importError = '';
		importOk = '';
		syncError = '';
		shopeeVariantBody = null;
		onClose();
	}

	function onBackdropMouseDown(e: MouseEvent): void {
		if (e.target === backdrop) close();
	}

	async function submit(e: Event): Promise<void> {
		e.preventDefault();
		syncError = '';
		shopeeVariantBody = null;
		syncSubmitting = true;
		try {
			const result = await onSubmitListing(draftUrl.trim());
			if (result.kind === 'shopee_variants') {
				shopeeVariantBody = {
					bodyJson: result.bodyJson,
					variants: result.variants
				};
				return;
			}
			if (result.kind === 'error') {
				syncError = result.message ?? 'Sync failed.';
				return;
			}
			close();
		} finally {
			syncSubmitting = false;
		}
	}

	function applyShopeeVariantChoice(v: ShopeeVariantOption): void {
		importError = '';
		importOk = '';
		if (!localRow || !shopeeVariantBody) return;
		const parsed = parseShopeeItemGetJson(shopeeVariantBody.bodyJson, localRow, {
			by: 'index',
			index: v.index
		});
		if (!parsed.ok) {
			importError = parsed.error;
			return;
		}
		onApplyImport(parsed.patch, draftUrl.trim());
		shopeeVariantBody = null;
		importOk = parsed.productName ? `Imported · ${parsed.productName}` : 'Imported marketplace pricing into this row.';
		pasteJson = '';
		close();
	}

	function applyJsonImport(): void {
		importError = '';
		importOk = '';
		shopeeVariantBody = null;
		if (!localRow) {
			importError = 'Missing catalog row.';
			return;
		}
		const trimmed = pasteJson.trim();
		if (!trimmed) {
			importError = 'Paste JSON first (Network → XHR row → Copy response).';
			return;
		}
		if (marketplace === 'shopee') {
			const sp = parseShopeeItemGetJson(trimmed, localRow);
			if (!sp.ok) {
				if (sp.needVariant === true) {
					shopeeVariantBody = {
						bodyJson: trimmed,
						variants: sp.variants
					};
					importError = '';
					return;
				}
				importError = sp.error;
				return;
			}
			onApplyImport(sp.patch, draftUrl.trim());
			importOk = sp.productName ? `Imported · ${sp.productName}` : 'Imported marketplace pricing into this row.';
			pasteJson = '';
			return;
		}

		const lp = parseLazadaProductJson(trimmed, localRow);
		if (!lp.ok) {
			importError = lp.error;
			return;
		}
		onApplyImport(lp.patch, draftUrl.trim());
		importOk = lp.productName ? `Imported · ${lp.productName}` : 'Imported marketplace pricing into this row.';
		pasteJson = '';
	}

	async function copyText(kind: string, text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			copyFeedback = kind;
			setTimeout(() => {
				copyFeedback = '';
			}, 2200);
		} catch {
			copyFeedback = 'copy_failed';
			setTimeout(() => {
				copyFeedback = '';
			}, 3200);
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={backdrop}
		class="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-sm"
		onmousedown={onBackdropMouseDown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="scrape-help-title"
		tabindex="-1"
	>
		<form
			class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/60 bg-white/90 p-6 shadow-2xl shadow-zinc-900/10 backdrop-blur-xl"
			onsubmit={submit}
		>
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 id="scrape-help-title" class="text-lg font-semibold tracking-tight text-zinc-900">
						Sync listing ({channelLabel})
					</h2>
					<p class="mt-1 text-sm text-zinc-500">
						{#if marketplace === 'shopee'}
							Paste the product link below, then use the <strong class="font-medium text-zinc-700">Open Shopee API</strong> button to get the price JSON in one click.
						{:else}
							Paste the product link and click <strong class="font-medium text-zinc-700">Save &amp; sync</strong>. The backend fetches pricing and fills package ₱ and units automatically.
						{/if}
					</p>
				</div>
				<button type="button" class="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onclick={close} aria-label="Close">
					×
				</button>
			</div>

			<div
				class="mt-4 rounded-2xl border px-4 py-3 text-sm {marketplace === 'shopee'
					? 'border-orange-200 bg-orange-50/80 text-orange-950'
					: 'border-sky-200 bg-sky-50/80 text-sky-950'}"
			>
				<p class="font-semibold">{marketplaceGuideTitle(marketplace)}</p>
				{#if marketplace === 'shopee'}
					{#if shopeeApiUrl}
						<!-- Primary Shopee flow: open API in new tab while logged in -->
						<ol class="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-snug opacity-95">
							<li>Make sure you are <strong>logged in to shopee.ph</strong> in this browser.</li>
							<li>Click <strong>Open Shopee API</strong> below — it opens the product's JSON in a new tab.</li>
							<li>Press <kbd class="rounded bg-white/80 px-1 py-0.5 text-xs">Ctrl+A</kbd> then <kbd class="rounded bg-white/80 px-1 py-0.5 text-xs">Ctrl+C</kbd> to copy all, then paste into the <strong>Advanced</strong> box below.</li>
						</ol>
						<div class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/70 p-3 ring-1 ring-orange-200/60">
							<a
								href={shopeeApiUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-500"
							>
								<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/></svg>
								Open Shopee API
							</a>
							<button
								type="button"
								class="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-orange-900 ring-1 ring-orange-200 hover:bg-orange-50"
								onclick={() => copyText('api', shopeeApiUrl)}
							>
								Copy URL instead
							</button>
							<code class="block w-full break-all text-[11px] leading-relaxed text-zinc-500">{shopeeApiUrl}</code>
						</div>
					{:else if draftUrl.trim()}
						<p class="mt-2 text-[13px] text-orange-900/80">
							Use the <strong>full desktop product URL</strong> — path must end in <code class="text-xs">-i.shop.item</code> (e.g. <code class="text-xs">shopee.ph/Product-name-i.649906772.23014373373</code>).
						</p>
					{:else}
						<p class="mt-2 text-[13px] text-orange-900/80">Paste the Shopee product URL above to get started.</p>
					{/if}
				{:else}
					<ul class="mt-2 list-inside list-disc space-y-1 text-[13px] leading-snug opacity-95">
						<li>
							<strong>Save &amp; sync</strong> reads <code class="text-xs">window.__moduleData__</code>,
							<code class="text-xs">pageData</code>, and <code class="text-xs">__INIT_DATA__</code> after the PDP loads — the same data you’d hunt for in DevTools, bundled as one JSON.
						</li>
						<li>
							The importer resolves <strong>skuInfos</strong> + <strong>selected SKU</strong> when present (sale price / nested
							<code class="text-xs">salePrice.value</code>), then specifications + title for package size hints.
						</li>
						<li>If sync fails, use Advanced — paste a large PDP response, not a tiny analytics request.</li>
					</ul>
				{/if}
			</div>

			<details class="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700">
				<summary class="cursor-pointer font-semibold text-zinc-900">Fields we capture</summary>
				<p class="mt-2 text-[13px] leading-relaxed">
					List price, shipping when present, and package hints for unit economics — aligned with your local catalog row when the
					listing omits weight.
				</p>
			</details>

			{#if copyFeedback}
				<p class="mt-3 text-center text-xs font-medium text-emerald-700" role="status">
					{copyFeedback === 'copy_failed'
						? 'Clipboard unavailable — copy from the field manually.'
						: copyFeedback === 'api'
							? 'API URL copied.'
							: copyFeedback === 'listing'
								? 'Listing URL copied.'
								: 'Copied.'}
				</p>
			{/if}

			<label class="mt-5 block">
				<span class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Product / listing URL</span>
				<input
					type="url"
					bind:value={draftUrl}
					placeholder="https://…"
					class="mt-1.5 w-full rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm outline-none ring-emerald-500/0 transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
				/>
			</label>

			{#if syncError}
				<p class="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200" role="alert">{syncError}</p>
			{/if}

			{#if marketplace === 'shopee' && shopeeVariantBody}
				<div
					class="mt-4 rounded-2xl border border-violet-200 bg-violet-50/95 px-4 py-3 text-sm text-violet-950 shadow-sm"
					role="region"
					aria-label="Choose Shopee variant"
				>
					<p class="font-semibold text-violet-950">Choose which option to price</p>
					<p class="mt-1 text-[13px] leading-snug text-violet-900/85">
						For example <strong>Ceremonial</strong> vs <strong>Culinary</strong> use different list prices. We add the
						listing&apos;s shipping from the same JSON after you pick.
					</p>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each shopeeVariantBody.variants as v}
							<button
								type="button"
								class="rounded-xl bg-white px-4 py-2.5 text-left text-sm font-semibold text-violet-950 shadow-sm ring-1 ring-violet-300 transition hover:bg-violet-100"
								onclick={() => applyShopeeVariantChoice(v)}
							>
								{v.name}
								<span class="block text-[13px] font-medium text-violet-700">List {formatPhp(v.pricePeso)}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="mt-6 flex flex-wrap justify-end gap-2">
				<button
					type="button"
					class="rounded-2xl px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
					onclick={close}
					disabled={syncSubmitting}
				>
					Cancel
				</button>
				{#if marketplace !== 'shopee'}
					<button
						type="submit"
						class="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={syncSubmitting}
					>
						{#if syncSubmitting}
							<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true"></span>
							Syncing…
						{:else}
							Save &amp; sync listing
						{/if}
					</button>
				{:else}
					<p class="text-[13px] text-zinc-500">Use <strong>Open Shopee API</strong> above, then paste the JSON in Advanced ↓</p>
				{/if}
			</div>

			<details class="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/90 px-4 py-3">
				<summary class="cursor-pointer text-sm font-semibold text-zinc-700">Advanced / debug — paste API JSON manually</summary>
				<p class="mt-2 text-[13px] leading-snug text-zinc-600">
					Use when Playwright is blocked or you need to double-check numbers. The listing URL field above is still saved with
					the row when provided.
				</p>
				{#if marketplace === 'shopee'}
					<ol
						class="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug text-zinc-700"
					>
						<li>
							Open the product in <strong>desktop</strong> Chrome/Edge, press <kbd class="rounded bg-zinc-200 px-1">F12</kbd> →
							<strong>Network</strong>.
						</li>
						<li>Turn on <strong>Preserve log</strong>. Set filter to <strong>Fetch / XHR</strong> (or &quot;All&quot; if you do not see it).</li>
						<li>
							<strong>Hard-reload</strong> the product page (Ctrl+Shift+R). Wait until images and price are visible.
						</li>
						<li>
							Click request rows and open the <strong>Response</strong> (or Preview) tab. You want JSON that includes fields
							like
							<code class="text-[11px]">itemid</code>, <code class="text-[11px]">shopid</code>, <code class="text-[11px]">price_min</code>
							or
							<code class="text-[11px]">name</code> — the <strong>request name in the list is not always
							&quot;item/get&quot;</strong> (Shopee uses e.g. <code class="text-xs">get_pc</code>, <code class="text-xs">pdp</code>, batch
							calls, or region-specific paths).
						</li>
						<li>Right-click that row → <strong>Copy</strong> → <strong>Copy response</strong>, then paste below.</li>
					</ol>
				{:else if marketplace === 'lazada'}
					<ol class="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug text-zinc-700">
						<li>
							<strong>Desktop</strong> Chrome/Edge → <kbd class="rounded bg-zinc-200 px-1">F12</kbd> → <strong>Network</strong> → filter
							<strong>Fetch / XHR</strong>.
						</li>
						<li>
							In the filter box try <code class="text-xs">mtop</code>, <code class="text-xs">product</code>,
							<code class="text-xs">pdp</code>, <code class="text-xs">detail</code>, or <code class="text-xs">sku</code> — Lazada does not use one fixed name.
						</li>
						<li><strong>Reload</strong> the product page. Open responses whose Preview shows nested JSON with numbers.</li>
						<li>
							Copy <strong>Copy response</strong> on any medium-sized JSON (often thousands of lines). PriceWise scans the whole tree for
							price fields — you do not need to find a specific endpoint name.
						</li>
					</ol>
				{:else}
					<p class="mt-2 text-[13px] text-zinc-600">
						In Network, pick an XHR whose response includes product/price fields, then copy the full response body.
					</p>
				{/if}
				<label class="mt-3 block">
					<span class="sr-only">Raw JSON</span>
					<textarea
						bind:value={pasteJson}
						rows="5"
						placeholder="Paste full JSON response body (XHR/Fetch)…"
						class="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/20"
					></textarea>
				</label>
				{#if importError}
					<p class="mt-2 text-sm text-rose-700" role="alert">{importError}</p>
				{/if}
				{#if importOk}
					<p class="mt-2 text-sm font-medium text-emerald-800" role="status">{importOk}</p>
				{/if}
				<button
					type="button"
					class="mt-3 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!localRow}
					onclick={applyJsonImport}
				>
					Apply JSON only
				</button>
			</details>
		</form>
	</div>
{/if}
