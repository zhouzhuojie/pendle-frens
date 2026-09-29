import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Chrome extension build: side panel HTML + module service worker, no remote code.
export default defineConfig(({ mode }) => ({
  root: 'src',
  publicDir: r('./public'),
  resolve: {
    alias: { '@': r('./src') },
  },
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'chrome120',
    // Ship without sourcemaps; `npm run build:dev` keeps them for debugging.
    sourcemap: mode !== 'production',
    rollupOptions: {
      input: {
        panel: r('./src/panel/index.html'),
        background: r('./src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));
