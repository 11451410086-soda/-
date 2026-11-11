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
- **客人**：收到第一帧快照才建世界（`world.localIndex = 1`），只做 `applySnapshot` + 插值 + 渲染，不跑模拟。**只在收到新快照时 apply**，别每帧重建。

### 客人端「不顺」的四个坑（都踩过，别再踩）
1. **弹道不插值** → 子弹每 30Hz 瞬移。快照里带 `vx/vy`，客人每帧 `extrapolateWorld()` 按速度外推。
2. **自己角色等房主回包** → 手感像延迟 100ms。客人本地 `world.predictPlayerMove()` 预测移动，`smoothWorld`/`interpolateWorld` 要跳过本地玩家；纠偏带死区（<22px 不管，>22px 缓拉，>90px 对齐）。
3. **瞄准角抄快照** → 预瞄线 30Hz 一跳一跳。客人每帧用本地鼠标算 `p.aim`，投掷落点 `throwTarget` 也本地算（按技能射程夹紧）。
4. **渲染取整** → 逻辑分辨率 480×270，放大 3 倍后 `Math.round` 让慢速角色每帧在 0/1 逻辑像素间跳（=3 屏幕像素）。画布按整数倍放大（`Renderer.setScale`，后备画布 = 480*s），去掉角色/相机的 `Math.round`。

- **预瞄状态同步**：`mode` / `aiming` / `leapTo` 走快照（`aim`/`throwTarget` 客人本地算）。
- **构建号**：`?fps=1` 底部显示 `b:MM-DD HH:MM`，排查「改完没生效」先看这个。

### D. 客人端特效补齐（快照里必须带的字段）
- `shake`：震屏强度，客人照抄，自己不做衰减（房主每拍带过来）。
- `grenades`：玩家投出的黑洞雷，只传 `from/to/t/dur`，客人用 `animateWorld` 按本地时间推抛物线（渲染走 `world.grenadePos`）。
- `bottles`：毒雾瓶同理，带 `from/to/t/dur`，客人自己算 `pos`（和 `updateBottles` 同一公式：`-sin(kπ)*30`）。
- `hurtFlash` / `invuln`：受伤红屏和无敌闪烁。
- 弹道 `vx/vy`：见上面第 1 条。**新加任何「会动/会闪」的实体，先想清楚客人端怎么拿到它**，否则就是「房主有、客人没有」。

### E. 房主切后台不停机
- rAF 在后台标签会被暂停、`setTimeout` 会被节流到 1Hz，但 **MessageChannel 自调度不受影响**。
- `hiddenLoop`：`port2.postMessage` 自循环，按 `performance.now()` **自己限速 60Hz**（不限速会跑出 15 万 tick/s，世界 150 倍速，水晶瞬间被拆——踩过）。
- 触发：`visibilitychange` 到 hidden、开局 `startCoopGame`（房主已在后台时）、收到客人 lobby 消息时唤醒。
- 空闲自动停：大厅没在倒计时、对局已结束时停掉，避免自旋吃 CPU。
- 前台 rAF 用 `if (!hiddenOn)` 兜底（有些环境 `document.hidden` 一直是 true，不能拿它当判断）。

### F. 主机 / 客机身份约定（改玩法时最容易踩）
- `this.player` = **`this.actor ?? this.players[localIndex]`**。`tick()` 在逐玩家循环里先 `this.actor = p` 再 `updatePlayer`，所以**玩家循环内部**用 `this.player` 是对的。
- **循环外**（`updateEnemies / updateShots / updateZones / fanStrike / damagePlayer`…）`this.actor` 是 null，`this.player` 就是房主——凡是「对玩家生效」的逻辑必须**显式遍历 `this.players`** 或传目标玩家：
  - `damagePlayer(amount, src, target?)` / `absorbHit(dmg, target?)` / `hasSkillShape(id, shapeId, pl?)` / `shapeLevel(id, pl?)` / `hasShape(w, id, pl?)`
  - 已按玩家处理的：近战、扇形劈击、敌方子弹、毒雾区、升华水晶光环、波次奖励、拦路判定、索敌（`nearestPlayer`）
