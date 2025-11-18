import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Fuse from 'fuse.js';
import { Database } from 'bun:sqlite';

type StructuredIngredient = {
	line?: string;
	quantity?: number | null;
	unit?: string | null;
	name?: string | null;
};

type IngredientInput = string | StructuredIngredient;

interface RecipePayload {
	cookbook_id: number;
	title: string;
	description?: string;
	author?: string;
	servings?: number;
	ingredients?: IngredientInput[];
	steps?: string[];
	notes?: string;
	photoDataUrl?: string | null;
	tags?: string[];
}

interface RecipeRecord {
	id: number;
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	photo: string | null;
	uses: number;
	servings: number;
	created_at: string;
}

interface IngredientRow {
	line: string;
	quantity: number | null;
	unit: string | null;
	name: string | null;
	position: number;
}

interface StepRow {
	instruction: string;
	position: number;
}

interface NamePayload {
	name?: string;
}

const PORT = Number(process.env.PORT) || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '../data');
const envDbPath = process.env.COOKBOOK_DB_PATH?.trim();
const resolvedDbPath = envDbPath ? path.resolve(envDbPath) : path.join(defaultDataDir, 'cookbook.db');
const resolvedDir = envDbPath ? path.dirname(resolvedDbPath) : defaultDataDir;
if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });

const db = new Database(resolvedDbPath, { create: true });
export const database = db;
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

type StatementType = ReturnType<Database['prepare']>;
const withStatement = <T>(sql: string, handler: (stmt: StatementType) => T) => {
	const stmt = db.prepare(sql);
	try {
		return handler(stmt);
	} finally {
		stmt.finalize();
	}
};

