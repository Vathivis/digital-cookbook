import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';

const tmpDir = path.resolve(process.cwd(), '.tmp-tests');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

type AppLike = {
	handle?(request: Request): Promise<Response>;
	fetch(request: Request): Promise<Response>;
};

type LoadedServer = {
	app: AppLike;
	database: { close: () => void };
	dbPath: string;
};

const withEnv = async <T>(
	overrides: Record<string, string | undefined>,
	handler: () => Promise<T>
) => {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await handler();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

const loadServer = async (
	envOverrides: Record<string, string | undefined> = {}
): Promise<LoadedServer> => {
	const dbPath = path.join(tmpDir, `auth-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
	const module = await withEnv(
		{
			SERVE_STATIC: 'false',
			COOKBOOK_DB_PATH: dbPath,
			AUTH_ENABLED: 'true',
			AUTH_USERNAME: 'chef',
			AUTH_PASSWORD: 'secret',
			...envOverrides
		},
		() => import(`../../server/index?auth=${Date.now()}-${Math.random()}`)
	);
	return {
		app: module.app as AppLike,
		database: module.database as { close: () => void },
		dbPath
	};
};

const closeServer = (server: LoadedServer) => {
	try {
		server.database.close();
	} catch (error) {
		console.error('Failed to close auth test database', error);
	}
	try {
		if (fs.existsSync(server.dbPath)) fs.rmSync(server.dbPath, { force: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'EBUSY') {
			console.error('Failed to remove auth test database file', error);
		}
	}
};

const callApi = async (app: AppLike, pathname: string, init?: RequestInit) => {
	const headers = new Headers(init?.headers ?? {});
	if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const request = new Request(`http://localhost${pathname}`, { ...init, headers });
	const handler = app.handle ?? app.fetch;
	return handler.call(app, request);
};

const cookiePair = (setCookie: string | null) => (setCookie ? (setCookie.split(';')[0] ?? '') : '');

describe('auth', () => {
	test('fails startup when auth is enabled but credentials are missing', async () => {
		const failingImport = withEnv(
			{
				SERVE_STATIC: 'false',
				COOKBOOK_DB_PATH: path.join(tmpDir, `auth-missing-${Date.now()}.db`),
				AUTH_ENABLED: 'true',
				AUTH_USERNAME: '',
				AUTH_PASSWORD: ''
			},
			() => import(`../../server/index?auth-missing=${Date.now()}-${Math.random()}`)
		);
		await expect(failingImport).rejects.toThrow('AUTH_ENABLED=true requires AUTH_USERNAME and AUTH_PASSWORD');
	});

	test('protects routes, validates login, and supports logout', async () => {
		const server = await loadServer();
		try {
			const protectedWithoutSession = await callApi(server.app, '/api/cookbooks');
			expect(protectedWithoutSession.status).toBe(401);
			await expect(protectedWithoutSession.json()).resolves.toEqual({ error: 'unauthorized' });

			const statusBefore = await callApi(server.app, '/api/auth/status');
			expect(statusBefore.status).toBe(200);
			await expect(statusBefore.json()).resolves.toEqual({ enabled: true, authenticated: false });

			const invalidLogin = await callApi(server.app, '/api/auth/login', {
				method: 'POST',
				body: JSON.stringify({ username: 'chef', password: 'wrong' })
			});
			expect(invalidLogin.status).toBe(401);
			await expect(invalidLogin.json()).resolves.toEqual({ error: 'invalid credentials' });

			const validLogin = await callApi(server.app, '/api/auth/login', {
				method: 'POST',
				body: JSON.stringify({ username: 'chef', password: 'secret' })
			});
			expect(validLogin.status).toBe(200);
			const sessionCookie = validLogin.headers.get('set-cookie');
			expect(sessionCookie).toContain('Max-Age=2592000');
			const session = cookiePair(sessionCookie);
			expect(session).toContain('dc_auth=');

			const protectedWithSession = await callApi(server.app, '/api/cookbooks', {
				headers: { Cookie: session }
			});
			expect(protectedWithSession.status).toBe(200);
			const cookbooks = await protectedWithSession.json();
			expect(Array.isArray(cookbooks)).toBe(true);

			const statusAfter = await callApi(server.app, '/api/auth/status', {
				headers: { Cookie: session }
			});
			expect(statusAfter.status).toBe(200);
			await expect(statusAfter.json()).resolves.toEqual({ enabled: true, authenticated: true, username: 'chef' });

			const logout = await callApi(server.app, '/api/auth/logout', {
				method: 'POST',
				headers: { Cookie: session }
			});
			expect(logout.status).toBe(200);
			expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

			const protectedAfterLogout = await callApi(server.app, '/api/cookbooks');
			expect(protectedAfterLogout.status).toBe(401);
			await expect(protectedAfterLogout.json()).resolves.toEqual({ error: 'unauthorized' });
		} finally {
			closeServer(server);
		}
	});

	test('allows unauthenticated CORS preflight for protected routes', async () => {
		const server = await loadServer();
		try {
			const preflight = await callApi(server.app, '/api/recipes', {
				method: 'OPTIONS',
				headers: {
					Origin: 'http://example.com',
					'Access-Control-Request-Method': 'POST',
					'Access-Control-Request-Headers': 'content-type'
				}
			});

			expect(preflight.status).not.toBe(401);
			expect([200, 204]).toContain(preflight.status);
			expect(preflight.headers.get('access-control-allow-origin')).toBeTruthy();
			const allowMethods = preflight.headers.get('access-control-allow-methods')?.toUpperCase() ?? '';
			expect(allowMethods).toContain('POST');
		} finally {
			closeServer(server);
		}
	});

	test('keeps health endpoints publicly accessible when auth is enabled', async () => {
		const server = await loadServer();
		try {
			const rootHealth = await callApi(server.app, '/health');
			expect(rootHealth.status).toBe(200);
			await expect(rootHealth.json()).resolves.toEqual({ ok: true });

			const apiHealth = await callApi(server.app, '/api/health');
			expect(apiHealth.status).toBe(200);
			await expect(apiHealth.json()).resolves.toEqual({ ok: true });
		} finally {
			closeServer(server);
		}
	});

	test('sets remember-permanent login max-age to ten years', async () => {
		const server = await loadServer();
		try {
			const login = await callApi(server.app, '/api/auth/login', {
				method: 'POST',
				body: JSON.stringify({ username: 'chef', password: 'secret', rememberPermanently: true })
			});
			expect(login.status).toBe(200);
			expect(login.headers.get('set-cookie')).toContain('Max-Age=315360000');
		} finally {
			closeServer(server);
		}
	});
});
