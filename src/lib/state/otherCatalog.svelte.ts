import type {
	ChannelMarketplace,
	ChannelScrapeInfo,
	MeasureUnit,
	OtherItemMasterDTO,
	OtherItemMasterInput,
	UnitCostHistoryEntry
} from '$lib/types/recipe';
import type { ChannelLandedPrices } from '$lib/types/statistics';
import { mergeChannelLanded } from '$lib/utils/marketplaceJsonImport';
import { computeUnitCost, toBaseQuantity } from '$lib/utils/baseUnitCost';
import { catalogBatchKey } from '$lib/utils/catalogBatch';
import type { StockTransaction } from '$lib/types/recipe';
import {
	buildInitialLotsFromMaster,
	consumeStockFifo,
	ensurePurchaseLots,
	lotMergeKey,
	receiveStock,
	totalPackagesRemaining,
	type ReceiveStockInput
} from '$lib/utils/stockLots';

export const otherCatalog = $state({
	items: [] as OtherItemMasterDTO[]
});

export function computeOtherUnitCost(input: {
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
	prev: OtherItemMasterDTO['channelScrape'],
	patch: Partial<Record<ChannelMarketplace, Partial<ChannelScrapeInfo>>>
): OtherItemMasterDTO['channelScrape'] {
	const next: NonNullable<OtherItemMasterDTO['channelScrape']> = { ...prev };
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
	return `oid_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MAX_UNIT_COST_HISTORY = 36;

function trimHistory(h: UnitCostHistoryEntry[]): UnitCostHistoryEntry[] {
	if (h.length <= MAX_UNIT_COST_HISTORY) return h;
	return h.slice(h.length - MAX_UNIT_COST_HISTORY);
}

export function addOtherMaster(input: OtherItemMasterInput): OtherItemMasterDTO {
	const existing = findOtherByBatchKey({
		name: input.name,
		supplier: input.supplier,
		packagePrice: input.packagePrice,
		shippingFee: input.shippingFee,
		packageSize: input.packageSize,
		packageUnit: input.packageUnit
	});
	if (existing) {
		const merged = receiveOtherStock(existing.id, {
			packagePrice: input.packagePrice,
			shippingFee: input.shippingFee,
			packageSize: input.packageSize,
			packageUnit: input.packageUnit,
			packagesQty: 1
		})!;
		if (input.marketplaceSourcingLocalOnly) {
			updateOtherMaster(merged.id, { marketplaceSourcingLocalOnly: true });
			return getOtherMaster(merged.id)!;
		}
		return merged;
	}

	const base = toBaseQuantity(input.packageSize, input.packageUnit);
	const unitCost = computeUnitCost(input.packagePrice, input.shippingFee, base.quantity);
	const now = new Date().toISOString();
	const row: OtherItemMasterDTO = {
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
		purchaseLots: buildInitialLotsFromMaster(
			{
				packagePrice: input.packagePrice,
				shippingFee: input.shippingFee,
				packageSize: input.packageSize,
				packageUnit: input.packageUnit,
				baseQuantity: base.quantity,
				unitCost
			},
			1
		),
		marketplaceSourcingLocalOnly: input.marketplaceSourcingLocalOnly === true
	};
	otherCatalog.items = [...otherCatalog.items, row];
	return row;
}

export function updateOtherMaster(
	id: string,
	patch: Partial<
		Pick<
			OtherItemMasterDTO,
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
	otherCatalog.items = otherCatalog.items.map((m) => {
		if (m.id !== id) return m;
		const { channelScrape: chPatch, supplierChannelLanded: landedPatch, ...fieldPatch } = patch;
		const next: OtherItemMasterDTO = {
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

export function deleteOtherMaster(id: string): void {
	otherCatalog.items = otherCatalog.items.filter((m) => m.id !== id);
}

export function getOtherMaster(id: string): OtherItemMasterDTO | undefined {
	return otherCatalog.items.find((m) => m.id === id);
}

export function resetOtherCatalog(): void {
	otherCatalog.items = [];
}

export function replaceOtherCatalogItems(next: OtherItemMasterDTO[]): void {
	otherCatalog.items = structuredClone(next);
}

function findOtherByBatchKey(row: {
	name: string;
	supplier: string;
	packagePrice: number;
	shippingFee: number;
	packageSize: number;
	packageUnit: MeasureUnit;
}): OtherItemMasterDTO | undefined {
	const key = catalogBatchKey(row);
	return otherCatalog.items.find((i) => catalogBatchKey(i) === key);
}

function newOtherTxnId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return `otxn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function appendOtherStockTransaction(
	m: OtherItemMasterDTO,
	txn: Omit<StockTransaction, 'id' | 'stockAfter'>,
	stockAfter: number
): StockTransaction[] {
	const next = [...(m.stockTransactions ?? []), { ...txn, id: newOtherTxnId(), stockAfter }];
	return next.length > 120 ? next.slice(next.length - 120) : next;
}

function applyLotsToOther(
	m: OtherItemMasterDTO,
	lots: OtherItemMasterDTO['purchaseLots'],
	txn?: Omit<StockTransaction, 'id' | 'stockAfter'>
): OtherItemMasterDTO {
	const stockAfter = totalPackagesRemaining(lots);
	const stockTransactions = txn
		? appendOtherStockTransaction(m, txn, stockAfter)
		: (m.stockTransactions ?? []);
	return { ...m, purchaseLots: lots, stockTransactions };
}

export function receiveOtherStock(
	id: string,
	input: ReceiveStockInput,
	notes = 'Stock received'
): OtherItemMasterDTO | undefined {
	const m = getOtherMaster(id);
	if (!m) return undefined;
	const target = findOtherByBatchKey({
		name: m.name,
		supplier: m.supplier,
		packagePrice: input.packagePrice,
		shippingFee: input.shippingFee,
		packageSize: input.packageSize,
		packageUnit: input.packageUnit
	});
	if (target && target.id !== id) return receiveOtherStock(target.id, input, notes);
	const lots = receiveStock(m.purchaseLots ?? [], input);
	const now = new Date().toISOString();
	const next = applyLotsToOther(m, lots, {
		type: 'receive',
		quantity: input.packagesQty,
		createdAt: now,
		purchasedOn: input.purchasedOn ?? now.slice(0, 10),
		notes
	});
	otherCatalog.items = otherCatalog.items.map((row) => (row.id === id ? next : row));
	return next;
}

export function useOtherStock(
	id: string,
	packagesQty: number,
	notes = 'Stock used'
): { master: OtherItemMasterDTO; consumed: number } | undefined {
	const m = getOtherMaster(id);
	if (!m || packagesQty <= 0) return undefined;
	const baseLots = m.purchaseLots?.length ? m.purchaseLots : buildInitialLotsFromMaster(m, 1);
	const { lots, consumed } = consumeStockFifo(baseLots, packagesQty);
	if (consumed <= 1e-9) return undefined;
	const now = new Date().toISOString();
	const next = applyLotsToOther(m, lots, {
		type: 'deduct',
		quantity: consumed,
		createdAt: now,
		notes
	});
	otherCatalog.items = otherCatalog.items.map((row) => (row.id === id ? next : row));
	return { master: next, consumed };
}

/** Import a local supplier listing — merges stock when name + supplier already exist. */
export function importOtherFromLocalStore(
	product: import('$lib/types/localStore').LocalStoreProductDTO,
	storeName: string,
	storeId: number
): OtherItemMasterDTO {
	const now = new Date().toISOString();
	const landed = Math.round((product.packagePrice + product.shippingFee) * 100) / 100;
	const existing = findOtherByBatchKey({
		name: product.name,
		supplier: storeName,
		packagePrice: product.packagePrice,
		shippingFee: product.shippingFee,
		packageSize: product.packageSize,
		packageUnit: product.packageUnit
	});

	if (existing) {
		const updated = receiveOtherStock(existing.id, {
			packagePrice: product.packagePrice,
			shippingFee: product.shippingFee,
			packageSize: product.packageSize,
			packageUnit: product.packageUnit,
			packagesQty: 1
		})!;
		const withSource: OtherItemMasterDTO = {
			...updated,
			supplierChannelLanded: { ...updated.supplierChannelLanded, local: landed },
			localStoreSource: {
				storeId,
				storeName: storeName.trim(),
				productId: product.id,
				importedAt: now
			}
		};
		otherCatalog.items = otherCatalog.items.map((r) => (r.id === existing.id ? withSource : r));
		return withSource;
	}

	const row: OtherItemMasterDTO = {
		id: newId(),
		name: product.name.trim(),
		supplier: storeName.trim(),
		packagePrice: product.packagePrice,
		packageSize: product.packageSize,
		packageUnit: product.packageUnit,
		shippingFee: product.shippingFee,
		baseQuantity: product.baseQuantity,
		baseUnit: product.baseUnit,
		unitCost: product.unitCost,
		addedAt: now,
		unitCostHistory: [{ recordedAt: now, unitCost: product.unitCost }],
		purchaseLots: buildInitialLotsFromMaster(
			{
				packagePrice: product.packagePrice,
				shippingFee: product.shippingFee,
				packageSize: product.packageSize,
				packageUnit: product.packageUnit,
				baseQuantity: product.baseQuantity,
				unitCost: product.unitCost
			},
			1
		),
		supplierChannelLanded: { local: landed },
		localStoreSource: {
			storeId,
			storeName: storeName.trim(),
			productId: product.id,
			importedAt: now
		}
	};
	otherCatalog.items = [...otherCatalog.items, row];
	return row;
}

/** Split rows that mixed multiple price tiers into separate batch cards. */
export function splitOtherCatalogByPrice(): void {
	const result: OtherItemMasterDTO[] = [];
	for (const item of otherCatalog.items) {
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
	otherCatalog.items = result;
}
