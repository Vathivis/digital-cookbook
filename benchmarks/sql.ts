import { performance } from 'perf_hooks';
import { applyBenchmarkEnv, getBenchmarkOptions } from './config';
import { writeBenchmarkReport, type QueryPlanMetric } from './report';

type Statement = {
	all: (...params: unknown[]) => unknown[];
	finalize: () => void;
};

type BenchmarkDatabase = {
	prepare: (sql: string) => Statement;
	close: () => void;
};

function runQueryPlan(database: BenchmarkDatabase, label: string, sql: string, params: unknown[] = []): QueryPlanMetric {
	const explain = database.prepare(`EXPLAIN QUERY PLAN ${sql}`);
	const statement = database.prepare(sql);
	const started = performance.now();
	try {
		const planRows = explain.all(...params) as Array<{ detail?: string }>;
		const rows = statement.all(...params);
		return {
			label,
			durationMs: performance.now() - started,
			rowCount: rows.length,
			plan: planRows.map((row) => row.detail ?? JSON.stringify(row)),
		};
	} finally {
		explain.finalize();
		statement.finalize();
	}
}

if (import.meta.main) {
	const startedAt = new Date().toISOString();
	const options = getBenchmarkOptions();
	applyBenchmarkEnv(options);
	const { database } = await import(`../server/index.ts?benchmark-sql=${Date.now()}`);
	const db = database as BenchmarkDatabase;
	const idRows = db.prepare('SELECT id FROM recipes ORDER BY id ASC LIMIT 50').all() as Array<{ id: number }>;
	const ids = idRows.map((row) => row.id);
	const placeholders = ids.map(() => '?').join(',');
	const plans: QueryPlanMetric[] = [];

	plans.push(
		runQueryPlan(
			db,
			'recipes:list',
			`SELECT id, cookbook_id, title, description, author, uses, servings, created_at
			 FROM recipes WHERE cookbook_id = ?
			 ORDER BY LOWER(title) ASC, id ASC`,
			[1]
		)
	);
	plans.push(
		runQueryPlan(
			db,
			'recipes:search:title-description',
			`SELECT r.id, r.cookbook_id, r.title, r.description, r.author, r.uses, r.servings, r.created_at
			 FROM recipes r
			 WHERE r.cookbook_id = ?
			 AND (LOWER(r.title) LIKE ? ESCAPE '\\' OR LOWER(r.description) LIKE ? ESCAPE '\\')
			 ORDER BY LOWER(r.title) ASC, r.id ASC
			 LIMIT 200`,
			[1, '%pomodoro%', '%pomodoro%']
		)
	);
	plans.push(
		runQueryPlan(
			db,
			'recipes:search:ingredient',
			`SELECT r.id
			 FROM recipes r
			 WHERE r.cookbook_id = ?
			 AND EXISTS (
				SELECT 1 FROM ingredients i
				LEFT JOIN ingredient_names n ON n.id = i.ingredient_id
				WHERE i.recipe_id = r.id AND LOWER(COALESCE(n.name, i.name, i.line)) LIKE ? ESCAPE '\\'
			 )
			 ORDER BY LOWER(r.title) ASC, r.id ASC
			 LIMIT 200`,
			[1, '%tomato%']
		)
	);
	if (ids.length) {
		plans.push(
			runQueryPlan(
				db,
				'metadata:photo-urls-batch',
				`SELECT recipe_id as recipeId, variant as variant, updated_at as updatedAt
				 FROM recipe_photo_variants
				 WHERE recipe_id IN (${placeholders})`,
				ids
			)
		);
		plans.push(
			runQueryPlan(
				db,
				'metadata:ingredient-names-batch',
				`SELECT i.recipe_id as recipeId, TRIM(COALESCE(n.name, i.name, i.line)) as name
				 FROM ingredients i
				 LEFT JOIN ingredient_names n ON n.id = i.ingredient_id
				 WHERE i.recipe_id IN (${placeholders})
				 ORDER BY i.position ASC`,
				ids
			)
		);
		plans.push(
			runQueryPlan(
				db,
				'metadata:tags-batch',
				`SELECT rt.recipe_id as recipeId, t.name as name
				 FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
				 WHERE rt.recipe_id IN (${placeholders})`,
				ids
			)
		);
		plans.push(
			runQueryPlan(
				db,
				'metadata:likes-batch',
				`SELECT recipe_id as recipeId, name FROM recipe_likes WHERE recipe_id IN (${placeholders})`,
				ids
			)
		);
		plans.push(
			runQueryPlan(
				db,
				'recipe:detail:ingredients',
				'SELECT line, quantity, unit, name, position FROM ingredients WHERE recipe_id=? ORDER BY position ASC',
				[ids[0]]
			)
		);
	}
	plans.push(
		runQueryPlan(
			db,
			'ingredients:suggest',
			`SELECT DISTINCT n.name as name
			 FROM ingredient_names n
			 JOIN ingredients i ON i.ingredient_id = n.id
			 JOIN recipes r ON r.id = i.recipe_id
			 WHERE r.cookbook_id = ? AND LOWER(n.name) LIKE ? ESCAPE '\\'
			 ORDER BY
				CASE
					WHEN LOWER(n.name) = ? THEN 0
					WHEN LOWER(n.name) LIKE ? ESCAPE '\\' THEN 1
					ELSE 2
				END,
				LENGTH(n.name) ASC,
				LOWER(n.name) ASC
			 LIMIT ?`,
			[1, '%tom%', 'tom', 'tom%', 20]
		)
	);

	const written = writeBenchmarkReport(options, {
		name: 'benchmark-backend-sql',
		startedAt,
		options,
		queryPlans: plans,
		notes: ['SQL timings are local query execution timings plus EXPLAIN QUERY PLAN output.'],
	});
	console.log(`Wrote SQL benchmark report: ${written.mdPath}`);
	db.close();
}
