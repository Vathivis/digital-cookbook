import { afterAll, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';

const tmpDir = path.resolve(process.cwd(), '.tmp-tests');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, `cookbook-${Date.now()}.db`);
process.env.COOKBOOK_DB_PATH = testDbPath;

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

const { app, database } = await import('../../server/index');

async function callApi(pathname: string, init?: RequestInit) {
	const headers = new Headers(init?.headers ?? {});
	if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const request = new Request(`http://localhost${pathname}`, { ...init, headers });
	const appLike = app as AppLike;
	const handler = appLike.handle ?? appLike.fetch;
	return handler.call(app, request);
}

test('unknown /api routes return a JSON 404 even with static SPA fallback enabled', async () => {
	const res = await callApi('/api/does-not-exist');
	expect(res.status).toBe(404);
	await expect(res.json()).resolves.toEqual({ error: 'not found' });
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
			photoDataUrl: 'data:image/png;base64,AAA'
		})
	});
	expect(createRes.status).toBe(200);
	const { id } = (await createRes.json()) as { id: number };
	expect(typeof id).toBe('number');

	const detailBefore = await callApi(`/api/recipes/${id}`);
	expect(detailBefore.status).toBe(200);
	const beforePayload = await detailBefore.json();
	expect(beforePayload.photo).toBe('data:image/png;base64,AAA');

	const patchClear = await callApi(`/api/recipes/${id}`, {
		method: 'PATCH',
		body: JSON.stringify({ photoDataUrl: null })
	});
	expect(patchClear.status).toBe(200);

	const detailAfter = await callApi(`/api/recipes/${id}`);
	const afterPayload = await detailAfter.json();
	expect(afterPayload.photo).toBeNull();

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
