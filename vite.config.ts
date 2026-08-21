import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages serves project sites from /<repo-name>/, not /. Only the
  // dedicated gh-pages build mode (see package.json's build:gh-pages script,
  // used by the deploy workflow) uses that prefix — local dev/build/preview
  // keep serving from root so they're unaffected.
  base: mode === 'gh-pages' ? '/Pivot-Hunter/' : '/',
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
