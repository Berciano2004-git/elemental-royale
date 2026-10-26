import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    hmr: false,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
});
