import type {
	IngredientMasterDTO,
	MeasureUnit,
	OtherItemMasterDTO,
	RecipeDTO
} from '$lib/types/recipe';
import { convertQuantity, unitLabel } from '$lib/utils/unitConvert';
import { batchesForProductName } from '$lib/utils/catalogBatch';
import { totalPackagesRemaining } from '$lib/utils/stockLots';

export type ProductAvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unconfigured';

export interface RecipeLineAvailability {
	kind: 'ingredient' | 'other';
	lineId: string;
	masterId: string;
	name: string;
	supplier: string;
	requiredQuantity: number;
	unit: MeasureUnit;
	packagesNeededPerServing: number;
	totalStockPackages: number;
	servingsSupported: number;
	isOutOfStock: boolean;
	isLowStock: boolean;
	conversionError?: boolean;
}

export interface RecipeProductAvailability {
	recipeId: string;
	recipeName: string;
	status: ProductAvailabilityStatus;
	servingsAvailable: number;
	lowStockThreshold: number;
	lines: RecipeLineAvailability[];
	missingLines: RecipeLineAvailability[];
	lowStockLines: RecipeLineAvailability[];
	limitingLine: RecipeLineAvailability | null;
	totalLinesCount: number;
	missingLinesCount: number;
	hasStock: boolean;
}

function packagesNeededForMaster(
	qty: number,
	unit: MeasureUnit,
	m: IngredientMasterDTO | OtherItemMasterDTO
): number | null {
	if (m.baseQuantity <= 1e-9) return null;
	const qtyInBase = convertQuantity(qty, unit, m.baseUnit);
	if (qtyInBase === null) return null;
	return qtyInBase / m.baseQuantity;
}

/**
 * Calculates real-time product availability for a recipe based on live inventory/purchase lots.
 * Takes into account all available batches of each ingredient and packaging item.
 */
export function computeRecipeAvailability(
	recipe: RecipeDTO,
	ingredientMasters: IngredientMasterDTO[],
	otherMasters: OtherItemMasterDTO[],
	lowStockThreshold = 5
): RecipeProductAvailability {
	const lines: RecipeLineAvailability[] = [];

	// Evaluate ingredient lines
	for (const line of recipe.ingredientLines) {
		const m =
			ingredientMasters.find((x) => x.id === line.ingredientMasterId) ??
			ingredientMasters.find(
				(x) => x.name.trim().toLowerCase() === line.ingredientMasterId.trim().toLowerCase()
			);

		if (!m) {
			lines.push({
				kind: 'ingredient',
				lineId: line.id,
				masterId: line.ingredientMasterId,
				name: 'Missing / Deleted Ingredient',
				supplier: '',
				requiredQuantity: line.quantity,
				unit: line.unit,
				packagesNeededPerServing: 0,
				totalStockPackages: 0,
				servingsSupported: 0,
				isOutOfStock: true,
				isLowStock: false,
				conversionError: true
			});
			continue;
		}

		// Sum up available packages across all matching batches of this ingredient
		const batches = batchesForProductName(ingredientMasters, m.name);
		const candidateBatches = batches.length > 0 ? batches : [m];
		const totalStockPackages = candidateBatches.reduce(
			(sum, b) => sum + totalPackagesRemaining(b.purchaseLots),
			0
		);

		const pkgsPerServing = packagesNeededForMaster(line.quantity, line.unit, m);
		if (pkgsPerServing === null || pkgsPerServing <= 1e-9) {
			lines.push({
				kind: 'ingredient',
				lineId: line.id,
				masterId: m.id,
				name: m.name,
				supplier: m.supplier,
				requiredQuantity: line.quantity,
				unit: line.unit,
				packagesNeededPerServing: 0,
				totalStockPackages,
				servingsSupported: 0,
				isOutOfStock: true,
				isLowStock: false,
				conversionError: true
			});
			continue;
		}

		const servings = Math.floor(totalStockPackages / pkgsPerServing);
		const isOutOfStock = servings <= 0;
		const isLowStock = !isOutOfStock && servings <= lowStockThreshold;

		lines.push({
			kind: 'ingredient',
			lineId: line.id,
			masterId: m.id,
			name: m.name,
			supplier: m.supplier,
			requiredQuantity: line.quantity,
			unit: line.unit,
			packagesNeededPerServing: Math.round(pkgsPerServing * 10000) / 10000,
			totalStockPackages: Math.round(totalStockPackages * 1000) / 1000,
			servingsSupported: servings,
			isOutOfStock,
			isLowStock
		});
	}

	// Evaluate packaging / other lines
	for (const line of recipe.otherLines) {
		const m =
			otherMasters.find((x) => x.id === line.otherMasterId) ??
			otherMasters.find(
				(x) => x.name.trim().toLowerCase() === line.otherMasterId.trim().toLowerCase()
			);

		if (!m) {
			lines.push({
				kind: 'other',
				lineId: line.id,
				masterId: line.otherMasterId,
				name: 'Missing / Deleted Item',
				supplier: '',
				requiredQuantity: line.quantity,
				unit: line.unit,
				packagesNeededPerServing: 0,
				totalStockPackages: 0,
				servingsSupported: 0,
				isOutOfStock: true,
				isLowStock: false,
				conversionError: true
			});
			continue;
		}

		const batches = batchesForProductName(otherMasters, m.name);
		const candidateBatches = batches.length > 0 ? batches : [m];
		const totalStockPackages = candidateBatches.reduce(
			(sum, b) => sum + totalPackagesRemaining(b.purchaseLots),
			0
		);

		const pkgsPerServing = packagesNeededForMaster(line.quantity, line.unit, m);
		if (pkgsPerServing === null || pkgsPerServing <= 1e-9) {
			lines.push({
				kind: 'other',
				lineId: line.id,
				masterId: m.id,
				name: m.name,
				supplier: m.supplier,
				requiredQuantity: line.quantity,
				unit: line.unit,
				packagesNeededPerServing: 0,
				totalStockPackages,
				servingsSupported: 0,
				isOutOfStock: true,
				isLowStock: false,
				conversionError: true
			});
			continue;
		}

		const servings = Math.floor(totalStockPackages / pkgsPerServing);
		const isOutOfStock = servings <= 0;
		const isLowStock = !isOutOfStock && servings <= lowStockThreshold;

		lines.push({
			kind: 'other',
			lineId: line.id,
			masterId: m.id,
			name: m.name,
			supplier: m.supplier,
			requiredQuantity: line.quantity,
			unit: line.unit,
			packagesNeededPerServing: Math.round(pkgsPerServing * 10000) / 10000,
			totalStockPackages: Math.round(totalStockPackages * 1000) / 1000,
			servingsSupported: servings,
			isOutOfStock,
			isLowStock
		});
	}

	if (lines.length === 0) {
		return {
			recipeId: recipe.id,
			recipeName: recipe.name,
			status: 'unconfigured',
			servingsAvailable: 0,
			lowStockThreshold,
			lines: [],
			missingLines: [],
			lowStockLines: [],
			limitingLine: null,
			totalLinesCount: 0,
			missingLinesCount: 0,
			hasStock: false
		};
	}

	const missingLines = lines.filter((l) => l.isOutOfStock);
	const lowStockLines = lines.filter((l) => l.isLowStock);

	// Find the bottleneck line that produces the minimum number of servings
	let limitingLine: RecipeLineAvailability | null = lines[0] ?? null;
	for (const l of lines) {
		if (limitingLine === null || l.servingsSupported < limitingLine.servingsSupported) {
			limitingLine = l;
		}
	}

	const servingsAvailable = limitingLine ? Math.max(0, limitingLine.servingsSupported) : 0;

	let status: ProductAvailabilityStatus = 'in_stock';
	if (servingsAvailable <= 0) {
		status = 'out_of_stock';
	} else if (servingsAvailable <= lowStockThreshold) {
		status = 'low_stock';
	} else {
		status = 'in_stock';
	}

	return {
		recipeId: recipe.id,
		recipeName: recipe.name,
		status,
		servingsAvailable,
		lowStockThreshold,
		lines,
		missingLines,
		lowStockLines,
		limitingLine,
		totalLinesCount: lines.length,
		missingLinesCount: missingLines.length,
		hasStock: servingsAvailable > 0
	};
}

