import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { chromium, type Browser, type Page } from 'playwright';
import { contentTypeForFile, getBenchmarkOptions, type BenchmarkOptions } from './config';
import { writeBenchmarkReport, type MemoryPhaseMetric, type MemorySampleMetric } from './report';

type Subprocess = ReturnType<typeof Bun.spawn>;

type ProcessTreeSample = {
	rssBytes: number;
	privateBytes?: number;
	processCount: number;
};

type MemoryRole = {
	role: string;
	pid: number | null;
};

const startedAt = new Date().toISOString();
const options = getBenchmarkOptions();
const rootStarted = performance.now();
const sampleIntervalMs = 500;
const generatedThumbnailDataUrl =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function benchmarkEnv() {
	return {
		...process.env,
		COOKBOOK_DB_PATH: options.dbPath,
		AUTH_ENABLED: 'false',
		SERVE_STATIC: 'false',
		HOST: '127.0.0.1',
		PORT: String(options.apiPort),
		PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH: '50000000',
		BENCHMARK_PROFILE: options.name,
		BENCHMARK_MODE: options.mode,
		BENCHMARK_RECIPES: String(options.recipes),
		BENCHMARK_SEED: String(options.seed),
		BENCHMARK_API_PORT: String(options.apiPort),
		BENCHMARK_WEB_PORT: String(options.webPort),
		BENCHMARK_IMAGE_MODE: options.imageMode,
		BENCHMARK_THUMBNAIL_MODE: options.thumbnailMode,
		BENCHMARK_IMAGES_DIR: options.imagesDir,
		BENCHMARK_RESULTS_DIR: options.resultsDir,
		...(options.runName ? { BENCHMARK_RUN_NAME: options.runName } : {}),
	};
}

async function waitForUrl(url: string, label: string) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Server not ready yet.
		}
		await Bun.sleep(250);
	}
	throw new Error(`${label} did not become ready at ${url}`);
}

async function runTextCommand(command: string[]) {
	const child = Bun.spawn(command, {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`${command.join(' ')} failed with exit code ${exitCode}: ${stderr}`);
	}
	return stdout;
}

async function sampleProcessTreeWindows(rootPid: number): Promise<ProcessTreeSample> {
	const script = `
$roots = @(${rootPid});
$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,Name;
$queue = [System.Collections.Generic.Queue[int]]::new();
$seen = @{};
foreach ($root in $roots) {
	if ($root -gt 0) {
		$queue.Enqueue([int]$root);
		$seen[[int]$root] = $true;
	}
}
$result = @();
while ($queue.Count -gt 0) {
	$pid = $queue.Dequeue();
	foreach ($process in $all | Where-Object { $_.ProcessId -eq $pid }) {
		$result += $process;
	}
	foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $pid }) {
		$childPid = [int]$child.ProcessId;
		if (-not $seen.ContainsKey($childPid)) {
			$seen[$childPid] = $true;
			$queue.Enqueue($childPid);
		}
	}
}
$result | ConvertTo-Json -Compress
`;
	const output = (await runTextCommand(['pwsh', '-NoLogo', '-NoProfile', '-Command', script])).trim();
	if (!output) return { rssBytes: 0, privateBytes: 0, processCount: 0 };
	const parsed = JSON.parse(output);
	const rows = Array.isArray(parsed) ? parsed : [parsed];
	return rows.reduce<ProcessTreeSample>(
		(acc, row) => ({
			rssBytes: acc.rssBytes + Number(row.WorkingSetSize ?? 0),
			privateBytes: (acc.privateBytes ?? 0) + Number(row.PrivatePageCount ?? 0),
			processCount: acc.processCount + 1,
		}),
		{ rssBytes: 0, privateBytes: 0, processCount: 0 }
	);
}

async function sampleProcessTreeUnix(rootPid: number): Promise<ProcessTreeSample> {
	const output = await runTextCommand(['ps', '-axo', 'pid=,ppid=,rss=,comm=']);
	const rows = output
		.trim()
		.split(/\r?\n/)
		.map((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
			if (!match) return null;
			return {
				pid: Number(match[1]),
				ppid: Number(match[2]),
				rssBytes: Number(match[3]) * 1024,
			};
		})
		.filter((row): row is { pid: number; ppid: number; rssBytes: number } => row !== null);
	const byParent = new Map<number, typeof rows>();
	for (const row of rows) {
		const children = byParent.get(row.ppid) ?? [];
		children.push(row);
		byParent.set(row.ppid, children);
	}
	const queue = [rootPid];
	const seen = new Set<number>();
	let rssBytes = 0;
	let processCount = 0;
	while (queue.length) {
		const pid = queue.shift()!;
		if (seen.has(pid)) continue;
		seen.add(pid);
		const row = rows.find((entry) => entry.pid === pid);
		if (row) {
			rssBytes += row.rssBytes;
			processCount += 1;
		}
		for (const child of byParent.get(pid) ?? []) queue.push(child.pid);
	}
	return { rssBytes, processCount };
}

