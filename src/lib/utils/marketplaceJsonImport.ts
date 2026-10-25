import type { ChannelLandedPrices } from '$lib/types/statistics';
import type { IngredientMasterDTO, MeasureUnit, OtherItemMasterDTO } from '$lib/types/recipe';
import { toBaseQuantity } from '$lib/utils/baseUnitCost';

export type CatalogRowForImport = Pick<
	IngredientMasterDTO,
	'packageSize' | 'packageUnit' | 'baseQuantity' | 'baseUnit'
>;

/** Successful parse fills landed ₱ for one channel + listing snapshot fields for display. */
export type MarketplaceImportPatch = {
	supplierChannelLanded: Partial<ChannelLandedPrices>;
	listingPackageSize: number;
	listingPackageUnit: MeasureUnit;
	listingShippingFee: number;
	listingBaseQuantity: number;
	listingBaseUnit: 'g' | 'ml' | 'piece';
};

function pesoFromShopeeInt(raw: number): number {
	if (!Number.isFinite(raw) || raw <= 0) return 0;
	// PH storefront APIs typically encode peso × 100_000 as integer
	let php = raw / 100_000;
	if (php > 5_000_000) php = raw / 100_000_000;
	return Math.round(php * 100) / 100;
}

function looksLikeShopeeItem(o: Record<string, unknown>): boolean {
	const id = o.itemid ?? (o as { item_id?: unknown }).item_id;
	const hasId = typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id));
	if (!hasId) return false;
	return (
		typeof o.name === 'string' ||
		typeof (o as { title?: unknown }).title === 'string' ||
		typeof o.price_min === 'number' ||
		typeof o.price_max === 'number' ||
		typeof o.price === 'number' ||
		Array.isArray(o.tier_variations) ||
		o.price_info !== undefined
	);
}

/** PDP APIs expose data.item or nested item blobs — route names differ by Shopee version/region. */
function walkFindShopeeItem(obj: unknown, depth = 0): Record<string, unknown> | null {
	if (depth > 22) return null;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		if (looksLikeShopeeItem(r)) return r;
		const nestedItem = r.item;
		if (nestedItem && typeof nestedItem === 'object') {
			const inner = nestedItem as Record<string, unknown>;
			if (looksLikeShopeeItem(inner)) return inner;
		}
		for (const v of Object.values(r)) {
			const hit = walkFindShopeeItem(v, depth + 1);
			if (hit) return hit;
		}
	} else if (Array.isArray(obj)) {
		for (const el of obj) {
			const hit = walkFindShopeeItem(el, depth + 1);
			if (hit) return hit;
		}
	}
	return null;
}

function pickShopeeItem(root: Record<string, unknown>): Record<string, unknown> | null {
	const data = root.data;
	if (data && typeof data === 'object') {
		const d = data as Record<string, unknown>;
		const item = d.item;
		if (item && typeof item === 'object') return item as Record<string, unknown>;
	}
	const item = root.item;
	if (item && typeof item === 'object') return item as Record<string, unknown>;
	return walkFindShopeeItem(root);
}

function shopeeListedPricePeso(item: Record<string, unknown>): number {
	const keys = ['price_min', 'price_max', 'price', 'item_min_price', 'item_price'] as const;
	for (const k of keys) {
		const v = item[k];
		if (typeof v === 'number' && v > 0) return pesoFromShopeeInt(v);
	}
	const pi = item.price_info;
	if (pi && typeof pi === 'object') {
		const pr = (pi as Record<string, unknown>).price;
		if (typeof pr === 'number' && pr > 0) return pesoFromShopeeInt(pr);
	}
	const tiers = item.tier_variations;
	if (Array.isArray(tiers) && tiers.length > 0) {
		for (const t0 of tiers) {
			if (t0 && typeof t0 === 'object') {
				const rec = t0 as Record<string, unknown>;
				const price = rec.price ?? rec.price_min;
				if (typeof price === 'number' && price > 0) return pesoFromShopeeInt(price);
			}
		}
	}
	return 0;
}

