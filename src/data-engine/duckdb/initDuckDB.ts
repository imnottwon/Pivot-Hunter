import * as duckdb from '@duckdb/duckdb-wasm'

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/** Self-hosted bundle paths — copied into `public/duckdb` by vite-plugin-static-copy
 * at build time so the app never depends on a CDN (see vite.config.ts). Built
 * from Vite's BASE_URL rather than hardcoded absolute `/duckdb/...` paths —
 * the app isn't always served from the domain root (e.g. a GitHub Pages
 * project site lives under `/<repo-name>/`), and a root-relative path would
 * 404 there. */
const assetBase = import.meta.env.BASE_URL

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: `${assetBase}duckdb/duckdb-mvp.wasm`,
    mainWorker: `${assetBase}duckdb/duckdb-browser-mvp.worker.js`,
  },
  eh: {
    mainModule: `${assetBase}duckdb/duckdb-eh.wasm`,
    mainWorker: `${assetBase}duckdb/duckdb-browser-eh.worker.js`,
  },
  coi: {
    mainModule: `${assetBase}duckdb/duckdb-coi.wasm`,
    mainWorker: `${assetBase}duckdb/duckdb-browser-coi.worker.js`,
    pthreadWorker: `${assetBase}duckdb/duckdb-browser-coi.pthread.worker.js`,
  },
}

/** Bootstraps a single shared AsyncDuckDB instance for the app's lifetime.
 * Safe to call multiple times — subsequent calls return the same promise. */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = instantiate()
  }
  return dbPromise
}

async function instantiate(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
  const worker = new Worker(bundle.mainWorker!)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
  return db
}

let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null

/** A single shared connection reused for every query in the app. DuckDB-WASM
 * supports multiple connections, but one is simplest and sufficient here since
 * all tables live in the same in-browser database instance. */
export function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) {
    connPromise = getDuckDB().then((db) => db.connect())
  }
  return connPromise
}

export { duckdb }
