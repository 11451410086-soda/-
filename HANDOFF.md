# 交接说明（新会话先读这个）

## 项目
界域净化 —— 域卫防守 PvE 游戏。Vite + TS + Canvas2D，逻辑在 `src/sim/`（纯函数，无 DOM），渲染在 `src/render/`。

## 常用命令
- `npm run dev` — 开发服务器（127.0.0.1:5173）
- `npm run build` — 构建（tsc --noEmit && vite build）
- `npm run server` — 联机服务器（http+ws 同端口，PORT 环境变量）
- 自检：`npx esbuild src/simtest.ts --bundle --format=cjs --outfile=.tmp_t.cjs` 后用 stub document 运行，目前 64 项通过

## 部署
- GitHub: https://github.com/11451410086-soda/- （分支 main，**公开仓库方式**接入 Render，所以 Auto-Deploy 无效）
- Render 服务: https://jie-yu-jing-hua.onrender.com
  - 服务页 https://dashboard.render.com/web/srv-dboudgrl550s73au0290
  - **每次 push 后必须手动点 Manual Deploy → Deploy latest commit**
  - 免费实例，闲置 15 分钟休眠，首次访问慢 30~50 秒
- package-lock.json 已改用 registry.npmjs.org（不能再用淘宝镜像地址，否则 Render 构建 500）

## 联机现状（重点）
做了两套，都没打磨：

### A. 服务器权威模式 `?online=1&room=XXX`
- `server/index.ts` 跑 World，客户端发输入、收快照渲染
- 已实现：房间隔离、双人、各自域币/塑造（购买走 `buy` 消息）、双人 HUD
- **问题**：卡顿。FPS 165、draw 0.1ms，说明不是渲染问题，是位置更新方式（30Hz 快照 + 插值参数没调好）
- 客户端平滑在 `src/net/apply.ts` 的 `smoothWorld`（按实测快照间隔算系数）

### B. P2P 模式 `?p2p=1&room=XXX&role=host|guest`（新，未端到端验证）
- `src/net/p2p.ts`：WebRTC + 免费 STUN，信令走现有 ws 服务器的 `p2p-*` 消息
- 房主跑本地世界，30Hz 通过数据通道发 `serializeWorld`（`src/net/snapshot.ts`）
- 客人应用快照 + 回传输入
- 信令转发在 `server/index.ts` 的 `signalRooms`

### C. 房间界面（已做）
主菜单「联 机」弹窗：创建房间（生成 4 位码 + 复制链接）、加入房间。
**注意：弹窗给出的链接还是旧格式，需要改成 `?p2p=1&...&role=guest`。**

## 待办（按优先级）
1. P2P 端到端验证：房主+客人两个窗口实测，确认客人画面跟随
2. 房间弹窗链接改成 P2P 格式，并显示连接状态（等待朋友/已连接/连接失败）
3. P2P 的 `applySnapshot` 复用现有实现（`src/net/apply.ts`），注意它按 `WorldWire` 形状取数据
4. 联机卡顿根治：客户端预测（已做雏形，`main.ts` 的 P2P/online 分支里）+ 正确的插值缓冲
5. 尚未做：音效、技能选择界面、第三把武器、快速匹配

## 已知坑
- 服务器 `room` 状态全在内存，重启即重置
- WebRTC 跨运营商/NAT 可能连不上，需要 TURN 兜底（未做）
- 游戏名「界域净化」，但世界里地名仍叫「流界」
