import { afterAll, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { Database } from 'bun:sqlite';

const tmpDir = path.resolve(process.cwd(), '.tmp-tests');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, `cookbook-${Date.now()}.db`);

// Ensure static serving is enabled for these tests (server checks for dist/index.html on startup).
const distDir = path.resolve(process.cwd(), 'dist');
const distIndexPath = path.join(distDir, 'index.html');
const distDirExisted = fs.existsSync(distDir);
const distIndexExisted = fs.existsSync(distIndexPath);
if (!distIndexExisted) {
	if (!distDirExisted) fs.mkdirSync(distDir, { recursive: true });
	fs.writeFileSync(distIndexPath, '<!doctype html><html><body>test-spa</body></html>');
}

type AppLike = {
	handle?(request: Request): Promise<Response>;
	fetch(request: Request): Promise<Response>;
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

const { app, database } = await withEnv(
	{
		COOKBOOK_DB_PATH: testDbPath,
		COOKBOOK_BASE_PATH: '/cookbook/',
		AUTH_ENABLED: 'false',
		AUTH_USERNAME: undefined,
		AUTH_PASSWORD: undefined,
		PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH: '64'
	},
	() => import(`../../server/index?index=${Date.now()}-${Math.random()}`)
);

async function callApi(pathname: string, init?: RequestInit) {
	const headers = new Headers(init?.headers ?? {});
	if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const request = new Request(`http://localhost${pathname}`, { ...init, headers });
	const appLike = app as AppLike;
	const handler = appLike.handle ?? appLike.fetch;
	return handler.call(app, request);
}

async function callAppApi(appInstance: AppLike, pathname: string, init?: RequestInit) {
	const headers = new Headers(init?.headers ?? {});
	if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const request = new Request(`http://localhost${pathname}`, { ...init, headers });
	const handler = appInstance.handle ?? appInstance.fetch;
	return handler.call(appInstance, request);
}

const expectPhotoUrl = (value: unknown, recipeId: number, variant: string) => {
	expect(typeof value).toBe('string');
	expect((value as string).startsWith(`/api/recipes/${recipeId}/photos/${variant}?v=`)).toBe(true);
	return value as string;
};

const expectPhotoResponse = async (url: string, contentType: string) => {
	const res = await callApi(url);
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toBe(contentType);
	expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
};

test('unknown /api routes return a JSON 404 even with static SPA fallback enabled', async () => {
	const res = await callApi('/api/does-not-exist');
	expect(res.status).toBe(404);
	await expect(res.json()).resolves.toEqual({ error: 'not found' });
});

test('auth is disabled for server index tests', async () => {
	const status = await callApi('/api/auth/status');
	expect(status.status).toBe(200);
	await expect(status.json()).resolves.toEqual({ enabled: false, authenticated: true });
});

test('recipe create rejects thumbnail-only photo payloads', async () => {
	const res = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Thumbnail Only Recipe',
			description: '',
			author: '',
			ingredients: [],
			steps: [],
			notes: '',
			photoThumbnailDataUrl: 'data:image/jpeg;base64,ORPHAN'
		})
	});

	expect(res.status).toBe(400);
	await expect(res.json()).resolves.toEqual({ error: 'photoThumbnailDataUrl requires supplied photoDataUrl' });
});

