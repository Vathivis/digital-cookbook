import { describe, expect, test } from 'bun:test';
import { deriveNextCookbookId } from '@/components/cookbook-helpers';

describe('deriveNextCookbookId', () => {
	test('returns null when there are no cookbooks', () => {
		expect(deriveNextCookbookId(5, [])).toBeNull();
		expect(deriveNextCookbookId(null, [])).toBeNull();
	});

	test('picks the first cookbook when none is active', () => {
		const cookbooks = [{ id: 2 }, { id: 3 }];
		expect(deriveNextCookbookId(null, cookbooks)).toBe(2);
	});

	test('keeps current selection when still present', () => {
		const cookbooks = [{ id: 2 }, { id: 3 }];
		expect(deriveNextCookbookId(3, cookbooks)).toBe(3);
	});

	test('falls back to first cookbook when current selection disappears', () => {
		const cookbooks = [{ id: 10 }, { id: 15 }];
		expect(deriveNextCookbookId(999, cookbooks)).toBe(10);
	});
});