export interface AvailabilityBadgeConfig {
	label: string;
	badgeClass: string;
	dotClass: string;
	summaryText: string;
	icon: 'check' | 'warning' | 'alert' | 'empty';
}

export function getRecipeAvailabilityBadge(
	availability: RecipeProductAvailability
): AvailabilityBadgeConfig {
	switch (availability.status) {
		case 'in_stock':
			return {
				label: `Available · ${availability.servingsAvailable} servings`,
				badgeClass:
					'bg-emerald-50 text-emerald-800 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
				dotClass: 'bg-emerald-500 animate-pulse',
				summaryText: availability.limitingLine
					? `Ready to serve (${availability.servingsAvailable} max). Limited by ${availability.limitingLine.name}.`
					: `Ready to prepare (${availability.servingsAvailable} servings).`,
				icon: 'check'
			};
		case 'low_stock':
			return {
				label: `Low stock · ${availability.servingsAvailable} left`,
				badgeClass:
					'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
				dotClass: 'bg-amber-500',
				summaryText: availability.limitingLine
					? `Running low! Only ${availability.servingsAvailable} left due to ${availability.limitingLine.name}.`
					: `Running low! Only ${availability.servingsAvailable} servings remaining.`,
				icon: 'warning'
			};
		case 'out_of_stock': {
			const missingNames = availability.missingLines.map((l) => l.name).slice(0, 2).join(', ');
			const extra = availability.missingLines.length > 2 ? ` +${availability.missingLines.length - 2} more` : '';
			return {
				label: `Out of stock · Missing: ${missingNames}${extra}`,
				badgeClass:
					'bg-rose-50 text-rose-800 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
				dotClass: 'bg-rose-500',
				summaryText: `Cannot prepare product: ${availability.missingLinesCount} required item(s) out of stock.`,
				icon: 'alert'
			};
		}
		case 'unconfigured':
		default:
			return {
				label: 'No ingredients',
				badgeClass:
					'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
				dotClass: 'bg-zinc-400',
				summaryText: 'Add recipe ingredients to enable real-time availability tracking.',
				icon: 'empty'
			};
	}
}