test('recipe photo endpoints reject unsafe MIME types and do not echo legacy unsafe types', async () => {
	const parameterizedCreate = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Parameterized Photo Recipe',
			photoDataUrl: 'data:image/png;charset=utf-8;base64,QUJD'
		})
	});
	expect(parameterizedCreate.status).toBe(200);
	const { id: parameterizedId } = (await parameterizedCreate.json()) as { id: number };
	const parameterizedDetail = await callApi(`/api/recipes/${parameterizedId}`);
	expect(parameterizedDetail.status).toBe(200);
	const parameterizedPayload = await parameterizedDetail.json();
	const parameterizedPhotoUrl = expectPhotoUrl(parameterizedPayload.photo, parameterizedId, 'full');
	const parameterizedPhoto = await callApi(parameterizedPhotoUrl);
	expect(parameterizedPhoto.status).toBe(200);
	expect(parameterizedPhoto.headers.get('Content-Type')).toBe('image/png');
	expect(Buffer.from(await parameterizedPhoto.arrayBuffer()).toString('utf8')).toBe('ABC');

	const unsafeCreate = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Unsafe Photo Recipe',
			photoDataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
		})
	});
	expect(unsafeCreate.status).toBe(400);
	await expect(unsafeCreate.json()).resolves.toEqual({ error: 'photoDataUrl must be a supported image data URL' });

	const malformedCreate = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Malformed Photo Recipe',
			photoDataUrl: 'data:image/png,%ZZ'
		})
	});
	expect(malformedCreate.status).toBe(400);
	await expect(malformedCreate.json()).resolves.toEqual({ error: 'photoDataUrl must be a supported image data URL' });

	const createRes = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Legacy Unsafe Photo Recipe'
		})
	});
	expect(createRes.status).toBe(200);
	const { id } = (await createRes.json()) as { id: number };

	const unsafePatch = await callApi(`/api/recipes/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoDataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' })
	});
	expect(unsafePatch.status).toBe(400);
	await expect(unsafePatch.json()).resolves.toEqual({ error: 'photoDataUrl must be a supported image data URL' });

	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT INTO recipe_photo_variants (recipe_id, variant, content_type, data, created_at, updated_at)
			 VALUES (?, 'full', 'text/html', ?, ?, ?)`
		)
		.run(id, Buffer.from('<script>alert(1)</script>'), now, now);

	const legacyPhoto = await callApi(`/api/recipes/${id}/photos/full`);
	expect(legacyPhoto.status).toBe(200);
	expect(legacyPhoto.headers.get('Content-Type')).toBe('application/octet-stream');
	expect(legacyPhoto.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(legacyPhoto.headers.get('Content-Disposition')).toBe('attachment; filename="recipe-photo.bin"');
});

test('static file serving blocks traversal via encoded separators', async () => {
	const siblingDistDir = path.resolve(process.cwd(), 'dist2');
	const siblingFilePath = path.join(siblingDistDir, 'secret.txt');

	fs.mkdirSync(siblingDistDir, { recursive: true });
	fs.writeFileSync(siblingFilePath, 'leak');

	try {
		const res = await callApi('/..%2Fdist2/secret.txt');
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: 'not found' });
	} finally {
		try {
			fs.rmSync(siblingDistDir, { recursive: true, force: true });
		} catch (error) {
			console.error('Failed to clean up sibling dist directory after test', error);
		}
	}
});

