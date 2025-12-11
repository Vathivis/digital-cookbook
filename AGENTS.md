# AI Assistant Project Instructions

Purpose: Enable AI agents to quickly extend and maintain the Digital Cookbook (Bun + React + Vite + Elysia + SQLite) without re-discovering core patterns.

Use bun for everything, never npm.

When invoking PowerShell commands, always include the flags `-NoLogo -NoProfile`.

## 1. High-Level Architecture
- Frontend: React 19 + TypeScript + Vite + Tailwind (utility classes) + Radix UI primitives (in `src/components/ui`).
- Backend: Lightweight Elysia server (`server/index.ts`) exposing JSON REST under `/api/*`, using Bun's native SQLite driver (`bun:sqlite`) with the file DB in `data/cookbook.db`. WAL + FK pragmas enabled.
- Dev runtime: Two processes started together via `bun run dev:full` (concurrently starts API + Vite dev server). Vite proxies `/api` -> `http://localhost:4000` (see `vite.config.ts`).
- Data model duplicated: Browser also has an optional WASM SQLite layer (`src/lib/db.ts`) NOT currently wired into UI (UI uses network `src/lib/api.ts`). Treat `db.ts` as experimental/local/offline layer.

## 2. Data Model (authoritative = server)
Tables: cookbooks, recipes, tags, recipe_tags (M2M), ingredients (ordered lines), steps (ordered lines), notes (single text), recipe_likes (unique (recipe_id,name)). Order is preserved via `position` columns.
Required fields when creating recipe: `cookbook_id`, `title`. Optional: description, author, ingredients[], steps[], notes, photoDataUrl (base64), tags[].

## 3. Key Backend Endpoints (see exact SQL in `server/index.ts`)
GET /api/health

GET /api/cookbooks; POST /api/cookbooks { name }

GET /api/recipes?cookbookId=ID (returns list with tags[], likes[] embedded)

GET /api/recipes/search?cookbookId=ID&q=term (SQL LIKE/EXISTS filter across title/description/tags/likes; capped to 200 rows)

GET /api/recipes/:id (full recipe w/ ingredients[], steps[], notes, tags[], likes[])

POST /api/recipes (create)

PATCH /api/recipes/:id (partial update; replaces ingredient/step/note sets when provided)

POST /api/recipes/:id/increment-uses (usage counter)
POST /api/recipes/:id/decrement-uses (usage counter)

POST /api/recipes/:id/tags { name } / DELETE /api/recipes/:id/tags/:name

POST /api/recipes/:id/likes { name } / DELETE /api/recipes/:id/likes/:name

DELETE /api/recipes/:id

GET /api/tags (list all tags alphabetically)

Patterns:
- Tag & like insertion use INSERT OR IGNORE then re-fetch.
- Updates of list fields are destructive replace (delete then bulk insert). Maintain ordering by array index.

## 4. Frontend Interaction Patterns
- All network calls centralized in `src/lib/api.ts`. Add new endpoints here; prefer returning parsed JSON.
- Main state reload pattern: parent holds `reload` function calling list/search, passes as `onChange` / `onCreated` to children (`RecipeCard`, `RecipeCreateCard`). After any mutation, call `onChange()`.
- Debounced search: `App.tsx` uses 200ms timeout on query change before calling search endpoint.
- Theme toggling: simple `localStorage` + root class `dark` (no context provider).
- Image handling: Stored as data URL (base64) in `photo` column/field; upload uses FileReader.
- Tag colors: Deterministic HSL based on string hash (`RecipeCard.tagStyles`). Reuse that if showing tags elsewhere.

## 5. UI Conventions
- Component folders: High-level feature components in `src/components`; design system primitives live in `src/components/ui/*` (shadcn-style, do not modify unless updating global styles).
- Tailwind class merging via `cn` helper (`src/lib/utils.ts`); currently little use-prefer direct classes unless dynamic composition needed.
- Use semantic HTML lists (`<ul>/<ol>`) for ingredients/steps in read mode.
- Keep dialog modals accessible: use existing `<Dialog>` wrapper components (Radix based) for new modals.

## 6. Adding / Modifying Features
- New API route: Implement in `server/index.ts` (Elysia + TypeScript). Keep small, synchronous DB ops; wrap multi-step mutations in a `bun:sqlite` transaction (`db.transaction(() => {...})`). Return minimal JSON.
- Mirror client function in `src/lib/api.ts`; keep naming verb-first (e.g., `addX`, `removeX`, `searchRecipes`).
- Extend recipe shape: Update SQL schema (migration strategy currently = startup create-if-not-exists; adding columns is safe with `ALTER TABLE`). Reflect changes in list and single GET queries; adjust `api.ts` types + consuming components.
- Maintain list endpoint contract: must include tags[] & likes[] to avoid extra per-card fetches. If you add counts/aggregates, compute in same query batch.
- For new searchable fields, extend the SQL `LIKE`/`EXISTS` clauses in `/api/recipes/search` so filtering happens in the database.

## 7. Performance / Gotchas
- Avoid N+1 on tags/likes: Current pattern batches by collecting recipe IDs then querying IN (...). Follow that style for new per-recipe metadata.
- Large photos: Currently stored as full base64 in DB & response; consider future optimization (thumbnail) before adding heavier media.
- Concurrency: `bun:sqlite` is synchronous; keep handlers fast. No background jobs.

## 8. Dev Workflow
Install: bun install
Start full stack: bun run dev:full (API on 4000, Vite on 5173, auto proxy)
Lint: bun run lint
Build prod: bun run build then (optionally) `bun run preview` for static assets (backend still needed separately for API).
DB file: `data/cookbook.db` (WAL). Safe to delete for reset (will reseed one cookbook).

## 9. Quick Decision Rules
- Need recipe-wide derived value? Add in list query to avoid per-card fetches.
- Editing lists = replace entire set (consistent with current PATCH semantics) unless changing paradigm.
- Prefer optimistic UI updates only where current code already does (likes). If adding new optimistic flows, ensure final sync by re-fetching.

## 10. Commit Message Instructions
Start with the task category like feat, refactor, fix, etc with a colon behind it, them the rest of the first line should be a single line summary with no more than 100 characters. The second line should be blank. Start the full summary on the third line. Use bullet points with short descriptions of the changes.

(End)