const runStatement = (sql: string, ...params: unknown[]) => withStatement(sql, (stmt) => stmt.run(...params));
const getStatement = <T>(sql: string, ...params: unknown[]) => withStatement(sql, (stmt) => stmt.get(...params) as T | undefined);
const allStatement = <T>(sql: string, ...params: unknown[]) => withStatement(sql, (stmt) => stmt.all(...params) as T[]);
const runTransaction = <T>(handler: () => T) => {
	db.exec('BEGIN TRANSACTION');
	try {
		const result = handler();
		db.exec('COMMIT');
		return result;
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
};

const schema = `
CREATE TABLE IF NOT EXISTS cookbooks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	cookbook_id INTEGER NOT NULL,
	title TEXT NOT NULL,
	description TEXT DEFAULT '',
	author TEXT DEFAULT '',
	photo BLOB,
	uses INTEGER DEFAULT 0,
	servings INTEGER DEFAULT 1,
	created_at TEXT DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(cookbook_id) REFERENCES cookbooks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS recipe_tags (
	recipe_id INTEGER NOT NULL,
	tag_id INTEGER NOT NULL,
	PRIMARY KEY(recipe_id, tag_id),
	FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
	FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ingredients (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	recipe_id INTEGER NOT NULL,
	line TEXT NOT NULL,
	quantity REAL,
	unit TEXT,
	name TEXT,
	position INTEGER NOT NULL,
	FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS steps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	recipe_id INTEGER NOT NULL,
	instruction TEXT NOT NULL,
	position INTEGER NOT NULL,
	FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	recipe_id INTEGER NOT NULL,
	content TEXT NOT NULL,
	FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS recipe_likes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	recipe_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	created_at TEXT DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(recipe_id, name),
	FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
`;
db.exec(schema);

function ensureColumn(table: string, column: string, def: string) {
	try {
		const info = allStatement<{ name: string }>(`PRAGMA table_info(${table})`);
		if (!info.find((c) => c.name === column)) {
			runStatement(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
		}
	} catch {
		// Ignore; easiest recovery path is clearing the DB file
	}
}

ensureColumn('recipes', 'servings', 'INTEGER DEFAULT 1');
ensureColumn('ingredients', 'quantity', 'REAL');
ensureColumn('ingredients', 'unit', 'TEXT');
ensureColumn('ingredients', 'name', 'TEXT');

const cookbookCountRow = getStatement<{ c: number }>('SELECT COUNT(*) as c FROM cookbooks');
if (!cookbookCountRow || cookbookCountRow.c === 0) {
	runStatement('INSERT INTO cookbooks (name) VALUES (?)', 'My First Cookbook');
}

const badRequest = (set: { status: number }, message: string) => {
	set.status = 400;
	return { error: message };
};

const notFound = (set: { status: number }, message = 'not found') => {
	set.status = 404;
	return { error: message };
};

const mapRows = (rows: { recipeId: number; name: string }[]) => {
	const grouped: Record<number, string[]> = {};
	for (const row of rows) {
		if (!grouped[row.recipeId]) grouped[row.recipeId] = [];
		grouped[row.recipeId].push(row.name);
	}
	return grouped;
};

const fetchTags = (ids: number[]) => {
	if (!ids.length) return {};
	const placeholders = ids.map(() => '?').join(',');
	const rows = allStatement<{ recipeId: number; name: string }>(
		`SELECT rt.recipe_id as recipeId, t.name as name
		 FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
		 WHERE rt.recipe_id IN (${placeholders})`,
		...ids
	);
	return mapRows(rows);
};

const fetchLikes = (ids: number[]) => {
	if (!ids.length) return {};
	const placeholders = ids.map(() => '?').join(',');
	const rows = allStatement<{ recipeId: number; name: string }>(
		`SELECT recipe_id as recipeId, name FROM recipe_likes WHERE recipe_id IN (${placeholders})`,
		...ids
	);
	return mapRows(rows);
};

const insertIngredients = (recipeId: number, list: IngredientInput[]) => {
	if (!list?.length) return;
	withStatement(
		'INSERT INTO ingredients (recipe_id, line, quantity, unit, name, position) VALUES (?,?,?,?,?,?)',
		(stmt) => {
			list.forEach((ing, idx) => {
				if (ing && typeof ing === 'object') {
					stmt.run(
						recipeId,
						ing.line || (ing.name ? ing.name : ''),
						ing.quantity ?? null,
						ing.unit ?? null,
						ing.name ?? null,
						idx
					);
				} else {
					stmt.run(recipeId, String(ing), null, null, null, idx);
				}
			});
		}
	);
};

const insertSteps = (recipeId: number, steps: string[]) => {
	if (!steps?.length) return;
	withStatement('INSERT INTO steps (recipe_id, instruction, position) VALUES (?,?,?)', (stmt) => {
		steps.forEach((step, idx) => stmt.run(recipeId, step, idx));
	});
};

const insertTags = (recipeId: number, tags?: string[]) => {
	if (!tags?.length) return;
	const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
	const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
	const link = db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?,?)');
	try {
		for (const tag of tags) {
			const name = tag?.trim();
			if (!name) continue;
			insertTag.run(name);
			const tagId = (getTag.get(name) as { id: number } | undefined)?.id;
			if (tagId) link.run(recipeId, tagId);
		}
	} finally {
		insertTag.finalize();
		getTag.finalize();
		link.finalize();
	}
};

export const app = new Elysia({
	serve: {
		maxRequestBodySize: 25 * 1024 * 1024 // match previous Express 25MB limit
	}
})
	.use(cors())
	.get('/api/health', () => ({ ok: true }))
	.get('/api/cookbooks', () => {
		return allStatement<{ id: number; name: string }>('SELECT id, name FROM cookbooks ORDER BY created_at ASC');
	})
	.post('/api/cookbooks', ({ body, set }) => {
		const { name: rawName } = ((body ?? {}) as NamePayload);
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		if (!name) return badRequest(set, 'name is required');
		const info = runStatement('INSERT INTO cookbooks (name) VALUES (?)', name);
		return { id: Number(info.lastInsertRowid), name };
	})
	.patch('/api/cookbooks/:id', ({ params, body, set }) => {
		const id = Number(params.id);
		if (!id) return badRequest(set, 'id required');
		const { name: rawName } = ((body ?? {}) as NamePayload);
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		if (!name) return badRequest(set, 'name required');
		const info = runStatement('UPDATE cookbooks SET name=? WHERE id=?', name, id);
		if (info.changes === 0) return notFound(set);
		return { ok: true };
	})
	.delete('/api/cookbooks/:id', ({ params, set }) => {
		const id = Number(params.id);
		if (!id) return badRequest(set, 'id required');
		const info = runStatement('DELETE FROM cookbooks WHERE id=?', id);
		if (info.changes === 0) return notFound(set);
		return { ok: true };
	})
	.get('/api/recipes', ({ query, set }) => {
		const cookbookId = Number(query.cookbookId);
		if (!cookbookId) return badRequest(set, 'cookbookId is required');
		const recipes = allStatement<RecipeRecord>(
			`SELECT id, cookbook_id, title, description, author, photo, uses, servings, created_at
			 FROM recipes WHERE cookbook_id = ?
			 ORDER BY LOWER(title) ASC, id ASC`,
			cookbookId
		);
		if (!recipes.length) return [];
		const ids = recipes.map((r) => r.id as number);
		const tagsBy = fetchTags(ids);
		const likesBy = fetchLikes(ids);
		return recipes.map((r) => ({
			...r,
			tags: tagsBy[r.id] || [],
			likes: likesBy[r.id] || []
		}));
	})
	.get('/api/recipes/search', ({ query, set }) => {
		const cookbookId = Number(query.cookbookId);
		const term = typeof query.q === 'string' ? query.q.trim() : '';
		if (!cookbookId) return badRequest(set, 'cookbookId is required');
		const base = allStatement<RecipeRecord>(
			`SELECT id, cookbook_id, title, description, author, photo, uses, servings, created_at
			 FROM recipes WHERE cookbook_id = ?
			 ORDER BY LOWER(title) ASC, id ASC`,
			cookbookId
		);
		const ids = base.map((r) => r.id as number);
		const tagsBy = fetchTags(ids);
		const likesBy = fetchLikes(ids);
		const items = base.map((r) => ({
			...r,
			tags: tagsBy[r.id] || [],
			likes: likesBy[r.id] || []
		}));
		if (!term) return items;
		const fuse = new Fuse(items, { keys: ['title', 'description', 'tags', 'likes'], threshold: 0.4 });
		return fuse.search(term).map((x) => x.item);
	})
	.get('/api/recipes/:id', ({ params, set }) => {
		const id = Number(params.id);
		const recipe = getStatement<RecipeRecord>(
			`SELECT id, cookbook_id, title, description, author, photo, uses, servings, created_at
			 FROM recipes WHERE id=?`,
			id
		);
		if (!recipe) return notFound(set);
		const ingredientsRows = allStatement<IngredientRow>(
			'SELECT line, quantity, unit, name, position FROM ingredients WHERE recipe_id=? ORDER BY position ASC',
			id
		);
		const ingredients = ingredientsRows.map((row) => {
			if (row.name != null || row.quantity != null || row.unit != null) {
				return { line: row.line, quantity: row.quantity, unit: row.unit, name: row.name };
			}
			return { line: row.line };
		});
		const steps = allStatement<StepRow>('SELECT instruction, position FROM steps WHERE recipe_id=? ORDER BY position ASC', id).map(
			(row) => row.instruction
		);
		const noteRow = getStatement<{ content: string }>('SELECT content FROM notes WHERE recipe_id=?', id);
		const tags = allStatement<{ name: string }>(
			'SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id=?',
			id
		).map((row) => row.name);
		const likes = allStatement<{ name: string }>(
			'SELECT name FROM recipe_likes WHERE recipe_id=? ORDER BY created_at ASC',
			id
		).map((row) => row.name);
		return { ...recipe, ingredients, steps, notes: noteRow?.content || '', tags, likes };
	})
	.post('/api/recipes', ({ body, set }) => {
		const input = (body || {}) as Partial<RecipePayload>;
		const cookbookId = Number(input.cookbook_id);
		const title = typeof input.title === 'string' ? input.title.trim() : '';
		if (!cookbookId || !title) return badRequest(set, 'cookbook_id and title are required');
		const create = (payload: Partial<RecipePayload>) => {
			const info = runStatement(
				`INSERT INTO recipes (cookbook_id, title, description, author, photo, servings)
				 VALUES (?,?,?,?,?,?)`,
				cookbookId,
				title,
				payload.description || '',
				payload.author || '',
				payload.photoDataUrl || null,
				payload.servings || 1
			);
			const recipeId = Number(info.lastInsertRowid);
			insertIngredients(recipeId, payload.ingredients || []);
			insertSteps(recipeId, payload.steps || []);
			if (payload.notes?.trim()) {
				runStatement('INSERT INTO notes (recipe_id, content) VALUES (?,?)', recipeId, payload.notes);
			}
			insertTags(recipeId, payload.tags);
			return recipeId;
		};
		const id = runTransaction(() => create(input));
		return { id };
	})
	.patch('/api/recipes/:id', ({ params, body, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const exists = getStatement<{ id: number }>('SELECT id FROM recipes WHERE id = ?', id);
		if (!exists) return notFound(set);
		const input = (body || {}) as Partial<RecipePayload>;
		const update = (payload: Partial<RecipePayload>) => {
			const updates: string[] = [];
			const params: (string | number | null)[] = [];
			if (typeof payload.title === 'string') {
				updates.push('title = ?');
				params.push(payload.title);
			}
			if (typeof payload.description === 'string') {
				updates.push('description = ?');
				params.push(payload.description);
			}
			if (typeof payload.author === 'string') {
				updates.push('author = ?');
				params.push(payload.author);
			}
			if (Object.prototype.hasOwnProperty.call(payload, 'photoDataUrl')) {
				updates.push('photo = ?');
				params.push(payload.photoDataUrl ?? null);
			}
			if (typeof payload.servings === 'number') {
				updates.push('servings = ?');
				params.push(payload.servings);
			}
			if (updates.length) {
				params.push(id);
				runStatement(`UPDATE recipes SET ${updates.join(', ')} WHERE id = ?`, ...params);
			}
			if (Array.isArray(payload.ingredients)) {
				runStatement('DELETE FROM ingredients WHERE recipe_id=?', id);
				insertIngredients(id, payload.ingredients);
			}
			if (Array.isArray(payload.steps)) {
				runStatement('DELETE FROM steps WHERE recipe_id=?', id);
				insertSteps(id, payload.steps);
			}
			if (typeof payload.notes === 'string') {
				runStatement('DELETE FROM notes WHERE recipe_id=?', id);
				if (payload.notes.trim()) {
					runStatement('INSERT INTO notes (recipe_id, content) VALUES (?,?)', id, payload.notes);
				}
			}
		};
		runTransaction(() => update(input));
		return { ok: true };
	})
	.post('/api/recipes/:id/increment-uses', ({ params, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const info = runStatement('UPDATE recipes SET uses = uses + 1 WHERE id = ?', id);
		if (info.changes === 0) return notFound(set);
		const row = getStatement<{ uses: number }>('SELECT uses FROM recipes WHERE id = ?', id);
		return { ok: true, uses: row?.uses ?? 0 };
	})
	.post('/api/recipes/:id/decrement-uses', ({ params, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const existing = getStatement<{ uses: number }>('SELECT uses FROM recipes WHERE id = ?', id);
		if (!existing) return notFound(set);
		const next = existing.uses > 0 ? existing.uses - 1 : 0;
		if (next !== existing.uses) {
			runStatement('UPDATE recipes SET uses = ? WHERE id = ?', next, id);
		}
		return { ok: true, uses: next };
	})
	.post('/api/recipes/:id/tags', ({ params, body, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const recipeExists = getStatement<{ id: number }>('SELECT id FROM recipes WHERE id = ?', id);
		if (!recipeExists) return notFound(set);
		const { name: rawName } = ((body ?? {}) as NamePayload);
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		if (!name) return badRequest(set, 'name required');
		runStatement('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
		const tagId = getStatement<{ id: number }>('SELECT id FROM tags WHERE name = ?', name);
		if (tagId) runStatement('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?,?)', id, tagId.id);
		return { ok: true };
	})
	.delete('/api/recipes/:id/tags/:name', ({ params, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const recipeExists = getStatement<{ id: number }>('SELECT id FROM recipes WHERE id = ?', id);
		if (!recipeExists) return notFound(set);
		const name = params.name;
		const row = getStatement<{ id: number }>('SELECT id FROM tags WHERE name = ?', name);
		if (row) runStatement('DELETE FROM recipe_tags WHERE recipe_id=? AND tag_id=?', id, row.id);
		return { ok: true };
	})
	.post('/api/recipes/:id/likes', ({ params, body, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const recipeExists = getStatement<{ id: number }>('SELECT id FROM recipes WHERE id = ?', id);
		if (!recipeExists) return notFound(set);
		const { name: rawName } = ((body ?? {}) as NamePayload);
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		if (!name) return badRequest(set, 'name required');
		runStatement('INSERT OR IGNORE INTO recipe_likes (recipe_id, name) VALUES (?,?)', id, name);
		return { ok: true };
	})
	.delete('/api/recipes/:id/likes/:name', ({ params, set }) => {
		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return badRequest(set, 'id required');
		const recipeExists = getStatement<{ id: number }>('SELECT id FROM recipes WHERE id = ?', id);
		if (!recipeExists) return notFound(set);
		const name = params.name;
		runStatement('DELETE FROM recipe_likes WHERE recipe_id=? AND name=?', id, name);
		return { ok: true };
	})
	.delete('/api/recipes/:id', ({ params, set }) => {
		const id = Number(params.id);
		const info = runStatement('DELETE FROM recipes WHERE id=?', id);
		if (info.changes === 0) return notFound(set);
		return { ok: true };
	})
	.get('/api/tags', ({ set }) => {
		try {
			const rows = allStatement<{ name: string }>('SELECT name FROM tags ORDER BY LOWER(name) ASC');
			return rows.map((r) => r.name);
		} catch {
			set.status = 500;
			return { error: 'failed to fetch tags' };
		}
	});

if (import.meta.main) {
	app.listen(PORT);
	console.log(`API listening on http://localhost:${app.server?.hostname || 'localhost'}:${app.server?.port || PORT}`);
}