test('static file serving returns browser-safe content types', async () => {
	const assetsDir = path.join(distDir, 'assets');
	const jsPath = path.join(assetsDir, 'static-test.js');
	const faviconPath = path.join(distDir, 'favicon.svg');
	const faviconExisted = fs.existsSync(faviconPath);

	fs.mkdirSync(assetsDir, { recursive: true });
	fs.writeFileSync(jsPath, 'export const ok = true;');
	if (!faviconExisted) {
		fs.writeFileSync(faviconPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>');
	}

	try {
		const jsRes = await callApi('/assets/static-test.js');
		expect(jsRes.status).toBe(200);
		expect(jsRes.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');

		const prefixedJsRes = await callApi('/cookbook/assets/static-test.js');
		expect(prefixedJsRes.status).toBe(200);
		expect(prefixedJsRes.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');

		const svgRes = await callApi('/favicon.svg');
		expect(svgRes.status).toBe(200);
		expect(svgRes.headers.get('Content-Type')).toBe('image/svg+xml');

		const prefixedSvgRes = await callApi('/cookbook/favicon.svg');
		expect(prefixedSvgRes.status).toBe(200);
		expect(prefixedSvgRes.headers.get('Content-Type')).toBe('image/svg+xml');

		const icoRes = await callApi('/favicon.ico');
		expect(icoRes.status).toBe(200);
		expect(icoRes.headers.get('Content-Type')).toBe('image/svg+xml');

		const prefixedIcoRes = await callApi('/cookbook/favicon.ico');
		expect(prefixedIcoRes.status).toBe(200);
		expect(prefixedIcoRes.headers.get('Content-Type')).toBe('image/svg+xml');
	} finally {
		try {
			if (fs.existsSync(jsPath)) fs.rmSync(jsPath);
			if (!faviconExisted && fs.existsSync(faviconPath)) fs.rmSync(faviconPath);
			if (fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).length === 0) fs.rmdirSync(assetsDir);
		} catch (error) {
			console.error('Failed to clean up static content type test artifacts', error);
		}
	}
});

test('legacy recipe photo columns migrate into photo variants and are cleared', async () => {
	const legacyDbPath = path.join(tmpDir, `legacy-photo-${Date.now()}.db`);
	const legacyDb = new Database(legacyDbPath, { create: true });
	legacyDb.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE cookbooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE recipes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cookbook_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			description TEXT DEFAULT '',
			author TEXT DEFAULT '',
			photo BLOB,
			photo_thumbnail BLOB,
			uses INTEGER DEFAULT 0,
			servings INTEGER DEFAULT 1,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(cookbook_id) REFERENCES cookbooks(id) ON DELETE CASCADE
		);
		INSERT INTO cookbooks (id, name) VALUES (1, 'Legacy');
		INSERT INTO recipes (id, cookbook_id, title, photo, photo_thumbnail)
		VALUES (1, 1, 'Legacy Photo', 'data:image/png;base64,AAA', 'data:image/jpeg;base64,thumb');
	`);
	legacyDb.close();

	const module = await withEnv(
		{
			SERVE_STATIC: 'false',
			COOKBOOK_DB_PATH: legacyDbPath,
			AUTH_ENABLED: 'false',
			AUTH_USERNAME: undefined,
			AUTH_PASSWORD: undefined
		},
		() => import(`../../server/index?legacy-photo=${Date.now()}-${Math.random()}`)
	);
	const legacyApp = module.app as AppLike;
	const legacyDatabase = module.database as Database;
	try {
		const row = legacyDatabase
			.query<{ photo: string | null; photo_thumbnail: string | null }, []>(
				'SELECT photo, photo_thumbnail FROM recipes WHERE id = 1'
			)
			.get();
		expect(row).toEqual({ photo: null, photo_thumbnail: null });

		const list = await callAppApi(legacyApp, '/api/recipes?cookbookId=1');
		expect(list.status).toBe(200);
		const payload = (await list.json()) as Array<{ id: number; photo: string | null }>;
		const photoUrl = expectPhotoUrl(payload.find((recipe) => recipe.id === 1)?.photo, 1, 'thumbnail_card');

		const photo = await callAppApi(legacyApp, photoUrl);
		expect(photo.status).toBe(200);
		expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
	} finally {
		legacyDatabase.close();
		if (fs.existsSync(legacyDbPath)) fs.rmSync(legacyDbPath, { force: true });
	}
});

test('legacy photo variant data URLs migrate into blob storage', async () => {
	const legacyDbPath = path.join(tmpDir, `legacy-photo-variant-${Date.now()}.db`);
	const legacyDb = new Database(legacyDbPath, { create: true });
	legacyDb.exec(`
		PRAGMA foreign_keys = ON;
		CREATE TABLE cookbooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE recipes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cookbook_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			description TEXT DEFAULT '',
			author TEXT DEFAULT '',
			uses INTEGER DEFAULT 0,
			servings INTEGER DEFAULT 1,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(cookbook_id) REFERENCES cookbooks(id) ON DELETE CASCADE
		);
		CREATE TABLE recipe_photo_variants (
			recipe_id INTEGER NOT NULL,
			variant TEXT NOT NULL CHECK (variant IN ('full', 'thumbnail_card', 'thumbnail_detail')),
			data_url TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY(recipe_id, variant),
			FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
		);
		INSERT INTO cookbooks (id, name) VALUES (1, 'Legacy');
		INSERT INTO recipes (id, cookbook_id, title) VALUES (1, 1, 'Legacy Variant Photo');
		INSERT INTO recipe_photo_variants (recipe_id, variant, data_url)
		VALUES (1, 'full', 'data:image/png;charset=utf-8;base64,QUJD');
	`);
	legacyDb.close();

	const module = await withEnv(
		{
			SERVE_STATIC: 'false',
			COOKBOOK_DB_PATH: legacyDbPath,
			AUTH_ENABLED: 'false',
			AUTH_USERNAME: undefined,
			AUTH_PASSWORD: undefined
		},
		() => import(`../../server/index?legacy-photo-variant=${Date.now()}-${Math.random()}`)
	);
	const legacyApp = module.app as AppLike;
	const legacyDatabase = module.database as Database;
	try {
		const columns = legacyDatabase.query<{ name: string }, []>('PRAGMA table_info(recipe_photo_variants)').all().map((row) => row.name);
		expect(columns).toContain('content_type');
		expect(columns).toContain('data');
		expect(columns).not.toContain('data_url');

		const detail = await callAppApi(legacyApp, '/api/recipes/1');
		expect(detail.status).toBe(200);
		const payload = (await detail.json()) as { photoFull: string | null };
		const photoUrl = expectPhotoUrl(payload.photoFull, 1, 'full');

		const photo = await callAppApi(legacyApp, photoUrl);
		expect(photo.status).toBe(200);
		expect(photo.headers.get('Content-Type')).toBe('image/png');
		expect(Buffer.from(await photo.arrayBuffer()).toString('utf8')).toBe('ABC');
	} finally {
		legacyDatabase.close();
		if (fs.existsSync(legacyDbPath)) fs.rmSync(legacyDbPath, { force: true });
	}
});

test('recipe mutations handle image clears and invalid ids', async () => {
	const createRes = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Photo Recipe',
			description: '',
			author: '',
			ingredients: [],
			steps: [],
			notes: '',
			photoDataUrl: 'data:image/png;base64,AAA',
			photoThumbnailDataUrl: 'data:image/jpeg;base64,thumb'
		})
	});
	expect(createRes.status).toBe(200);
	const { id } = (await createRes.json()) as { id: number };
	expect(typeof id).toBe('number');

	const detailBefore = await callApi(`/api/recipes/${id}`);
	expect(detailBefore.status).toBe(200);
	const beforePayload = await detailBefore.json();
	const fullPhotoUrl = expectPhotoUrl(beforePayload.photo, id, 'full');
	await expectPhotoResponse(fullPhotoUrl, 'image/png');

	const listBefore = await callApi('/api/recipes?cookbookId=1');
	expect(listBefore.status).toBe(200);
	const listPayload = (await listBefore.json()) as Array<{ id: number; photo: string | null }>;
	const cardPhotoUrl = expectPhotoUrl(listPayload.find((recipe) => recipe.id === id)?.photo, id, 'thumbnail_card');
	await expectPhotoResponse(cardPhotoUrl, 'image/jpeg');

	const searchBefore = await callApi('/api/recipes/search?cookbookId=1&q=Photo');
	expect(searchBefore.status).toBe(200);
	const searchPayload = (await searchBefore.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(searchPayload.find((recipe) => recipe.id === id)?.photo, id, 'thumbnail_card');

	const noPhotoRes = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'No Photo Recipe',
			description: '',
			author: '',
			ingredients: [],
			steps: [],
			notes: ''
		})
	});
	expect(noPhotoRes.status).toBe(200);
	const noPhoto = (await noPhotoRes.json()) as { id: number };

	const patchNoPhotoThumbnail = await callApi(`/api/recipes/${noPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoThumbnailDataUrl: 'data:image/jpeg;base64,NO-FULL-PHOTO-THUMB' })
	});
	expect(patchNoPhotoThumbnail.status).toBe(400);

	const listAfterRejectedThumbnail = await callApi('/api/recipes?cookbookId=1');
	expect(listAfterRejectedThumbnail.status).toBe(200);
	const listRejectedThumbnailPayload = (await listAfterRejectedThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	expect(listRejectedThumbnailPayload.find((recipe) => recipe.id === noPhoto.id)?.photo).toBeNull();

	const legacyPhotoRes = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Legacy Photo Recipe',
			description: '',
			author: '',
			ingredients: [],
			steps: [],
			notes: '',
			photoDataUrl: 'data:image/png;base64,LEGACY'
		})
	});
	expect(legacyPhotoRes.status).toBe(200);
	const legacyPhoto = (await legacyPhotoRes.json()) as { id: number };

	const listWithLegacyPhoto = await callApi('/api/recipes?cookbookId=1');
	expect(listWithLegacyPhoto.status).toBe(200);
	const listWithLegacyPayload = (await listWithLegacyPhoto.json()) as Array<{ id: number; photo: string | null }>;
	const legacyCardUrl = expectPhotoUrl(
		listWithLegacyPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo,
		legacyPhoto.id,
		'thumbnail_card'
	);
	await expectPhotoResponse(legacyCardUrl, 'image/png');

	const searchWithLegacyPhoto = await callApi('/api/recipes/search?cookbookId=1&q=Legacy');
	expect(searchWithLegacyPhoto.status).toBe(200);
	const searchWithLegacyPayload = (await searchWithLegacyPhoto.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(searchWithLegacyPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo, legacyPhoto.id, 'thumbnail_card');

	const patchLegacyThumbnail = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoThumbnailDataUrl: 'data:image/jpeg;base64,LEGACY-THUMB' })
	});
	expect(patchLegacyThumbnail.status).toBe(200);

	const listWithBackfilledThumbnail = await callApi('/api/recipes?cookbookId=1');
	expect(listWithBackfilledThumbnail.status).toBe(200);
	const listBackfillPayload = (await listWithBackfilledThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	const backfilledCardUrl = expectPhotoUrl(
		listBackfillPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo,
		legacyPhoto.id,
		'thumbnail_card'
	);
	await expectPhotoResponse(backfilledCardUrl, 'image/jpeg');

	const searchWithBackfilledThumbnail = await callApi('/api/recipes/search?cookbookId=1&q=Legacy');
	expect(searchWithBackfilledThumbnail.status).toBe(200);
	const searchBackfillPayload = (await searchWithBackfilledThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(searchBackfillPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo, legacyPhoto.id, 'thumbnail_card');

	const patchLegacyThumbnailFromFull = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoThumbnailDataUrl: null })
	});
	expect(patchLegacyThumbnailFromFull.status).toBe(200);

	const listWithFullCopiedThumbnail = await callApi('/api/recipes?cookbookId=1');
	expect(listWithFullCopiedThumbnail.status).toBe(200);
	const listFullCopiedPayload = (await listWithFullCopiedThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	const fullCopiedCardUrl = expectPhotoUrl(
		listFullCopiedPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo,
		legacyPhoto.id,
		'thumbnail_card'
	);
	await expectPhotoResponse(fullCopiedCardUrl, 'image/png');

	const restoreLegacyThumbnail = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoThumbnailDataUrl: 'data:image/jpeg;base64,LEGACY-THUMB' })
	});
	expect(restoreLegacyThumbnail.status).toBe(200);

	const patchLegacyTitleOnly = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ title: 'Legacy Photo Recipe Updated' })
	});
	expect(patchLegacyTitleOnly.status).toBe(200);

	const listWithTitleOnlyPatch = await callApi('/api/recipes?cookbookId=1');
	expect(listWithTitleOnlyPatch.status).toBe(200);
	const listTitleOnlyPatchPayload = (await listWithTitleOnlyPatch.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(listTitleOnlyPatchPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo, legacyPhoto.id, 'thumbnail_card');

	const patchLegacyPhotoUnchanged = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoDataUrl: 'data:image/png;base64,LEGACY' })
	});
	expect(patchLegacyPhotoUnchanged.status).toBe(200);

	const listWithPreservedThumbnail = await callApi('/api/recipes?cookbookId=1');
	expect(listWithPreservedThumbnail.status).toBe(200);
	const listPreservedThumbnailPayload = (await listWithPreservedThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(listPreservedThumbnailPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo, legacyPhoto.id, 'thumbnail_card');

	const searchWithPreservedThumbnail = await callApi('/api/recipes/search?cookbookId=1&q=Legacy');
	expect(searchWithPreservedThumbnail.status).toBe(200);
	const searchPreservedThumbnailPayload = (await searchWithPreservedThumbnail.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(
		searchPreservedThumbnailPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo,
		legacyPhoto.id,
		'thumbnail_card'
	);

	const patchLegacyPhotoOnly = await callApi(`/api/recipes/${legacyPhoto.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoDataUrl: 'data:image/png;base64,LEGACY-UPDATED' })
	});
	expect(patchLegacyPhotoOnly.status).toBe(200);

	const listWithUpdatedLegacyPhoto = await callApi('/api/recipes?cookbookId=1');
	expect(listWithUpdatedLegacyPhoto.status).toBe(200);
	const listUpdatedLegacyPayload = (await listWithUpdatedLegacyPhoto.json()) as Array<{ id: number; photo: string | null }>;
	const updatedLegacyCardUrl = expectPhotoUrl(
		listUpdatedLegacyPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo,
		legacyPhoto.id,
		'thumbnail_card'
	);
	await expectPhotoResponse(updatedLegacyCardUrl, 'image/png');

	const searchWithUpdatedLegacyPhoto = await callApi('/api/recipes/search?cookbookId=1&q=Legacy');
	expect(searchWithUpdatedLegacyPhoto.status).toBe(200);
	const searchUpdatedLegacyPayload = (await searchWithUpdatedLegacyPhoto.json()) as Array<{ id: number; photo: string | null }>;
	expectPhotoUrl(searchUpdatedLegacyPayload.find((recipe) => recipe.id === legacyPhoto.id)?.photo, legacyPhoto.id, 'thumbnail_card');

	const patchClear = await callApi(`/api/recipes/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoDataUrl: null })
	});
	expect(patchClear.status).toBe(200);

	const detailAfter = await callApi(`/api/recipes/${id}`);
	const afterPayload = await detailAfter.json();
	expect(afterPayload.photo).toBeNull();

	const listAfterClear = await callApi('/api/recipes?cookbookId=1');
	expect(listAfterClear.status).toBe(200);
	const listAfterClearPayload = (await listAfterClear.json()) as Array<{ id: number; photo: string | null }>;
	expect(listAfterClearPayload.find((recipe) => recipe.id === id)?.photo).toBeNull();

	const missingPatch = await callApi('/api/recipes/99999', {
		method: 'PATCH',
		body: JSON.stringify({ title: 'no-op' })
	});
	expect(missingPatch.status).toBe(404);

	const invalidTagAdd = await callApi('/api/recipes/99999/tags', {
		method: 'POST',
		body: JSON.stringify({ name: 'ghost' })
	});
	expect(invalidTagAdd.status).toBe(404);

	const invalidTagRemove = await callApi('/api/recipes/99999/tags/ghost', { method: 'DELETE' });
	expect(invalidTagRemove.status).toBe(404);

	const invalidLikeAdd = await callApi('/api/recipes/99999/likes', {
		method: 'POST',
		body: JSON.stringify({ name: 'ghost' })
	});
	expect(invalidLikeAdd.status).toBe(404);

	const invalidLikeRemove = await callApi('/api/recipes/99999/likes/ghost', { method: 'DELETE' });
	expect(invalidLikeRemove.status).toBe(404);
});

