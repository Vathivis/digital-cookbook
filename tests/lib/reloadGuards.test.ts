import { describe, expect, test } from 'bun:test';
import { shouldApplyRecipeReload } from '@/lib/reloadGuards';

const currentReload = {
	requestId: 2,
	latestRequestId: 2,
	cookbookId: 1,
	activeCookbookId: 1,
	query: 'pie',
	currentQuery: 'pie'
};

describe('shouldApplyRecipeReload', () => {
	test('accepts the latest response for the active cookbook and query', () => {
		expect(shouldApplyRecipeReload(currentReload)).toBe(true);
	});

	test('rejects stale request ids, cookbook switches, and query changes', () => {
		expect(shouldApplyRecipeReload({ ...currentReload, requestId: 1 })).toBe(false);
		expect(shouldApplyRecipeReload({ ...currentReload, activeCookbookId: 2 })).toBe(false);
		expect(shouldApplyRecipeReload({ ...currentReload, currentQuery: 'cake' })).toBe(false);
	});
});
