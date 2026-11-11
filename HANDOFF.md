# 交接说明（新会话先读这个）

## 项目
界域净化 —— 域卫防守 PvE 游戏。Vite + TS + Canvas2D，逻辑在 `src/sim/`（纯函数，无 DOM），渲染在 `src/render/`。

## 常用命令
- `npm run dev` — 开发服务器（127.0.0.1:5173）
- `npm run server` — 联机服务器（http+ws 同端口 3001）
- `npm run selftest` — 模拟自检，目前 **64 项全过**，失败时退出码 1
- `npm run build` — 构建（tsc --noEmit && vite build）
- `npm run typecheck` — 只做类型检查

## 部署
- GitHub: https://github.com/11451410086-soda/- （分支 main，**公开仓库方式**接入 Render，Auto-Deploy 无效）
- Render 服务: https://jie-yu-jing-hua.onrender.com
  - 服务页 https://dashboard.render.com/web/srv-dboudgrl550s73au0290
  - **每次 push 后必须手动点 Manual Deploy → Deploy latest commit**
  - 免费实例，闲置 15 分钟休眠，首次访问慢 30~50 秒
- package-lock.json 用 registry.npmjs.org（不能改回淘宝镜像，否则 Render 构建 500）

## 联机现状

### A. P2P 模式（主力，双人实测通过）
`?p2p=1&room=XXX&role=host|guest`，实现在 `src/net/p2p.ts` + `src/main.ts` 的 `p2pMode` 分支。

- **信令**：走 ws 服务器的 `p2p-*` 转发。房主只在收到 `p2p-join` 时发 offer；客人没连上就每 1.2s 重发 join。ICE 候选先进队列，`setRemoteDescription` 之后才灌进去。
- **两条数据通道**：`state`（不可靠无序，房主 30Hz 快照 + 大厅广播）/ `input`（可靠有序，客人输入、面板、购买、作弊）。别合回一条——快照丢了无所谓，按键边沿不能丢。
- **房主**：跑真实世界，`world.tick([自己输入, 客人输入])`。客人的输入用 `mergeInput` 累积边沿，等 tick 消费，避免 33ms 后被下一包覆盖。
- **客人**：收到第一帧快照才建世界（`world.localIndex = 1`），只做 `applySnapshot` + `smoothWorld` + 渲染，不跑模拟。**只在收到新快照时 apply**，别每帧重建（以前每帧重建整个 enemies/lasers 数组，帧数会被 GC 拖）。
- **预瞄**：`mode` / `throwTarget` / `aiming` / `leapTo` 都在快照里同步，客人才能画出技能范围圈和蓄力弹道。
- **输入时序坑**：客人端 `buildInput` 不能每帧清边沿——只在「真正发出去」的那一刻 `clearEdges()`，否则 60fps 下按在未发送帧会被吞。
- **成长面板**：客人 Tab 可以打开，购买通过 `{t:'buy'}` 发给房主，房主临时 `localIndex = 1` 代执行；`World.tick` 只有单人才会因为开面板暂停世界，联机只冻结开面板的那个人。
- **作弊按钮**：联机时客人按作弊会发 `{t:'cheat'}` 让房主加钱（本地加会被快照覆盖）。

### C. 联机房间：准备 → 选武器（`src/ui/coop.ts`）
- **入口**：主菜单「联 机」→「创建房间」→ 立即进入准备房间（不再回主菜单点开始）；「加入房间」跳客人链接。
- **准备房间**：显示房间号 + 「复制邀请链接」；两边卡片显示 已准备/未准备；**两人都点「准备」**才进入下一阶段。
- **选择武器**：双方各选电磁炮/陨盾 + 技能一览（Q/E/F），**能看到对方选了什么**；**两人都点「出发」**才开局；右键取消。
- **同步**：房主权威。客人每 30Hz 发 `{t:'lobby', phase, ready, weapon, cx, cy}`，房主广播 `{t:'lobby', phase, host, guest}`；阶段切换时客人会重置自己的 ready，房主丢弃阶段不匹配的旧包。
- 两个鼠标位置都在界面上可见（归一化坐标），房主金 / 客人蓝。
- 断线会清空对方的准备状态，不会出现「对面掉线了还显示已准备」。

### B. 服务器权威模式 `?online=1&room=XXX`（保留，仍卡顿）
- `server/index.ts` 跑 World，客户端发输入收快照渲染
- 房间隔离、双人、各自域币/塑造（购买走 `buy` 消息）、双人 HUD 都在
- 卡顿根因推测仍是插值参数 / 本地预测，没继续调

## 待办（按优先级）
1. 联机手感：客人端本地预测（现在完全靠 30Hz 快照插值，RTT 高时明显发钝）
2. 房主后台不冻结（见已知坑，最稳的是把 World 挪进 Web Worker）
3. 房间界面扩展：技能目前只是展示，还没有真正的技能选择；要加就按 `loadout` 阶段扩
4. 音效、技能选择界面、第三把武器、快速匹配

## 已知坑 / 限制
- **房主必须保持页面前台**：Chrome 会暂停后台标签的 rAF，房主切走世界就冻住。已加顶部提示条，但没根治。
- 客人的帧数如果很低，先看窗口是不是没聚焦/被挡住（同样是浏览器节流）；联机世界本身是 30Hz 更新 + 插值，不是 60Hz 模拟。
- TURN 用的是 openrelay 公共节点（`stun.cloudflare.com` + `turn:openrelay.metered.ca`），跨运营商能不能连没有实测。
- 服务器 room 状态全在内存，重启即重置；P2P 的房间码不加锁，撞码理论上可能连串。
- 游戏名「界域净化」，但世界里地名仍叫「流界」。
- 调试开关：`?debug=1` 打开左下角状态覆盖层（含 `vis`/`focus`）并打印 `[p2p]`/`[net]` 日志；`?fps=1` 看帧率。
