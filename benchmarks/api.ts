import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
	applyBenchmarkEnv,
	contentTypeForFile,
	getBenchmarkOptions,
	type BenchmarkOptions,
} from './config';
import { writeBenchmarkReport, type ApiCallMetric } from './report';

type RecipeSummary = {
	id: number;
	title: string;
	ingredients?: unknown[];
	steps?: string[];
};

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
				? 'data:image/svg+xml;base64,' +
					Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#446"/></svg>').toString(
						'base64'
					)
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
	const calls: ApiCallMetric[] = [];
	const record = async (label: string, pathname: string, init?: RequestInit) => {
		const result = await timedFetch(options, label, pathname, init);
		calls.push(result.metric);
		return result.text;
	};

	for (let iteration = 0; iteration < options.iterations; iteration += 1) {
		await record('health', '/api/health');
		await record('cookbooks:list', '/api/cookbooks');
		const listText = await record('recipes:list', '/api/recipes?cookbookId=1');
		const recipes = parseJson<RecipeSummary[]>(listText, []);
		const target = recipes[Math.min(20, Math.max(0, recipes.length - 1))];
		const targetId = target?.id ?? 1;
		await record('recipes:search:pomodoro', '/api/recipes/search?cookbookId=1&q=pomodoro');
		await record('recipes:search:tomato', '/api/recipes/search?cookbookId=1&q=tomato');
		await record('ingredients:suggest', '/api/ingredients?cookbookId=1&q=tom&limit=20');
		await record('recipes:detail', `/api/recipes/${targetId}`);
	}

	const imagePayload = await loadImagePayload(options);

	for (let iteration = 0; iteration < options.iterations; iteration += 1) {
		const scratch = buildScratchRecipe(iteration, imagePayload);
		const createText = await record('recipe:create:with-image', '/api/recipes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(scratch),
		});
		const created = parseJson<{ id?: number }>(createText, {});
		if (typeof created.id !== 'number') continue;
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

	return calls;
}

if (import.meta.main) {
	const options = getBenchmarkOptions();
	applyBenchmarkEnv(options);
	const { app, database } = await import(`../server/index.ts?benchmark-api=${Date.now()}`);
	const serverApp = app as ServerApp;
	serverApp.listen({ hostname: '127.0.0.1', port: options.apiPort });
	try {
		await waitForServer(options);
		const apiCalls = await runScenarioSet(options);
		const written = writeBenchmarkReport(options, {
			name: 'benchmark-backend-api',
			startedAt,
			options,
			apiCalls,
			notes: [
				`Measured every direct benchmark API call against ${options.baseUrl}.`,
				'Read scenarios and mutation scenarios both scale with --iterations.',
				'Each mutation iteration creates a scratch recipe, edits it, and records a timed cleanup delete so the seeded recipe set stays stable.',
			],
		});
		console.log(`Wrote API benchmark report: ${written.mdPath}`);
	} finally {
		await serverApp.stop?.();
		database.close();
	}
}
