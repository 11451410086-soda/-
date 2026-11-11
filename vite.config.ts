import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，dist 可以直接丢到任意静态目录/子路径下
  base: './',
  // 构建标记：显示在 ?fps=1 的悬浮层上，方便确认跑的是哪一版
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')),
  },
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
