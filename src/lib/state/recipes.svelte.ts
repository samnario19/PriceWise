import type {
	MeasureUnit,
	RecipeDTO,
	RecipeIngredientLineDTO,
	RecipeOtherLineDTO,
	RecipePricingDTO
} from '$lib/types/recipe';
import { ingredientCatalog } from '$lib/state/ingredientCatalog.svelte';
import { otherCatalog } from '$lib/state/otherCatalog.svelte';
import { convertQuantity } from '$lib/utils/unitConvert';

export const recipeStore = $state({
	recipes: [] as RecipeDTO[]
});

function newId(prefix: string): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function roundQty(q: number): number {
	return Math.round(q * 1e6) / 1e6;
}

export function addRecipe(name: string): string {
	const id = newId('rec');
	const recipe: RecipeDTO = {
		id,
		name: name.trim() || 'New recipe',
		pricing: { local: 0, shopee: 0, lazada: 0 },
		ingredientLines: [],
		otherLines: []
	};
	recipeStore.recipes = [...recipeStore.recipes, recipe];
	return id;
}

export function updateRecipeName(recipeId: string, name: string): void {
	recipeStore.recipes = recipeStore.recipes.map((r) =>
		r.id === recipeId ? { ...r, name: name.trim() || 'Untitled recipe' } : r
	);
}

export function updateRecipePricing(recipeId: string, pricing: RecipePricingDTO): void {
	recipeStore.recipes = recipeStore.recipes.map((r) => (r.id === recipeId ? { ...r, pricing } : r));
}

export function archiveRecipe(recipeId: string): void {
	recipeStore.recipes = recipeStore.recipes.map((r) =>
		r.id === recipeId ? { ...r, archived: true, archivedAt: new Date().toISOString() } : r
	);
}

export function unarchiveRecipe(recipeId: string): void {
	recipeStore.recipes = recipeStore.recipes.map((r) =>
		r.id === recipeId ? { ...r, archived: false, archivedAt: undefined } : r
	);
}

export function deleteRecipePermanently(recipeId: string): void {
	recipeStore.recipes = recipeStore.recipes.filter((r) => r.id !== recipeId);
}

export function deleteRecipe(recipeId: string): void {
	deleteRecipePermanently(recipeId);
}

export function addRecipeIngredientLine(
	recipeId: string,
	ingredientMasterId: string,
	quantity: number,
	unit: MeasureUnit
): void {
	recipeStore.recipes = recipeStore.recipes.map((r) => {
		if (r.id !== recipeId) return r;
		const master = ingredientCatalog.items.find((m) => m.id === ingredientMasterId);
		if (!master) {
			const line: RecipeIngredientLineDTO = {
				id: newId('rl'),
				ingredientMasterId,
				quantity,
				unit
			};
			return { ...r, ingredientLines: [...r.ingredientLines, line] };
		}
		const base = master.baseUnit as MeasureUnit;
		const same = r.ingredientLines.filter((l) => l.ingredientMasterId === ingredientMasterId);
		const rest = r.ingredientLines.filter((l) => l.ingredientMasterId !== ingredientMasterId);
		let totalBase = 0;
		for (const l of same) {
			const q = convertQuantity(l.quantity, l.unit, base);
			if (q === null) {
				const line: RecipeIngredientLineDTO = {
					id: newId('rl'),
					ingredientMasterId,
					quantity,
					unit
				};
				return { ...r, ingredientLines: [...r.ingredientLines, line] };
			}
			totalBase += q;
		}
		const qNew = convertQuantity(quantity, unit, base);
		if (qNew === null) {
			const line: RecipeIngredientLineDTO = {
				id: newId('rl'),
				ingredientMasterId,
				quantity,
				unit
			};
			return { ...r, ingredientLines: [...r.ingredientLines, line] };
		}
		totalBase += qNew;
		const headId = same.length > 0 ? same[0]!.id : newId('rl');
		const merged: RecipeIngredientLineDTO = {
			id: headId,
			ingredientMasterId,
			quantity: roundQty(totalBase),
			unit: base
		};
		return { ...r, ingredientLines: [...rest, merged] };
	});
}

export function updateRecipeIngredientLine(
	recipeId: string,
	lineId: string,
	patch: Partial<Pick<RecipeIngredientLineDTO, 'ingredientMasterId' | 'quantity' | 'unit'>>
): void {
	recipeStore.recipes = recipeStore.recipes.map((r) => {
		if (r.id !== recipeId) return r;
		return {
			...r,
			ingredientLines: r.ingredientLines.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
		};
	});
}

export function deleteRecipeIngredientLine(recipeId: string, lineId: string): void {
	recipeStore.recipes = recipeStore.recipes.map((r) =>
		r.id === recipeId
			? { ...r, ingredientLines: r.ingredientLines.filter((l) => l.id !== lineId) }
			: r
	);
}

export function addRecipeOtherLine(
	recipeId: string,
	otherMasterId: string,
	quantity: number,
	unit: MeasureUnit
): void {
	recipeStore.recipes = recipeStore.recipes.map((r) => {
		if (r.id !== recipeId) return r;
		const master = otherCatalog.items.find((m) => m.id === otherMasterId);
		if (!master) {
			const line: RecipeOtherLineDTO = {
				id: newId('ol'),
				otherMasterId,
				quantity,
				unit
			};
			return { ...r, otherLines: [...r.otherLines, line] };
		}
		const base = master.baseUnit as MeasureUnit;
		const same = r.otherLines.filter((l) => l.otherMasterId === otherMasterId);
		const rest = r.otherLines.filter((l) => l.otherMasterId !== otherMasterId);
		let totalBase = 0;
		for (const l of same) {
			const q = convertQuantity(l.quantity, l.unit, base);
			if (q === null) {
				const line: RecipeOtherLineDTO = {
					id: newId('ol'),
					otherMasterId,
					quantity,
					unit
				};
				return { ...r, otherLines: [...r.otherLines, line] };
			}
			totalBase += q;
		}
		const qNew = convertQuantity(quantity, unit, base);
		if (qNew === null) {
			const line: RecipeOtherLineDTO = {
				id: newId('ol'),
				otherMasterId,
				quantity,
				unit
			};
			return { ...r, otherLines: [...r.otherLines, line] };
		}
		totalBase += qNew;
		const headId = same.length > 0 ? same[0]!.id : newId('ol');
		const merged: RecipeOtherLineDTO = {
			id: headId,
			otherMasterId,
			quantity: roundQty(totalBase),
			unit: base
		};
		return { ...r, otherLines: [...rest, merged] };
	});
}

export function updateRecipeOtherLine(
	recipeId: string,
	lineId: string,
	patch: Partial<Pick<RecipeOtherLineDTO, 'otherMasterId' | 'quantity' | 'unit'>>
): void {
	recipeStore.recipes = recipeStore.recipes.map((r) => {
		if (r.id !== recipeId) return r;
		return {
			...r,
			otherLines: r.otherLines.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
		};
	});
}

export function deleteRecipeOtherLine(recipeId: string, lineId: string): void {
	recipeStore.recipes = recipeStore.recipes.map((r) =>
		r.id === recipeId ? { ...r, otherLines: r.otherLines.filter((l) => l.id !== lineId) } : r
	);
}

export function replaceRecipesFromApi(next: RecipeDTO[]): void {
	recipeStore.recipes = structuredClone(next);
}

export function resetRecipes(): void {
	recipeStore.recipes = [];
}
