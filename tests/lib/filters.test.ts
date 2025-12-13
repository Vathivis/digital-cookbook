import { describe, expect, test } from 'bun:test';
import { filterAndSortRecipes, type FilterableRecipe } from '@/lib/filters';

const recipes = [
	{ id: 1, title: 'Alpha', uses: 5, tags: ['vegan'], ingredientNames: ['garlic', 'salt'] },
	{ id: 2, title: 'Beta', uses: 3, tags: ['italian'], ingredientNames: ['garlic'] },
	{ id: 3, title: 'Gamma', uses: 7, tags: ['vegan', 'italian'], ingredientNames: ['garlic', 'tomato'] },
	{ id: 4, title: 'Delta', uses: 1, tags: [], ingredientNames: ['basil'] },
	{ id: 5, title: 'Eclair', uses: 5, tags: [], ingredientNames: ['flour'] }
] satisfies ReadonlyArray<FilterableRecipe>;

describe('filterAndSortRecipes', () => {
	test('applies AND filters across tags and ingredients', () => {
		const result = filterAndSortRecipes(recipes, {
			selectedTags: ['vegan'],
			tagMode: 'AND',
			selectedIngredients: ['garlic', 'tomato'],
			ingredientMode: 'AND',
			sortMode: 'AZ'
		});
		expect(result.map((r) => r.title)).toEqual(['Gamma']);
	});

	test('supports OR ingredient filtering', () => {
		const result = filterAndSortRecipes(recipes, {
			selectedTags: [],
			tagMode: 'AND',
			selectedIngredients: ['basil', 'salt'],
			ingredientMode: 'OR',
			sortMode: 'AZ'
		});
		expect(result.map((r) => r.title)).toEqual(['Alpha', 'Delta']);
	});

	test('sorts by MOST cooked with title tiebreaker', () => {
		const result = filterAndSortRecipes(recipes, {
			selectedTags: [],
			tagMode: 'AND',
			selectedIngredients: [],
			ingredientMode: 'AND',
			sortMode: 'MOST'
		});
		expect(result.map((r) => r.title)).toEqual(['Gamma', 'Alpha', 'Eclair', 'Beta', 'Delta']);
	});
});