async function sampleProcessTree(rootPid: number | null): Promise<ProcessTreeSample> {
	if (rootPid == null || rootPid <= 0) return { rssBytes: 0, processCount: 0 };
	if (process.platform === 'win32') return sampleProcessTreeWindows(rootPid);
	return sampleProcessTreeUnix(rootPid);
}

async function sampleRoles(label: string, roles: MemoryRole[], samples: MemorySampleMetric[]) {
	const timestampMs = performance.now() - rootStarted;
	for (const role of roles) {
		const sample = await sampleProcessTree(role.pid);
		samples.push({
			label,
			role: role.role,
			timestampMs,
			rssBytes: sample.rssBytes,
			privateBytes: sample.privateBytes,
			processCount: sample.processCount,
		});
	}
}

async function measurePhase(
	label: string,
	roles: MemoryRole[],
	samples: MemorySampleMetric[],
	phases: MemoryPhaseMetric[],
	action: () => Promise<void>
) {
	await sampleRoles(label, roles, samples);
	let sampling = false;
	const timer = setInterval(() => {
		if (sampling) return;
		sampling = true;
		void sampleRoles(label, roles, samples).finally(() => {
			sampling = false;
		});
	}, sampleIntervalMs);
	const started = performance.now();
	try {
		await action();
	} finally {
		clearInterval(timer);
		while (sampling) await Bun.sleep(25);
		const durationMs = performance.now() - started;
		await sampleRoles(label, roles, samples);
		phases.push({ label, durationMs });
	}
}

function loadFirstImageDataUrl(options: BenchmarkOptions) {
	if (options.imageMode === 'none') return {};
	const imageFiles = fs
		.readdirSync(options.imagesDir)
		.filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
		.sort();
	const selected = imageFiles[0];
	if (!selected) return {};
	const filePath = path.join(options.imagesDir, selected);
	const data = fs.readFileSync(filePath).toString('base64');
	const photoDataUrl = `data:${contentTypeForFile(filePath)};base64,${data}`;
	const photoThumbnailDataUrl = generatedThumbnailDataUrl;
	return { photoDataUrl, photoThumbnailDataUrl };
}

function buildScratchRecipe(title: string, includeImage: boolean) {
	return {
		cookbook_id: 1,
		title,
		description: 'Created by the RAM benchmark and removed during timed cleanup.',
		author: 'Benchmark Harness',
		servings: 4,
		ingredients: [
			{ line: '400 g tomato', quantity: 400, unit: 'g', name: 'tomato' },
			{ line: '320 g spaghetti', quantity: 320, unit: 'g', name: 'spaghetti' },
			{ line: '2 tbsp olive oil', quantity: 2, unit: 'tbsp', name: 'olive oil' },
			{ line: '1 tbsp basil', quantity: 1, unit: 'tbsp', name: 'basil' },
		],
		steps: ['Warm the oil.', 'Cook the tomato sauce.', 'Boil the pasta.', 'Combine and finish.'],
		notes: 'Scratch recipe used for RAM benchmark mutation and cleanup.',
		tags: ['benchmark', 'ram', 'cleanup'],
		...(includeImage ? loadFirstImageDataUrl(options) : {}),
	};
}

async function browserProcessId(browser: Browser) {
	const maybeProcess = (browser as unknown as { process?: () => { pid?: number } | null }).process?.();
	return typeof maybeProcess?.pid === 'number' ? maybeProcess.pid : null;
}

