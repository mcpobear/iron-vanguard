import { defineConfig } from 'vite';
import pkg from './package.json';
// base './' lets the build run from any GitHub Pages sub-path (username.github.io/repo/).
export default defineConfig({
  base: './',
  // the version shown on the main menu comes from package.json, so it's bumped in one place
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
} as any);
