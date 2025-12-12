import initSqlJs, { Database } from 'sql.js';

let dbPromise: Promise<Database> | null = null;
const LS_KEY = 'cookbook_sqlite';

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
	photo BLOB, -- stored as base64 data URLs
	uses INTEGER DEFAULT 0,
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
);`;

export async function getDb() {
	if (!dbPromise) {
		dbPromise = (async () => {
			const SQL = await initSqlJs({ locateFile: (f: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/${f}` });
			let db: Database;
			const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
			if (stored) {
				try {
					const binary = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
					db = new SQL.Database(binary);
				} catch (error) {
					console.warn('Failed to restore persisted database; starting fresh', error);
					db = new SQL.Database();
				}
			} else {
				db = new SQL.Database();
			}
			db.exec(schema);
			const res = db.exec('SELECT COUNT(*) as c FROM cookbooks');
			if (res.length === 0 || (res[0].values[0][0] as number) === 0) {
				db.run('INSERT INTO cookbooks (name) VALUES (?)', ['My First Cookbook']);
			}
			return db;
		})();
	}
	return dbPromise;
}

function saveDb(db: Database) {
	try {
		const data = db.export();
		const b64 = btoa(String.fromCharCode(...data));
		localStorage.setItem(LS_KEY, b64);
	} catch (error) {
		console.error('Failed to persist cookbook database', error);
	}
}

type RecipeRow = [
	number,
	number,
	string,
	string,
	string,
	string | null,
	number,
	string
];

export type RecipeInput = {
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	ingredients: string[];
	steps: string[];
	notes?: string;
	photoDataUrl?: string;
	tags?: string[];
};

export async function createRecipe(input: RecipeInput) {
	const db = await getDb();
	db.run(`INSERT INTO recipes (cookbook_id, title, description, author, photo) VALUES (?,?,?,?,?)`, [
		input.cookbook_id,
		input.title,
		input.description,
		input.author,
		input.photoDataUrl || null,
	]);
	const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number;
	insertList(db, 'ingredients', 'line', id, input.ingredients);
	insertList(db, 'steps', 'instruction', id, input.steps);
	if (input.notes) {
		db.run('INSERT INTO notes (recipe_id, content) VALUES (?,?)', [id, input.notes]);
	}
	if (input.tags?.length) {
		await Promise.all(input.tags.map(tag => addTagToRecipe(id, tag.trim())));
	}
	saveDb(db);
	return id;
}

function insertList(db: Database, table: string, column: string, recipeId: number, arr: string[]) {
	if (!arr || !arr.length) return;
	arr.forEach((val, idx) => {
		db.run(`INSERT INTO ${table} (recipe_id, ${column}, position) VALUES (?,?,?)`, [recipeId, val, idx]);
	});
}

export async function getRecipes(cookbookId: number) {
	const db = await getDb();
	const res = db.exec(`SELECT * FROM recipes WHERE cookbook_id = ? ORDER BY created_at DESC`, [cookbookId]);
	if (res.length === 0) return [];
	const recipes = res[0].values.map((value) => {
		const row = value as RecipeRow;
		return {
		id: row[0],
		cookbook_id: row[1],
		title: row[2],
		description: row[3],
		author: row[4],
		photo: row[5],
		uses: row[6],
		created_at: row[7],
		tags: [] as string[],
		};
	});
	for (const rec of recipes) {
		const tagRes = db.exec(`SELECT t.name FROM tags t JOIN recipe_tags rt ON t.id=rt.tag_id WHERE rt.recipe_id = ?`, [rec.id]);
		rec.tags = tagRes.length ? tagRes[0].values.map(value => value[0] as string) : [];
	}
	return recipes;
}

export async function incrementUses(recipeId: number) {
	const db = await getDb();
	db.run('UPDATE recipes SET uses = uses + 1 WHERE id = ?', [recipeId]);
	saveDb(db);
}

type CookbookRow = [number, string];

export async function listCookbooks() {
	const db = await getDb();
	const res = db.exec('SELECT id, name FROM cookbooks ORDER BY created_at ASC');
	return res.length
		? res[0].values.map((value) => {
			const row = value as CookbookRow;
			return { id: row[0], name: row[1] };
		})
		: [];
}

export async function createCookbook(name: string) {
	const db = await getDb();
	db.run('INSERT INTO cookbooks (name) VALUES (?)', [name]);
	saveDb(db);
}

export async function addTagToRecipe(recipeId: number, name: string) {
	if (!name) return;
	const db = await getDb();
	try {
		db.run('INSERT INTO tags (name) VALUES (?)', [name]);
	} catch (error) {
		console.warn('Failed to insert tag (may already exist)', error);
	}
	const tagIdRes = db.exec('SELECT id FROM tags WHERE name = ?', [name]);
	if (tagIdRes.length) {
		const tagId = tagIdRes[0].values[0][0] as number;
		try {
			db.run('INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (?,?)', [recipeId, tagId]);
		} catch (error) {
			console.warn('Failed to link tag to recipe', error);
		}
		saveDb(db);
	}
}

export async function removeTagFromRecipe(recipeId: number, name: string) {
	const db = await getDb();
	const tagIdRes = db.exec('SELECT id FROM tags WHERE name = ?', [name]);
	if (!tagIdRes.length) return;
	const tagId = tagIdRes[0].values[0][0] as number;
	db.run('DELETE FROM recipe_tags WHERE recipe_id=? AND tag_id=?', [recipeId, tagId]);
	saveDb(db);
}

interface FuseSearchResult<T> {
	item: T;
}

export async function fuzzySearchRecipes(cookbookId: number, term: string) {
	const Fuse = (await import('fuse.js')).default;
	const recipes = await getRecipes(cookbookId);
	const fuse = new Fuse(recipes, { keys: ['title', 'description', 'tags'], threshold: 0.4 });
	if (!term) return recipes;
	return fuse.search(term).map((result: FuseSearchResult<typeof recipes[number]>) => result.item);
}