test('recipe thumbnail data URL length cap is configurable via env', async () => {
	const oversizedThumbnail = `data:image/jpeg;base64,${'x'.repeat(80)}`;
	const res = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Oversized Thumbnail Recipe',
			description: '',
			author: '',
			ingredients: [],
			steps: [],
			notes: '',
			photoDataUrl: 'data:image/png;base64,PHOTO',
			photoThumbnailDataUrl: oversizedThumbnail
		})
	});

	expect(res.status).toBe(400);
});

test('ingredients endpoint returns catalogued names without duplicates', async () => {
	const first = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Sugary Toast',
			description: '',
			author: '',
			ingredients: [
				{ name: 'Sugar', quantity: 1, unit: 'cup', line: '1 cup Sugar' },
				{ name: 'butter', line: 'butter' }
			],
			steps: [],
			notes: ''
		})
	});
	expect(first.status).toBe(200);

	const duplicate = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Another',
			description: '',
			author: '',
			ingredients: [{ name: 'sugar', line: 'sugar' }],
			steps: [],
			notes: ''
		})
	});
	expect(duplicate.status).toBe(200);

	const cookbookRes = await callApi('/api/cookbooks', {
		method: 'POST',
		body: JSON.stringify({ name: `Second ${Date.now()}` })
	});
	expect(cookbookRes.status).toBe(200);
	const cookbook2 = (await cookbookRes.json()) as { id: number };

	const otherCookbook = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: cookbook2.id,
			title: 'Saffron Tea',
			description: '',
			author: '',
			ingredients: [{ name: 'Saffron', line: 'Saffron' }],
			steps: [],
			notes: ''
		})
	});
	expect(otherCookbook.status).toBe(200);

	const res = await callApi('/api/ingredients?cookbookId=1');
	expect(res.status).toBe(200);
	const names = (await res.json()) as string[];
	expect(names).toContain('Sugar');
	expect(names).toContain('butter');
	expect(names).not.toContain('Saffron');
	expect(names.filter((n) => n.toLowerCase() === 'sugar')).toHaveLength(1);
	expect(names.indexOf('butter')).toBeLessThan(names.indexOf('Sugar'));

	const scoped = await callApi(`/api/ingredients?cookbookId=${cookbook2.id}`);
	expect(scoped.status).toBe(200);
	const scopedNames = (await scoped.json()) as string[];
	expect(scopedNames).toContain('Saffron');

	const limited = await callApi('/api/ingredients?cookbookId=1&q=su&limit=1');
	expect(limited.status).toBe(200);
	const limitedNames = (await limited.json()) as string[];
	expect(limitedNames).toHaveLength(1);
	expect(limitedNames[0]).toBe('Sugar');
});

