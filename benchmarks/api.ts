import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
	applyBenchmarkEnv,
	contentTypeForFile,
	getBenchmarkOptions,
	type BenchmarkOptions,
} from './config';
import { writeBenchmarkReport, type ApiCallMetric, type IterationMetric } from './report';

type RecipeSummary = {
	id: number;
	title: string;
	photo?: string | null;
	photoFull?: string | null;
	photoDetail?: string | null;
	ingredients?: unknown[];
	steps?: string[];
};

const generatedThumbnailDataUrl =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

type RecipeInput = {
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	servings: number;
	ingredients: Array<{ line: string; quantity: number; unit: string; name: string }>;
	steps: string[];
	notes: string;
	tags: string[];
	photoDataUrl?: string;
	photoThumbnailDataUrl?: string;
};

type ServerApp = {
	listen: (options: { hostname: string; port: number }) => unknown;
	stop?: () => Promise<void> | void;
};

const startedAt = new Date().toISOString();

function requestBytes(body?: string) {
	return body ? Buffer.byteLength(body) : 0;
}

async function timedFetch(options: BenchmarkOptions, label: string, pathname: string, init: RequestInit = {}) {
	const method = init.method ?? 'GET';
	const body = typeof init.body === 'string' ? init.body : undefined;
	const started = performance.now();
	let status = 0;
	let responseBytes = 0;
	let ok = false;
	let error: string | undefined;
	let text = '';
	try {
		const response = await fetch(`${options.baseUrl}${pathname}`, init);
		status = response.status;
		ok = response.ok;
		text = await response.text();
		responseBytes = Buffer.byteLength(text);
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	}
	const metric: ApiCallMetric = {
		label,
		method,
		url: pathname,
		status,
		ok,
		durationMs: performance.now() - started,
		requestBytes: requestBytes(body),
		responseBytes,
		error,
	};
	return { metric, text };
}

async function waitForServer(options: BenchmarkOptions) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const { metric } = await timedFetch(options, 'wait:health', '/api/health');
		if (metric.ok) return;
		await Bun.sleep(250);
	}
	throw new Error(`Benchmark server did not become healthy at ${options.baseUrl}`);
}

function parseJson<T>(text: string, fallback: T) {
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
}

async function loadImagePayload(options: BenchmarkOptions) {
	if (options.imageMode === 'none') {
		return { photoDataUrl: undefined, photoThumbnailDataUrl: undefined };
	}
	const imageFiles = fs
		.readdirSync(options.imagesDir)
		.filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
		.sort();
	const selected = imageFiles[0];
	if (!selected) return { photoDataUrl: undefined, photoThumbnailDataUrl: undefined };
	const filePath = path.join(options.imagesDir, selected);
	const file = Bun.file(filePath);
	const bytes = Buffer.from(await file.arrayBuffer());
	const photoDataUrl = `data:${contentTypeForFile(filePath)};base64,${bytes.toString('base64')}`;
	const thumbnailDataUrl =
		options.thumbnailMode === 'full'
			? photoDataUrl
			: options.thumbnailMode === 'generated'
				? generatedThumbnailDataUrl
				: undefined;
	return { photoDataUrl, photoThumbnailDataUrl: thumbnailDataUrl };
}

function buildScratchRecipe(iteration: number, imagePayload: Awaited<ReturnType<typeof loadImagePayload>>): RecipeInput {
	const ingredientNames = [
		'tomato',
		'spaghetti',
		'basil',
		'garlic',
		'olive oil',
		'onion',
		'parmesan',
		'black pepper',
		'sea salt',
		'oregano',
		'butter',
		'lemon',
		'parsley',
		'chili',
		'mushroom',
		'cream',
		'paprika',
		'carrot',
		'celery',
		'flour',
	];
	const units = ['g', 'ml', 'tbsp', 'tsp', 'cup'];
	const ingredients = ingredientNames.map((name, index) => {
		const quantity = (index % 5) + 1;
		const unit = units[index % units.length];
		return {
			line: `${quantity} ${unit} ${name}`,
			quantity,
			unit,
			name,
		};
	});
	const steps = Array.from({ length: 10 }, (_, index) => `Benchmark step ${index + 1}: prepare ingredient ${ingredients[index * 2]?.name ?? 'tomato'}.`);
	return {
		cookbook_id: 1,
		title: `Benchmark Scratch Recipe ${Date.now()}-${iteration}`,
		description: 'Created by benchmark:api and deleted during timed cleanup.',
		author: 'Benchmark Harness',
		servings: 4,
		ingredients,
		steps,
		notes: 'Scratch recipe used for timed mutation and cleanup paths.',
		tags: ['benchmark', 'scratch', 'cleanup'],
		...imagePayload,
	};
}

