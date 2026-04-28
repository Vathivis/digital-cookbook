import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
	HTMLButtonElement: globalWindow.HTMLButtonElement,
	HTMLFormElement: globalWindow.HTMLFormElement,
	HTMLInputElement: globalWindow.HTMLInputElement,
	Node: globalWindow.Node,
	Event: globalWindow.Event,
	InputEvent: globalWindow.InputEvent,
	KeyboardEvent: globalWindow.KeyboardEvent,
	MouseEvent: globalWindow.MouseEvent,
	SubmitEvent: globalWindow.SubmitEvent,
	FormData: globalWindow.FormData,
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

afterEach(() => {
	cleanup();
	mock.restore();
});

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

	test('does not remove an existing like when duplicate quick-like submission would fail', async () => {
		const fetchMock = mock(() => Promise.reject(new Error('network fail')));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const originalConsoleError = console.error;
		console.error = mock(() => {}) as typeof console.error;

		try {
			const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
				<RecipeCard recipe={{ ...baseRecipe, likes: ['Alex'] }} onChange={() => {}} />
			);

			expect(getByText('Alex')).toBeTruthy();
			fireEvent.click(getByText('like'));

			const input = getByPlaceholderText('Name who likes this') as HTMLInputElement;
			fireEvent.input(input, { target: { value: 'Alex' } });
			fireEvent.submit(input.closest('form')!);

			await waitFor(() => {
				expect(queryByPlaceholderText('Name who likes this')).toBeNull();
			});
			expect(getByText('Alex')).toBeTruthy();
			expect(fetchMock).toHaveBeenCalledTimes(0);
		} finally {
			globalThis.fetch = originalFetch;
			console.error = originalConsoleError;
		}
	});
});
