import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import {
	applyBenchmarkEnv,
	contentTypeForFile,
	ensureDir,
	getBenchmarkOptions,
	readCliArgs,
	type BenchmarkOptions,
} from './config';

type Statement = {
	run: (...params: unknown[]) => { lastInsertRowid?: number | bigint; changes?: number };
	get: (...params: unknown[]) => unknown;
	finalize: () => void;
};

type BenchmarkDatabase = {
	exec: (sql: string) => void;
	prepare: (sql: string) => Statement;
	close?: () => void;
};

type SeedSummary = {
	cookbookId: number;
	recipes: number;
	images: number;
	durationMs: number;
	dbPath: string;
	cached: boolean;
};

type ImageFixture = {
	name: string;
	filePath: string;
	contentType: string;
	size: number;
	mtimeMs: number;
};

type SeedCache = {
	version: number;
	cacheKey: string;
	createdAt: string;
	summary: Omit<SeedSummary, 'durationMs' | 'cached'>;
};

class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	next() {
		this.state = (1664525 * this.state + 1013904223) >>> 0;
		return this.state / 0x100000000;
	}

	int(min: number, max: number) {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}

	pick<T>(items: T[]) {
		return items[this.int(0, items.length - 1)];
	}

	sample<T>(items: T[], count: number) {
		const copy = [...items];
		const result: T[] = [];
		while (copy.length && result.length < count) {
			const index = this.int(0, copy.length - 1);
			const [item] = copy.splice(index, 1);
			result.push(item);
		}
		return result;
	}
}

const dishes = [
	'Pomodoro Pasta',
	'Sunday Stew',
	'Karelian Pasty',
	'Sardinian Supper',
	'Roasted Chicken',
	'Bean Chili',
	'Garlic Noodles',
	'Garden Risotto',
	'Family Burger',
	'Lemon Cake',
	'Pepper Soup',
	'Herb Omelette',
];

const ingredients = [
	'tomato',
	'spaghetti',
	'basil',
	'garlic',
	'olive oil',
	'onion',
	'butter',
	'flour',
	'egg',
	'milk',
	'parmesan',
	'chicken',
	'beef',
	'beans',
	'rice',
	'potato',
	'carrot',
	'celery',
	'lemon',
	'parsley',
	'oregano',
	'chili',
	'black pepper',
	'sea salt',
	'mushroom',
	'cream',
	'paprika',
	'cheddar',
	'rye flour',
	'cucumber',
];

const units = ['g', 'ml', 'tbsp', 'tsp', 'cup', 'pcs', 'pinch'];
const tags = ['quick', 'dinner', 'lunch', 'pasta', 'vegetarian', 'family', 'weekend', 'dessert', 'spicy', 'comfort'];
const likes = ['Alex', 'Jamie', 'Mira', 'Vojta', 'Tereza', 'Klara', 'Matej', 'Nina'];
const verbs = ['Chop', 'Warm', 'Mix', 'Fold', 'Simmer', 'Bake', 'Season', 'Rest', 'Serve', 'Whisk'];
const seedCacheVersion = 1;

function lastInsertId(info: { lastInsertRowid?: number | bigint }) {
	return Number(info.lastInsertRowid ?? 0);
}

function listImageFixtures(options: BenchmarkOptions): ImageFixture[] {
	if (options.imageMode === 'none') return [];
	if (!fs.existsSync(options.imagesDir)) {
		throw new Error(`Benchmark image directory does not exist: ${options.imagesDir}`);
	}
	const imageFiles = fs
		.readdirSync(options.imagesDir)
		.filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
		.sort();
	if (!imageFiles.length) {
		throw new Error(`No jpg/png/webp images found in ${options.imagesDir}`);
	}
	return imageFiles.map((name) => {
		const filePath = path.join(options.imagesDir, name);
		const stat = fs.statSync(filePath);
		return {
			name,
			filePath,
			contentType: contentTypeForFile(filePath),
			size: stat.size,
			mtimeMs: Math.round(stat.mtimeMs),
		};
	});
}

function loadImages(options: BenchmarkOptions) {
	return listImageFixtures(options).map((fixture) => {
		const bytes = fs.readFileSync(fixture.filePath);
		return `data:${fixture.contentType};base64,${bytes.toString('base64')}`;
	});
}

function seedCachePath(options: BenchmarkOptions) {
	return `${options.dbPath}.seed.json`;
}

