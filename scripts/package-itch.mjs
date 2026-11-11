/**
 * 打 itch.io 用的包：npm run package:itch
 *
 * 产物：release/jieyu-itch.zip（zip 根目录就是 index.html）
 * itch.io 上传时选「HTML」，勾上 "This file will be played in the browser"。
 *
 * 网页和信令是分开部署的，所以构建时要把信令地址烤进去：
 *   VITE_SIGNAL_URL=wss://你的信令服务 npm run package:itch
 * 不传就用默认的 Render 服务。
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const signal = process.env.VITE_SIGNAL_URL ?? 'wss://jie-yu-jing-hua.onrender.com';
console.log(`[itch] 构建中，信令服务器：${signal}`);
execSync('npm run build', {
  stdio: 'inherit',
  env: { ...process.env, VITE_SIGNAL_URL: signal },
});

const outDir = resolve(root, 'release');
mkdirSync(outDir, { recursive: true });
const zip = resolve(outDir, 'jieyu-itch.zip');
if (existsSync(zip)) rmSync(zip);

if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'dist\\*' -DestinationPath '${zip}' -Force"`,
    { stdio: 'inherit' },
  );
} else {
  execSync(`cd dist && zip -qr "${zip}" .`, { stdio: 'inherit' });
}

console.log(`[itch] 完成：${zip}`);
console.log('[itch] itch.io → Create new project → Kind of project 选 HTML → 上传这个 zip');
