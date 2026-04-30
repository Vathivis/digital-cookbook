import { applyBenchmarkEnv, getBenchmarkOptions, readCliArgs } from './config';
import { ensureBenchmarkDatabase } from './seed';

type ServerApp = {
	listen: (options: { hostname: string; port: number }) => unknown;
	stop?: () => Promise<void> | void;
};

const args = readCliArgs();
const options = getBenchmarkOptions();
applyBenchmarkEnv(options);

const { app, database } = await import(`../server/index.ts?benchmark-server=${Date.now()}`);

if (args.has('seed')) {
	const summary = await ensureBenchmarkDatabase(database, options, args.has('force'));
	const prefix = summary.cached ? 'Using cached seed' : 'Seeded';
	const suffix = summary.cached ? '' : ` in ${Math.round(summary.durationMs)} ms`;
	console.log(`${prefix} ${summary.recipes} recipes for benchmark server${suffix}`);
}

const serverApp = app as ServerApp;
serverApp.listen({ hostname: '127.0.0.1', port: options.apiPort });
console.log(`Benchmark API listening on ${options.baseUrl}`);

const shutdown = async () => {
	await serverApp.stop?.();
	database.close();
	process.exit(0);
};

process.on('SIGINT', () => {
	void shutdown();
});
process.on('SIGTERM', () => {
	void shutdown();
});
