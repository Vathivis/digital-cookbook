import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type BenchmarkMode = 'local-fast' | 'local-throttled' | 'remote-smoke';
export type BenchmarkProfileName = 'small' | 'realistic' | 'stress' | 'photo-heavy';
export type ImageMode = 'none' | 'full';
export type ThumbnailMode = 'generated' | 'none' | 'full';

export type BenchmarkProfile = {
	name: BenchmarkProfileName;
	recipes: number;
	minIngredients: number;
	maxIngredients: number;
	minSteps: number;
	maxSteps: number;
	tagsPerRecipe: number;
	likesPerRecipe: number;
	imageMode: ImageMode;
	thumbnailMode: ThumbnailMode;
};

export type BenchmarkOptions = BenchmarkProfile & {
	runName?: string;
	mode: BenchmarkMode;
	seed: number;
	dbPath: string;
	apiPort: number;
	webPort: number;
	baseUrl: string;
	projectRoot: string;
	imagesDir: string;
	resultsDir: string;
	iterations: number;
	apiDelayMs: number;
};

export const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(benchmarkDir, '..');

const profiles: Record<BenchmarkProfileName, BenchmarkProfile> = {
	small: {
		name: 'small',
		recipes: 50,
		minIngredients: 6,
		maxIngredients: 12,
		minSteps: 4,
		maxSteps: 8,
		tagsPerRecipe: 2,
		likesPerRecipe: 1,
		imageMode: 'full',
		thumbnailMode: 'generated',
	},
	realistic: {
		name: 'realistic',
		recipes: 1000,
		minIngredients: 8,
		maxIngredients: 20,
		minSteps: 5,
		maxSteps: 12,
		tagsPerRecipe: 3,
		likesPerRecipe: 2,
		imageMode: 'full',
		thumbnailMode: 'generated',
	},
	stress: {
		name: 'stress',
		recipes: 2000,
		minIngredients: 10,
		maxIngredients: 26,
		minSteps: 6,
		maxSteps: 16,
		tagsPerRecipe: 5,
		likesPerRecipe: 4,
		imageMode: 'full',
		thumbnailMode: 'generated',
	},
	'photo-heavy': {
		name: 'photo-heavy',
		recipes: 1000,
		minIngredients: 8,
		maxIngredients: 20,
		minSteps: 5,
		maxSteps: 12,
		tagsPerRecipe: 3,
		likesPerRecipe: 2,
		imageMode: 'full',
		thumbnailMode: 'none',
	},
};

const asProfileName = (value: string | undefined): BenchmarkProfileName =>
	value && value in profiles ? (value as BenchmarkProfileName) : 'realistic';

const asMode = (value: string | undefined): BenchmarkMode => {
	if (value === 'local-throttled' || value === 'remote-smoke') return value;
	return 'local-fast';
};

const asImageMode = (value: string | undefined, fallback: ImageMode): ImageMode =>
	value === 'none' || value === 'full' ? value : fallback;

const asThumbnailMode = (value: string | undefined, fallback: ThumbnailMode): ThumbnailMode =>
	value === 'generated' || value === 'none' || value === 'full' ? value : fallback;

const intOption = (value: string | undefined, fallback: number, min = 0) => {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
};

const textOption = (value: string | undefined) => {
	const trimmed = value?.trim();
	return trimmed && trimmed !== 'true' ? trimmed : undefined;
};

export function readCliArgs(argv = Bun.argv.slice(2)) {
	const result = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const current = argv[i];
		if (!current.startsWith('--')) continue;
		const inline = current.indexOf('=');
		if (inline > 2) {
			result.set(current.slice(2, inline), current.slice(inline + 1));
			continue;
		}
		const key = current.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			result.set(key, 'true');
			continue;
		}
		result.set(key, next);
		i += 1;
	}
	return result;
}

export function getBenchmarkOptions(argv = Bun.argv.slice(2)): BenchmarkOptions {
	const args = readCliArgs(argv);
	const profileName = asProfileName(args.get('profile') ?? process.env.BENCHMARK_PROFILE);
	const profile = profiles[profileName];
	const dbPath = path.resolve(
		projectRoot,
		args.get('db-path') ?? process.env.COOKBOOK_DB_PATH ?? 'data/benchmark/cookbook.db'
	);
	const apiPort = intOption(args.get('api-port') ?? args.get('port') ?? process.env.BENCHMARK_API_PORT, 4000, 1);
	const webPort = intOption(args.get('web-port') ?? process.env.BENCHMARK_WEB_PORT, 5173, 1);
	const mode = asMode(args.get('mode') ?? process.env.BENCHMARK_MODE);
	const apiDelayMs = intOption(
		args.get('api-delay-ms') ?? process.env.BENCHMARK_API_DELAY_MS,
		mode === 'local-throttled' ? 150 : 0,
		0
	);
	const recipes = intOption(args.get('recipes') ?? process.env.BENCHMARK_RECIPES, profile.recipes, 1);

	return {
		...profile,
		runName: textOption(args.get('name') ?? process.env.BENCHMARK_RUN_NAME),
		recipes,
		mode,
		seed: intOption(args.get('seed') ?? process.env.BENCHMARK_SEED, 20260430, 1),
		dbPath,
		apiPort,
		webPort,
		baseUrl: args.get('base-url') ?? process.env.BENCHMARK_BASE_URL ?? `http://127.0.0.1:${apiPort}`,
		projectRoot,
		imagesDir: path.resolve(projectRoot, args.get('images-dir') ?? process.env.BENCHMARK_IMAGES_DIR ?? 'benchmarks/images'),
		resultsDir: path.resolve(projectRoot, args.get('results-dir') ?? process.env.BENCHMARK_RESULTS_DIR ?? 'benchmark-results'),
		iterations: intOption(args.get('iterations') ?? process.env.BENCHMARK_ITERATIONS, 3, 1),
		imageMode: asImageMode(args.get('image-mode') ?? process.env.BENCHMARK_IMAGE_MODE, profile.imageMode),
		thumbnailMode: asThumbnailMode(args.get('thumbnail-mode') ?? process.env.BENCHMARK_THUMBNAIL_MODE, profile.thumbnailMode),
		apiDelayMs,
	};
}

export function applyBenchmarkEnv(options: BenchmarkOptions) {
	process.env.COOKBOOK_DB_PATH = options.dbPath;
	process.env.AUTH_ENABLED = 'false';
	process.env.SERVE_STATIC = 'false';
	process.env.HOST = '127.0.0.1';
	process.env.PORT = String(options.apiPort);
	process.env.PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH = '50000000';
}

export function ensureDir(dir: string) {
	fs.mkdirSync(dir, { recursive: true });
}

export function contentTypeForFile(filePath: string) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.png') return 'image/png';
	if (ext === '.webp') return 'image/webp';
	return 'application/octet-stream';
}