function extractGramsMlPiece(text: string): { qty: number; unit: 'g' | 'ml' | 'piece' } | null {
	const s = text.toLowerCase();
	let m = s.match(/(\d+(?:\.\d+)?)\s*(kg)\b/);
	if (m) return { qty: parseFloat(m[1]) * 1000, unit: 'g' };
	m = s.match(/(\d+(?:\.\d+)?)\s*(g)\b/);
	if (m) return { qty: parseFloat(m[1]), unit: 'g' };
	m = s.match(/(\d+(?:\.\d+)?)\s*(l)\b/);
	if (m) return { qty: parseFloat(m[1]) * 1000, unit: 'ml' };
	m = s.match(/(\d+(?:\.\d+)?)\s*(ml)\b/);
	if (m) return { qty: parseFloat(m[1]), unit: 'ml' };
	m = s.match(/(\d+)\s*(pcs?|pieces?|pc)\b/);
	if (m) return { qty: parseFloat(m[1]), unit: 'piece' };
	return null;
}

function shopeeShippingPeso(item: Record<string, unknown>): number {
	const feeInfo = item.shipping_fee_info;
	if (feeInfo && typeof feeInfo === 'object') {
		const fi = feeInfo as Record<string, unknown>;
		const mod = fi.modified_fee;
		if (typeof mod === 'number' && mod > 0) return pesoFromShopeeInt(mod);
		const plain = fi.fee;
		if (typeof plain === 'number' && plain > 0) return pesoFromShopeeInt(plain);
		const priceObj = fi.price;
		if (priceObj && typeof priceObj === 'object') {
			const sv = (priceObj as Record<string, unknown>).single_value;
			if (typeof sv === 'number' && sv > 0) return pesoFromShopeeInt(sv);
		}
	}
	return 0;
}

/** get_pc nests shipping under data.product_shipping, not on data.item */
function shopeeShippingFromPdpRoot(root: Record<string, unknown>): number {
	const data = root.data;
	if (!data || typeof data !== 'object') return 0;
	const d = data as Record<string, unknown>;
	const ps = d.product_shipping;
	if (!ps || typeof ps !== 'object') return 0;
	const sfi = (ps as Record<string, unknown>).shipping_fee_info;
	return shopeeShippingPeso({ shipping_fee_info: sfi } as Record<string, unknown>);
}

function shopeeProductLabel(item: Record<string, unknown>): string {
	if (typeof item.name === 'string' && item.name.trim()) return item.name;
	if (typeof item.title === 'string' && item.title.trim()) return item.title;
	return '';
}

function guessListingDimsFromShopee(
	item: Record<string, unknown>,
	local: CatalogRowForImport
): Pick<
	MarketplaceImportPatch,
	'listingPackageSize' | 'listingPackageUnit' | 'listingBaseQuantity' | 'listingBaseUnit'
> {
	const label = shopeeProductLabel(item);
	const blobs: string[] = [];
	if (label) blobs.push(label);
	if (typeof item.description === 'string' && item.description.trim()) {
		blobs.push(item.description.slice(0, 2500));
	}
	const attrs = item.attributes;
	if (Array.isArray(attrs)) {
		for (const a of attrs) {
			if (a && typeof a === 'object') {
				const v = (a as Record<string, unknown>).value;
				if (typeof v === 'string') blobs.push(v);
			}
		}
	}
	let parsed: ReturnType<typeof extractGramsMlPiece> | null = null;
	for (const b of blobs) {
		parsed = extractGramsMlPiece(b);
		if (parsed) break;
	}

	const listingPackageSize = parsed ? parsed.qty : local.packageSize;
	const listingPackageUnit = parsed
		? parsed.unit === 'g'
			? 'g'
			: parsed.unit === 'ml'
				? 'ml'
				: 'piece'
		: local.packageUnit;

	const base = toBaseQuantity(listingPackageSize, listingPackageUnit);
	return {
		listingPackageSize,
		listingPackageUnit,
		listingBaseQuantity: base.quantity,
		listingBaseUnit: base.unit
	};
}

/** One SKU / tier from Shopee `data.item.models[]` (e.g. Ceremonial vs Culinary). */
export type ShopeeVariantOption = {
	index: number;
	modelId: number | null;
	name: string;
	pricePeso: number;
};

/** Pick a row from `models[]` after the user chooses (required when multiple models exist). */
export type ShopeeVariantPick = { by: 'index'; index: number };

export type ParseShopeeItemResult =
	| { ok: true; patch: MarketplaceImportPatch; productName?: string }
	| { ok: false; error: string; needVariant?: never }
	| { ok: false; needVariant: true; variants: ShopeeVariantOption[]; error: string };