- `addPlayer()` 是**浅拷贝**：`shapes` / `skillShapes` 必须各自新建，否则两人共享购买记录（踩过）。
- 客人在协议里固定是 `players[1]`，房主 `players[0]`；客人端 `world.localIndex = 1`。
- 客人面板走 `{t:'ctl', panel}`；输入快照里的 `panel` 边沿要在客人端清掉，别让房主再 toggle 一次。
- 渲染：`playerLift(p)`、深度排序、小地图都要按「每个玩家」画，别拿 `world.player` 顶替。
- **输入时序坑**：客人端 `buildInput` 不能每帧清边沿——只在「真正发出去」的那一刻 `clearEdges()`，否则 60fps 下按在未发送帧会被吞。
- **成长面板**：客人 Tab 可以打开，购买通过 `{t:'buy'}` 发给房主，房主临时 `localIndex = 1` 代执行；`World.tick` 只有单人才会因为开面板暂停世界，联机只冻结开面板的那个人。
- **作弊按钮**：联机时客人按作弊会发 `{t:'cheat'}` 让房主加钱（本地加会被快照覆盖）。

### C. 联机房间：准备 → 选武器（`src/ui/coop.ts`）
- **入口**：主菜单「联 机」→「创建房间」→ 立即进入准备房间（不再回主菜单点开始）；「加入房间」跳客人链接。
- **准备房间**：显示房间号 + 「复制邀请链接」；两边卡片显示 已准备/未准备；**两人都点「准备」**才进入下一阶段。
- **选择武器**：左侧是和单机准备界面同款的大卡片（描述/数值/操作），右侧是对方的简略卡（武器名 + 已出发/未准备）；**能看到对方选了什么**；**两人都点「出发」**才开局；按钮再点一次是取消。
- **结算重开**：房主点「再次净化」会发 `{t:'restart'}`，客人丢世界等新快照重建；客人的按钮显示「等待房主重开」。
- **同步**：房主权威。客人每 30Hz 发 `{t:'lobby', phase, ready, weapon, cx, cy}`，房主广播 `{t:'lobby', phase, host, guest}`；阶段切换时客人会重置自己的 ready，房主丢弃阶段不匹配的旧包。
- 两个鼠标位置都在界面上可见（归一化坐标），房主金 / 客人蓝。
- 断线会清空对方的准备状态，不会出现「对面掉线了还显示已准备」。

### B. 服务器权威模式 `?online=1&room=XXX`（保留，仍卡顿）
- `server/index.ts` 跑 World，客户端发输入收快照渲染
- 房间隔离、双人、各自域币/塑造（购买走 `buy` 消息）、双人 HUD 都在
- 卡顿根因推测仍是插值参数 / 本地预测，没继续调

## 待办（按优先级）
1. 房间界面扩展：技能目前只是展示，还没有真正的技能选择；要加就按 `loadout` 阶段扩
2. 跨公网 TURN：现在是 openrelay 公共节点，和朋友在外网连还是看运气
3. 音效、第三把武器、快速匹配
4. itch.io 包需要用最新代码重打（`npm run package:itch`）

## 已知坑 / 限制
- **联机不暂停**：Esc 只开菜单，世界继续跑（房主暂停会冻住两个人的局）。单机仍然是真暂停。
- **房主切后台**：用 MessageChannel 自调度接管，实测 121 tick/s、快照照常发。代价是后台期间会占一点 CPU（浏览器不允许 sleep）。
- **快照 60Hz、模拟 120Hz**：实测一张快照约 2KB、122KB/s；`?fps=1` 能看到 `snap` 和构建号 `b:MM-DD HH:MM`，排 chart「改了没生效」先看版本号。
- **缓存**：Pages 的 HTML 缓存 10 分钟，改完要让对方强刷（或链接带 `&v=` 参数）。
- TURN 用的是 openrelay 公共节点（`stun.cloudflare.com` + `turn:openrelay.metered.ca`），跨运营商能不能连没有实测。
- 服务器 room 状态全在内存，重启即重置；P2P 的房间码不加锁，撞码理论上可能连串。
- 游戏名「界域净化」，但世界里地名仍叫「流界」。
- 调试开关：`?debug=1` 打开左下角状态覆盖层（含 `vis`/`focus`、快照体积）并打印 `[p2p]`/`[net]` 日志；`?fps=1` 看帧率。
