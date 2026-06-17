export type SortMode = 'AZ' | 'ZA' | 'MOST';
export type FilterMode = 'AND' | 'OR';

export type FilterableRecipe = {
	id: number;
	title: string;
	uses: number;
	tags: string[];
	likes: string[];
	ingredientNames: string[];
};

type Options = {
	selectedTags: string[];
	tagMode: FilterMode;
	selectedIngredients: string[];
	ingredientMode: FilterMode;
	selectedLikes: string[];
	likeMode: FilterMode;
	sortMode: SortMode;
};

const matchesValues = (haystack: string[], needles: string[], mode: FilterMode) => {
	if (!needles.length) return true;
	if (mode === 'AND') return needles.every((n) => haystack.includes(n));
	return needles.some((n) => haystack.includes(n));
};

export function filterAndSortRecipes<T extends FilterableRecipe>(recipes: T[], options: Options): T[] {
	const { selectedTags, tagMode, selectedIngredients, ingredientMode, selectedLikes, likeMode, sortMode } = options;
	const filtered = recipes.filter((r) => {
		const matchesTags = matchesValues(r.tags || [], selectedTags, tagMode);
		if (!matchesTags) return false;
		const matchesIngredients = matchesValues(r.ingredientNames || [], selectedIngredients, ingredientMode);
		if (!matchesIngredients) return false;
		const matchesLikes = matchesValues(r.likes || [], selectedLikes, likeMode);
		return matchesLikes;
	});
	const sorted = [...filtered].sort((a, b) => {
		if (sortMode === 'AZ') return a.title.localeCompare(b.title);
		if (sortMode === 'ZA') return b.title.localeCompare(a.title);
		if (sortMode === 'MOST') return b.uses - a.uses || a.title.localeCompare(b.title);
		return 0;
	});
	return sorted;
}
