import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_COOKING_WATER_RULE,
	calculateCookingWater,
	createCookingWaterRuleDraft,
	formatCookingWaterAmount,
	parseCookingWaterRuleDraft
} from '@/lib/cookingWater';

describe('cooking water helpers', () => {
	test('calculates default water and salt from selected servings', () => {
		expect(calculateCookingWater(DEFAULT_COOKING_WATER_RULE, 1)).toEqual({
			amountGrams: 100,
			waterLiters: 1.5,
			saltGrams: 16.5
		});
		expect(calculateCookingWater(DEFAULT_COOKING_WATER_RULE, 2)).toEqual({
			amountGrams: 200,
			waterLiters: 2,
			saltGrams: 22
		});
		expect(calculateCookingWater(DEFAULT_COOKING_WATER_RULE, 5)).toEqual({
			amountGrams: 500,
			waterLiters: 3.5,
			saltGrams: 38.5
		});
	});

	test('parses draft values and rejects non-positive values', () => {
		expect(parseCookingWaterRuleDraft(createCookingWaterRuleDraft())).toEqual(DEFAULT_COOKING_WATER_RULE);
		expect(parseCookingWaterRuleDraft({ ...createCookingWaterRuleDraft(), extraWaterLitersPerServing: '0' })).toBeNull();
		expect(parseCookingWaterRuleDraft({ ...createCookingWaterRuleDraft(), extraWaterLitersPerServing: '0,75' })).toMatchObject({
			extraWaterLiters: 0.75
		});
	});

	test('formats values with at most one decimal', () => {
		expect(formatCookingWaterAmount(2)).toBe('2');
		expect(formatCookingWaterAmount(2.25)).toBe('2.3');
		expect(formatCookingWaterAmount(38.5)).toBe('38.5');
	});
});