function seedCacheKey(options: BenchmarkOptions) {
	const imageFixtures = listImageFixtures(options).map(({ name, size, mtimeMs, contentType }) => ({
		name,
		size,
		mtimeMs,
		contentType,
	}));
	return JSON.stringify({
		version: seedCacheVersion,
		profile: options.name,
		recipes: options.recipes,
		seed: options.seed,
		minIngredients: options.minIngredients,
		maxIngredients: options.maxIngredients,
		minSteps: options.minSteps,
		maxSteps: options.maxSteps,
		tagsPerRecipe: options.tagsPerRecipe,
		likesPerRecipe: options.likesPerRecipe,
		imageMode: options.imageMode,
		thumbnailMode: options.thumbnailMode,
		imagesDir: path.resolve(options.imagesDir),
		imageFixtures,
	});
}

function readSeedCache(options: BenchmarkOptions) {
	const markerPath = seedCachePath(options);
	if (!fs.existsSync(markerPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(markerPath, 'utf8')) as SeedCache;
	} catch {
		return null;
	}
}

function writeSeedCache(options: BenchmarkOptions, cacheKey: string, summary: SeedSummary) {
	const cache: SeedCache = {
		version: seedCacheVersion,
		cacheKey,
		createdAt: new Date().toISOString(),
		summary: {
			cookbookId: summary.cookbookId,
			recipes: summary.recipes,
			images: summary.images,
			dbPath: summary.dbPath,
		},
	};
	fs.writeFileSync(seedCachePath(options), `${JSON.stringify(cache, null, 2)}\n`);
}

