import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，dist 可以直接丢到任意静态目录/子路径下
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
});
