import { expect, test, type Page } from '@playwright/test';
import { getBenchmarkOptions } from './config';
import { writeBenchmarkReport, type ApiCallMetric, type InteractionMetric } from './report';

type BrowserApiCall = ApiCallMetric & {
	startTime: number;
	headersDurationMs: number;
	bodyDurationMs?: number;
	bodyDone?: boolean;
};

declare global {
	interface Window {
		__benchmarkApiCalls: BrowserApiCall[];
	}
}

const options = getBenchmarkOptions([]);
const startedAt = new Date().toISOString();

function buildScratchRecipe(title: string) {
	return {
		cookbook_id: 1,
		title,
		description: 'Created by the frontend benchmark and removed during timed cleanup.',
		author: 'Benchmark Harness',
		servings: 4,
		ingredients: [
			{ line: '400 g tomato', quantity: 400, unit: 'g', name: 'tomato' },
			{ line: '320 g spaghetti', quantity: 320, unit: 'g', name: 'spaghetti' },
			{ line: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', name: 'olive oil' },
			{ line: '1 tbsp basil', quantity: 1, unit: 'tbsp', name: 'basil' },
		],
		steps: [
			'Warm the oil.',
			'Cook the tomato sauce.',
			'Boil the pasta.',
			'Combine and finish.',
		],
		notes: 'Scratch recipe used for UI mutation and cleanup timing.',
		tags: ['benchmark', 'ui', 'cleanup'],
	};
}

async function installFetchInstrumentation(page: Page) {
	await page.addInitScript(() => {
		window.__benchmarkApiCalls = [];
		const originalFetch = window.fetch.bind(window);
		window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const started = performance.now();
			const method =
				init?.method ??
				(input instanceof Request ? input.method : 'GET');
			const rawUrl = input instanceof Request ? input.url : String(input);
			const url = rawUrl.startsWith('http') ? new URL(rawUrl).pathname + new URL(rawUrl).search : rawUrl;
			const requestBody = typeof init?.body === 'string' ? new Blob([init.body]).size : 0;
			const call: BrowserApiCall = {
				label: url,
				method,
				url,
				status: 0,
				ok: false,
				durationMs: 0,
				headersDurationMs: 0,
				requestBytes: requestBody,
				responseBytes: 0,
				startTime: started,
			};
			window.__benchmarkApiCalls.push(call);
			try {
				const response = await originalFetch(input, init);
				const headersDone = performance.now();
				call.status = response.status;
				call.ok = response.ok;
				call.headersDurationMs = headersDone - started;
				call.durationMs = call.headersDurationMs;
				void response
					.clone()
					.arrayBuffer()
					.then((buffer) => {
						call.responseBytes = buffer.byteLength;
						call.bodyDurationMs = performance.now() - started;
						call.durationMs = call.bodyDurationMs;
						call.bodyDone = true;
					})
					.catch((error: unknown) => {
						call.error = error instanceof Error ? error.message : String(error);
						call.bodyDone = true;
					});
				return response;
			} catch (error) {
				call.error = error instanceof Error ? error.message : String(error);
				call.durationMs = performance.now() - started;
				call.bodyDone = true;
				throw error;
			}
		};
	});
}

async function apiCallCount(page: Page) {
	return page.evaluate(() => window.__benchmarkApiCalls.length);
}

async function measureInteraction(page: Page, label: string, interactions: InteractionMetric[], action: () => Promise<void>) {
	const before = await apiCallCount(page);
	const started = performance.now();
	await action();
	interactions.push({
		label,
		durationMs: performance.now() - started,
		apiCallsBefore: before,
		apiCallsAfter: await apiCallCount(page),
	});
}

async function waitForApiBodies(page: Page) {
	await page.waitForFunction(() => window.__benchmarkApiCalls.every((call) => call.bodyDone), undefined, { timeout: 30_000 });
}

test('critical UI flows record every browser API call', async ({ page }) => {
	const interactions: InteractionMetric[] = [];
	const scratchTitle = `Benchmark UI Scratch ${Date.now()}`;
	let scratchId: number | null = null;
	await installFetchInstrumentation(page);

	try {
		await measureInteraction(page, 'initial-load', interactions, async () => {
			await page.goto('/');
			await expect(page.getByPlaceholder('Search recipes...')).toBeVisible();
			await expect(page.getByText(/Benchmark Recipe 0001/).first()).toBeVisible();
		});

		await measureInteraction(page, 'search-pomodoro', interactions, async () => {
			await page.getByPlaceholder('Search recipes...').fill('pomodoro');
			await page.waitForTimeout(350);
			await expect(page.getByText(/Pomodoro/i).first()).toBeVisible();
		});

		await measureInteraction(page, 'create-scratch-recipe', interactions, async () => {
			const created = await page.evaluate(async (recipe) => {
				const response = await fetch('/api/recipes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(recipe),
				});
				if (!response.ok) throw new Error(await response.text());
				return (await response.json()) as { id?: number };
			}, buildScratchRecipe(scratchTitle));
			if (typeof created.id !== 'number') throw new Error('Scratch recipe create did not return an id');
			scratchId = created.id;
		});

		await measureInteraction(page, 'search-scratch-recipe', interactions, async () => {
			await page.getByPlaceholder('Search recipes...').fill(scratchTitle);
			await page.waitForTimeout(350);
			await expect(page.getByText(scratchTitle).first()).toBeVisible();
		});

		await measureInteraction(page, 'card-counter-increment', interactions, async () => {
			await page.getByRole('button', { name: 'Increase cook count' }).first().click();
			await page.waitForFunction(() => window.__benchmarkApiCalls.some((call) => call.url.includes('/increment-uses')));
		});

		await measureInteraction(page, 'open-detail', interactions, async () => {
			await page.getByText(scratchTitle).first().click();
			await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
		});

		await measureInteraction(page, 'save-scalar-edit', interactions, async () => {
			await page.getByRole('button', { name: 'Edit' }).click();
			const title = page.getByPlaceholder('Title');
			await title.fill(`${scratchTitle} Saved`);
			await page.getByRole('button', { name: 'Save' }).click();
			await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
		});

		if (scratchId != null) {
			const id = scratchId;
			await measureInteraction(page, 'cleanup-delete-scratch-recipe', interactions, async () => {
				const ok = await page.evaluate(async (recipeId) => {
					const response = await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
					return response.ok;
				}, id);
				if (!ok) throw new Error(`Scratch recipe cleanup failed for recipe ${id}`);
			});
			scratchId = null;
		}
	} finally {
		if (scratchId != null) {
			const id = scratchId;
			await page.evaluate(async (recipeId) => {
				await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' }).catch(() => undefined);
			}, id);
		}
	}

	await waitForApiBodies(page);
	const apiCalls = await page.evaluate(() => window.__benchmarkApiCalls);
	const written = writeBenchmarkReport(options, {
		name: 'benchmark-frontend-ui',
		startedAt,
		options,
		apiCalls,
		interactions,
		notes: [
			'API calls are captured by an injected window.fetch wrapper before the app loads.',
			'UI mutation flows use a scratch recipe and record a timed cleanup delete so the seeded recipe set stays stable.',
		],
	});
	console.log(`Wrote frontend benchmark report: ${written.mdPath}`);
});
