import type { ChannelLandedPrices } from '$lib/types/statistics';
import type { LocalStoreCatalogSource } from '$lib/types/localStore';

/** Lazada / Shopee marketplace rows in catalogs */
export type ChannelMarketplace = 'lazada' | 'shopee';

/** Saved scrape hint + UI status (Help Scrape modal documents API/XHR-first workflows; no automated fetch in app yet) */
export type ScrapeStatus = 'idle' | 'pending' | 'scraping' | 'complete' | 'error';

/** Café-oriented units; liquids normalize to ml, mass to g, count to piece */
export type MeasureUnit =
	| 'g'
	| 'kg'
	| 'oz'
	| 'ml'
	| 'l'
	| 'cc'
	| 'oz_fl'
	| 'gal'
	| 'cup'
	| 'tbsp'
	| 'tsp'
	| 'shot'
	| 'piece';

export interface ChannelScrapeInfo {
	status: ScrapeStatus;
	/** Product or listing URL to speed up manual / future automated scraping */
	url?: string;
	/** ISO timestamp when status last changed (e.g. scrape marked complete) */
	updatedAt?: string;
	/** Optional listing snapshot from marketplace scrape — shown on Lazada/Shopee tabs when sync is complete */
	listingPackageSize?: number;
	listingPackageUnit?: MeasureUnit;
	listingShippingFee?: number;
	listingBaseQuantity?: number;
	listingBaseUnit?: 'g' | 'ml' | 'piece';
}

/** Dated snapshot of local catalog unit cost (when package price/size changes) — feeds Smart Pricing / ML. */
export interface UnitCostHistoryEntry {
	recordedAt: string;
	unitCost: number;
}

export interface StockPurchaseLot {
	id: string;
	/** YYYY-MM-DD */
	purchasedOn: string;
	packagePrice: number;
	shippingFee: number;
	packageSize: number;
	packageUnit: MeasureUnit;
	baseQuantityPerPackage: number;
	unitCost: number;
	/** Total packages received in this lot */
	packagesQty: number;
	/** Packages still on hand */
	packagesRemaining: number;
	recordedAt: string;
}

/** Stock movement log for a price-tier inventory batch. */
export interface StockTransaction {
	id: string;
	type: 'receive' | 'deduct' | 'adjust';
	/** Packages added or removed (always positive) */
	quantity: number;
	stockAfter: number;
	createdAt: string;
	purchasedOn?: string;
	notes?: string;
}

/** Master ingredient purchased in bulk — unit cost from package + shipping */
export interface IngredientMasterDTO {
	id: string;
	name: string;
	supplier: string;
	packagePrice: number;
	packageSize: number;
	packageUnit: MeasureUnit;
	shippingFee: number;
	baseQuantity: number;
	baseUnit: 'g' | 'ml' | 'piece';
	unitCost: number;
	/** ISO — when this row was first added */
	addedAt?: string;
	/** Time series of local unit costs for forecasting */
	unitCostHistory?: UnitCostHistoryEntry[];
	/** Same-price purchase layers (same day merges qty) */
	purchaseLots?: StockPurchaseLot[];
	/** Stock movement history for this batch */
	stockTransactions?: StockTransaction[];
	/** Landed ₱ for same package from each channel (Statistics supplier comparison) */
	supplierChannelLanded?: ChannelLandedPrices;
	/** Optional scrape workflow metadata per marketplace */
	channelScrape?: Partial<Record<ChannelMarketplace, ChannelScrapeInfo>>;
	/**
	 * When true, Shopee/Lazada recipe COGS uses this row’s local catalog unit cost (no listing required).
	 * Use for ice, utilities, or anything you never buy from marketplaces.
	 */
	marketplaceSourcingLocalOnly?: boolean;
	/** Set when imported from a local supplier listing on the Local Store page */
	localStoreSource?: LocalStoreCatalogSource;
}

export interface RecipeIngredientLineDTO {
	id: string;
	ingredientMasterId: string;
	quantity: number;
	unit: MeasureUnit;
}

/** Cups, lids, sleeves — same economics shape as ingredients */
export interface OtherItemMasterDTO {
	id: string;
	name: string;
	supplier: string;
	packagePrice: number;
	packageSize: number;
	packageUnit: MeasureUnit;
	shippingFee: number;
	baseQuantity: number;
	baseUnit: 'g' | 'ml' | 'piece';
	unitCost: number;
	addedAt?: string;
	unitCostHistory?: UnitCostHistoryEntry[];
	/** Same-price purchase layers (same day merges qty) */
	purchaseLots?: StockPurchaseLot[];
	/** Stock movement history for this batch */
	stockTransactions?: StockTransaction[];
	supplierChannelLanded?: ChannelLandedPrices;
	channelScrape?: Partial<Record<ChannelMarketplace, ChannelScrapeInfo>>;
	marketplaceSourcingLocalOnly?: boolean;
	/** Set when imported from a local supplier listing on the Local Store page */
	localStoreSource?: LocalStoreCatalogSource;
}

/** Packaging lines reference Others catalog */
export interface RecipeOtherLineDTO {
	id: string;
	otherMasterId: string;
	quantity: number;
	unit: MeasureUnit;
}

export interface RecipePricingDTO {
	local: number;
	shopee: number;
	lazada: number;
}

export interface RecipeDTO {
	id: string;
	name: string;
	pricing: RecipePricingDTO;
	ingredientLines: RecipeIngredientLineDTO[];
	otherLines: RecipeOtherLineDTO[];
	archived?: boolean;
	archivedAt?: string;
}

export interface OpexLineDTO {
	id: string;
	label: string;
	amountPerMonth: number;
}

export interface IngredientMasterInput {
	name: string;
	supplier: string;
	packagePrice: number;
	packageSize: number;
	packageUnit: MeasureUnit;
	shippingFee: number;
	marketplaceSourcingLocalOnly?: boolean;
	/** Set when imported from a local supplier listing on the Local Store page */
	localStoreSource?: LocalStoreCatalogSource;
}

export type OtherItemMasterInput = IngredientMasterInput;
