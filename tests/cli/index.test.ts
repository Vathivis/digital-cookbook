import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../../cli/index';
import type { FetchLike } from '../../cli/api';

const tmpDir = path.resolve(process.cwd(), '.tmp-tests');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, `cookbook-cli-${Date.now()}.db`);

const previousEnvironment = new Map<string, string | undefined>();
const environmentOverrides: Record<string, string | undefined> = {
	COOKBOOK_DB_PATH: testDbPath,
	AUTH_ENABLED: 'false',
	AUTH_USERNAME: undefined,
	AUTH_PASSWORD: undefined,
	SERVE_STATIC: 'false'
};
for (const [name, value] of Object.entries(environmentOverrides)) {
	previousEnvironment.set(name, process.env[name]);
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

const { app, database } = await import(`../../server/index?cli=${Date.now()}-${Math.random()}`);

for (const [name, value] of previousEnvironment.entries()) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

type AppLike = {
	handle?(request: Request): Promise<Response>;
	fetch(request: Request): Promise<Response>;
};

const fetchFn: FetchLike = async (input, init) => {
	const request = input instanceof Request ? input : new Request(input, init);
	const appLike = app as AppLike;
	const handler = appLike.handle ?? appLike.fetch;
	return handler.call(app, request);
};

const invoke = async (arguments_: string[]) => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const code = await runCli(arguments_, {
		env: { COOKBOOK_URL: 'http://cookbook.test' },
		fetchFn,
		stdout: (text) => stdout.push(text),
		stderr: (text) => stderr.push(text)
	});
	return { code, stdout, stderr };
};

const successData = <T>(result: Awaited<ReturnType<typeof invoke>>) => {
	expect(result.code).toBe(0);
	expect(result.stderr).toEqual([]);
	return (JSON.parse(result.stdout.join('\n')) as { ok: true; data: T }).data;
};

test('CLI help documents cookbook and recipe operations', async () => {
	const result = await invoke(['--help']);
	expect(result.code).toBe(0);
	expect(result.stderr).toEqual([]);
	expect(result.stdout.join('\n')).toContain('cookbook list');
	expect(result.stdout.join('\n')).toContain('recipe search');
	expect(result.stdout.join('\n')).toContain('--file -');
});

test('CLI help uses silent Bun commands for machine-readable output', async () => {
	const result = await invoke(['--help']);
	const output = result.stdout.join('\n');

	expect(output).toContain('bun run --silent cookbook -- cookbook list');
	expect(output).not.toContain('bun run cookbook --');
});

test('CLI logs in once and forwards the shared-auth session cookie', async () => {
	const requests: Request[] = [];
	const authenticatedFetch: FetchLike = async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		requests.push(request);
		const pathname = new URL(request.url).pathname;
		if (pathname === '/api/auth/status') {
			return Response.json({ enabled: true, authenticated: false });
		}
		if (pathname === '/api/auth/login') {
			expect(await request.json()).toEqual({ username: 'chef', password: 'secret' });
			return Response.json(
				{ ok: true },
				{ headers: { 'Set-Cookie': 'dc_auth=session-token; Path=/; HttpOnly; SameSite=Strict' } }
			);
		}
		expect(request.headers.get('Cookie')).toBe('dc_auth=session-token');
		return Response.json([{ id: 1, name: 'Authenticated Cookbook' }]);
	};
	const stdout: string[] = [];
	const result = await runCli(['cookbook', 'list'], {
		env: {
			COOKBOOK_URL: 'http://cookbook.test',
			COOKBOOK_USERNAME: 'chef',
			COOKBOOK_PASSWORD: 'secret'
		},
		fetchFn: authenticatedFetch,
		stdout: (text) => stdout.push(text)
	});

	expect(result).toBe(0);
	expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
		'/api/auth/status',
		'/api/auth/login',
		'/api/cookbooks'
	]);
	expect(JSON.parse(stdout.join('\n'))).toMatchObject({ ok: true });
});

test('cookbook update returns the stored cookbook name', async () => {
	const cookbook = successData<{ id: number; name: string }>(
		await invoke(['cookbook', 'create', '--name', 'Original Name'])
	);
	const updated = successData<{ id: number; name: string }>(
		await invoke(['cookbook', 'update', String(cookbook.id), '--name', '  Normalized Name  '])
	);
	const stored = successData<{ id: number; name: string }>(
		await invoke(['cookbook', 'get', String(cookbook.id)])
	);

	expect(updated).toEqual({ id: cookbook.id, name: 'Normalized Name' });
	expect(updated).toEqual(stored);
});

