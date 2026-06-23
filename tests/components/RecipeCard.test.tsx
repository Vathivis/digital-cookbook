import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Window as HappyWindow } from 'happy-dom';
import { RecipeCard } from '@/components/RecipeCard';
import { webcrypto } from 'node:crypto';

const happyWindow = new HappyWindow();
const globalWindow = happyWindow as unknown as Window & typeof globalThis;
globalWindow.Error = Error;
globalWindow.SyntaxError = SyntaxError;
globalWindow.TypeError = TypeError;
Object.assign(globalThis, {
	window: globalWindow,
	document: globalWindow.document,
	navigator: globalWindow.navigator,
	Element: globalWindow.Element,
	HTMLElement: globalWindow.HTMLElement,
	HTMLButtonElement: globalWindow.HTMLButtonElement,
	HTMLFormElement: globalWindow.HTMLFormElement,
	HTMLInputElement: globalWindow.HTMLInputElement,
	SVGElement: globalWindow.SVGElement,
	DocumentFragment: globalWindow.DocumentFragment,
	getComputedStyle: globalWindow.getComputedStyle.bind(globalWindow),
	Node: globalWindow.Node,
	NodeFilter: globalWindow.NodeFilter,
	Event: globalWindow.Event,
	CustomEvent: globalWindow.CustomEvent,
	InputEvent: globalWindow.InputEvent,
	KeyboardEvent: globalWindow.KeyboardEvent,
	MouseEvent: globalWindow.MouseEvent,
	PointerEvent: globalWindow.PointerEvent,
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

const requestAnimationFrameStub = (callback: FrameRequestCallback) => {
	return setTimeout(() => callback(Date.now()), 0) as unknown as number;
};
const cancelAnimationFrameStub = (id: number) => {
	clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};

Object.assign(globalThis, {
	ResizeObserver: ResizeObserverStub,
	requestAnimationFrame: requestAnimationFrameStub,
	cancelAnimationFrame: cancelAnimationFrameStub,
});
Object.assign(globalWindow, {
	requestAnimationFrame: requestAnimationFrameStub,
	cancelAnimationFrame: cancelAnimationFrameStub,
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

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
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
		const fetchMock = mock(() => Promise.resolve(json(['Alex'])));
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
			const postCalls = fetchMock.mock.calls.filter(([input, init]) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
				return url.endsWith('/api/recipes/1/likes') && init?.method === 'POST';
			});
			expect(postCalls).toHaveLength(0);
		} finally {
			globalThis.fetch = originalFetch;
			console.error = originalConsoleError;
		}
	});

	test('shows saved like names in quick-like autocomplete', async () => {
		const fetchMock = mock((input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.startsWith('/api/likes')) return Promise.resolve(json(['Sam']));
			if (url.endsWith('/api/recipes/1/likes') && init?.method === 'POST') return Promise.resolve(json({ ok: true }));
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getByText, queryByPlaceholderText } = render(
				<RecipeCard recipe={{ ...baseRecipe }} onChange={() => {}} />
			);

			fireEvent.click(getByText('like'));

			await waitFor(() => {
				expect(getByText('Sam')).toBeTruthy();
			});
			fireEvent.pointerDown(getByText('Sam'));

			await waitFor(() => {
				expect(queryByPlaceholderText('Name who likes this')).toBeNull();
			});
			expect(getByText('Sam')).toBeTruthy();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('batches rapid cook count clicks into one delta request', async () => {
		const fetchMock = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/recipes/1/uses-delta')) {
				return Promise.resolve(json({ ok: true, uses: 3 }));
			}
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const onChange = mock(() => {});
		const onUsesChange = mock(() => {});

		try {
			const { getByTitle, getByText } = render(
				<RecipeCard recipe={{ ...baseRecipe, uses: 0 }} onChange={onChange} onUsesChange={onUsesChange} />
			);

			const increment = getByTitle('Increment uses');
			fireEvent.click(increment);
			fireEvent.click(increment);
			fireEvent.click(increment);

			expect(getByText('3')).toBeTruthy();
			expect(onUsesChange).toHaveBeenLastCalledWith(1, 3);
			expect(onChange).not.toHaveBeenCalled();

			await waitFor(() => {
				expect(fetchMock).toHaveBeenCalledTimes(1);
			});
			const [, init] = fetchMock.mock.calls[0] as [string | URL | Request, RequestInit | undefined];
			expect(init?.body).toBe(JSON.stringify({ delta: 3 }));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('fetches detail when an auto-open request arrives', async () => {
		const fetchMock = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/recipes/1')) {
				return Promise.resolve(json({
					...baseRecipe,
					title: 'Loaded Toast',
					servings: 2,
					ingredients: [],
					steps: ['Serve warm'],
					notes: '',
					ingredientNames: [],
				}));
			}
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const onAutoOpenHandled = mock(() => {});

		try {
			const { rerender } = render(
				<RecipeCard
					recipe={{ ...baseRecipe }}
					onChange={() => {}}
					onAutoOpenHandled={onAutoOpenHandled}
				/>
			);
			rerender(
				<RecipeCard
					recipe={{ ...baseRecipe }}
					onChange={() => {}}
					autoOpenRequestId={1}
					onAutoOpenHandled={onAutoOpenHandled}
				/>
			);

			await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/recipes/1', undefined));
			expect(onAutoOpenHandled).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
