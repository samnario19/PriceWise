import type {
	ChannelMarketplace,
	ChannelScrapeInfo,
	IngredientMasterDTO,
	IngredientMasterInput,
	MeasureUnit,
	UnitCostHistoryEntry
} from '$lib/types/recipe';
import type { ChannelLandedPrices } from '$lib/types/statistics';
import { mergeChannelLanded } from '$lib/utils/marketplaceJsonImport';
import { computeUnitCost, toBaseQuantity } from '$lib/utils/baseUnitCost';
import { catalogBatchKey } from '$lib/utils/catalogBatch';
import type { StockTransaction } from '$lib/types/recipe';
import {
	buildInitialLotsFromMaster,
	catalogUnitCost,
	consumeStockFifo,
	ensurePurchaseLots,
	lotMergeKey,
	receiveStock,
	totalPackagesRemaining,
	type ReceiveStockInput
} from '$lib/utils/stockLots';

export const ingredientCatalog = $state({
	items: [] as IngredientMasterDTO[]
});

export function computeCatalogUnitCost(input: {
	packagePrice: number;
	shippingFee: number;
	packageSize: number;
	packageUnit: MeasureUnit;
}): number {
	const base = toBaseQuantity(input.packageSize, input.packageUnit);
	if (base.quantity <= 0) return 0;
	return computeUnitCost(input.packagePrice, input.shippingFee, base.quantity);
}

function mergeChannelScrape(
	prev: IngredientMasterDTO['channelScrape'],
	patch: Partial<Record<ChannelMarketplace, Partial<ChannelScrapeInfo>>>
): IngredientMasterDTO['channelScrape'] {
	const next: NonNullable<IngredientMasterDTO['channelScrape']> = { ...prev };
	for (const [k, v] of Object.entries(patch) as [ChannelMarketplace, Partial<ChannelScrapeInfo>][]) {
		const merged = { ...prev?.[k], ...v };
		next[k] = {
			status: merged.status ?? prev?.[k]?.status ?? 'idle',
			url: merged.url,
			updatedAt: merged.updatedAt,
			listingPackageSize: merged.listingPackageSize,
			listingPackageUnit: merged.listingPackageUnit,
			listingShippingFee: merged.listingShippingFee,
			listingBaseQuantity: merged.listingBaseQuantity,
			listingBaseUnit: merged.listingBaseUnit
		};
	}
	return next;
}

