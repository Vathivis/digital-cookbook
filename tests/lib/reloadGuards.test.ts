import { describe, expect, test } from 'bun:test';
import { shouldApplyRecipeReload, shouldStartRecipeReload } from '@/lib/reloadGuards';

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

describe('shouldStartRecipeReload', () => {
	test('accepts active cookbook and query reloads', () => {
		expect(shouldStartRecipeReload(currentReload)).toBe(true);
	});

	test('rejects stale callbacks before they can advance the latest request id', () => {
		let latestRequestId = 1;
		const currentCookbookReload = {
			cookbookId: 2,
			activeCookbookId: 2,
			query: '',
			currentQuery: ''
		};
		const staleCookbookReload = {
			...currentCookbookReload,
			cookbookId: 1
		};

		if (shouldStartRecipeReload(staleCookbookReload)) {
			latestRequestId += 1;
		}

		expect(latestRequestId).toBe(1);
		const currentRequestId = ++latestRequestId;
		expect(shouldApplyRecipeReload({
			...currentCookbookReload,
			requestId: currentRequestId,
			latestRequestId
		})).toBe(true);
	});

	test('rejects stale query callbacks before they can advance the latest request id', () => {
		expect(shouldStartRecipeReload({ ...currentReload, query: 'pie', currentQuery: 'cake' })).toBe(false);
	});
});
