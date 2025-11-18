import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Window as HappyWindow } from 'happy-dom';
import { RecipeCard } from '@/components/RecipeCard';
import { webcrypto } from 'node:crypto';

const happyWindow = new HappyWindow();
const globalWindow = happyWindow as unknown as Window & typeof globalThis;
Object.assign(globalThis, {
	window: globalWindow,
	document: globalWindow.document,
	navigator: globalWindow.navigator,
	HTMLElement: globalWindow.HTMLElement,
	Node: globalWindow.Node,
});

if (!globalThis.crypto) {
	globalThis.crypto = webcrypto as unknown as Crypto;
}

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.assign(globalThis, {
	ResizeObserver: ResizeObserverStub,
});

class MutationObserverStub {
	private callback: MutationCallback;
	constructor(callback: MutationCallback) {
		this.callback = callback;
	}
	observe() {}
	disconnect() {}
	takeRecords(): MutationRecord[] {
		return [];
	}
}

if (!globalThis.MutationObserver) {
	globalThis.MutationObserver = MutationObserverStub as unknown as typeof MutationObserver;
}

afterEach(() => cleanup());

const baseRecipe = {
	id: 1,
	cookbook_id: 1,
	title: 'Toast',
	description: 'Buttered toast',
	author: 'Chef',
	photo: null,
	uses: 0,
	created_at: '2024-01-01',
	tags: [] as string[],
	likes: [] as string[],
};

describe('RecipeCard', () => {
	test('refreshes likes when recipe prop changes', async () => {
		const { rerender, getByText, queryByText } = render(<RecipeCard recipe={{ ...baseRecipe, likes: ['Alex'] }} onChange={() => {}} />);
		expect(getByText('Alex')).toBeTruthy();

		rerender(<RecipeCard recipe={{ ...baseRecipe, likes: ['Jamie'] }} onChange={() => {}} />);

		await waitFor(() => {
			expect(getByText('Jamie')).toBeTruthy();
		});
		expect(queryByText('Alex')).toBeNull();
	});
});