test('search finds recipes by ingredient name or line and records ingredient_id', async () => {
	const createRes = await callApi('/api/recipes', {
		method: 'POST',
		body: JSON.stringify({
			cookbook_id: 1,
			title: 'Spiced Tea',
			description: '',
			author: '',
			ingredients: [
				{ name: 'Cardamom', quantity: 3, unit: 'pods', line: '3 pods Cardamom' },
				'pinch of salt'
			],
			steps: [],
			notes: ''
		})
	});
	expect(createRes.status).toBe(200);
	const { id } = (await createRes.json()) as { id: number };

	const searchRes = await callApi('/api/recipes/search?cookbookId=1&q=carda');
	expect(searchRes.status).toBe(200);
	const list = (await searchRes.json()) as Array<{ id: number }>;
	expect(list.some((r) => r.id === id)).toBe(true);

	const ingredientRows = database
		.prepare('SELECT ingredient_id, line FROM ingredients WHERE recipe_id = ? ORDER BY position ASC')
		.all(id) as Array<{ ingredient_id: number | null; line: string }>;
	expect(ingredientRows[0].ingredient_id).not.toBeNull();
	expect(ingredientRows[0].line.toLowerCase()).toContain('cardamom');

	const saltRow = ingredientRows.find((row) => row.line.includes('salt'));
	expect(saltRow?.ingredient_id).not.toBeNull();

	const catalog = database
		.prepare('SELECT name FROM ingredient_names WHERE id = ?')
		.get(ingredientRows[0].ingredient_id!) as { name: string } | undefined;
	expect(catalog?.name.toLowerCase()).toBe('cardamom');
});

afterAll(() => {
	try {
		database.close();
	} catch (error) {
		console.error('Failed to close database after tests', error);
	}
	try {
		if (fs.existsSync(testDbPath)) fs.rmSync(testDbPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'EBUSY') {
			console.error('Failed to remove test database file', error);
		}
	}

	try {
		if (!distIndexExisted && fs.existsSync(distIndexPath)) fs.rmSync(distIndexPath);
		if (!distDirExisted && fs.existsSync(distDir)) {
			const remaining = fs.readdirSync(distDir);
			if (remaining.length === 0) fs.rmdirSync(distDir);
		}
	} catch (error) {
		console.error('Failed to clean up dist artifacts after tests', error);
	}
});
