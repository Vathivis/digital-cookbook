import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Window as HappyWindow } from 'happy-dom';
import { CookbookLayoutSidebar } from '@/components/CookbookLayout';

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

describe('CookbookLayoutSidebar', () => {
	test('does not refetch cookbooks when toggling add form', async () => {
		let listCookbooksCount = 0;
		globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
			if (url.endsWith('/api/cookbooks') && method === 'GET') {
				listCookbooksCount += 1;
				return Promise.resolve(json([{ id: 1, name: 'Main' }]));
			}
			return Promise.resolve(json({ ok: true }));
		}) as typeof fetch;

		const onSelect = mock(() => {});
		const { getByRole, getByText } = render(<CookbookLayoutSidebar activeCookbookId={null} onSelect={onSelect} />);

		await waitFor(() => {
			expect(getByText('Main')).toBeTruthy();
		});
		expect(listCookbooksCount).toBe(1);

		fireEvent.click(getByRole('button', { name: 'Add Cookbook' }));
		await waitFor(() => {
			expect(getByRole('button', { name: 'Cancel' })).toBeTruthy();
		});
		fireEvent.click(getByRole('button', { name: 'Cancel' }));

		await waitFor(() => {
			expect(getByRole('button', { name: 'Add Cookbook' })).toBeTruthy();
		});
		expect(listCookbooksCount).toBe(1);
	});
});

