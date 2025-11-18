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

afterAll(() => {
	try {
		database.close();
	} catch (error) {
		console.error('Failed to close database after tests', error);
	}
	try {
		if (fs.existsSync(testDbPath)) fs.rmSync(testDbPath);
	} catch (error) {
		console.error('Failed to remove test database file', error);
	}
});
