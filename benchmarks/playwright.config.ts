import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const profile = process.env.BENCHMARK_PROFILE ?? 'realistic';
const mode = process.env.BENCHMARK_MODE ?? 'local-throttled';
const apiPort = process.env.BENCHMARK_API_PORT ?? '4000';
const webPort = process.env.BENCHMARK_WEB_PORT ?? '5173';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
	testDir: '.',
	testMatch: /frontend\.playwright\.ts/,
	timeout: 180_000,
	expect: {
		timeout: 90_000,
	},
	use: {
		baseURL: `http://127.0.0.1:${webPort}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	webServer: [
		{
			command: `bun benchmarks/server.ts --seed --profile ${profile} --mode ${mode} --api-port ${apiPort}`,
			cwd: projectRoot,
			url: `http://127.0.0.1:${apiPort}/api/health`,
			reuseExistingServer: false,
			timeout: 240_000,
		},
		{
			command: `bun run dev -- --host 127.0.0.1 --port ${webPort}`,
			cwd: projectRoot,
			url: `http://127.0.0.1:${webPort}`,
			reuseExistingServer: false,
			timeout: 120_000,
		},
	],
	reporter: [['list']],
});
