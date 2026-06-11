import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Relative base ('./') makes the build work when served from any path,
// including a GitHub Pages project subdirectory (https://user.github.io/ODE-plotter/).
// Plain-JS (.mjs) config loads via native ESM import, avoiding the esbuild config
// bundling that breaks when Windows node operates on a \\wsl.localhost UNC path.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
