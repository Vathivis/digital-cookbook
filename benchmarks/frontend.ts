import { readCliArgs } from './config';

const args = readCliArgs();
const env = { ...process.env };

const envMap: Record<string, string> = {
	name: 'BENCHMARK_RUN_NAME',
	profile: 'BENCHMARK_PROFILE',
	mode: 'BENCHMARK_MODE',
	recipes: 'BENCHMARK_RECIPES',
	seed: 'BENCHMARK_SEED',
	'api-port': 'BENCHMARK_API_PORT',
	'web-port': 'BENCHMARK_WEB_PORT',
	'api-delay-ms': 'BENCHMARK_API_DELAY_MS',
	'image-mode': 'BENCHMARK_IMAGE_MODE',
	'thumbnail-mode': 'BENCHMARK_THUMBNAIL_MODE',
	'db-path': 'COOKBOOK_DB_PATH',
	'images-dir': 'BENCHMARK_IMAGES_DIR',
	'results-dir': 'BENCHMARK_RESULTS_DIR',
};

for (const [argName, envName] of Object.entries(envMap)) {
	const value = args.get(argName);
	if (value != null && value !== 'true') env[envName] = value;
}

if (args.has('force')) {
	env.BENCHMARK_FORCE = 'true';
}

const child = Bun.spawn(['bunx', 'playwright', 'test', '-c', 'benchmarks/playwright.config.ts'], {
	stdout: 'inherit',
	stderr: 'inherit',
	stdin: 'inherit',
	env,
});

process.exit(await child.exited);
