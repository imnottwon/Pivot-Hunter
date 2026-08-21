import * as duckdb from '@duckdb/duckdb-wasm'

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/** Self-hosted bundle paths — copied into `public/duckdb` by vite-plugin-static-copy
 * at build time so the app never depends on a CDN (see vite.config.ts). */
const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: '/duckdb/duckdb-mvp.wasm',
    mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
  },
  eh: {
    mainModule: '/duckdb/duckdb-eh.wasm',
    mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
  },
  coi: {
    mainModule: '/duckdb/duckdb-coi.wasm',
    mainWorker: '/duckdb/duckdb-browser-coi.worker.js',
    pthreadWorker: '/duckdb/duckdb-browser-coi.pthread.worker.js',
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
