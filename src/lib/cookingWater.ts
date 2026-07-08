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

export type CookingWaterRuleDraft = Record<keyof CookingWaterRule, string>;

export const DEFAULT_COOKING_WATER_RULE: CookingWaterRule = {
	amountGramsPerServing: 100,
	minimumWaterLiters: 1,
	extraWaterLiters: 0.5,
	extraWaterPerGrams: 100,
	saltGramsPerLiter: 11
};

export function createCookingWaterRuleDraft(rule: CookingWaterRule = DEFAULT_COOKING_WATER_RULE): CookingWaterRuleDraft {
	return {
		amountGramsPerServing: String(rule.amountGramsPerServing),
		minimumWaterLiters: String(rule.minimumWaterLiters),
		extraWaterLiters: String(rule.extraWaterLiters),
		extraWaterPerGrams: String(rule.extraWaterPerGrams),
		saltGramsPerLiter: String(rule.saltGramsPerLiter)
	};
}

export function parseCookingWaterRuleDraft(draft: CookingWaterRuleDraft): CookingWaterRule | null {
	const amountGramsPerServing = Number(draft.amountGramsPerServing.replace(/,/g, '.'));
	const minimumWaterLiters = Number(draft.minimumWaterLiters.replace(/,/g, '.'));
	const extraWaterLiters = Number(draft.extraWaterLiters.replace(/,/g, '.'));
	const extraWaterPerGrams = Number(draft.extraWaterPerGrams.replace(/,/g, '.'));
	const saltGramsPerLiter = Number(draft.saltGramsPerLiter.replace(/,/g, '.'));
	const values = [amountGramsPerServing, minimumWaterLiters, extraWaterLiters, extraWaterPerGrams, saltGramsPerLiter];
	if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
	return { amountGramsPerServing, minimumWaterLiters, extraWaterLiters, extraWaterPerGrams, saltGramsPerLiter };
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
