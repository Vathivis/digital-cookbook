# Digital Cookbook

Digital Cookbook is a full-stack recipe manager built with **Bun + React + Vite + Elysia + SQLite**. It’s intentionally scoped for in-home/local use with a single shared credential option (no account/user management or hosted deployment workflows). If you want to run it publicly you’d still need stronger security hardening and persistence planning.

## Tech Stack
- **Frontend:** React 19, TypeScript, Vite, Tailwind, shadcn.
- **Backend:** Elysia (Bun) with the `bun:sqlite` driver storing data in `data/cookbook.db` (WAL + foreign keys enabled).
- **Tooling:** Bun scripts for dev/build/test, ESLint, server-side SQL search, custom FLIP animation hook.

## Highlighted Features
- Multiple cookbooks with inline rename/delete and confirmation flows.
- Rich recipe cards with photos, servings scaling, drag-and-drop ingredient/step reordering.
- Tag-based filtering (AND/OR), debounced search, and animated grid transitions.
- Likes, tags, and cook-count tracking.
- Optional experimental WASM SQLite layer (`src/lib/db.ts`) for potential offline/local extensions.

## Features
### Add & curate recipes
Create recipes with photos, author notes, ingredient quantities, ordered steps, tags, and optional rich notes—all inside a single dialog that handles uploads and validation.

![New recipe](docs/image-1.png)

### Powerful sorting options
Switch between alphabetical (A→Z / Z→A) and “Most cooked” sorting so the list surfaces favorites or keeps things organized by title.

### Tag filtering modes
Filter recipes with AND/OR logic to narrow down to exact tag combinations or quickly browse anything matching a tag set.

### Ingredient scaling per serving
Adjust servings directly on the recipe card; ingredient quantities recalculate on the fly so shopping lists always match the desired portion size.

### Debounced search & animations
Typing in the search bar triggers a 200 ms debounced SQL-backed lookup (LIKE/EXISTS matching across title, description, tags, likes), while the recipe grid animates insertions/removals using FLIP-based transitions.

### Engagement tracking
Recipes track likes and usage counts, with optimistic UI updates to keep interactions feeling instant.

## Project Structure
```
.
├─ server/            # Elysia API + SQLite schema/queries
├─ src/
│  ├─ components/    # Feature components (RecipeCard, sidebar, etc.)
│  ├─ components/ui/ # Design-system primitives (Radix wrappers/shadcn style)
│  ├─ hooks/         # Reusable hooks (e.g., useFlipList)
│  ├─ lib/           # API client, experimental sql.js DB, helpers
│  └─ types/         # Ambient declarations
├─ data/cookbook.db  # SQLite database (auto-created, safe to delete for reset)
├─ AGENTS.md         # AI/maintainer instructions and conventions
```

