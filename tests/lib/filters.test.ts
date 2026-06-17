import { describe, expect, test } from 'bun:test';
import { filterAndSortRecipes, type FilterableRecipe } from '@/lib/filters';

const recipes = [
	{ id: 1, title: 'Alpha', uses: 5, tags: ['vegan'], likes: ['Alex', 'Mira'], ingredientNames: ['garlic', 'salt'] },
	{ id: 2, title: 'Beta', uses: 3, tags: ['italian'], likes: ['Sam'], ingredientNames: ['garlic'] },
	{ id: 3, title: 'Gamma', uses: 7, tags: ['vegan', 'italian'], likes: ['Alex', 'Sam'], ingredientNames: ['garlic', 'tomato'] },
	{ id: 4, title: 'Delta', uses: 1, tags: [], likes: ['Mira'], ingredientNames: ['basil'] },
	{ id: 5, title: 'Eclair', uses: 5, tags: [], likes: [], ingredientNames: ['flour'] }
] satisfies ReadonlyArray<FilterableRecipe>;

describe('filterAndSortRecipes', () => {
	test('applies AND filters across tags and ingredients', () => {
		const result = filterAndSortRecipes(recipes, {
			selectedTags: ['vegan'],
			tagMode: 'AND',
			selectedIngredients: ['garlic', 'tomato'],
			ingredientMode: 'AND',
			selectedLikes: [],
			likeMode: 'AND',
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
			selectedLikes: [],
			likeMode: 'AND',
			sortMode: 'AZ'
		});
		expect(result.map((r) => r.title)).toEqual(['Alpha', 'Delta']);
	});

	test('supports AND and OR filtering by likes', () => {
		const andResult = filterAndSortRecipes(recipes, {
			selectedTags: [],
			tagMode: 'AND',
			selectedIngredients: [],
			ingredientMode: 'AND',
			selectedLikes: ['Alex', 'Sam'],
			likeMode: 'AND',
			sortMode: 'AZ'
		});
		expect(andResult.map((r) => r.title)).toEqual(['Gamma']);

		const orResult = filterAndSortRecipes(recipes, {
			selectedTags: [],
			tagMode: 'AND',
			selectedIngredients: [],
			ingredientMode: 'AND',
			selectedLikes: ['Mira', 'Sam'],
			likeMode: 'OR',
			sortMode: 'AZ'
		});
		expect(orResult.map((r) => r.title)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
	});

	test('sorts by MOST cooked with title tiebreaker', () => {
		const result = filterAndSortRecipes(recipes, {
			selectedTags: [],
			tagMode: 'AND',
			selectedIngredients: [],
			ingredientMode: 'AND',
			selectedLikes: [],
			likeMode: 'AND',
			sortMode: 'MOST'
		});
		expect(result.map((r) => r.title)).toEqual(['Gamma', 'Alpha', 'Eclair', 'Beta', 'Delta']);
	});
});