/** Result from Save & sync — Shopee multi-SKU listings may need a variant step in the modal. */
export type MarketplaceListingSubmitResult =
	| { kind: 'success' }
	| { kind: 'error'; message?: string }
	| { kind: 'shopee_variants'; variants: ShopeeVariantOption[]; bodyJson: string };

export function extractShopeeModelVariants(item: Record<string, unknown>): ShopeeVariantOption[] {
	const models = item.models;
	if (!Array.isArray(models) || models.length === 0) return [];
	const out: ShopeeVariantOption[] = [];
	for (let i = 0; i < models.length; i++) {
		const m = models[i];
		if (!m || typeof m !== 'object') continue;
		const rec = m as Record<string, unknown>;
		const price = rec.price;
		if (typeof price !== 'number' || price <= 0) continue;
		const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : `Option ${i + 1}`;
		const mid = rec.model_id;
		out.push({
			index: i,
			modelId: typeof mid === 'number' ? mid : null,
			name,
			pricePeso: pesoFromShopeeInt(price)
		});
	}
	return out;
}

/** Parse pasted DevTools JSON — any XHR/Fetch body that contains Shopee item + price fields. */
export function parseShopeeItemGetJson(
	raw: string,
	local: CatalogRowForImport,
	pick?: ShopeeVariantPick
): ParseShopeeItemResult {
	let root: unknown;
	try {
		root = JSON.parse(raw) as unknown;
	} catch {
		return {
			ok: false,
			error:
				'Invalid JSON. In Network → click a Fetch/XHR row → Response tab → copy the full JSON body.'
		};
	}
	if (!root || typeof root !== 'object') return { ok: false, error: 'Unexpected JSON root.' };
	const rootObj = root as Record<string, unknown>;
	const item = pickShopeeItem(rootObj);
	if (!item) {
		if (rootObj.error !== undefined) {
			return {
				ok: false,
				error: `Shopee error payload (error=${String(JSON.stringify(rootObj.error)).slice(0, 160)}). Try another XHR with a 200 response whose Preview shows itemid and prices, or paste JSON after the page fully loads.`
			};
		}
		return {
			ok: false,
			error:
				'Could not find product fields (itemid + price) in this JSON. In DevTools → Network → Fetch/XHR, reload the product page and paste a response whose Preview includes itemid / price_min / name (request names are not always "item/get").'
		};
	}

	const modelsOpts = extractShopeeModelVariants(item);
	let listPeso = 0;

	if (modelsOpts.length > 1) {
		if (!pick) {
			return {
				ok: false,
				needVariant: true,
				variants: modelsOpts,
				error:
					'This listing has multiple SKUs — choose Ceremonial, Culinary, or another option below.'
			};
		}
		const chosen = modelsOpts.find((m) => m.index === pick.index);
		if (!chosen) {
			return { ok: false, error: 'Invalid variant selection — try another option.' };
		}
		listPeso = chosen.pricePeso;
	} else if (modelsOpts.length === 1) {
		listPeso = modelsOpts[0].pricePeso;
	} else {
		listPeso = shopeeListedPricePeso(item);
	}

	if (listPeso <= 0) return { ok: false, error: 'Could not read a list price from this JSON.' };

	let ship = shopeeShippingPeso(item);
	if (ship <= 0) ship = shopeeShippingFromPdpRoot(rootObj);
	const landed = Math.round((listPeso + ship) * 100) / 100;
	const dims = guessListingDimsFromShopee(item, local);
	const baseName =
		typeof item.name === 'string'
			? item.name
			: typeof item.title === 'string'
				? item.title
				: undefined;
	let productName = baseName;
	if (pick?.by === 'index' && modelsOpts.length > 0) {
		const vn = modelsOpts.find((m) => m.index === pick.index);
		if (vn?.name) {
			productName = baseName ? `${baseName} · ${vn.name}` : vn.name;
		}
	}

	return {
		ok: true,
		productName,
		patch: {
			supplierChannelLanded: { shopee: landed },
			...dims,
			listingShippingFee: ship
		}
	};
}

/** Lazada APIs vary (MTOP, PDP modules); normalize integers that might be centavos or minor units. */
function lazadaNormalizeRawPrice(raw: number): number[] {
	if (!Number.isFinite(raw) || raw <= 0) return [];
	const candidates = new Set<number>();
	const push = (x: number) => {
		const r = Math.round(x * 100) / 100;
		if (r >= 10 && r <= 5_000_000) candidates.add(r);
	};
	push(raw);
	push(raw / 100);
	push(raw / 10000);
	push(raw / 100000);
	push(raw / 1000000);
	const arr = [...candidates].sort((a, b) => a - b);
	/** Prefer typical storefront ₱ amounts over tiny fractions from bad divides */
	const preferred = arr.filter((x) => x >= 39 && x <= 999_999);
	return preferred.length ? preferred : arr;
}

