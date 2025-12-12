import { afterAll, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';

const tmpDir = path.resolve(process.cwd(), '.tmp-tests');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const testDbPath = path.join(tmpDir, `cookbook-${Date.now()}.db`);
process.env.COOKBOOK_DB_PATH = testDbPath;

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

	const res = await callApi('/api/ingredients');
	expect(res.status).toBe(200);
	const names = (await res.json()) as string[];
	expect(names).toContain('Sugar');
	expect(names).toContain('butter');
	expect(names.filter((n) => n.toLowerCase() === 'sugar')).toHaveLength(1);
	expect(names.indexOf('butter')).toBeLessThan(names.indexOf('Sugar'));
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
});
