import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { RecipeCard } from '@/components/RecipeCard';
import { DEFAULT_COOKING_WATER_RULE } from '@/lib/cookingWater';

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

	test('updates cooking water readout from selected servings', async () => {
		const fetchMock = mock((input: string | URL | Request) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/recipes/1')) {
				return Promise.resolve(json({
					...baseRecipe,
					servings: 1,
					cookingWaterRule: DEFAULT_COOKING_WATER_RULE,
					ingredients: [{ quantity: 100, unit: 'g', name: 'pasta', line: '100 g pasta' }],
					steps: ['Boil pasta'],
					notes: '',
					ingredientNames: ['pasta'],
				}));
			}
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getByText, getByRole } = render(<RecipeCard recipe={{ ...baseRecipe }} onChange={() => {}} />);

			fireEvent.click(getByText('Toast'));

			await waitFor(() => {
				expect(getByText('For 1 serving: 100 g batch, 1.5 L water, 16.5 g salt')).toBeTruthy();
			});

			fireEvent.click(getByRole('combobox'));
			fireEvent.click(getByText('5'));

			await waitFor(() => {
				expect(getByText('For 5 servings: 500 g batch, 3.5 L water, 38.5 g salt')).toBeTruthy();
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('clears cooking water readout when edit disables the rule', async () => {
		let detailIncludesRule = true;
		const patchBodies: unknown[] = [];
		const fetchMock = mock((input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/recipes/1') && init?.method === 'PATCH') {
				patchBodies.push(JSON.parse(String(init.body)));
				detailIncludesRule = false;
				return Promise.resolve(json({ ok: true }));
			}
			if (url.endsWith('/api/recipes/1')) {
				return Promise.resolve(json({
					...baseRecipe,
					servings: 1,
					cookingWaterRule: detailIncludesRule ? DEFAULT_COOKING_WATER_RULE : null,
					ingredients: [{ quantity: 100, unit: 'g', name: 'pasta', line: '100 g pasta' }],
					steps: ['Boil pasta'],
					notes: '',
					ingredientNames: ['pasta'],
				}));
			}
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getByText, getByRole, queryByText } = render(<RecipeCard recipe={{ ...baseRecipe }} onChange={() => {}} />);

			fireEvent.click(getByText('Toast'));

			await waitFor(() => {
				expect(getByText('For 1 serving: 100 g batch, 1.5 L water, 16.5 g salt')).toBeTruthy();
			});

			fireEvent.click(getByRole('button', { name: 'Edit' }));
			fireEvent.click(getByRole('switch', { name: 'Cooking water' }));
			fireEvent.click(getByRole('button', { name: 'Save' }));

			await waitFor(() => {
				expect(queryByText('For 1 serving: 100 g batch, 1.5 L water, 16.5 g salt')).toBeNull();
			});
			expect(patchBodies[0]).toMatchObject({ cookingWaterRule: null });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('collapses cooking water fields without disabling the rule', async () => {
		const patchBodies: unknown[] = [];
		const fetchMock = mock((input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			if (url.endsWith('/api/recipes/1') && init?.method === 'PATCH') {
				patchBodies.push(JSON.parse(String(init.body)));
				return Promise.resolve(json({ ok: true }));
			}
			if (url.endsWith('/api/recipes/1')) {
				return Promise.resolve(json({
					...baseRecipe,
					servings: 1,
					cookingWaterRule: DEFAULT_COOKING_WATER_RULE,
					ingredients: [{ quantity: 100, unit: 'g', name: 'pasta', line: '100 g pasta' }],
					steps: ['Boil pasta'],
					notes: '',
					ingredientNames: ['pasta'],
				}));
			}
			return Promise.resolve(json({ ok: true }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const { getByText, getByRole, queryByDisplayValue } = render(<RecipeCard recipe={{ ...baseRecipe }} onChange={() => {}} />);

			fireEvent.click(getByText('Toast'));
			await waitFor(() => {
				expect(getByText('For 1 serving: 100 g batch, 1.5 L water, 16.5 g salt')).toBeTruthy();
			});

			fireEvent.click(getByRole('button', { name: 'Edit' }));
			const cookingWaterSwitch = getByRole('switch', { name: 'Cooking water' });
			expect(cookingWaterSwitch.getAttribute('aria-checked')).toBe('true');
			fireEvent.click(getByRole('button', { name: 'Collapse cooking water fields' }));

			expect(cookingWaterSwitch.getAttribute('aria-checked')).toBe('true');
			expect(queryByDisplayValue('11')).toBeNull();

			fireEvent.click(getByRole('button', { name: 'Save' }));

			await waitFor(() => expect(patchBodies).toHaveLength(1));
			expect(patchBodies[0]).toMatchObject({ cookingWaterRule: DEFAULT_COOKING_WATER_RULE });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