async function driveMemoryFlow(page: Page, roles: MemoryRole[], samples: MemorySampleMetric[], phases: MemoryPhaseMetric[]) {
	const scratchTitle = `Benchmark RAM Scratch ${Date.now()}`;
	let scratchId: number | null = null;
	const webUrl = `http://127.0.0.1:${options.webPort}/`;

	try {
		await measurePhase('initial-load', roles, samples, phases, async () => {
			await page.goto(webUrl);
			await page.getByPlaceholder('Search recipes...').waitFor({ state: 'visible' });
			await page.getByText(/Benchmark Recipe 0001/).first().waitFor({ state: 'visible' });
		});

		await measurePhase('search-pomodoro', roles, samples, phases, async () => {
			await page.getByPlaceholder('Search recipes...').fill('pomodoro');
			await page.waitForTimeout(350);
			await page.getByText(/Pomodoro/i).first().waitFor({ state: 'visible' });
		});

		await measurePhase('open-detail', roles, samples, phases, async () => {
			await page.getByText(/Pomodoro/i).first().click();
			await page.getByRole('button', { name: 'Edit' }).waitFor({ state: 'visible' });
		});

		await measurePhase('fetch-full-photo', roles, samples, phases, async () => {
			await page.evaluate(async () => {
				const list = (await (await fetch('/api/recipes?cookbookId=1')).json()) as Array<{ id: number; photoFull?: string | null }>;
				const withPhoto = list.find((recipe) => recipe.photoFull);
				if (!withPhoto?.photoFull) throw new Error('No full photo URL available');
				const response = await fetch(withPhoto.photoFull);
				if (!response.ok) throw new Error(`Full photo fetch failed: ${response.status}`);
				await response.arrayBuffer();
			});
		});

		await measurePhase('create-scratch-recipe-with-image', roles, samples, phases, async () => {
			const created = await page.evaluate(async (recipe) => {
				const response = await fetch('/api/recipes', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(recipe),
				});
				if (!response.ok) throw new Error(await response.text());
				return (await response.json()) as { id?: number };
			}, buildScratchRecipe(scratchTitle, true));
			if (typeof created.id !== 'number') throw new Error('Scratch recipe create did not return an id');
			scratchId = created.id;
		});

		await measurePhase('search-scratch-recipe', roles, samples, phases, async () => {
			await page.getByPlaceholder('Search recipes...').fill(scratchTitle);
			await page.waitForTimeout(350);
			await page.getByText(scratchTitle).first().waitFor({ state: 'visible' });
		});

		if (scratchId != null) {
			const id = scratchId;
			await measurePhase('cleanup-delete-scratch-recipe', roles, samples, phases, async () => {
				const ok = await page.evaluate(async (recipeId) => {
					const response = await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
					return response.ok;
				}, id);
				if (!ok) throw new Error(`Scratch recipe cleanup failed for recipe ${id}`);
			});
			scratchId = null;
		}

		await measurePhase('post-cleanup-idle', roles, samples, phases, async () => {
			await page.waitForTimeout(1500);
		});
	} finally {
		if (scratchId != null) {
			const id = scratchId;
			await page.evaluate(async (recipeId) => {
				await fetch(`/api/recipes/${recipeId}`, { method: 'DELETE' }).catch(() => undefined);
			}, id);
		}
	}
}

function spawnApiServer(args: string[]) {
	return Bun.spawn(['bun', 'benchmarks/server.ts', '--seed', ...args], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: benchmarkEnv(),
	});
}

function spawnWebServer() {
	return Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(options.webPort)], {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
		env: {
			...benchmarkEnv(),
			VITE_API_PROXY_TARGET: options.baseUrl,
		},
	});
}

async function stopProcess(child: Subprocess | null) {
	if (!child) return;
	if (process.platform === 'win32') {
		await Bun.spawn(['taskkill', '/PID', String(child.pid), '/T', '/F'], {
			stdout: 'ignore',
			stderr: 'ignore',
		}).exited.catch(() => undefined);
		return;
	}
	child.kill();
	await Promise.race([child.exited.catch(() => undefined), Bun.sleep(5000)]);
}

async function launchBrowser() {
	try {
		return await chromium.launch({ headless: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("Executable doesn't exist") || message.includes('playwright install')) {
			throw new Error(`Playwright browser is not installed. Run: bunx playwright install chromium\n${message}`, { cause: error });
		}
		throw error;
	}
}

if (import.meta.main) {
	const args = Bun.argv.slice(2);
	const samples: MemorySampleMetric[] = [];
	const phases: MemoryPhaseMetric[] = [];
	const notes: string[] = [
		'RAM benchmark samples process-tree RSS and, on Windows, private bytes for the API server, Vite dev server, and browser.',
		'The flow uses the seeded DB, opens the frontend, searches, opens a detail view, fetches one full photo, creates an image recipe, searches it, and deletes it.',
		'Vite dev server memory is reported separately from browser memory; browser memory is the better frontend runtime signal.',
		'This benchmark runs one controlled usage scenario; --iterations remains in the options for naming/config compatibility and is not used as a loop count.',
	];
	let apiServer: Subprocess | null = null;
	let webServer: Subprocess | null = null;
	let browser: Browser | null = null;
	try {
		apiServer = spawnApiServer(args);
		webServer = spawnWebServer();
		await waitForUrl(`${options.baseUrl}/api/health`, 'API server');
		await waitForUrl(`http://127.0.0.1:${options.webPort}`, 'Vite server');

		browser = await launchBrowser();
		const browserPid = await browserProcessId(browser);
		if (browserPid == null) notes.push('Playwright did not expose a browser process id; browser memory samples are omitted.');
		const page = await browser.newPage();
		const roles: MemoryRole[] = [
			{ role: 'api', pid: apiServer.pid },
			{ role: 'web', pid: webServer.pid },
			{ role: 'browser', pid: browserPid },
		];
		await driveMemoryFlow(page, roles, samples, phases);
		const written = writeBenchmarkReport(options, {
			name: 'benchmark-ram',
			startedAt,
			options,
			memorySamples: samples,
			memoryPhases: phases,
			notes,
		});
		console.log(`Wrote RAM benchmark report: ${written.mdPath}`);
	} finally {
		await browser?.close().catch(() => undefined);
		await stopProcess(webServer);
		await stopProcess(apiServer);
	}
}
