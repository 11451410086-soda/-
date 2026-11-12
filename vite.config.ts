import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，dist 可以直接丢到任意静态目录/子路径下
  base: './',
  // 构建标记：显示在 ?fps=1 的悬浮层上，方便确认跑的是哪一版（固定用北京时间，runner 是 UTC）
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' '),
    ),
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
    /**
     * 固定资源名（不带哈希）。
     * 原因：GitHub Pages 每次部署是整站替换，带哈希的旧文件会被删掉；
     * 浏览器缓存住旧 HTML（max-age=600）后再来访问，就会 404 → 整页失去样式。
     * 用固定名字后，旧 HTML 也能拿到新文件（最坏情况是 10 分钟旧代码）。
     */
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
