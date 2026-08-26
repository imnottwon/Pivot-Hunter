import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves project sites from /<repo-name>/, not /. Only the
  // dedicated gh-pages build mode (see package.json's build:gh-pages script,
  // used by the deploy workflow) uses that prefix — local dev/build/preview
  // keep serving from root so they're unaffected.
  base: mode === 'gh-pages' ? '/Pivot-Hunter/' : '/',
  // Exposes package.json's version to the client as a compile-time constant
  // (see src/vite-env.d.ts for the type declaration) so the UI can show which
  // version is actually running — useful once the app is hosted online.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@duckdb/duckdb-wasm/dist/*.wasm',
          dest: 'duckdb',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-*.worker.js',
          dest: 'duckdb',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}))