function thumbnailDataUrl(index: number, title: string, color: string) {
	const escapedTitle = title.replace(/[<>&'"]/g, '');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="${color}"/><text x="24" y="168" font-family="Arial" font-size="26" fill="#fff">Recipe ${index}</text><text x="24" y="208" font-family="Arial" font-size="18" fill="#fff">${escapedTitle.slice(0, 32)}</text></svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function clearDatabase(database: BenchmarkDatabase) {
	database.exec('PRAGMA foreign_keys = OFF');
	database.exec('BEGIN TRANSACTION');
	try {
		for (const table of ['recipe_tags', 'recipe_likes', 'ingredients', 'steps', 'notes', 'recipes', 'tags', 'ingredient_names', 'cookbooks']) {
			database.exec(`DELETE FROM ${table}`);
		}
		database.exec("DELETE FROM sqlite_sequence WHERE name IN ('cookbooks','recipes','tags','ingredient_names','ingredients','steps','notes','recipe_likes')");
		database.exec('COMMIT');
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	} finally {
		database.exec('PRAGMA foreign_keys = ON');
	}
}

export async function seedBenchmarkDatabase(database: BenchmarkDatabase, options: BenchmarkOptions): Promise<SeedSummary> {
	const started = performance.now();
	ensureDir(path.dirname(options.dbPath));
	const imageDataUrls = loadImages(options);
	const rng = new Rng(options.seed);

	clearDatabase(database);

	const insertCookbook = database.prepare('INSERT INTO cookbooks (name) VALUES (?)');
	const insertRecipe = database.prepare(
		'INSERT INTO recipes (cookbook_id, title, description, author, photo, photo_thumbnail, uses, servings) VALUES (?,?,?,?,?,?,?,?)'
	);
	const insertIngredientName = database.prepare('INSERT OR IGNORE INTO ingredient_names (name) VALUES (?)');
	const getIngredientName = database.prepare('SELECT id FROM ingredient_names WHERE name = ?');
	const insertIngredient = database.prepare(
		'INSERT INTO ingredients (recipe_id, ingredient_id, line, quantity, unit, name, position) VALUES (?,?,?,?,?,?,?)'
	);
	const insertStep = database.prepare('INSERT INTO steps (recipe_id, instruction, position) VALUES (?,?,?)');
	const insertNote = database.prepare('INSERT INTO notes (recipe_id, content) VALUES (?,?)');
	const insertTag = database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
	const getTag = database.prepare('SELECT id FROM tags WHERE name = ?');
	const linkTag = database.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?,?)');
	const insertLike = database.prepare('INSERT OR IGNORE INTO recipe_likes (recipe_id, name) VALUES (?,?)');

	try {
		database.exec('BEGIN TRANSACTION');
		const cookbookId = lastInsertId(insertCookbook.run('Benchmark Cookbook'));

		for (let recipeIndex = 1; recipeIndex <= options.recipes; recipeIndex += 1) {
			const dish = recipeIndex % 5 === 0 ? 'Pomodoro Pasta' : rng.pick(dishes);
			const title = `Benchmark Recipe ${String(recipeIndex).padStart(4, '0')} ${dish}`;
			const selectedImage = imageDataUrls.length ? rng.pick(imageDataUrls) : null;
			const photo = options.imageMode === 'full' ? selectedImage : null;
			const thumbnail =
				options.thumbnailMode === 'full'
					? photo
					: options.thumbnailMode === 'generated'
						? thumbnailDataUrl(recipeIndex, title, `hsl(${rng.int(0, 359)},65%,42%)`)
						: null;
			const recipeId = lastInsertId(
				insertRecipe.run(
					cookbookId,
					title,
					`Generated benchmark recipe ${recipeIndex} for measuring list, search, edit, and photo payload behavior.`,
					`Benchmark Author ${rng.int(1, 12)}`,
					photo,
					thumbnail,
					rng.int(0, 35),
					rng.int(1, 8)
				)
			);

			const ingredientCount = rng.int(options.minIngredients, options.maxIngredients);
			const selectedIngredients = rng.sample(ingredients, ingredientCount);
			selectedIngredients.forEach((name, position) => {
				const quantity = rng.int(1, 6);
				const unit = rng.pick(units);
				const line = `${quantity} ${unit} ${name}`;
				insertIngredientName.run(name);
				const ingredientRow = getIngredientName.get(name) as { id: number } | undefined;
				insertIngredient.run(recipeId, ingredientRow?.id ?? null, line, quantity, unit, name, position);
			});

			const stepCount = rng.int(options.minSteps, options.maxSteps);
			for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
				const verb = rng.pick(verbs);
				const ingredient = rng.pick(selectedIngredients);
				insertStep.run(recipeId, `${verb} the ${ingredient} and continue until the texture looks right.`, stepIndex);
			}

			insertNote.run(recipeId, `Benchmark note ${recipeIndex}: generated to keep realistic detail payloads.`);

			for (const tag of rng.sample(tags, options.tagsPerRecipe)) {
				insertTag.run(tag);
				const tagRow = getTag.get(tag) as { id: number } | undefined;
				if (tagRow) linkTag.run(recipeId, tagRow.id);
			}

			for (const name of rng.sample(likes, options.likesPerRecipe)) {
				insertLike.run(recipeId, name);
			}
		}

		database.exec('COMMIT');
		return {
			cookbookId,
			recipes: options.recipes,
			images: imageDataUrls.length,
			durationMs: performance.now() - started,
			dbPath: options.dbPath,
			cached: false,
		};
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	} finally {
		for (const statement of [
			insertCookbook,
			insertRecipe,
			insertIngredientName,
			getIngredientName,
			insertIngredient,
			insertStep,
			insertNote,
			insertTag,
			getTag,
			linkTag,
			insertLike,
		]) {
			statement.finalize();
		}
	}
}

export async function ensureBenchmarkDatabase(database: BenchmarkDatabase, options: BenchmarkOptions, force = false): Promise<SeedSummary> {
	ensureDir(path.dirname(options.dbPath));
	const cacheKey = seedCacheKey(options);
	const cache = readSeedCache(options);
	if (!force && fs.existsSync(options.dbPath) && cache?.version === seedCacheVersion && cache.cacheKey === cacheKey) {
		return {
			...cache.summary,
			durationMs: 0,
			cached: true,
		};
	}
	const summary = await seedBenchmarkDatabase(database, options);
	writeSeedCache(options, cacheKey, summary);
	return summary;
}

if (import.meta.main) {
	const options = getBenchmarkOptions();
	const args = readCliArgs();
	applyBenchmarkEnv(options);
	const { database } = await import(`../server/index.ts?benchmark-seed=${Date.now()}`);
	const summary = await ensureBenchmarkDatabase(database as BenchmarkDatabase, options, args.has('force'));
	const prefix = summary.cached ? 'Using cached seed' : 'Seeded';
	const suffix = summary.cached ? '' : ` in ${Math.round(summary.durationMs)} ms`;
	console.log(`${prefix} ${summary.recipes} recipes with ${summary.images} image fixtures${suffix} at ${summary.dbPath}`);
	database.close();
}
