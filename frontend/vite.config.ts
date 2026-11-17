import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { rollupOptions: { input: {
    studio: resolve(import.meta.dirname, 'index.html'),
    room: resolve(import.meta.dirname, 'room.html'),
  } } },
});