function newId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return `mid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MAX_UNIT_COST_HISTORY = 36;

function trimHistory(h: UnitCostHistoryEntry[]): UnitCostHistoryEntry[] {
	if (h.length <= MAX_UNIT_COST_HISTORY) return h;
	return h.slice(h.length - MAX_UNIT_COST_HISTORY);
}

function newTxnId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function appendStockTransaction(
	m: IngredientMasterDTO,
	txn: Omit<StockTransaction, 'id' | 'stockAfter'>,
	stockAfter: number
): StockTransaction[] {
	const next = [...(m.stockTransactions ?? []), { ...txn, id: newTxnId(), stockAfter }];
	return next.length > 120 ? next.slice(next.length - 120) : next;
}

function buildMasterFromInput(input: IngredientMasterInput, packagesQty = 1): IngredientMasterDTO {
	const base = toBaseQuantity(input.packageSize, input.packageUnit);
	const unitCost = computeUnitCost(input.packagePrice, input.shippingFee, base.quantity);
	const now = new Date().toISOString();
	const lots = buildInitialLotsFromMaster(
		{
			packagePrice: input.packagePrice,
			shippingFee: input.shippingFee,
			packageSize: input.packageSize,
			packageUnit: input.packageUnit,
			baseQuantity: base.quantity,
			unitCost
		},
		packagesQty
	);
	const stockAfter = totalPackagesRemaining(lots);
	return {
		id: newId(),
		name: input.name.trim(),
		supplier: input.supplier.trim(),
		packagePrice: input.packagePrice,
		packageSize: input.packageSize,
		packageUnit: input.packageUnit,
		shippingFee: input.shippingFee,
		baseQuantity: base.quantity,
		baseUnit: base.unit,
		unitCost,
		addedAt: now,
		unitCostHistory: [{ recordedAt: now, unitCost }],
		purchaseLots: lots,
		stockTransactions: [
			{
				id: newTxnId(),
				type: 'receive',
				quantity: packagesQty,
				stockAfter,
				createdAt: now,
				purchasedOn: now.slice(0, 10),
				notes: 'Initial stock'
			}
		],
		marketplaceSourcingLocalOnly: input.marketplaceSourcingLocalOnly === true
	};
}

export function addIngredientMaster(input: IngredientMasterInput): IngredientMasterDTO {
	const existing = findByBatchKey({
		name: input.name,
		supplier: input.supplier,
		packagePrice: input.packagePrice,
		shippingFee: input.shippingFee,
		packageSize: input.packageSize,
		packageUnit: input.packageUnit
	});
	if (existing) {
		const merged = receiveIngredientStock(existing.id, {
			packagePrice: input.packagePrice,
			shippingFee: input.shippingFee,
			packageSize: input.packageSize,
			packageUnit: input.packageUnit,
			packagesQty: 1
		})!;
		if (input.marketplaceSourcingLocalOnly) {
			updateIngredientMaster(merged.id, { marketplaceSourcingLocalOnly: true });
			return getMaster(merged.id)!;
		}
		return merged;
	}

	const row = buildMasterFromInput(input, 1);
	ingredientCatalog.items = [...ingredientCatalog.items, row];
	return row;
}

export function updateIngredientMaster(
	id: string,
	patch: Partial<
		Pick<
			IngredientMasterDTO,
			| 'name'
			| 'supplier'
			| 'packagePrice'
			| 'packageSize'
			| 'packageUnit'
			| 'shippingFee'
			| 'marketplaceSourcingLocalOnly'
		>
	> & {
		channelScrape?: Partial<Record<ChannelMarketplace, Partial<ChannelScrapeInfo>>>;
		supplierChannelLanded?: Partial<ChannelLandedPrices>;
	}
): void {
	ingredientCatalog.items = ingredientCatalog.items.map((m) => {
		if (m.id !== id) return m;
		const { channelScrape: chPatch, supplierChannelLanded: landedPatch, ...fieldPatch } = patch;
		const next: IngredientMasterDTO = {
			...m,
			...fieldPatch,
			name: patch.name !== undefined ? patch.name.trim() : m.name,
			supplier: patch.supplier !== undefined ? patch.supplier.trim() : m.supplier
		};
		if (landedPatch) {
			next.supplierChannelLanded = mergeChannelLanded(m.supplierChannelLanded, landedPatch);
		}
		if (chPatch) {
			next.channelScrape = mergeChannelScrape(m.channelScrape, chPatch);
		}
		if (
			patch.packagePrice !== undefined ||
			patch.packageSize !== undefined ||
			patch.shippingFee !== undefined ||
			patch.packageUnit !== undefined
		) {
			const prevUnit = m.unitCost;
			const base = toBaseQuantity(next.packageSize, next.packageUnit);
			next.baseQuantity = base.quantity;
			next.baseUnit = base.unit;
			next.unitCost = computeUnitCost(next.packagePrice, next.shippingFee, next.baseQuantity);
			if (Math.abs(next.unitCost - prevUnit) > 1e-6) {
				const ts = new Date().toISOString();
				const hist = trimHistory([...(m.unitCostHistory ?? []), { recordedAt: ts, unitCost: next.unitCost }]);
				next.unitCostHistory = hist;
				next.addedAt = m.addedAt ?? hist[0]?.recordedAt ?? ts;
			} else {
				next.unitCostHistory = m.unitCostHistory;
				next.addedAt = m.addedAt;
			}
		} else {
			next.unitCostHistory = m.unitCostHistory;
			next.addedAt = m.addedAt;
		}
		return next;
	});
}

export function deleteIngredientMaster(id: string): void {
	ingredientCatalog.items = ingredientCatalog.items.filter((m) => m.id !== id);
}

export function getMaster(id: string): IngredientMasterDTO | undefined {
	return ingredientCatalog.items.find((m) => m.id === id);
}

export function resetIngredientCatalog(): void {
	ingredientCatalog.items = [];
}

export function replaceIngredientCatalogItems(next: IngredientMasterDTO[]): void {
	ingredientCatalog.items = structuredClone(next);
}

function findByBatchKey(row: {
	name: string;
	supplier: string;
	packagePrice: number;
	shippingFee: number;
	packageSize: number;
	packageUnit: MeasureUnit;
}): IngredientMasterDTO | undefined {
	const key = catalogBatchKey(row);
	return ingredientCatalog.items.find((i) => catalogBatchKey(i) === key);
}

function applyLotsToMaster(
	m: IngredientMasterDTO,
	lots: IngredientMasterDTO['purchaseLots'],
	txn?: Omit<StockTransaction, 'id' | 'stockAfter'>
): IngredientMasterDTO {
	const stockAfter = totalPackagesRemaining(lots);
	const stockTransactions = txn
		? appendStockTransaction(m, txn, stockAfter)
		: (m.stockTransactions ?? []);
	return { ...m, purchaseLots: lots, stockTransactions };
}

export function receiveIngredientStock(
	id: string,
	input: ReceiveStockInput,
	notes = 'Stock received'
): IngredientMasterDTO | undefined {
	const m = getMaster(id);
	if (!m) return undefined;

	const target = findByBatchKey({
		name: m.name,
		supplier: m.supplier,
		packagePrice: input.packagePrice,
		shippingFee: input.shippingFee,
		packageSize: input.packageSize,
		packageUnit: input.packageUnit
	});
	if (target && target.id !== id) {
		return receiveIngredientStock(target.id, input);
	}

	const lots = receiveStock(m.purchaseLots ?? [], input);
	const now = new Date().toISOString();
	const next = applyLotsToMaster(m, lots, {
		type: 'receive',
		quantity: input.packagesQty,
		createdAt: now,
		purchasedOn: input.purchasedOn ?? now.slice(0, 10),
		notes
	});
	ingredientCatalog.items = ingredientCatalog.items.map((row) => (row.id === id ? next : row));
	return next;
}

export function useIngredientStock(
	id: string,
	packagesQty: number,
	notes = 'Stock used'
): { master: IngredientMasterDTO; consumed: number } | undefined {
	const m = getMaster(id);
	if (!m || packagesQty <= 0) return undefined;
	const baseLots = m.purchaseLots ?? buildInitialLotsFromMaster(m, 1);
	const { lots, consumed } = consumeStockFifo(baseLots, packagesQty);
	if (consumed <= 1e-9) return undefined;
	const now = new Date().toISOString();
	const next = applyLotsToMaster(m, lots, {
		type: 'deduct',
		quantity: consumed,
		createdAt: now,
		notes
	});
	ingredientCatalog.items = ingredientCatalog.items.map((row) => (row.id === id ? next : row));
	return { master: next, consumed };
}

export function adjustIngredientStock(
	id: string,
	targetPackages: number,
	notes = 'Manual adjustment'
): IngredientMasterDTO | undefined {
	const m = getMaster(id);
	if (!m || targetPackages < 0) return undefined;
	const current = totalPackagesRemaining(m.purchaseLots);
	const delta = targetPackages - current;
	if (Math.abs(delta) < 1e-9) return m;
	if (delta > 0) {
		return receiveIngredientStock(
			id,
			{
				packagePrice: m.packagePrice,
				shippingFee: m.shippingFee,
				packageSize: m.packageSize,
				packageUnit: m.packageUnit,
				packagesQty: delta
			},
			notes
		);
	}
	return useIngredientStock(id, Math.abs(delta), notes)?.master;
}

export { catalogUnitCost as ingredientCatalogUnitCost };

/** Split rows that mixed multiple price tiers into separate batch cards. */
export function splitIngredientCatalogByPrice(): void {
	const result: IngredientMasterDTO[] = [];

	for (const item of ingredientCatalog.items) {
		const lots = ensurePurchaseLots(item);
		const groups = new Map<string, typeof lots>();
		for (const lot of lots) {
			const k = lotMergeKey(lot);
			const list = groups.get(k) ?? [];
			list.push(lot);
			groups.set(k, list);
		}

		if (groups.size <= 1) {
			result.push({ ...item, purchaseLots: lots });
			continue;
		}

		let first = true;
		for (const groupLots of groups.values()) {
			const lead = groupLots[0]!;
			if (first) {
				result.push({
					...item,
					packagePrice: lead.packagePrice,
					shippingFee: lead.shippingFee,
					packageSize: lead.packageSize,
					packageUnit: lead.packageUnit,
					baseQuantity: lead.baseQuantityPerPackage,
					unitCost: lead.unitCost,
					purchaseLots: groupLots
				});
				first = false;
			} else {
				const base = toBaseQuantity(lead.packageSize, lead.packageUnit);
				result.push({
					...item,
					id: newId(),
					packagePrice: lead.packagePrice,
					shippingFee: lead.shippingFee,
					packageSize: lead.packageSize,
					packageUnit: lead.packageUnit,
					baseQuantity: lead.baseQuantityPerPackage,
					baseUnit: base.unit,
					unitCost: lead.unitCost,
					purchaseLots: groupLots,
					addedAt: lead.recordedAt,
					stockTransactions: []
				});
			}
		}
	}

	ingredientCatalog.items = result;
}

/** Import a local supplier listing — merges stock when name + supplier + price tier match. */
export function importIngredientFromLocalStore(
	product: import('$lib/types/localStore').LocalStoreProductDTO,
	storeName: string,
	storeId: number
): IngredientMasterDTO {
	const now = new Date().toISOString();
	const landed = Math.round((product.packagePrice + product.shippingFee) * 100) / 100;
	const existing = findByBatchKey({
		name: product.name,
		supplier: storeName,
		packagePrice: product.packagePrice,
		shippingFee: product.shippingFee,
		packageSize: product.packageSize,
		packageUnit: product.packageUnit
	});

	if (existing) {
		const updated = receiveIngredientStock(existing.id, {
			packagePrice: product.packagePrice,
			shippingFee: product.shippingFee,
			packageSize: product.packageSize,
			packageUnit: product.packageUnit,
			packagesQty: 1
		})!;
		const withSource: IngredientMasterDTO = {
			...updated,
			supplierChannelLanded: { ...updated.supplierChannelLanded, local: landed },
			localStoreSource: {
				storeId,
				storeName: storeName.trim(),
				productId: product.id,
				importedAt: now
			}
		};
		ingredientCatalog.items = ingredientCatalog.items.map((r) =>
			r.id === existing.id ? withSource : r
		);
		return withSource;
	}

	const row = buildMasterFromInput(
		{
			name: product.name,
			supplier: storeName,
			packagePrice: product.packagePrice,
			packageSize: product.packageSize,
			packageUnit: product.packageUnit,
			shippingFee: product.shippingFee
		},
		1
	);
	const withMeta: IngredientMasterDTO = {
		...row,
		baseQuantity: product.baseQuantity,
		baseUnit: product.baseUnit,
		unitCost: product.unitCost,
		supplierChannelLanded: { local: landed },
		localStoreSource: {
			storeId,
			storeName: storeName.trim(),
			productId: product.id,
			importedAt: now
		}
	};
	ingredientCatalog.items = [...ingredientCatalog.items, withMeta];
	return withMeta;
}

/** Units shown in forms */
export const MEASURE_UNIT_OPTIONS: { value: MeasureUnit; label: string }[] = [
	{ value: 'g', label: 'g' },
	{ value: 'kg', label: 'kg' },
	{ value: 'oz', label: 'oz (weight)' },
	{ value: 'ml', label: 'ml' },
	{ value: 'cc', label: 'cc' },
	{ value: 'l', label: 'L' },
	{ value: 'gal', label: 'gal (US → ml)' },
	{ value: 'cup', label: 'cup (240 ml)' },
	{ value: 'tbsp', label: 'tbsp (15 ml)' },
	{ value: 'tsp', label: 'tsp (5 ml)' },
	{ value: 'shot', label: 'shot (30 ml)' },
	{ value: 'oz_fl', label: 'oz (fluid)' },
	{ value: 'piece', label: 'piece' }
];