## Prerequisites
- [Bun](https://bun.sh/) v1.1+
- Node-compatible environment (used for tooling via Bun)

> **Note:** Always use `bun` instead of `npm`/`yarn`, and when running PowerShell commands include `-NoLogo -NoProfile` (mirrors automation rules in `AGENTS.md`).

## Quickstart
```bash
# Install dependencies
bun install

# Start API + Vite dev servers concurrently (API:4000, Vite:5173)
bun run dev:full

# Run only the API server
bun run server

# Run only the Vite dev server
bun run dev
```

Visit `http://localhost:5173` and interact with the UI; `/api/*` calls proxy to `http://localhost:4000` via Vite.

## Optional Auth
You can enable a simple shared login (one username/password from env, no user database).

```bash
# .env
AUTH_ENABLED=true
AUTH_USERNAME=your-username
AUTH_PASSWORD=your-password
```

Behavior:
- When enabled, unauthenticated users see a login screen in the React app.
- Login sets an HttpOnly cookie session.
- Default session lifetime is 30 days.
- Checking “Remember login permanently” sets a ~10-year cookie.
- There is no account registration, password reset, or multi-user management.

If `AUTH_ENABLED=true` and either `AUTH_USERNAME` or `AUTH_PASSWORD` is missing, server startup fails.

## Additional Scripts
```bash
# Lint the project
bun run lint

# Execute tests (Bun test + happy-dom, loads .env.test)
bun run test

# Production build (type-check + Vite build)
bun run build

# Preview built frontend (still requires API server separately)
bun run preview
```

## Docker (single container)
GitHub Container Registry image: `ghcr.io/vathivis/digital-cookbook`

The provided `Dockerfile` builds the Vite frontend and serves it from the same Bun/Elysia server process. The container exposes one port and serves:
- `GET /` (and SPA routes) from `dist/`
- `/api/*` from the Elysia API


```bash
# Pull prebuilt image from GHCR
docker pull ghcr.io/vathivis/digital-cookbook:latest

# Run GHCR image (persists SQLite DB in a named volume)
docker run --name digital-cookbook -p 4000:4000 -v cookbook_data:/app/data ghcr.io/vathivis/digital-cookbook:latest

# Build image
docker build -t digital-cookbook:local .

# Run (persists SQLite DB in a named volume)
docker run --name digital-cookbook -p 4000:4000 -v cookbook_data:/app/data digital-cookbook:local
```

Open `http://localhost:4000`.

Notes:
- Data is persisted via `/app/data` (default `COOKBOOK_DB_PATH=/app/data/cookbook.db`).
- Override listen address/port with `HOST` / `PORT` env vars if needed.
- Optional auth can also be set via env (`AUTH_ENABLED`, `AUTH_USERNAME`, `AUTH_PASSWORD`).
- Image includes a Docker `HEALTHCHECK` that probes `GET /health`, so `docker ps` reports `healthy`/`unhealthy`.
- The image-level `HEALTHCHECK` timings are baked into the image. Runtime env vars such as `HEALTHCHECK_INTERVAL` do not affect `docker run` by themselves.

If you want healthcheck timings to come from `.env`, use the provided `compose.yml`:

```bash
docker compose up --build -d
```

`compose.yml` wires these env vars into the service healthcheck:
- `HEALTHCHECK_INTERVAL`
- `HEALTHCHECK_TIMEOUT`
- `HEALTHCHECK_START_PERIOD`
- `HEALTHCHECK_RETRIES`

With Compose, the container still probes `GET /health`, and the app still uses:
- `PORT`
- `HOST`
- `COOKBOOK_DB_PATH`
- `AUTH_ENABLED`
- `AUTH_USERNAME`
- `AUTH_PASSWORD`

## Backend Overview
- `server/index.ts` boots the Bun SQLite DB (WAL + FK) and defines routes such as:
  - `GET /api/cookbooks`, `POST /api/cookbooks`, `PATCH/DELETE /api/cookbooks/:id`
  - `GET /api/recipes?cookbookId=…`, `GET /api/recipes/search`
  - `GET /api/recipes/:id`, `POST /api/recipes`, `PATCH /api/recipes/:id`, `DELETE /api/recipes/:id`
  - Tag & like helpers (`POST/DELETE /api/recipes/:id/tags|likes`)
  - Usage counter actions (`POST /api/recipes/:id/increment-uses`, `/decrement-uses`)
  - Ingredient catalog (`GET /api/ingredients`) backed by a deduped, case-insensitive `ingredient_names` table for autocomplete suggestions
- Multi-step mutations run inside `db.transaction` calls and follow a “delete & replace” pattern for ordered lists (ingredients, steps, notes) to preserve deterministic ordering.

## Frontend Interaction Patterns
- All network requests go through `src/lib/api.ts`. Add new endpoints here first, then wire components.
- Parents expose a `reload` handler; children (`RecipeCard`, `RecipeCreateCard`) call it after any mutation.
- Search is debounced by 200 ms inside `App.tsx`; tag filtering supports AND/OR modes.
- Theme toggling persists via `localStorage` + a root `dark` class; there’s no context provider.
- Design-system primitives in `src/components/ui/*` should remain untouched unless updating global styles (keep overrides in feature components instead).

## Working Notes
- Need to reset the DB? Delete `data/cookbook.db` and restart; the server reseeds a default cookbook automatically.

Happy cooking! 🍳
