type RecipeReloadGuardInput = {
	requestId: number;
	latestRequestId: number;
	cookbookId: number;
	activeCookbookId: number | null;
	query: string;
	currentQuery: string;
};

export function shouldApplyRecipeReload({
	requestId,
	latestRequestId,
	cookbookId,
	activeCookbookId,
	query,
	currentQuery
}: RecipeReloadGuardInput) {
	return requestId === latestRequestId && activeCookbookId === cookbookId && currentQuery.trim() === query;
}
