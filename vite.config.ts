import { defineConfig } from 'vite';
// base './' lets the build run from any GitHub Pages sub-path (username.github.io/repo/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
} as any);
