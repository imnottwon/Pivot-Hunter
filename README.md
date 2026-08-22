# Pivot Hunter

A browser-based, offline-first timeline explorer for DFIR CSV exports (EvtxECmd, MFTECmd, IIS/W3C logs, and similar). Loads entirely client-side — no server, no data leaves the machine.

**Live demo:** https://imnottwon.github.io/Pivot-Hunter/

## Why

Fast, filterable, sortable viewing of large forensic CSV timelines, with arbitrary-depth grouping, tagging, highlight rules, and built-in statistics for triage: event frequency histograms, time-gap/interval analysis, and volume-based outlier detection — all computed in SQL, not hand-rolled JS.

## Architecture

- **Data engine**: [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) — CSVs are streamed straight from the browser `File` handle into an in-browser SQL database. The grid, filters, sorting, grouping, and stats are all paginated/aggregated SQL queries, not JS array operations, so it stays fast at millions of rows.
- **Grid**: `@tanstack/react-virtual` for row virtualization, backed by windowed SQL queries.
- **Persistence**: `dexie` (IndexedDB) for row tags and highlight rules, keyed by file fingerprint, synced into an in-memory DuckDB table so tagging/highlighting can be plain SQL joins.
- **Stats**: `recharts` for the frequency histogram; gap and outlier views are tables. All three views drill down into the grid by clicking a bar/row.
- **Self-hosted**: DuckDB-WASM's `.wasm`/worker assets are copied into `public/duckdb` at build time — no CDN dependency, works fully offline.

## Requirements

This is a Node.js/TypeScript project, not a Python one — there's no `requirements.txt` because the Node equivalent already exists: **`package.json`** lists every dependency and **`package-lock.json`** pins their exact versions. Running `npm install` (below) reads both and installs precisely what's needed; nothing else to fetch or track separately.

You need:

- **Node.js 20 or newer** (this project was built and tested with Node 24). Node bundles `npm`, so nothing else to install there.
  - Download: https://nodejs.org (choose the LTS installer for your OS)
  - Verify after installing:
    ```bash
    node -v
    npm -v
    ```
- **A modern browser** — Chrome, Edge, or Firefox, recent version. The app relies on WebAssembly and the browser File API; both are standard in any current release.
- **~500 MB free disk space** for `node_modules` (typical for a modern JS toolchain — DuckDB-WASM, React, Vite, and their transitive dependencies).

No Python, no database server, no Docker — nothing else to install.

## Install and run locally

1. **Get the project files onto your machine.** If you received this as a folder (zip, copy, etc.), just place it somewhere on disk — e.g. `C:\Users\<you>\Pivot-Hunter`. If it's in a git repository instead, clone it:
   ```bash
   git clone <repository-url> Pivot-Hunter
   cd Pivot-Hunter
   ```

2. **Install dependencies.** From the project folder:
   ```bash
   npm install
   ```
   This reads `package.json`/`package-lock.json` and downloads everything into a local `node_modules` folder — nothing is installed system-wide. Takes a minute or two the first time.

3. **Start the app in development mode:**
   ```bash
   npm run dev
   ```
   Vite starts a local dev server and prints a URL — normally `http://localhost:5173`. Open it in your browser. Leave the terminal running while you use the app; `Ctrl+C` stops it.

That's it — drag a CSV onto the page to try it.

## Building for production

If you want an optimized, static build instead of the dev server (e.g. to host it somewhere, or just to run it without the dev-time tooling):

```bash
npm run build      # type-checks, then bundles into dist/
npm run preview    # serves the dist/ build locally, so you can sanity-check it before deploying
```

`dist/` is a fully self-contained static site (HTML/JS/CSS plus the DuckDB-WASM assets) — copy it to any static file host. No server-side runtime is required.

## Deployment (GitHub Pages)

Every push to `main` automatically builds and deploys to GitHub Pages via `.github/workflows/deploy.yml` — no manual step needed after the initial one-time repo setup (Settings → Pages → Source: **GitHub Actions**, already configured for this repo).

The Pages build uses a dedicated `npm run build:gh-pages` script instead of the regular `npm run build`: GitHub Pages serves a project site from `/<repo-name>/`, not `/`, so `vite.config.ts` sets `base: '/Pivot-Hunter/'` only under that build mode (`--mode gh-pages`) — local dev/build/preview are unaffected and keep serving from root.

To deploy manually instead of waiting on a push, go to the repo's **Actions** tab → "Deploy to GitHub Pages" → **Run workflow**.

## Versioning

Pivot Hunter follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). Every notable change is recorded in [`CHANGELOG.md`](./CHANGELOG.md), and each release is tagged in git and published as a [GitHub Release](https://github.com/imnottwon/Pivot-Hunter/releases). The running app shows its own version number next to the title in the header, sourced from `package.json` at build time (see `vite.config.ts`).

To cut a new release:

1. Move the relevant entries from `CHANGELOG.md`'s `[Unreleased]` section into a new dated version section.
2. Bump `"version"` in `package.json` to match (patch/minor/major depending on what changed).
3. Commit both, then tag and push:
   ```bash
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```
4. Publish the GitHub Release (pulls in that version's changelog section as the release notes):
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md | sed '1d;$d')
   ```
   Pushing the tag alone doesn't publish anything to GitHub Pages by itself — that still happens via the normal push-to-`main` deploy workflow above.

## Troubleshooting

- **`npm install` fails on a native/optional dependency** — make sure you're on Node 20+ (`node -v`); older Node versions aren't tested against this dependency set.
- **Port 5173 already in use** — another process (maybe a previous `npm run dev` that didn't shut down) is holding it. Stop that process, or let Vite prompt you to use the next free port.
- **Slower-than-expected loading on a deployed build** — DuckDB-WASM's fastest (multi-threaded) mode needs the page to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. These are already set for `npm run dev`/`npm run preview` in `vite.config.ts`; if you deploy `dist/` elsewhere, make sure your static host sends the same two headers, or it silently falls back to a slower single-threaded mode instead of failing. **GitHub Pages cannot send custom headers at all**, so the hosted demo above always runs single-threaded — still fully functional, just not as fast on very large files as a locally-run copy with the headers in place.
- **Frequency/outlier bucketing** deliberately avoids DuckDB's `date_trunc`/`to_timestamp` — those can trigger an attempt to fetch the ICU extension over the network, which breaks in this offline-first setup. Bucketing uses core epoch-arithmetic instead (see `src/data-engine/queries/statsQueries.ts`) — not something you need to configure, just noted here in case you're extending that file.