/** Lower score = prefer for list price. “discount” alone often holds amounts saved — not list ₱. */
function lazadaPriceKeyScore(key: string): number {
	const k = key.toLowerCase();
	if (
		/\b(discount|cashback|voucher|coin|point|installment|emi|percent|ratio|saved)\b/i.test(k) ||
		/^pct|rate$/i.test(k)
	) {
		return 98;
	}
	/* `/sale/` matches inside `sales` — cumulative sold counts were tier-0 “prices” (e.g. ₱100,000). */
	if (/\b(sales|wholesale|presales)\b/i.test(k)) return 98;
	if (/sales/i.test(k) && !/saleprice|sale_price/i.test(k)) return 98;
	if (/\b(soldquantity|soldcount|reviewcount|ratingcount)\b/i.test(k)) return 98;
	if (
		/\b(saleprice|listprice|promotionprice|offerprice|dealprice|finalprice|currentprice|specialprice)\b/i.test(k)
	) {
		return 0;
	}
	if (/sale|promotion|offer|deal|final|current|special|listprice|saleprice/i.test(k)) return 0;
	if (/^pay$/i.test(k)) return 98;
	if (/payamount|paidamount|payable|orderamount/i.test(k)) return 1;
	if (/price|amount|cost/i.test(k) && !/original|market|strike|before|cross|list|rrp|high/i.test(k)) return 1;
	if (/original|market|strike|before|list|rrp/i.test(k)) return 3;
	return 2;
}

/** PDP/search URLs often carry `price=` or `priceCompare` minor-unit integers (e.g. displayPrice:41661 → ₱416.61). */
function lazadaExtractPriceFromListingUrl(rawUrl: unknown): number {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return 0;
	try {
		const u = new URL(rawUrl.trim());
		const direct = u.searchParams.get('price');
		if (direct) {
			const n = parseFloat(direct.replace(/,/g, ''));
			if (Number.isFinite(n) && n >= 1 && n <= 500_000) return Math.round(n * 100) / 100;
		}
		const pc = u.searchParams.get('priceCompare');
		if (pc) {
			const dec = decodeURIComponent(pc);
			for (const name of ['displayPrice', 'originPrice'] as const) {
				const re = new RegExp(`(?:^|[;])${name}:(\\d+)`, 'i');
				const m = re.exec(dec);
				if (!m) continue;
				const v = parseInt(m[1], 10);
				if (!Number.isFinite(v) || v <= 0) continue;
				const major = v >= 1000 ? v / 100 : v;
				const rounded = Math.round(major * 100) / 100;
				if (rounded >= 1 && rounded <= 500_000) return rounded;
			}
		}
	} catch {
		return 0;
	}
	return 0;
}

/** PDP path often includes `-s{skuId}.html` (explicit variant from the shared link). */
function lazadaSkuIdFromListingUrl(rawUrl: unknown): string | number | null {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
	try {
		const u = new URL(rawUrl.trim());
		const path = u.pathname;
		const m = /-s(\d+)(?:\.html)?$/i.exec(path);
		if (m) return m[1];
		for (const key of ['sku_id', 'skuId', 'skuid'] as const) {
			const q = u.searchParams.get(key);
			if (q && /^\d+$/.test(q)) return q;
		}
	} catch {
		return null;
	}
	return null;
}

/** Depth-first: collect normalized ₱ candidates from nested Lazada / MTOP payloads. */
function walkCollectLazadaPrices(obj: unknown, depth: number, scored: { p: number; s: number }[]): void {
	if (depth > 28) return;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		for (const [key, val] of Object.entries(r)) {
			if (/shipping|freight|delivery|postage|postfee|shipfee/i.test(key)) continue;
			if (/\b(sku|item|shop)?id$/i.test(key) && typeof val === 'number' && val < 1_000_000_000) {
				continue;
			}
			const ks = lazadaPriceKeyScore(key);
			if (ks >= 98) continue;
			if (typeof val === 'number' && val > 0) {
				for (const php of lazadaNormalizeRawPrice(val)) {
					scored.push({ p: php, s: ks });
				}
			} else if (typeof val === 'string' && /^[\d,.]+$/.test(val.trim())) {
				const n = parseFloat(val.replace(/,/g, ''));
				if (n > 0) {
					for (const php of lazadaNormalizeRawPrice(n)) {
						scored.push({ p: php, s: ks });
					}
				}
			}
		}
		for (const v of Object.values(r)) walkCollectLazadaPrices(v, depth + 1, scored);
	} else if (Array.isArray(obj)) {
		for (const el of obj) walkCollectLazadaPrices(el, depth + 1, scored);
	}
}

