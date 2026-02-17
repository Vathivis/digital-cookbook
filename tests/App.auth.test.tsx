import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Window as HappyWindow } from 'happy-dom';
import App from '@/App';
import { AUTH_EXPIRED_EVENT } from '@/lib/api';

const happyWindow = new HappyWindow();
const globalWindow = happyWindow as unknown as Window & typeof globalThis;
Object.assign(globalThis, {
	window: globalWindow,
	document: globalWindow.document,
	navigator: globalWindow.navigator,
	HTMLElement: globalWindow.HTMLElement,
	HTMLInputElement: globalWindow.HTMLInputElement,
	Node: globalWindow.Node,
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

afterEach(() => {
	cleanup();
	mock.restore();
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

		window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));

		await waitFor(() => {
			expect(getByRole('heading', { name: 'Sign in' })).toBeTruthy();
		});
	});
});
