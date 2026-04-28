type RecipeReloadTargetInput = {
	cookbookId: number;
	activeCookbookId: number | null;
	query: string;
	currentQuery: string;
};

type RecipeReloadGuardInput = RecipeReloadTargetInput & {
	requestId: number;
	latestRequestId: number;
};

export function shouldStartRecipeReload({
	cookbookId,
	activeCookbookId,
	query,
	currentQuery
}: RecipeReloadTargetInput) {
	return activeCookbookId === cookbookId && currentQuery.trim() === query;
}

export function shouldApplyRecipeReload({
	requestId,
	latestRequestId,
	cookbookId,
	activeCookbookId,
	query,
	currentQuery
}: RecipeReloadGuardInput) {
	return requestId === latestRequestId && shouldStartRecipeReload({ cookbookId, activeCookbookId, query, currentQuery });
}