function pickBestLazadaListPrice(scored: { p: number; s: number }[]): number {
	if (scored.length === 0) return 0;
	scored.sort((a, b) => (a.s !== b.s ? a.s - b.s : a.p - b.p));
	const tier = scored[0].s;
	let tierPool = scored.filter((x) => x.s === tier);
	let prices = [...new Set(tierPool.map((x) => x.p))].sort((a, b) => a - b);
	if (prices.length >= 2) {
		const lo = prices[0];
		const hi = prices[prices.length - 1];
		/** Drop tiny junk numbers when the same JSON also contains realistic list ₱ (e.g. 76 vs 528). */
		if (hi >= 199 && hi <= 900_000 && hi / lo >= 2.5) {
			prices = prices.filter((p) => p >= hi / 5);
		}
	}
	if (prices.length === 0) return 0;
	return prices.reduce((m, x) => Math.min(m, x), prices[0]);
}

function walkFindLazadaTitle(obj: unknown, depth: number): string {
	if (depth > 22) return '';
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		for (const k of ['title', 'subject', 'productTitle', 'itemTitle', 'name', 'productName'] as const) {
			const v = r[k];
			if (typeof v === 'string' && v.trim().length > 3) return v.trim();
		}
		for (const v of Object.values(r)) {
			const t = walkFindLazadaTitle(v, depth + 1);
			if (t) return t;
		}
	} else if (Array.isArray(obj)) {
		for (const el of obj) {
			const t = walkFindLazadaTitle(el, depth + 1);
			if (t) return t;
		}
	}
	return '';
}

function lazadaExtractMoneyPhp(v: unknown): number {
	if (typeof v === 'number' && v > 0 && v < 500_000) return Math.round(v * 100) / 100;
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		const inner =
			o.amount ??
			o.fee ??
			o.price ??
			o.value ??
			o.singleValue ??
			o.payAmount ??
			o.displayAmount;
		if (typeof inner === 'number' && inner > 0) {
			const opts = lazadaNormalizeRawPrice(inner);
			const pick = opts.filter((x) => x >= 5 && x < 50_000);
			return pick.length ? Math.min(...pick) : opts[0] ?? 0;
		}
	}
	return 0;
}

/** Playwright bundles __moduleData__ / pageData / __INIT_DATA__ / __data / g_config — parse each fragment. */
function lazadaEffectiveRoots(root: Record<string, unknown>): Record<string, unknown>[] {
	const parts: Record<string, unknown>[] = [];

	// Path 1: _lazadaPageBootstrap (Playwright window extraction)
	const bs = root._lazadaPageBootstrap;
	if (bs && typeof bs === 'object') {
		const b = bs as Record<string, unknown>;
		for (const key of ['__moduleData__', 'pageData', '__INIT_DATA__', '__data', 'g_config'] as const) {
			const v = b[key];
			if (v && typeof v === 'object' && !Array.isArray(v)) parts.push(v as Record<string, unknown>);
		}
		// Also push the bootstrap itself as a root for top-level key walking
		parts.push(b);
	}

	// Path 2: _lazadaNextData (Next.js __NEXT_DATA__ extraction)
	const nd = root._lazadaNextData;
	if (nd && typeof nd === 'object' && !Array.isArray(nd)) {
		parts.push(nd as Record<string, unknown>);
	}

	if (parts.length) return [...parts, root];
	return [root];
}