async function runScenarioSet(options: BenchmarkOptions) {
	const scenarioStarted = performance.now();
	const calls: ApiCallMetric[] = [];
	const iterationTimings: IterationMetric[] = [];
	const readDurations: number[] = [];
	const mutationDurations: number[] = [];
	const record = async (label: string, pathname: string, init?: RequestInit) => {
		const result = await timedFetch(options, label, pathname, init);
		calls.push(result.metric);
		return result.text;
	};

	for (let iteration = 0; iteration < options.iterations; iteration += 1) {
		const iterationStarted = performance.now();
		await record('health:root', '/health');
		await record('health', '/api/health');
		await record('auth:status', '/api/auth/status');
		await record('auth:login', '/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'benchmark', password: 'benchmark' }),
		});
		await record('auth:logout', '/api/auth/logout', { method: 'POST' });
		await record('cookbooks:list', '/api/cookbooks');
		const listText = await record('recipes:list', '/api/recipes?cookbookId=1');
		const recipes = parseJson<RecipeSummary[]>(listText, []);
		const target = recipes[Math.min(20, Math.max(0, recipes.length - 1))];
		const targetId = target?.id ?? 1;
		await record('recipes:search:pomodoro', '/api/recipes/search?cookbookId=1&q=pomodoro');
		await record('recipes:search:tomato', '/api/recipes/search?cookbookId=1&q=tomato');
		await record('ingredients:suggest', '/api/ingredients?cookbookId=1&q=tom&limit=20');
		const detailText = await record('recipes:detail', `/api/recipes/${targetId}`);
		const detail = parseJson<RecipeSummary>(detailText, {} as RecipeSummary);
		if (target?.photo) {
			await record('recipes:photo:thumbnail-card', target.photo);
		}
		if (detail.photoFull) {
			await record('recipes:photo:full', detail.photoFull);
		}
		if (detail.photoDetail) {
			await record('recipes:photo:thumbnail-detail', detail.photoDetail);
		}
		await record('tags:list', '/api/tags');
		await record('ingredients:list-global', '/api/ingredients?limit=50');
		const durationMs = performance.now() - iterationStarted;
		readDurations[iteration] = durationMs;
		iterationTimings.push({ label: 'read iteration', iteration, durationMs });
	}

	const imagePayload = await loadImagePayload(options);

	for (let iteration = 0; iteration < options.iterations; iteration += 1) {
		const iterationStarted = performance.now();
		const cookbookName = `Benchmark Scratch Cookbook ${Date.now()}-${iteration}`;
		const cookbookText = await record('cookbook:create', '/api/cookbooks', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: cookbookName }),
		});
		const cookbook = parseJson<{ id?: number }>(cookbookText, {});
		if (typeof cookbook.id === 'number') {
			await record('cookbook:patch', `/api/cookbooks/${cookbook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: `${cookbookName} Updated` }),
			});
			await record('cookbook:delete', `/api/cookbooks/${cookbook.id}`, { method: 'DELETE' });
		}
		const scratch = buildScratchRecipe(iteration, imagePayload);
		const createText = await record('recipe:create:with-image', '/api/recipes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(scratch),
		});
		const created = parseJson<{ id?: number }>(createText, {});
		if (typeof created.id === 'number') {
			const tagName = `benchmark-tag-${iteration}`;
			const likeName = `Benchmark Like ${iteration}`;
			await record('recipe:tag:add', `/api/recipes/${created.id}/tags`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: tagName }),
			});
			await record('recipe:tag:delete', `/api/recipes/${created.id}/tags/${encodeURIComponent(tagName)}`, { method: 'DELETE' });
			await record('recipe:like:add', `/api/recipes/${created.id}/likes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: likeName }),
			});
			await record('recipe:like:delete', `/api/recipes/${created.id}/likes/${encodeURIComponent(likeName)}`, { method: 'DELETE' });
			await record('uses:increment', `/api/recipes/${created.id}/increment-uses`, { method: 'POST' });
			await record('uses:decrement', `/api/recipes/${created.id}/decrement-uses`, { method: 'POST' });
			await record('recipe:patch:scalar', `/api/recipes/${created.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ description: `Benchmark scalar edit ${Date.now()}-${iteration}` }),
			});
			await record('recipe:patch-reorder:detail', `/api/recipes/${created.id}`);
			await record('recipe:patch:reorder', `/api/recipes/${created.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ingredients: [...scratch.ingredients].reverse(),
					steps: [...scratch.steps].reverse(),
				}),
			});
			await record('recipe:cleanup:delete', `/api/recipes/${created.id}`, { method: 'DELETE' });
		}
		const durationMs = performance.now() - iterationStarted;
		mutationDurations[iteration] = durationMs;
		iterationTimings.push({ label: 'mutation iteration', iteration, durationMs });
	}

	for (let iteration = 0; iteration < options.iterations; iteration += 1) {
		const readMs = readDurations[iteration];
		const mutationMs = mutationDurations[iteration];
		if (readMs == null || mutationMs == null) continue;
		iterationTimings.push({ label: 'read + mutation iteration', iteration, durationMs: readMs + mutationMs });
	}

	return {
		calls,
		iterationTimings,
		totalDurationMs: performance.now() - scenarioStarted,
	};
}

if (import.meta.main) {
	const options = getBenchmarkOptions();
	applyBenchmarkEnv(options);
	const { app, database } = await import(`../server/index.ts?benchmark-api=${Date.now()}`);
	const serverApp = app as ServerApp;
	serverApp.listen({ hostname: '127.0.0.1', port: options.apiPort });
	try {
		await waitForServer(options);
		const { calls: apiCalls, iterationTimings, totalDurationMs } = await runScenarioSet(options);
		const written = writeBenchmarkReport(options, {
			name: 'benchmark-backend-api',
			startedAt,
			options,
			totalDurationMs,
			apiCalls,
			iterationTimings,
			notes: [
				`Measured every direct benchmark API call against ${options.baseUrl}.`,
				'Read scenarios and mutation scenarios both scale with --iterations.',
				'Photo variant endpoints are fetched per read iteration when present, including full-size photo responses.',
				'Each mutation iteration creates a scratch recipe, edits it, and records a timed cleanup delete so the seeded recipe set stays stable.',
			],
		});
		console.log(`Wrote API benchmark report: ${written.mdPath}`);
	} finally {
		await serverApp.stop?.();
		database.close();
	}
}
