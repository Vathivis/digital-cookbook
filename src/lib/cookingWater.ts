export type CookingWaterRule = {
	amountGramsPerServing: number;
	minimumWaterLiters: number;
	extraWaterLiters: number;
	extraWaterPerGrams: number;
	saltGramsPerLiter: number;
};

export type CookingWaterResult = {
	amountGrams: number;
	waterLiters: number;
	saltGrams: number;
};

export type CookingWaterRuleDraft = {
	minimumWaterLiters: string;
	extraWaterLitersPerServing: string;
	saltGramsPerLiter: string;
};

const STORAGE_AMOUNT_GRAMS_PER_SERVING = 100;

export const DEFAULT_COOKING_WATER_RULE: CookingWaterRule = {
	amountGramsPerServing: STORAGE_AMOUNT_GRAMS_PER_SERVING,
	minimumWaterLiters: 1,
	extraWaterLiters: 0.5,
	extraWaterPerGrams: STORAGE_AMOUNT_GRAMS_PER_SERVING,
	saltGramsPerLiter: 11
};

export function createCookingWaterRuleDraft(rule: CookingWaterRule = DEFAULT_COOKING_WATER_RULE): CookingWaterRuleDraft {
	const extraWaterLitersPerServing = rule.extraWaterLiters * (rule.amountGramsPerServing / rule.extraWaterPerGrams);
	return {
		minimumWaterLiters: String(rule.minimumWaterLiters),
		extraWaterLitersPerServing: String(extraWaterLitersPerServing),
		saltGramsPerLiter: String(rule.saltGramsPerLiter)
	};
}

export function parseCookingWaterRuleDraft(draft: CookingWaterRuleDraft): CookingWaterRule | null {
	const minimumWaterLiters = Number(draft.minimumWaterLiters.replace(/,/g, '.'));
	const extraWaterLitersPerServing = Number(draft.extraWaterLitersPerServing.replace(/,/g, '.'));
	const saltGramsPerLiter = Number(draft.saltGramsPerLiter.replace(/,/g, '.'));
	const values = [minimumWaterLiters, extraWaterLitersPerServing, saltGramsPerLiter];
	if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
	return {
		amountGramsPerServing: STORAGE_AMOUNT_GRAMS_PER_SERVING,
		minimumWaterLiters,
		extraWaterLiters: extraWaterLitersPerServing,
		extraWaterPerGrams: STORAGE_AMOUNT_GRAMS_PER_SERVING,
		saltGramsPerLiter
	};
}

export function calculateCookingWater(rule: CookingWaterRule, servings: number): CookingWaterResult {
	const safeServings = Number.isFinite(servings) && servings > 0 ? servings : 1;
	const amountGrams = rule.amountGramsPerServing * safeServings;
	const waterLiters = rule.minimumWaterLiters + rule.extraWaterLiters * (amountGrams / rule.extraWaterPerGrams);
	const saltGrams = waterLiters * rule.saltGramsPerLiter;
	return { amountGrams, waterLiters, saltGrams };
}

export function formatCookingWaterAmount(value: number) {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