function lazadaWalkFindSelectedSkuId(obj: unknown, depth = 0): string | number | null {
	if (depth > 22) return null;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		for (const k of [
			'selectedSkuId',
			'curSkuId',
			'currentSkuId',
			'skuSelectedId',
			'focusSkuId',
			'mainSkuId'
		] as const) {
			const v = r[k];
			if (typeof v === 'number' && v > 0) return v;
			if (typeof v === 'string' && /^\d+$/.test(v)) return v;
		}
		const sel = r.selectedSku;
		if (sel && typeof sel === 'object') {
			const so = sel as Record<string, unknown>;
			const sid = so.skuId ?? so.itemId ?? so.id;
			if (typeof sid === 'number' && sid > 0) return sid;
			if (typeof sid === 'string' && /^\d+$/.test(sid)) return sid;
		}
		for (const v of Object.values(r)) {
			const hit = lazadaWalkFindSelectedSkuId(v, depth + 1);
			if (hit !== null) return hit;
		}
	} else if (Array.isArray(obj)) {
		for (const el of obj) {
			const hit = lazadaWalkFindSelectedSkuId(el, depth + 1);
			if (hit !== null) return hit;
		}
	}
	return null;
}

function lazadaWalkFindSkuInfos(obj: unknown, depth = 0): unknown[] | null {
	if (depth > 22) return null;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		const si = r.skuInfos ?? r.skuList;
		if (Array.isArray(si) && si.length > 0) return si;
		for (const v of Object.values(r)) {
			const hit = lazadaWalkFindSkuInfos(v, depth + 1);
			if (hit) return hit;
		}
	} else if (Array.isArray(obj)) {
		for (const el of obj) {
			const hit = lazadaWalkFindSkuInfos(el, depth + 1);
			if (hit) return hit;
		}
	}
	return null;
}

function lazadaSkuRowMatchesId(row: unknown, id: string | number | null): boolean {
	if (id === null || row === null || typeof row !== 'object') return false;
	const r = row as Record<string, unknown>;
	const candidates = [
		r.skuId,
		r.itemId,
		r.sku_id,
		r.item_id,
		r.id,
		r.SKUId
	];
	const idStr = String(id);
	for (const c of candidates) {
		if (c !== undefined && c !== null && String(c) === idStr) return true;
	}
	return false;
}

function lazadaPickSkuRow(infos: unknown[], selectedId: string | number | null): unknown | null {
	if (!infos.length) return null;
	if (selectedId !== null) {
		const hit = infos.find((row) => lazadaSkuRowMatchesId(row, selectedId));
		if (hit) return hit;
	}
	return infos[0];
}

/** Lazada nests sale prices: price.salePrice.value, price.showPrice */
function lazadaExtractNestedPricePhp(priceVal: unknown): number {
	if (typeof priceVal === 'number') {
		const opts = lazadaNormalizeRawPrice(priceVal);
		return opts.length ? opts[0] : priceVal;
	}
	if (!priceVal || typeof priceVal !== 'object') return 0;
	const p = priceVal as Record<string, unknown>;
	const sale = p.salePrice;
	if (sale && typeof sale === 'object') {
		const v = (sale as Record<string, unknown>).value;
		if (typeof v === 'number') {
			const opts = lazadaNormalizeRawPrice(v);
			return opts.length ? opts[0] : v;
		}
	}
	const show = p.showPrice;
	if (typeof show === 'string') {
		const m = show.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
		if (m) return parseFloat(m[1]);
	}
	for (const k of ['promotionPrice', 'finalPrice', 'price'] as const) {
		const v = p[k];
		if (typeof v === 'number') {
			const opts = lazadaNormalizeRawPrice(v);
			if (opts.length) return opts[0];
		}
		if (v && typeof v === 'object') {
			const inner = (v as Record<string, unknown>).value;
			if (typeof inner === 'number') {
				const opts = lazadaNormalizeRawPrice(inner);
				return opts.length ? opts[0] : inner;
			}
		}
	}
	return 0;
}

function lazadaExtractSkuRowPricePhp(sku: unknown): number {
	if (!sku || typeof sku !== 'object') return 0;
	const o = sku as Record<string, unknown>;
	let v = lazadaExtractNestedPricePhp(o.price);
	if (v > 0) return v;
	v = lazadaExtractNestedPricePhp(o.salePrice);
	if (v > 0) return v;
	if (typeof o.price === 'number') {
		const opts = lazadaNormalizeRawPrice(o.price);
		return opts.length ? opts[0] : o.price;
	}
	return 0;
}

