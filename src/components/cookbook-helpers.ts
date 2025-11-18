interface CookbookLike {
	id: number;
}

export function deriveNextCookbookId(activeCookbookId: number | null, cookbooks: CookbookLike[]) {
	if (!cookbooks.length) return null;
	if (activeCookbookId == null) return cookbooks[0]?.id ?? null;
	return cookbooks.some(cb => cb.id === activeCookbookId) ? activeCookbookId : (cookbooks[0]?.id ?? null);
}
