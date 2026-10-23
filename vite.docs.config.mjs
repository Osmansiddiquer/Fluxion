import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The documentation page: its own small bundle (no parser / app code), built into
// dist/docs/ after the app (`npm run build`), then pre-rendered to static HTML by
// scripts/prerender-docs.ts, which also moves the page from
// dist/docs/src/docs-page/index.html (Vite mirrors the source path) to
// dist/docs/index.html. Relative base, like the app, for GitHub Pages / preview.
// In dev the main config serves this page at /docs/.
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/docs',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/docs-page/index.html', import.meta.url)),
    },
  },
});
