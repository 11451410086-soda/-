/**
 * 无浏览器跑模拟自检：`npm run selftest`
 *
 * src/simtest.ts 是给浏览器 test.html 用的，只依赖 document.getElementById('log')，
 * 这里塞一个最小 DOM stub 就能在 Node 里跑，失败时退出码为 1。
 */
const store = { innerHTML: '' };
(globalThis as unknown as { document: unknown }).document = {
  getElementById: () => store,
};

await import('../src/simtest');

const ok = (store.innerHTML.match(/<div class="ok">/g) ?? []).length;
const bad = (store.innerHTML.match(/<div class="bad">/g) ?? []).length;

const text = store.innerHTML
  .replace(/<h1[^>]*>/g, '')
  .replace(/<\/h1>/g, '')
  .replace(/<div class="(ok|bad)">/g, '')
  .replace(/<\/div>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

console.log(text);
console.log(bad === 0 ? '\n✓ 全部通过' : `\n✗ ${bad} 项失败`);
process.exit(bad === 0 && ok > 0 ? 0 : 1);