function lazadaCollectSpecificationBlobs(obj: unknown, depth = 0, out: string[] = []): string[] {
	if (depth > 20) return out;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		const specs = r.specifications ?? r.attributes ?? r.props;
		if (Array.isArray(specs)) {
			for (const s of specs) {
				if (s && typeof s === 'object') {
					const rec = s as Record<string, unknown>;
					const name = rec.name ?? rec.attrName;
					const val = rec.value ?? rec.attrVal ?? rec.text;
					if (typeof val === 'string')
						out.push(typeof name === 'string' ? `${name} ${val}` : val);
				}
			}
		}
		for (const v of Object.values(r)) lazadaCollectSpecificationBlobs(v, depth + 1, out);
	} else if (Array.isArray(obj)) {
		for (const el of obj) lazadaCollectSpecificationBlobs(el, depth + 1, out);
	}
	return out;
}

function guessLazadaDimsFromHybrid(
	rootFragments: Record<string, unknown>[],
	title: string | undefined,
	local: CatalogRowForImport
): Pick<
	MarketplaceImportPatch,
	'listingPackageSize' | 'listingPackageUnit' | 'listingBaseQuantity' | 'listingBaseUnit'
> {
	const blobs: string[] = [];
	if (title) blobs.push(title);
	for (const frag of rootFragments) lazadaCollectSpecificationBlobs(frag, 0, blobs);
	let parsed: ReturnType<typeof extractGramsMlPiece> | null = null;
	for (const b of blobs) {
		parsed = extractGramsMlPiece(b);
		if (parsed) break;
	}
	const listingPackageSize = parsed ? parsed.qty : local.packageSize;
	const listingPackageUnit = parsed
		? parsed.unit === 'g'
			? 'g'
			: parsed.unit === 'ml'
				? 'ml'
				: 'piece'
		: local.packageUnit;
	const base = toBaseQuantity(listingPackageSize, listingPackageUnit);
	return {
		listingPackageSize,
		listingPackageUnit,
		listingBaseQuantity: base.quantity,
		listingBaseUnit: base.unit
	};
}

function walkFindLazadaShipping(obj: unknown, depth: number): number {
	if (depth > 22) return 0;
	if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
		const r = obj as Record<string, unknown>;
		for (const key of Object.keys(r)) {
			if (
				/shipping|freight|postage|deliveryfee|shipfee|deliverycost|logisticsfee|standarddelivery/i.test(key)
			) {
				const got = lazadaExtractMoneyPhp(r[key]);
				if (got > 0 && got < 50_000) return got;
			}
		}
		for (const v of Object.values(r)) {
			const s = walkFindLazadaShipping(v, depth + 1);
			if (s > 0) return s;
		}
	} else if (Array.isArray(obj)) {
		for (const el of obj) {
			const s = walkFindLazadaShipping(el, depth + 1);
			if (s > 0) return s;
		}
	}
	return 0;
}

/**
 * Lazada: prefer `_lazadaPageBootstrap` from Playwright, selected SKU row in `skuInfos`,
 * nested `salePrice.value`, specifications + title for package hints.
 */
