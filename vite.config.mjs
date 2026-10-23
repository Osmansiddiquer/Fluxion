import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const SANDBOX_ENTRY = fileURLToPath(new URL('./src/lib/script/sandbox/worker.ts', import.meta.url));
const SANDBOX_ID = 'virtual:fluxion-sandbox-runtime';

/**
 * Script mode's sandbox runtime as a *string*: the worker (runtime + Graph
 * bridge + mathjs) bundled into one self-contained IIFE. The app hands it to
 * the sandboxed iframe, which starts it as a blob: Worker — an opaque-origin
 * frame can't load a worker from the app's URL, and a string works the same
 * in dev and in the static build. Only the lazily loaded Script mode chunk
 * imports it, so Graph mode doesn't pay for it.
 */
function sandboxRuntime() {
  return {
    name: 'fluxion-sandbox-runtime',
    resolveId(id) {
      if (id === SANDBOX_ID) return '\0' + SANDBOX_ID;
    },
    async load(id) {
      if (id !== '\0' + SANDBOX_ID) return;
      const r = await esbuild({
        entryPoints: [SANDBOX_ENTRY],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        metafile: true,
      });
      // Rebuild on change (skip esbuild's virtual inputs like "(disabled):crypto").
      for (const f of Object.keys(r.metafile.inputs)) if (!f.startsWith('(')) this.addWatchFile(resolve(f));
      // Escape "import" inside the string so Vite's import analysis never sees one.
      const literal = JSON.stringify(r.outputFiles[0].text).replace(/import/g, '\\u0069mport');
      return `export default ${literal};`;
    },
  };
}

// Relative base ('./') makes the build work when served from any path,
// including a GitHub Pages project subdirectory (https://user.github.io/ODE-plotter/).
// Plain-JS (.mjs) config loads via native ESM import, avoiding the esbuild config
// bundling that breaks when Windows node operates on a \\wsl.localhost UNC path.
// Dev only: serve the docs page (src/docs-page, built separately by
// vite.docs.config.mjs into dist/docs/) at /docs/, like the deployed site.
const docsDevPage = {
  name: 'fluxion-docs-dev',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/docs\/?(\?.*)?$/.test(req.url)) req.url = '/src/docs-page/index.html';
      next();
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), docsDevPage, sandboxRuntime()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
