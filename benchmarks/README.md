# Benchmarking

Run benchmark commands from the repository root. The benchmark harness is separate from normal app behavior. It uses a benchmark SQLite DB, generates reports under `benchmark-results/`, and does not change `bun run dev:full` or production routes.

Backend-only benchmark:
```bash
bun run benchmark:backend -- --profile realistic --mode local-fast
```

Frontend/UI benchmark:
```bash
# One-time browser install for Playwright UI runs
bunx playwright install chromium

bun run benchmark:frontend -- --profile realistic --mode local-fast
```

Full benchmark:
```bash
bun run benchmark:full -- --profile realistic --mode local-fast
```

Modes:
- `benchmark:seed`: creates the benchmark DB, or reuses it when the seed config has not changed.
- `benchmark:api`: measures direct API calls and records every request it makes, including timed scratch recipe cleanup.
- `benchmark:sql`: records SQL timings and `EXPLAIN QUERY PLAN` output.
- `benchmark:backend`: runs seed, API, and SQL benchmarks.
- `benchmark:frontend`: runs Playwright and injects a `window.fetch` wrapper to measure every browser API call, including timed scratch recipe cleanup.
- `benchmark:full`: runs backend first, then frontend.
- `benchmark:ram`: samples process-tree memory while running a controlled frontend scenario.
- `benchmark`: runs the full benchmark.
- `server:benchmark`: starts only the benchmark API server for manual inspection.

Profiles:
- `small`: quick smoke run.
- `realistic`: default target, 1000 generated recipes.
- `stress`: heavier 2000-recipe run.
- `photo-heavy`: 1000 recipes with worst-case photo payload behavior.

Common parameters:
```bash
--profile realistic
--recipes 1000
--iterations 3
--db-path data/benchmark/cookbook.db
--api-port 4000
--web-port 5173
--seed 20260430
--name pi-baseline
--image-mode full
--thumbnail-mode generated
--force
```

Seed caching:
- Benchmark seeding writes a `.seed.json` marker beside the benchmark DB.
- If the DB exists and the marker matches the current seed config, the seed step is skipped.
- Changing recipe count, seed, profile, image mode, thumbnail mode, or the image fixture list invalidates the cache.
- Use `--force` to rebuild the seed even when the cache matches.

Mutation cleanup:
- Direct API read and mutation paths scale with `--iterations`; this includes `recipes:list`, create, reorder-detail, reorder patch, and cleanup delete.
- Successful API benchmark iterations create a scratch recipe, increment/decrement it, patch scalar fields, patch ingredient/step order, and then time `DELETE /api/recipes/:id`.
- Successful frontend benchmark runs create a scratch recipe, search it, use the card plus button and save edit flow against it, and then time the cleanup delete.
- This keeps the seeded recipe set stable for consecutive runs. If a benchmark is interrupted mid-run, use `--force` once to rebuild the seed.

Run naming:
- Use `--name my-run-label` to include a custom label in saved report filenames.
- Example: `--name pi-baseline` writes files like `latest-pi-baseline-benchmark-backend-api.md`.
- The run name only affects reports; it does not invalidate or change the cached seed.

Image options:
- `--image-mode full` stores full image data URLs from `benchmarks/images/`.
- `--image-mode none` disables full photos.
- `--thumbnail-mode generated` uses lightweight generated thumbnails for list/search.
- `--thumbnail-mode none` forces list/search to fall back to full photos, useful for worst-case payload testing.

Useful runs:
```bash
# Normal 1000-recipe backend baseline
bun run benchmark:backend -- --profile realistic

# Worst-case list/search payload with full photos
bun run benchmark:backend -- --profile realistic --thumbnail-mode none

# Fast smoke run while editing benchmark code
bun run benchmark:backend -- --profile small --recipes 10 --iterations 1 --image-mode none
```