export function parseLazadaProductJson(
	raw: string,
	local: CatalogRowForImport
): { ok: true; patch: MarketplaceImportPatch; productName?: string } | { ok: false; error: string } {
	let root: unknown;
	try {
		root = JSON.parse(raw) as unknown;
	} catch {
		return {
			ok: false,
			error: 'Invalid JSON. In Network → Fetch/XHR, copy the Response body of a product page request (try filtering “product”, “pdp”, “mtop”, or “detail”).'
		};
	}
	if (!root || typeof root !== 'object') return { ok: false, error: 'Unexpected JSON root.' };

	const r = root as Record<string, unknown>;

	// Fast path: simple DOM-fallback shape {price, title, _pricewise_source: 'dom_fallback'}
	if (r._pricewise_source === 'dom_fallback') {
		const rawPrice = r.price;
		const pricePhp =
			typeof rawPrice === 'number' && rawPrice > 0
				? Math.round(rawPrice * 100) / 100
				: 0;
		if (pricePhp > 0) {
			const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : undefined;
			const dims = guessLazadaDimsFromHybrid([r], title, local);
			return {
				ok: true,
				productName: title,
				patch: {
					supplierChannelLanded: { lazada: pricePhp },
					...dims,
					listingShippingFee: 0
				}
			};
		}
	}

	const roots = lazadaEffectiveRoots(r);

	let selectedSkuId: string | number | null = lazadaSkuIdFromListingUrl(r._pricewisePageUrl);
	let skuInfos: unknown[] | null = null;
	for (const frag of roots) {
		if (selectedSkuId === null)
			selectedSkuId = lazadaWalkFindSelectedSkuId(frag) ?? selectedSkuId;
		const found = lazadaWalkFindSkuInfos(frag);
		if (found && found.length > 0) skuInfos = found;
	}

	let skuPricePhp = 0;
	if (skuInfos && skuInfos.length > 0) {
		const row = lazadaPickSkuRow(skuInfos, selectedSkuId);
		if (row) skuPricePhp = lazadaExtractSkuRowPricePhp(row);
	}

	const globalRaw = r.global;
	const globalObj =
		globalRaw && typeof globalRaw === 'object' ? (globalRaw as Record<string, unknown>) : null;
	const payloadRoot =
		r.module ??
		r.data ??
		r.result ??
		r.mainModule ??
		globalObj?.product ??
		globalObj?.skuOverlay ??
		r;
	const flat =
		typeof payloadRoot === 'object' && payloadRoot !== null
			? (payloadRoot as Record<string, unknown>)
			: r;

	const flatSkuInfos = flat.skuInfos;
	const skuList = flat.skuList;
	const priceCandidates: unknown[] = [
		flat.price,
		flat.originalPrice,
		Array.isArray(flatSkuInfos) ? flatSkuInfos[0] : undefined,
		Array.isArray(skuList) ? skuList[0] : undefined
	];
	let firstPass = 0;
	for (const c of priceCandidates) {
		if (typeof c === 'number' && c > 0) {
			const opts = lazadaNormalizeRawPrice(c);
			firstPass = opts.length ? opts[0] : c;
			break;
		}
		if (c && typeof c === 'object') {
			const o = c as Record<string, unknown>;
			const nested =
				o.price ?? o.originalPrice ?? o.salePrice ?? o.finalPrice ?? o.promotionPrice;
			if (typeof nested === 'number' && nested > 0) {
				const opts = lazadaNormalizeRawPrice(nested);
				firstPass = opts.length ? opts[0] : nested;
				break;
			}
			const fromNested = lazadaExtractNestedPricePhp(o.price);
			if (fromNested > 0) {
				firstPass = fromNested;
				break;
			}
		}
	}

	const scored: { p: number; s: number }[] = [];
	for (const frag of roots) walkCollectLazadaPrices(frag, 0, scored);
	const urlHintPhp = lazadaExtractPriceFromListingUrl(r._pricewisePageUrl);
	if (urlHintPhp > 0) scored.push({ p: urlHintPhp, s: -4 });
	if (skuPricePhp > 0) scored.push({ p: Math.round(skuPricePhp * 100) / 100, s: -2 });
	if (firstPass > 0) scored.push({ p: Math.round(firstPass * 100) / 100, s: 1 });

	let pricePhp = pickBestLazadaListPrice(scored);
	pricePhp = Math.round(pricePhp * 100) / 100;

	if (pricePhp <= 0 || pricePhp > 5_000_000) {
		return {
			ok: false,
			error:
				'Could not find a price in this JSON. Use Save & sync (Playwright reads window.__moduleData__ / pageData) or paste a full PDP response — not a tiny tracking XHR.'
		};
	}

	const titleBlob =
		(typeof flat.title === 'string' && flat.title) ||
		(typeof flat.subject === 'string' && flat.subject) ||
		(typeof flat.productTitle === 'string' && flat.productTitle) ||
		walkFindLazadaTitle(r, 0);
	const title = titleBlob || undefined;

	const dims = guessLazadaDimsFromHybrid(roots, title, local);

	let ship = typeof flat.shippingFee === 'number' ? flat.shippingFee : 0;
	if (ship <= 0) {
		for (const frag of roots) {
			ship = walkFindLazadaShipping(frag, 0);
			if (ship > 0) break;
		}
	}
	const landed = Math.round((pricePhp + ship) * 100) / 100;

	return {
		ok: true,
		productName: title,
		patch: {
			supplierChannelLanded: { lazada: landed },
			...dims,
			listingShippingFee: ship
		}
	};
}

export function mergeChannelLanded(
	prev: ChannelLandedPrices | undefined,
	patch: Partial<ChannelLandedPrices>
): ChannelLandedPrices {
	return {
		lazada: patch.lazada ?? prev?.lazada ?? 0,
		shopee: patch.shopee ?? prev?.shopee ?? 0,
		local: patch.local ?? prev?.local ?? 0
	};
}