test('recipe update rejects cookbook locally', async () => {
	let requestCount = 0;
	const stderr: string[] = [];
	const code = await runCli(['recipe', 'update', '1', '--cookbook', '2'], {
		env: { COOKBOOK_URL: 'http://cookbook.test' },
		fetchFn: async () => {
			requestCount += 1;
			return Response.json({ enabled: false, authenticated: true });
		},
		stdout: () => undefined,
		stderr: (text) => stderr.push(text)
	});

	expect(code).toBe(2);
	expect(requestCount).toBe(0);
	expect(JSON.parse(stderr.join('\n'))).toMatchObject({ ok: false, type: 'usage' });
});

test('CLI supports cookbook and recipe CRUD, listing, and search', async () => {
	const initialCookbooks = successData<Array<{ id: number; name: string }>>(await invoke(['cookbook', 'list']));
	expect(initialCookbooks.length).toBeGreaterThan(0);

	const cookbook = successData<{ id: number; name: string }>(
		await invoke(['cookbook', 'create', '--name', 'Agent Recipes'])
	);
	expect(cookbook.name).toBe('Agent Recipes');

	const renamedCookbook = successData<{ id: number; name: string }>(
		await invoke(['cookbook', 'update', String(cookbook.id), '--name', 'Agent Cookbook'])
	);
	expect(renamedCookbook).toEqual({ id: cookbook.id, name: 'Agent Cookbook' });
	expect(
		successData<{ id: number; name: string }>(await invoke(['cookbook', 'get', String(cookbook.id)]))
	).toEqual(renamedCookbook);

	const recipe = successData<{ id: number; title: string; tags: string[]; steps: string[] }>(
		await invoke([
			'recipe',
			'create',
			'--cookbook',
			String(cookbook.id),
			'--title',
			'Agent Toast',
			'--ingredient',
			'2 slices bread',
			'--ingredient',
			'Butter',
			'--step',
			'Toast the bread',
			'--tag',
			'Quick'
		])
	);
	expect(recipe.title).toBe('Agent Toast');
	expect(recipe.tags).toEqual(['Quick']);
	expect(recipe.steps).toEqual(['Toast the bread']);

	const recipes = successData<Array<{ id: number }>>(
		await invoke(['recipe', 'list', '--cookbook', String(cookbook.id)])
	);
	expect(recipes.map((candidate) => candidate.id)).toContain(recipe.id);

	const searchResults = successData<Array<{ id: number }>>(
		await invoke(['recipe', 'search', '--cookbook', String(cookbook.id), '--query', 'bread'])
	);
	expect(searchResults.map((candidate) => candidate.id)).toContain(recipe.id);

	const updated = successData<{ id: number; title: string; tags: string[] }>(
		await invoke([
			'recipe',
			'update',
			String(recipe.id),
			'--json',
			JSON.stringify({ title: 'Better Agent Toast', tags: ['Breakfast', 'Easy'] })
		])
	);
	expect(updated.title).toBe('Better Agent Toast');
	expect(updated.tags).toEqual(['Breakfast', 'Easy']);

	const fetched = successData<{ id: number; title: string }>(await invoke(['recipe', 'get', String(recipe.id)]));
	expect(fetched).toMatchObject({ id: recipe.id, title: 'Better Agent Toast' });

	const refusedDelete = await invoke(['recipe', 'delete', String(recipe.id)]);
	expect(refusedDelete.code).toBe(2);
	expect(JSON.parse(refusedDelete.stderr.join('\n'))).toMatchObject({ ok: false, type: 'usage' });

	expect(
		successData<{ id: number; deleted: boolean }>(await invoke(['recipe', 'delete', String(recipe.id), '--yes']))
	).toEqual({ id: recipe.id, deleted: true });
	expect(
		successData<{ id: number; deleted: boolean }>(await invoke(['cookbook', 'delete', String(cookbook.id), '--yes']))
	).toEqual({ id: cookbook.id, deleted: true });
});

afterAll(() => {
	database.close();
	for (const suffix of ['', '-wal', '-shm']) {
		const file = `${testDbPath}${suffix}`;
		if (fs.existsSync(file)) fs.rmSync(file);
	}
});
