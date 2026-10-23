import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
  plugins: [react(), docsDevPage],
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
