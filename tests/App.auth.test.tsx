import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Window as HappyWindow } from 'happy-dom';
import App from '@/App';
import { AUTH_EXPIRED_EVENT } from '@/lib/api';

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
	HTMLInputElement: globalWindow.HTMLInputElement,
	SVGElement: globalWindow.SVGElement,
	DocumentFragment: globalWindow.DocumentFragment,
	getComputedStyle: globalWindow.getComputedStyle.bind(globalWindow),
	localStorage: globalWindow.localStorage,
	Node: globalWindow.Node,
	NodeFilter: globalWindow.NodeFilter,
	Event: globalWindow.Event,
	CustomEvent: globalWindow.CustomEvent,
	InputEvent: globalWindow.InputEvent,
	KeyboardEvent: globalWindow.KeyboardEvent,
	MouseEvent: globalWindow.MouseEvent,
	PointerEvent: globalWindow.PointerEvent,
});

if (!globalThis.MutationObserver) {
	class MutationObserverStub {
		observe() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	}
	globalThis.MutationObserver = MutationObserverStub as unknown as typeof MutationObserver;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

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

afterEach(() => {
	cleanup();
	mock.restore();
	globalWindow.history.replaceState(null, '', 'about:blank');
	localStorage.clear();
});

describe('App auth gating', () => {
	test('does not duplicate initial recipe fetch when query is empty', async () => {
		let recipesFetchCount = 0;
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: false, authenticated: true }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 1, name: 'Main' }]));
			if (url.includes('/api/recipes?cookbookId=1')) {
				recipesFetchCount += 1;
				return Promise.resolve(json([]));
			}
			if (url.includes('/api/recipes/search?cookbookId=1')) {
				return Promise.resolve(json([]));
			}
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		render(<App />);

		await waitFor(() => {
			expect(recipesFetchCount).toBe(1);
		});
		await new Promise((resolve) => setTimeout(resolve, 350));
		expect(recipesFetchCount).toBe(1);
	});

	test('restores the last selected cookbook on initial load', async () => {
		localStorage.setItem('digital-cookbook.activeCookbookId', '2');
		let restoredCookbookFetchCount = 0;
		let firstCookbookFetchCount = 0;
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: false, authenticated: true }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 1, name: 'Demo' }, { id: 2, name: 'test' }]));
			if (url.includes('/api/recipes?cookbookId=2')) {
				restoredCookbookFetchCount += 1;
				return Promise.resolve(json([]));
			}
			if (url.includes('/api/recipes?cookbookId=1')) {
				firstCookbookFetchCount += 1;
				return Promise.resolve(json([]));
			}
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		render(<App />);

		await waitFor(() => {
			expect(restoredCookbookFetchCount).toBe(1);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
		expect(firstCookbookFetchCount).toBe(0);
	});

	test('does not fetch saved cookbook recipes before auth status resolves logged out', async () => {
		localStorage.setItem('digital-cookbook.activeCookbookId', '2');
		let recipesFetchCount = 0;
		let resolveAuthStatus: (response: Response) => void = () => {};
		const authStatusPromise = new Promise<Response>((resolve) => {
			resolveAuthStatus = resolve;
		});
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return authStatusPromise;
			if (url.includes('/api/recipes?cookbookId=2')) {
				recipesFetchCount += 1;
				return Promise.resolve(json({ error: 'unauthorized' }, 401));
			}
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 2, name: 'Saved' }]));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		const { getByRole } = render(<App />);

		await act(async () => {
			await Promise.resolve();
		});
		expect(recipesFetchCount).toBe(0);

		await act(async () => {
			resolveAuthStatus(json({ enabled: true, authenticated: false }));
			await authStatusPromise;
		});

		await waitFor(() => {
			expect(getByRole('heading', { name: 'Sign in' })).toBeTruthy();
		});
		expect(recipesFetchCount).toBe(0);
	});

	test('shows login screen when auth status request fails', async () => {
		const originalConsoleError = console.error;
		console.error = mock(() => {}) as typeof console.error;
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.reject(new Error('network fail'));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([]));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		try {
			const { getByRole, queryByText } = render(<App />);

			await waitFor(() => {
				expect(getByRole('heading', { name: 'Sign in' })).toBeTruthy();
			});
			expect(queryByText('Recipes')).toBeNull();
		} finally {
			console.error = originalConsoleError;
		}
	});

	test('shows login screen when auth is enabled and unauthenticated', async () => {
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: true, authenticated: false }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([]));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		const { getByRole, queryByText } = render(<App />);

		await waitFor(() => {
			expect(getByRole('heading', { name: 'Sign in' })).toBeTruthy();
		});
		expect(queryByText('Recipes')).toBeNull();
	});

	test('shows app content when authenticated', async () => {
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: true, authenticated: true, username: 'chef' }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([]));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		const { getByText, queryByRole } = render(<App />);

		await waitFor(() => {
			expect(getByText('Recipes')).toBeTruthy();
		});
		expect(queryByRole('heading', { name: 'Sign in' })).toBeNull();
	});

	test('returns to login after auth-expired event', async () => {
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: true, authenticated: true, username: 'chef' }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([]));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		const { getByText, getByRole } = render(<App />);

		await waitFor(() => {
			expect(getByText('Recipes')).toBeTruthy();
		});

		act(() => {
			window.dispatchEvent(new globalWindow.CustomEvent(AUTH_EXPIRED_EVENT));
		});

		await waitFor(() => {
			expect(getByRole('heading', { name: 'Sign in' })).toBeTruthy();
		});
	});

	test('opens a random recipe from the currently filtered matches', async () => {
		const recipes = [
			{
				id: 1,
				cookbook_id: 1,
				title: 'Cheap Egg Bake',
				description: 'Uses eggs',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap', 'Dinner'],
				likes: [],
				ingredientNames: ['Egg'],
			},
			{
				id: 2,
				cookbook_id: 1,
				title: 'Cheap Rice Dinner',
				description: 'Uses rice',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap', 'Dinner'],
				likes: [],
				ingredientNames: ['Rice'],
			},
			{
				id: 3,
				cookbook_id: 1,
				title: 'Budget Tomato Lunch',
				description: 'Uses tomatoes',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap', 'Lunch'],
				likes: [],
				ingredientNames: ['Tomatoes'],
			},
			{
				id: 4,
				cookbook_id: 1,
				title: 'Honey Feta Roast',
				description: 'Uses honey',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap', 'Dinner'],
				likes: [],
				ingredientNames: ['Honey'],
			},
		];
		const fetchMock = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: false, authenticated: true }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 1, name: 'Main' }]));
			if (url.includes('/api/recipes?cookbookId=1')) return Promise.resolve(json(recipes));
			if (url.endsWith('/api/recipes/4')) {
				return Promise.resolve(json({
					...recipes[3],
					title: 'Honey Feta Roast Detail',
					ingredients: [],
					steps: ['Roast until browned'],
					notes: '',
				}));
			}
			return Promise.resolve(json({ error: 'not found' }, 404));
		});
		const originalRandom = Math.random;
		Math.random = mock(() => 0.75) as unknown as typeof Math.random;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getAllByRole, getByRole } = render(<App />);

			await waitFor(() => {
				expect(getByRole('button', { name: 'Random matching recipe' })).toBeTruthy();
			});

			fireEvent.click(getAllByRole('button', { name: 'Cheap' })[0]);
			fireEvent.click(getAllByRole('button', { name: 'Dinner' })[0]);
			fireEvent.click(getAllByRole('button', { name: 'OR' })[1]);
			fireEvent.click(getAllByRole('button', { name: 'Egg' })[0]);
			fireEvent.click(getAllByRole('button', { name: 'Honey' })[0]);
			fireEvent.click(getByRole('button', { name: 'Random matching recipe' }));

			await waitFor(() => {
				const detailCalls = fetchMock.mock.calls
					.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
					.filter(url => url.endsWith('/api/recipes/4'));
				expect(detailCalls).toHaveLength(1);
			});
			fireEvent.click(getByRole('button', { name: 'Random matching recipe' }));
			await waitFor(() => {
				const detailCalls = fetchMock.mock.calls
					.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
					.filter(url => url.endsWith('/api/recipes/4'));
				expect(detailCalls).toHaveLength(2);
			});
		} finally {
			Math.random = originalRandom;
		}
	});

	test('does not reopen a stale random request after the selected recipe leaves the filters', async () => {
		const recipes = [
			{
				id: 1,
				cookbook_id: 1,
				title: 'Cheap Egg Bake',
				description: 'Uses eggs',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap'],
				likes: [],
				ingredientNames: ['Egg'],
			},
			{
				id: 2,
				cookbook_id: 1,
				title: 'Vegetarian Plate',
				description: 'Simple plate',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Vegetarian'],
				likes: [],
				ingredientNames: ['Carrot'],
			},
		];
		const fetchMock = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: false, authenticated: true }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 1, name: 'Main' }]));
			if (url.includes('/api/recipes?cookbookId=1')) return Promise.resolve(json(recipes));
			if (url.endsWith('/api/recipes/1')) {
				return Promise.resolve(json({
					...recipes[0],
					ingredients: [],
					steps: ['Bake until set'],
					notes: '',
				}));
			}
			return Promise.resolve(json({ error: 'not found' }, 404));
		});
		const originalRandom = Math.random;
		Math.random = mock(() => 0) as unknown as typeof Math.random;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getAllByRole, getByRole, queryByRole } = render(<App />);

			await waitFor(() => {
				expect(getByRole('button', { name: 'Random matching recipe' })).toBeTruthy();
			});

			const randomButton = getByRole('button', { name: 'Random matching recipe' });
			const vegetarianFilter = getAllByRole('button', { name: 'Vegetarian' })[0];

			await act(async () => {
				randomButton.dispatchEvent(new globalWindow.MouseEvent('click', { bubbles: true }));
				vegetarianFilter.dispatchEvent(new globalWindow.MouseEvent('click', { bubbles: true }));
			});

			await waitFor(() => {
				expect(queryByRole('heading', { name: 'Cheap Egg Bake' })).toBeNull();
			});

			fireEvent.click(getAllByRole('button', { name: 'Vegetarian' })[0]);

			await waitFor(() => {
				expect(getByRole('heading', { name: 'Cheap Egg Bake' })).toBeTruthy();
			});

			const detailCalls = fetchMock.mock.calls
				.map(([input]) => typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
				.filter(url => url.endsWith('/api/recipes/1'));
			expect(detailCalls).toHaveLength(0);
		} finally {
			Math.random = originalRandom;
		}
	});

	test('disables the random recipe button when filters leave no matches', async () => {
		const recipes = [
			{
				id: 1,
				cookbook_id: 1,
				title: 'Cheap Soup',
				description: 'Simple soup',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Cheap'],
				likes: [],
				ingredientNames: ['Onion'],
			},
			{
				id: 2,
				cookbook_id: 1,
				title: 'Vegetarian Plate',
				description: 'Simple plate',
				author: 'Chef',
				photo: null,
				uses: 0,
				servings: 1,
				created_at: '2024-01-01',
				tags: ['Vegetarian'],
				likes: [],
				ingredientNames: ['Carrot'],
			},
		];
		globalThis.fetch = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/auth/status')) return Promise.resolve(json({ enabled: false, authenticated: true }));
			if (url.endsWith('/api/cookbooks')) return Promise.resolve(json([{ id: 1, name: 'Main' }]));
			if (url.includes('/api/recipes?cookbookId=1')) return Promise.resolve(json(recipes));
			return Promise.resolve(json({ error: 'not found' }, 404));
		}) as typeof fetch;

		const { getAllByRole, getByRole } = render(<App />);

		await waitFor(() => {
			expect(getByRole('button', { name: 'Random matching recipe' })).toBeTruthy();
		});

		fireEvent.click(getAllByRole('button', { name: 'Cheap' })[0]);
		fireEvent.click(getAllByRole('button', { name: 'Vegetarian' })[0]);

		await waitFor(() => {
			const button = getByRole('button', { name: 'No matching recipes' }) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
		});
	});
});
