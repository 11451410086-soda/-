import './style.css';import { RAIL_WEAPON, ROLL, SHIELD_WEAPON, SKILLS } from './content/defs';
import { VIEW } from './content/defs';
import type { HeroId } from './content/defs';
import { Camera, Renderer } from './render/renderer';
import { NetClient } from './net/client';
import { P2P } from './net/p2p';
import { serializeWorld } from './net/snapshot';
import { animateWorld, applySnapshot, extrapolateWorld, interpolateWorld, smoothWorld } from './net/apply';
import type { InputSnapshot } from './shared/types';
import type { WorldWire } from '../server/protocol';
import type { WorldEvent } from './sim/types';
import { clamp } from './shared/util';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import { Codex } from './ui/codex';
import { GrowthPanel } from './ui/panel';
import { CoopLobby } from './ui/coop';
import type { LobbyCard, LobbyPhase, LobbyWeapon } from './ui/coop';

declare const __BUILD_ID__: string;

window.addEventListener('error', (e) => {
  console.error('BOOT ERROR:', e.message, '@', e.filename, e.lineno, e.colno);
});
console.log('[boot] build', __BUILD_ID__);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screenTitle = document.getElementById('screen-title') as HTMLElement;
const screenEnd = document.getElementById('screen-end') as HTMLElement;
const endTitle = document.getElementById('end-title') as HTMLElement;
const endSub = document.getElementById('end-sub') as HTMLElement;
const endStats = document.getElementById('end-stats') as HTMLElement;
const screenDrop = document.getElementById('screen-drop') as HTMLElement;
const dropTitle = document.getElementById('drop-title') as HTMLElement;
const dropSub = document.getElementById('drop-sub') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const pauseScreen = document.getElementById('pause') as HTMLElement;
const pauseTitle = document.getElementById('pause-title') as HTMLElement;
const prepScreen = document.getElementById('prep') as HTMLElement;
let paused = false;
/** 联机时菜单开着但世界不暂停 */
let menuOpen = false;

const renderer = new Renderer(canvas);
const camera = new Camera();
const hud = new Hud(() => {
  edges.skip = true;
});

let world: World | null = null;
let ended = false;
let panelWasOpen = false;
let panelSig = '';

const codex = new Codex();

/* ---------------- 联机房间 ---------------- */
const lobby = document.getElementById("lobby") as HTMLElement;
const lobbyCodeEl = document.getElementById("lobby-code") as HTMLElement;
const lobbyInput = document.getElementById("lobby-input") as HTMLInputElement;
const lobbyTip = document.getElementById("lobby-tip") as HTMLElement;
let roomCode = "";

/** 清掉上一次房间留下的界面状态（离开房间后别再显示旧房间号） */
function resetRoomUi(): void {
  roomCode = "";
  lobbyCodeEl.textContent = "";
  lobbyTip.textContent = "创建一个房间，把邀请链接发给朋友即可";
}

function onlineUrl(code: string, role: "host" | "guest"): string {
  const base = location.origin + location.pathname;
  const q = new URLSearchParams();
  q.set("p2p", "1");
  q.set("room", code);
  q.set("role", role);
  // 页面和信令分开部署时（静态托管 + Render 信令），链接要把信令地址带上
  const sig = PARAMS.get("signal");
  if (sig) q.set("signal", sig);
  return base + "?" + q.toString();
}

document.getElementById("btn-online")!.addEventListener("click", () => {
  warmSignal();
  // 已经不在房间里的话，开弹窗就是全新的开始
  if (!p2p) resetRoomUi();
  lobby.classList.remove("hidden");
});
document.getElementById("lobby-close")!.addEventListener("click", () => lobby.classList.add("hidden"));
document.getElementById("lobby-create")!.addEventListener("click", () => {
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase();
  lobbyCodeEl.textContent = roomCode;
  lobbyTip.textContent = "房间已创建，正在进入准备界面…";
  // 创建房间直接进准备界面，不用再回主菜单点开始
  startP2P(roomCode, "host");
  enterCoopLobby();
});
document.getElementById("lobby-join")!.addEventListener("click", () => {
  const code = lobbyInput.value.trim().toUpperCase();
  if (code.length < 3) {
    lobbyTip.textContent = "房间号太短";
    return;
  }
  location.href = onlineUrl(code, "guest");
});

const panel = new GrowthPanel(() => {
  if (world) world.player.panelOpen = false;
  panel.hide();
  panelWasOpen = false;
});

/* ---------------- 输入 ---------------- */

const keys = new Set<string>();
const mouse = { x: VIEW.w / 2, y: VIEW.h / 2, left: false, right: false };
const edges = {
  fire: false,
  alt: false,
  reload: false,
  q: false,
  e: false,
  f: false,
  panel: false,
  skip: false,
  roll: false,
};

function clearEdges(): void {
  edges.fire = false;
  edges.alt = false;
  edges.reload = false;
  edges.roll = false;
  edges.q = false;
  edges.e = false;
  edges.f = false;
  edges.panel = false;
  edges.skip = false;
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'tab') {
    e.preventDefault();
    if (!e.repeat) edges.panel = true;
    return;
  }
  if (k === ' ') {
    e.preventDefault();
    if (!e.repeat) edges.skip = true;
    return;
  }
  if (k === 'escape') {
    if (!lobby.classList.contains("hidden")) {
      lobby.classList.add("hidden");
      return;
    }
    if (!prepScreen.classList.contains('hidden')) {
      // 选武器界面：Esc 等于「返回」
      backFromPrep();
      return;
    }
    if (codex.isOpen()) {
      codex.hide();
      return;
    }
    if (panel.isOpen()) {
      if (world) world.player.panelOpen = false;
      panel.hide();
      panelWasOpen = false;
      return;
    }
    if (world && world.state === 'playing' && !ended) setPaused(!(p2pMode ? menuOpen : paused));
    return;
  }
  if (e.repeat) return;
  if (k === 'shift') {
    edges.roll = true;
    return;
  }
  if (k === 'r') edges.reload = true;
  if (k === 'q') edges.q = true;
  if (k === 'e') edges.e = true;
  if (k === 'f') edges.f = true;
  keys.add(k);
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
});

window.addEventListener('blur', () => {
  keys.clear();
  mouse.left = false;
  mouse.right = false;
});

function toCanvas(e: MouseEvent): void {
  const r = canvas.getBoundingClientRect();
  mouse.x = clamp(((e.clientX - r.left) / r.width) * VIEW.w, 0, VIEW.w - 1);
  mouse.y = clamp(((e.clientY - r.top) / r.height) * VIEW.h, 0, VIEW.h - 1);
}

canvas.addEventListener('mousemove', toCanvas);
canvas.addEventListener('mousedown', (e) => {
  toCanvas(e);
  if (e.button === 0) {
    mouse.left = true;
    edges.fire = true;
  } else if (e.button === 2) {
    mouse.right = true;
    edges.alt = true;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function buildInput(consume: boolean): InputSnapshot {
  const right = keys.has('d') || keys.has('arrowright');
  const left = keys.has('a') || keys.has('arrowleft');
  const down = keys.has('s') || keys.has('arrowdown');
  const up = keys.has('w') || keys.has('arrowup');
  const snap: InputSnapshot = {
    moveX: (right ? 1 : 0) - (left ? 1 : 0),
    moveY: (down ? 1 : 0) - (up ? 1 : 0),
    aimX: camera.x + mouse.x,
    aimY: camera.y + mouse.y,
    fireHeld: mouse.left,
    firePressed: edges.fire,
    altHeld: mouse.right,
    altPressed: edges.alt,
    reloadPressed: edges.reload,
    rollPressed: edges.roll,
    skillQ: edges.q,
    skillE: edges.e,
    skillF: edges.f,
    panel: edges.panel,
    skip: edges.skip,
  };
  if (consume) clearEdges();
  return snap;
}

function setPaused(v: boolean): void {
  // 联机：菜单只是盖一层 UI，世界继续跑（房主暂停会冻住两个人的局）
  if (p2pMode) {
    menuOpen = v;
    pauseScreen.classList.toggle('hidden', !v);
    if (v) {
      keys.clear();
      mouse.left = false;
      mouse.right = false;
      clearEdges();
      pauseTitle.textContent =
        p2pRole === 'guest' ? '菜单 · 联机中世界仍在进行' : '菜单 · 联机中不暂停（世界继续）';
    }
    lastTime = performance.now();
    return;
  }
  paused = v;
  pauseScreen.classList.toggle('hidden', !v);
  if (v) {
    keys.clear();
    mouse.left = false;
    mouse.right = false;
    clearEdges();
    pauseTitle.textContent = '已暂停';
  }
  lastTime = performance.now();
}

document.getElementById('btn-resume')!.addEventListener('click', () => setPaused(false));
document.getElementById('btn-quit')!.addEventListener('click', () => {
  setPaused(false);
  // 退出即断联：否则客人会继续收到快照、又被拉回战场
  if (p2p) {
    p2p.close();
    p2p = null;
    p2pReady = false;
    p2pSnap = null;
    p2pInput = null;
  }
  if (p2pMode && p2pRole === 'guest') {
    hideGuestWait();
    screenTitle.classList.remove('hidden');
  }
  // 退出联机后回到单机语义，避免再开局时卡在「客人只渲染不推进」的分支
  p2pMode = false;
  p2pRole = 'host';
  world = null;
  ended = false;
  acc = 0;
  hudEl.classList.remove('on');
  screenEnd.classList.add('hidden');
  prepScreen.classList.add('hidden');
  screenTitle.classList.remove('hidden');
});

/* ---------------- 面板同步 ---------------- */

function syncPanel(): void {
  if (!world) return;
  const open = world.player.panelOpen;

  if (open && !panelWasOpen) {
    mouse.left = false;
    mouse.right = false;
    edges.fire = false;
    edges.alt = false;
    panel.open(world);
    panelSig = '';
  } else if (!open && panelWasOpen) {
    panel.hide();
  }

  if (open) {
    const nodes = Object.keys(world.player.nodes)
      .sort()
      .map((k) => `${k}:${world!.player.nodes[k]}`)
      .join(',');
    const sig = `${world.player.points}|${world.player.coins}|${nodes}`;
    if (sig !== panelSig) {
      panelSig = sig;
      panel.refresh();
    }
  }
  panelWasOpen = open;
}

/* ---------------- 流程 ---------------- */

function opsBlock(rows: [string, string][]): string {
  return (
    '<div class="card-ops"><div class="card-ops-title">武器操作</div>' +
    rows.map(([k, v]) => `<div class="card-ops-row"><b>${k}</b><span>${v}</span></div>`).join('') +
    '</div>'
  );
}

function kv(label: string, value: string): string {
  return '<div class="kv"><span>' + label + '</span><b>' + value + '</b></div>';
}

let selectedWeapon: 'railgun' | 'shield' = 'railgun';

function renderPrep(): void {
  const weaponBox = document.getElementById('prep-weapon');
  if (weaponBox) {
    const rail = RAIL_WEAPON;
    const shield = SHIELD_WEAPON;
    weaponBox.innerHTML =
      '<div class="prep-card weapon' + (selectedWeapon === 'railgun' ? ' selected' : '') + '" data-w="railgun">' +
      '<div class="prep-card-head"><b>' + rail.name + '</b><span>远程</span></div>' +
      '<p class="prep-desc">射出一枚圆形蓝色电磁球（身份：飞行物），命中造成伤害。</p>' +
      '<div class="prep-detail">' +
      kv('飞行物伤害', rail.damage + '') +
      kv('飞行物间隔', rail.fireInterval + ' 秒') +
      kv('飞行物范围', rail.range + '') +
      kv('回复时间', rail.reload + ' 秒') +
      kv('容量', rail.magSize + ' 发') +
      opsBlock([['左键', '射击'], ['右键', '瞄准'], ['R', '换弹']]) +
      '<div class="prep-tags"><i>远程</i><i>飞行物</i></div>' +
      '</div></div>' +
      '<div class="prep-card weapon' + (selectedWeapon === 'shield' ? ' selected' : '') + '" data-w="shield">' +
      '<div class="prep-card-head"><b>' + shield.name + '</b><span>近战</span></div>' +
      '<p class="prep-desc">身侧有可转向的抵挡范围，挡下飞行物与近战击；左键盾击、击退敌人。耐久耗尽会破碎，进入陨星状态。</p>' +
      '<div class="prep-detail">' +
      kv('近战击伤害', shield.damage + '') +
      kv('近战击间隔', shield.interval + ' 秒') +
      kv('近战击范围', shield.range + '') +
      kv('控制时长', shield.knockTime + ' 秒') +
      kv('耐久', shield.durabilityMax + '') +
      kv('减益效果', '抵挡伤害 −' + Math.round(shield.blockDR * 100) + '%') +
      kv('增益加成', '陨星减伤 ' + Math.round(shield.meteorDR * 100) + '%') +
      '<div class="prep-tags"><i>近战</i><i>近战击</i><i>生理控制</i></div>' +
      '</div>' +
      opsBlock([['左键', '盾击'], ['右键', '转向']]) +
      '</div>';

    weaponBox.querySelectorAll('.prep-card.weapon').forEach((el) => {
      el.addEventListener('click', () => {
        selectedWeapon = (el as HTMLElement).dataset.w as 'railgun' | 'shield';
        renderPrep();
      });
    });
  }

  const list = document.getElementById('prep-skill-list');
  if (!list) return;
  const order = ['blackhole', 'leap', 'stone'];
  const keys = ['Q', 'E', 'F'];
  list.innerHTML = order
    .map((id, i) => {
      const d = SKILLS[id];
      const desc = d.desc.replace(/\[\[(.+?)\]\]/g, '<span class="tip-tag">$1</span>');
      const detail =
        id === 'blackhole'
          ? kv('范围区伤害', '8 / 次') +
            kv('范围区范围', '66') +
            kv('范围区时间', '3 秒') +
            kv('控制时长', '0.12 秒') +
            kv('冷却时间', d.cd + ' 秒')
          : id === 'leap'
            ? kv('近战击伤害', '26') +
              kv('近战击范围', '76') +
              kv('控制时长', '1.4 秒') +
              kv('冷却时间', d.cd + ' 秒')
            : kv('增益加成', '减伤 +45%') +
              kv('减益加成', '移速 −30%') +
              kv('增益时间', '6 秒') +
              kv('冷却时间', d.cd + ' 秒');
      return (
        '<div class="prep-card">' +
        '<div class="prep-card-head"><b>' + d.name + '</b><span>' + keys[i] + '</span></div>' +
        '<p class="prep-desc">' + desc + '</p>' +
        '<div class="prep-detail">' + detail + '<div class="prep-tags"><i>技能</i></div></div>' +
        '</div>'
      );
    })
    .join('');
}

renderPrep();

function startGame(heroId: HeroId = 'guard'): void {
  world = new World(BOT ? 'guard' : heroId, selectedWeapon);
  ended = false;
  panelWasOpen = false;
  panelSig = '';
  panel.hide();
  hud.reset();
  renderer.particles.length = 0;
  renderer.numbers.length = 0;
  renderer.rings.length = 0;
  // 单机/房主：购买在本地执行
  panel.setBuyHandler(null);
  camera.update(world.player.pos, 0, true);
  screenTitle.classList.add('hidden');
  screenEnd.classList.add('hidden');
  hideDrop();
  prepScreen.classList.add('hidden');
  // 结算界面可能把它改成「等待房主重开」，开新局要还原
  const rb = document.getElementById('btn-restart') as HTMLButtonElement;
  rb.disabled = false;
  rb.textContent = '再次净化';
  setPaused(false);
  hudEl.classList.add('on');
  keys.clear();
  clearEdges();
  mouse.left = false;
  mouse.right = false;
  acc = 0;
  lastTime = performance.now();
  if (p2pReady && p2pRole === 'host') ensureHostPlayers();
}

function showEnd(w: World): void {
  if (ended) return;
  ended = true;
  const win = w.state === 'victory';
  endTitle.textContent = win ? '净化成功' : '净化失败';
  endTitle.classList.toggle('fail', !win);
  endSub.textContent = win
    ? '升华水晶仍在闪耀，域兽退去了。这条净化之路守住了。'
    : '升华水晶破碎，域兽涌入了流界。这条净化之路失守了。';
  endStats.innerHTML = `
    <div>抵达波次<b>${w.wave.n}</b></div>
    <div>击杀域兽<b>${w.totalKills}</b></div>
    <div>造成伤害<b>${Math.round(w.player.totalDamage)}</b></div>
  `;
  hudEl.classList.remove('on');
  screenEnd.classList.remove('hidden');
  // 联机客人不能自己重开，得等房主
  const coopGuest = p2pMode && p2pRole === 'guest';
  const restartBtn = document.getElementById('btn-restart') as HTMLButtonElement;
  restartBtn.disabled = coopGuest;
  restartBtn.textContent = coopGuest ? '等待房主重开' : '再次净化';
}

let lastHero: HeroId = 'guard';
document.getElementById('btn-start')!.addEventListener('click', () => {
  screenTitle.classList.add('hidden');
  prepScreen.classList.remove('hidden');
});
document.getElementById('btn-deploy')!.addEventListener('click', () => {
  prepScreen.classList.add('hidden');
  lastHero = 'guard';
  if (roomCode) startP2P(roomCode, 'host');
  // 联机房主：先进准备大厅，双方都点「出发」才开打
  if (p2pMode && p2pRole === 'host') {
    enterCoopLobby();
    return;
  }
  startGame(lastHero);
});

/** 从选武器界面返回主菜单（联机时顺便断开房间） */
function backFromPrep(): void {
  prepScreen.classList.add('hidden');
  if (p2pMode || lobbyActive) {
    leaveCoop();
    return;
  }
  screenTitle.classList.remove('hidden');
}
document.getElementById('btn-prep-back')!.addEventListener('click', () => backFromPrep());
document.getElementById('btn-codex')!.addEventListener('click', () => codex.show());
document.getElementById('btn-restart')!.addEventListener('click', () => {
  if (p2pRole === 'guest' && p2pMode) return;
  // 联机房主重开：通知客人一起重置，否则客人会停在结算界面
  if (p2pMode && p2pRole === 'host' && p2p) p2p.sendState({ t: 'restart' });
  startGame(lastHero);
});
document.getElementById('btn-cheat')!.addEventListener('click', () => {
  if (!world) return;
  // 客人的世界以房主为准，本地加钱会被下一帧快照覆盖，得让房主加
  if (p2pMode && p2pRole === 'guest') p2p?.sendInput({ t: 'cheat' });
  else world.player.coins += 1000;
  hud.toast('域币 +1000');
});

/* ---------------- 缩放 ---------------- */

function resize(): void {
  const scale = Math.max(
    1,
    Math.floor(Math.min(window.innerWidth / VIEW.w, window.innerHeight / VIEW.h)),
  );
  document.documentElement.style.setProperty('--s', String(scale));
  // 后备画布按整数倍放大：位移用设备像素表达，亚像素移动才不会卡成 1 逻辑像素
  renderer.setScale(scale);
}
window.addEventListener('resize', resize);
resize();

/* ---------------- 调试用自动演示（?bot=1） ---------------- */

const PARAMS = new URLSearchParams(location.search);
const BOT = PARAMS.has('bot');
const ONLINE = PARAMS.has('online');
const ROOM = PARAMS.get('room') ?? 'main';
const net = new NetClient();
let onlineReady = false;
let p2pMode = PARAMS.has('p2p');
let p2pRole: 'host' | 'guest' = PARAMS.get('role') === 'guest' ? 'guest' : 'host';
let p2pRoom = (PARAMS.get('room') ?? '').toUpperCase();
let p2p: P2P | null = null;
let p2pReady = false;
let p2pSnap: WorldWire | null = null;
let p2pInput: InputSnapshot | null = null;
let p2pSendAcc = 0;
/** 房主攒下来的特效事件，随快照一起发给客人（渲染层每帧会把 world.events 清空，得单独留一份） */
const p2pEvents: WorldEvent[] = [];
let stateSent = 0;
let lastSeq = -2;
let lastAppliedSnap: WorldWire | null = null;
/** 房主：收到的客人输入序号 / 最近一拍真正消费到的序号 */
let lastGuestSeq = 0;
let appliedGuestSeq = 0;
/** 客人：自己发出的输入序号 + 未确认输入缓冲（用于重放预测） */
let guestSeqOut = 0;
const AUTOWALK = typeof location !== 'undefined' && /[?&]autowalk=1/.test(location.search);
let ackedGuestSeq = 0;
/** debug：每秒有多少次纠偏超过 4px */
let corrLog = 0;
let corrDbgAt = 0;
let lastErr = 0;
/** 房主模拟时间相对真实时间的速率（房主卡顿时 <1）；客人的预测和发帧都按它走 */
let hostSimRate = 1;
let hostTimePrev = 0;
let hostTimePrevAt = 0;
const guestInputBuf: { seq: number; moveX: number; moveY: number }[] = [];

/* ---------------- 联机状态 ---------------- */

const netStatusEl = document.createElement('div');
netStatusEl.id = 'net-status';
netStatusEl.className = 'net-status hidden';
document.body.appendChild(netStatusEl);

function setNetStatus(text: string | null, kind: 'info' | 'good' | 'bad' = 'info'): void {
  if (!text) {
    netStatusEl.classList.add('hidden');
    return;
  }
  netStatusEl.textContent = text;
  netStatusEl.className = 'net-status ' + kind;
}

let guestWaitEl: HTMLElement | null = null;

function showGuestWait(): void {
  if (guestWaitEl) return;
  const el = document.createElement('div');
  el.className = 'screen';
  el.innerHTML =
    '<div class="screen-inner">' +
    '<div class="logo mini">正在连接房主</div>' +
    '<div class="sub">房间 ' + (p2pRoom || '—') + '</div>' +
    '<div class="sub" style="opacity:.55;font-size:13px;margin-top:10px">保持此页面打开，房主出发后会自动进入战场</div>' +
    '</div>';
  document.body.appendChild(el);
  guestWaitEl = el;
}

function hideGuestWait(): void {
  guestWaitEl?.remove();
  guestWaitEl = null;
}

const EMPTY_INPUT: InputSnapshot = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fireHeld: false,
  firePressed: false,
  altHeld: false,
  altPressed: false,
  reloadPressed: false,
  rollPressed: false,
  skillQ: false,
  skillE: false,
  skillF: false,
  panel: false,
  skip: false,
};

/** 边沿标记用掉就清掉，避免同一帧的多次 tick 重复触发 */
function clearInputEdges(i: InputSnapshot): void {
  i.firePressed = false;
  i.altPressed = false;
  i.reloadPressed = false;
  i.rollPressed = false;
  i.skillQ = false;
  i.skillE = false;
  i.skillF = false;
  i.panel = false;
  i.skip = false;
}

/** 客人的输入可能比房主的 tick 更密：连续量用最新的，边沿要累积到被消费为止 */
function mergeInput(prev: InputSnapshot | null, next: InputSnapshot): InputSnapshot {
  if (!prev) return { ...next };
  prev.moveX = next.moveX;
  prev.moveY = next.moveY;
  prev.aimX = next.aimX;
  prev.aimY = next.aimY;
  prev.fireHeld = next.fireHeld;
  prev.altHeld = next.altHeld;
  prev.firePressed = prev.firePressed || next.firePressed;
  prev.altPressed = prev.altPressed || next.altPressed;
  prev.reloadPressed = prev.reloadPressed || next.reloadPressed;
  prev.rollPressed = prev.rollPressed || next.rollPressed;
  prev.skillQ = prev.skillQ || next.skillQ;
  prev.skillE = prev.skillE || next.skillE;
  prev.skillF = prev.skillF || next.skillF;
  prev.panel = prev.panel || next.panel;
  prev.skip = prev.skip || next.skip;
  return prev;
}

/** 房主代客人执行购买：buyShape 内部看 localIndex 取武器塑造，先临时切到 1 号玩家 */
function applyGuestBuy(kind: string, id: string, skillId?: string): void {
  if (!world || p2pRole !== 'host') return;
  const prev = world.localIndex;
  world.localIndex = 1;
  if (kind === 'weapon') world.buyShape(id, 1);
  else if (kind === 'skill' && skillId) world.buySkillShape(skillId, id, 1);
  world.localIndex = prev;
}

function signalUrl(): string {
  return signalBase() + '/ws?room=' + p2pRoom;
}

/** 信令服务器基址：?signal= > 构建注入 VITE_SIGNAL_URL > 同源（开发模式连 3001） */
function signalBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const raw = PARAMS.get('signal') || env.VITE_SIGNAL_URL || '';
  if (raw) return raw.replace(/^http/, 'ws').replace(/\/+$/, '');
  if (location.port === '5173') {
    return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.hostname + ':3001';
  }
  return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
}

/** 先把休眠的免费实例戳醒，免得建房时卡在「连接信令服务器」 */
let signalWarmed = false;
function pingSignal(): void {
  const http = signalBase().replace(/^ws/, 'http');
  void fetch(http + '/', { mode: 'no-cors', cache: 'no-store' }).catch(() => undefined);
}
function warmSignal(): void {
  if (signalWarmed) return;
  signalWarmed = true;
  pingSignal();
}
// 免费实例闲置 15 分钟就休眠：页面开着就每 4 分钟戳一下，别让朋友等冷启动
if (typeof window !== 'undefined') {
  window.setInterval(pingSignal, 4 * 60 * 1000);
}

function startP2P(room: string, role: 'host' | 'guest'): void {
  if (p2p) return;
  p2pMode = true;
  p2pRole = role;
  p2pRoom = room.trim().toUpperCase();
  let stateLogged = false;
  p2p = new P2P({
    room: p2pRoom,
    role,
    signalUrl: signalUrl(),
    debug: DEBUG,
    onOpen: () => {
      p2pReady = true;
      if (DEBUG) console.log('[net] open', role);
      setNetStatus(role === 'host' ? '朋友已连接' : '已连接房主', 'good');
      window.setTimeout(() => {
        if (p2pReady) setNetStatus(null);
      }, 3200);
      if (role === 'host') ensureHostPlayers();
      // 客人连上就进准备大厅；但如果他本来就还在游戏里（断线重连），别把人踢回房间
      else if (!world) enterCoopLobby();
    },
    onData: (raw) => {
      try {
        const msg = JSON.parse(raw) as {
          t?: string;
          world?: WorldWire;
          snap?: InputSnapshot;
          ready?: boolean;
          weapon?: string;
          cx?: number;
          cy?: number;
          phase?: string;
          host?: { ready?: boolean; weapon?: string; cx?: number; cy?: number } | null;
          panel?: boolean;
          kind?: string;
          id?: string;
          skillId?: string;
        };
        if (!stateLogged && DEBUG) {
          stateLogged = true;
          console.log('[net] 首包', msg.t, 'world?', !!msg.world);
        }
        if (msg.t === 'state' && msg.world) {
          p2pSnap = msg.world;
          snapCount++;
          const nowMs = performance.now();
          if (lastSnapAt > 0) {
            const gap = (nowMs - lastSnapAt) / 1000;
            if (gap > 0.005 && gap < 1) snapInterval += (gap - snapInterval) * 0.2;
          }
          lastSnapAt = nowMs;
          if (DEBUG && msg.world.events && msg.world.events.length > 0) {
            console.log('[net] 收到事件', msg.world.events.length);
          }
          // 客人收到第一帧快照才建世界，避免空跑
          if (p2pRole === 'guest' && !world) enterGuestWorld();
        } else if (msg.t === 'input' && msg.snap) {
          if (typeof (msg.snap as { seq?: number }).seq === 'number') {
            lastGuestSeq = (msg.snap as { seq?: number }).seq!;
          }
          p2pInput = mergeInput(p2pInput, msg.snap);
        } else if (msg.t === 'lobby') {
          if (p2pRole === 'host') {
            // 阶段切换瞬间，客人可能还在发上一阶段的状态，丢掉
            if (typeof msg.phase === 'string' && msg.phase !== lobbyPhase) return;
            if (typeof msg.ready === 'boolean') {
              lobbyPeer = {
                ready: msg.ready,
                weapon: msg.weapon === 'shield' ? 'shield' : 'railgun',
                cx: typeof msg.cx === 'number' ? msg.cx : 0.5,
                cy: typeof msg.cy === 'number' ? msg.cy : 0.5,
              };
              renderCoopLobby();
            }
            // 房主在后台时，大厅靠 hiddenLoop 推进；收到客人消息就把它叫醒
            if (document.hidden) hiddenLoopStart();
          } else {
            if (msg.phase === 'ready' || msg.phase === 'loadout') {
              if (msg.phase !== lobbyPhase) {
                // 房主推进到下一阶段：清掉自己的准备状态
                lobbyPhase = msg.phase;
                if (lobbySelf) lobbySelf.ready = false;
                lobbyStartAt = null;
              }
            }
            if (msg.host) lobbyRemoteHost = msg.host;
            renderCoopLobby();
          }
        } else if (msg.t === 'ctl' && typeof msg.panel === 'boolean') {
          const gp = world?.players[1];
          if (gp) gp.panelOpen = msg.panel;
        } else if (msg.t === 'buy' && msg.id) {
          applyGuestBuy(msg.kind ?? '', msg.id, msg.skillId);
        } else if (msg.t === 'cheat') {
          const gp = world?.players[1];
          if (gp) gp.coins += 1000;
        } else if (msg.t === 'restart' && p2pRole === 'guest') {
          // 房主重开一局：客人丢掉旧世界，等下一帧快照重新建
          world = null;
          p2pSnap = null;
          lastAppliedSnap = null;
          ended = false;
          panelWasOpen = false;
          panelSig = '';
          panel.hide();
          screenEnd.classList.add('hidden');
          screenTitle.classList.add('hidden');
          prepScreen.classList.add('hidden');
        }
      } catch {
        /* 坏包直接丢 */
      }
    },
    onFail: (r) => {
      const wasLive = p2pMode && (world !== null || lobbyActive);
      p2pReady = false;
      p2pInput = null;
      // 断线后别让大厅还显示对方「已就绪」
      lobbyPeer = null;
      lobbyRemoteHost = null;
      if (lobbyActive) renderCoopLobby();
      setNetStatus('联机失败：' + r, 'bad');
      // 正在玩或在大厅里：给一个整屏提示，别让画面僵在那儿
      if (wasLive) showDrop(r);
    },
    onStatus: (st, detail) => {
      if (st === 'connected') return;
      setNetStatus(detail ?? '连接中…', st === 'failed' ? 'bad' : 'info');
    },
  });
  p2p.start();
}

/* ---------------- 联机准备大厅 ---------------- */

let lobbyActive = false;
let lobbyPhase: LobbyPhase = 'ready';
let lobbyStartAt: number | null = null;
let lobbySelf: { ready: boolean; weapon: LobbyWeapon; cx: number; cy: number } | null = null;
let lobbyPeer: { ready: boolean; weapon: LobbyWeapon; cx: number; cy: number } | null = null;
let lobbyRemoteHost: {
  ready?: boolean;
  weapon?: string;
  cx?: number;
  cy?: number;
} | null = null;
let lobbyAcc = 0;
let guestWeapon: LobbyWeapon = 'railgun';
let panelSent: boolean | null = null;

const coop = new CoopLobby({
  onReady: (ready) => {
    if (!lobbySelf) return;
    lobbySelf.ready = ready;
    renderCoopLobby();
  },
  onWeapon: (weapon) => {
    if (!lobbySelf) return;
    lobbySelf.weapon = weapon;
    renderCoopLobby();
  },
  onLeave: () => leaveCoop(),
  onMove: (nx, ny) => {
    if (!lobbySelf) return;
    lobbySelf.cx = nx;
    lobbySelf.cy = ny;
  },
  onInvite: () => {
    const url = onlineUrl(p2pRoom, 'guest');
    void navigator.clipboard?.writeText(url);
  },
});

function renderCoopLobby(): void {
  if (!lobbyActive || !lobbySelf) return;
  const self: LobbyCard = {
    weapon: lobbySelf.weapon,
    ready: lobbySelf.ready,
    cx: lobbySelf.cx,
    cy: lobbySelf.cy,
  };
  let peer: LobbyCard | null = null;
  if (p2pRole === 'host') {
    if (lobbyPeer) peer = { ...lobbyPeer };
  } else if (lobbyRemoteHost) {
    peer = {
      weapon: lobbyRemoteHost.weapon === 'shield' ? 'shield' : 'railgun',
      ready: !!lobbyRemoteHost.ready,
      cx: typeof lobbyRemoteHost.cx === 'number' ? lobbyRemoteHost.cx : 0.5,
      cy: typeof lobbyRemoteHost.cy === 'number' ? lobbyRemoteHost.cy : 0.5,
    };
  }
  coop.update({
    role: p2pRole,
    phase: lobbyPhase,
    room: p2pRoom,
    self,
    peer,
    peerConnected: p2pReady,
    countdown: lobbyStartAt !== null,
  });
  if (peer) coop.setPeerCursor(peer.cx, peer.cy);
}

function enterCoopLobby(): void {
  if (lobbyActive) return;
  lobbyActive = true;
  lobbyPhase = 'ready';
  lobbyStartAt = null;
  lobbyAcc = 0;
  lobbySelf = { ready: false, weapon: selectedWeapon, cx: 0.5, cy: 0.5 };
  lobbyPeer = null;
  lobbyRemoteHost = null;
  panelSent = null;
  hideGuestWait();
  lobby.classList.add('hidden');
  screenTitle.classList.add('hidden');
  prepScreen.classList.add('hidden');
  screenEnd.classList.add('hidden');
  hideDrop();
  hudEl.classList.remove('on');
  coop.show(p2pRole, selectedWeapon, p2pRoom);
  renderCoopLobby();
  // 房主在后台时，大厅也要能推进（否则双方就绪后没人切阶段）
  if (document.hidden) hiddenLoopStart();
}

/** 联机断了：整屏提示，避免画面僵在战场上没人知道发生了什么 */
function showDrop(reason: string): void {
  const isGuest = p2pRole === 'guest';
  dropTitle.textContent = world ? '连接中断' : '联机中断';
  dropSub.textContent = isGuest
    ? '与房主的连接已断开。' + (reason ? '（' + reason + '）' : '')
    : '与客人的连接已断开。' + (reason ? '（' + reason + '）' : '');
  screenDrop.classList.remove('hidden');
  hudEl.classList.remove('on');
  coop.hide();
}

function hideDrop(): void {
  screenDrop.classList.add('hidden');
}

document.getElementById('btn-drop-back')!.addEventListener('click', () => {
  hideDrop();
  leaveCoop();
});

function leaveCoop(): void {
  lobbyActive = false;
  lobbyStartAt = null;
  coop.hide();
  hideDrop();
  if (p2p) p2p.close();
  p2p = null;
  p2pReady = false;
  p2pSnap = null;
  p2pInput = null;
  p2pMode = false;
  p2pRole = 'host';
  world = null;
  hudEl.classList.remove('on');
  screenTitle.classList.remove('hidden');
  setNetStatus(null);
  // 房间号也一起清掉，否则下次开弹窗还显示上一次的码
  resetRoomUi();
}

function updateCoopLobby(dt: number): void {
  if (!p2p || !p2pReady || !lobbySelf) return;
  lobbyAcc += dt;
  if (lobbyAcc < 1 / 30) return;
  lobbyAcc = 0;
  if (p2pRole === 'host') {
    p2p.sendState({ t: 'lobby', phase: lobbyPhase, host: lobbySelf, guest: lobbyPeer });
    advanceCoop();
  } else {
    p2p.sendInput({
      t: 'lobby',
      phase: lobbyPhase,
      ready: lobbySelf.ready,
      weapon: lobbySelf.weapon,
      cx: lobbySelf.cx,
      cy: lobbySelf.cy,
    });
  }
}

/** 准备阶段：双方都准备 → 进入选武器；选武器阶段：双方都出发 → 开局 */
function advanceCoop(): void {
  const both = !!lobbySelf?.ready && !!lobbyPeer?.ready;

  if (lobbyPhase === 'ready') {
    if (!both) return;
    lobbyPhase = 'loadout';
    lobbyStartAt = null;
    lobbySelf!.ready = false;
    if (lobbyPeer) lobbyPeer.ready = false;
    renderCoopLobby();
    return;
  }

  if (!both) {
    if (lobbyStartAt !== null) {
      lobbyStartAt = null;
      renderCoopLobby();
    }
    return;
  }
  const now = performance.now();
  if (lobbyStartAt === null) {
    lobbyStartAt = now + 900;
    renderCoopLobby();
    // 房主切后台时靠隐藏循环推进倒计时，否则双方就绪后会一直卡在「即将开始」
    if (document.hidden) hiddenLoopStart();
  } else if (now >= lobbyStartAt) {
    startCoopGame();
  }
}

function startCoopGame(): void {
  if (!lobbySelf) return;
  guestWeapon = lobbyPeer?.weapon === 'shield' ? 'shield' : 'railgun';
  selectedWeapon = lobbySelf.weapon;
  lobbyActive = false;
  lobbyStartAt = null;
  coop.hide();
  startGame('guard');
  // 开局时如果房主已经在后台，直接把后台循环接上
  if (document.hidden) hiddenLoopStart();
}

/** 房主页面切到后台时浏览器会暂停 rAF，世界就冻住了 —— 明确提示，别让人以为卡死 */
document.addEventListener('visibilitychange', () => {
  if (!p2pMode || p2pRole !== 'host') return;
  if (document.hidden) {
    setNetStatus('房主页面已切到后台 → 世界暂停，请切回本页', 'bad');
  } else if (p2pReady) {
    setNetStatus('已回到前台，继续净化', 'good');
    window.setTimeout(() => {
      if (!document.hidden) setNetStatus(null);
    }, 2200);
  }
});

/** 房主世界里给客人留一个玩家位（联机前不占位） */
function ensureHostPlayers(): void {
  if (!world || p2pRole !== 'host') return;
  while (world.players.length < 2) world.addPlayer(guestWeapon);
}

/** 客人收到第一帧快照：以房主世界为准，本地只做插值渲染 */
function enterGuestWorld(): void {
  if (world) return;
  // 房主开始了：关掉准备大厅，进入战场
  lobbyActive = false;
  lobbyStartAt = null;
  coop.hide();
  panelSent = null;
  lastAppliedSnap = null;
  world = new World('guard', 'railgun');
  world.localIndex = 1;
  ended = false;
  panelWasOpen = false;
  panelSig = '';
  panel.hide();
  hud.reset();
  renderer.particles.length = 0;
  renderer.numbers.length = 0;
  renderer.rings.length = 0;
  screenTitle.classList.add('hidden');
  prepScreen.classList.add('hidden');
  screenEnd.classList.add('hidden');
  hudEl.classList.add('on');
  setPaused(false);
  // 客人也能开成长面板：购买发给房主执行
  panel.setBuyHandler((kind, id, skillId) => {
    p2p?.sendInput({ t: 'buy', kind, id, skillId });
  });
  if (p2pSnap) applySnapshot(world, p2pSnap);
  camera.update(world.player.pos, 0, true);
  hideGuestWait();
  keys.clear();
  clearEdges();
  mouse.left = false;
  mouse.right = false;
  acc = 0;
  lastTime = performance.now();
  setNetStatus(null);
}
const SHOW_FPS = PARAMS.has('fps');
const fpsEl = document.getElementById('fps');
if (SHOW_FPS && fpsEl) fpsEl.style.display = 'block';
let fpsFrames = 0;
let fpsTime = 0;
let snapCount = 0;
/** 实测快照间隔（秒），客人插值用；房主卡的时候它会变大，平滑跟着放慢，避免橡皮筋 */
let snapInterval = 1 / 30;
let lastSnapAt = 0;
/** 最近一次应用快照的时间，插值用 */
let snapAt = 0;
/** 诊断：弹道每帧是否在动 */
let projLastX: number | null = null;
let projLastY = 0;
let projFrames = 0;
let projMoved = 0;
let projLogAt = 0;
let tApply = 0;
let tDraw = 0;
let tHud = 0;
let inputAcc = 0;
const DEBUG = new URLSearchParams(location.search).has('debug');

let debugEl: HTMLElement | null = null;
if (DEBUG) {
  debugEl = document.createElement('div');
  debugEl.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;color:#7fe0a0;background:rgba(0,0,0,.7);padding:6px 8px;white-space:pre;';
  document.body.appendChild(debugEl);
}

function buildBotInput(w: World, consumePanel = true): InputSnapshot {
  const p = w.player;
  const pnl = consumePanel ? edges.panel : false;
  if (consumePanel) edges.panel = false;
  let nearest: { x: number; y: number } | null = null;
  let nd = Infinity;
  let count = 0;
  for (const e of w.enemies) {
    if (e.hp <= 0) continue;
    count++;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (d < nd) {
      nd = d;
      nearest = e.pos;
    }
  }
  const front = w.frontCrystal();
  const anchor = front ? front.pos : p.pos;
  const da = Math.hypot(anchor.x - p.pos.x, anchor.y - p.pos.y);

  let mx = 0;
  let my = 0;
  if (nearest && nd > 150) {
    mx = nearest.x - p.pos.x;
    my = nearest.y - p.pos.y;
  } else if (da > 84) {
    mx = anchor.x - p.pos.x;
    my = anchor.y - p.pos.y;
  } else if (nearest) {
    const a = Math.atan2(p.pos.y - nearest.y, p.pos.x - nearest.x) + 1.1;
    mx = Math.cos(a);
    my = Math.sin(a);
  }
  const l = Math.hypot(mx, my) || 1;

  const aimX = nearest ? nearest.x : p.pos.x + Math.cos(p.aim) * 120;
  const aimY = nearest ? nearest.y : p.pos.y + Math.sin(p.aim) * 120;

  let q = false;
  let e = false;
  if (p.mode === 'none') {
    if (p.qCd <= 0 && count >= 3 && nd < 210) q = true;
    else if (p.eCd <= 0 && nearest && nd < 82) e = true;
  }

  return {
    moveX: mx / l,
    moveY: my / l,
    aimX,
    aimY,
    fireHeld: true,
    firePressed: true,
    altHeld: false,
    altPressed: false,
    reloadPressed: false,
    rollPressed: false,
    skillQ: q,
    skillE: e,
    skillF: false,
    panel: pnl,
    skip: false,
  };
}

/* ---------------- 房主 tick / 发快照（前台与后台共用） ---------------- */

function hostCoopTick(dt: number): void {
  if (!world || world.state !== 'playing' || paused) return;
  acc += dt;
  let guard = 0;
  while (acc >= STEP && guard < 8) {
    // 输入必须在循环里取：高刷新率下有些帧不推进逻辑，在外面取会把按键边沿吃掉
    const inp = BOT ? buildBotInput(world, false) : buildInput(true);
    const guestInp = p2pInput ?? EMPTY_INPUT;
    if (DEBUG && (guestInp.skillQ || guestInp.skillE || guestInp.firePressed)) {
      console.log('[net] 客人边沿', guestInp.skillQ ? 'Q' : guestInp.skillE ? 'E' : 'fire');
    }
    if (DEBUG && (inp.skillQ || inp.skillE || inp.firePressed)) {
      console.log('[net] 房主边沿', inp.skillQ ? 'Q' : inp.skillE ? 'E' : 'fire');
    }
    world.tick([inp, guestInp], STEP);
    // 记下这一拍真正消费到的客人输入序号，随快照回报（客人据此重放）
    appliedGuestSeq = lastGuestSeq;
    clearInputEdges(guestInp);
    acc -= STEP;
    guard++;
  }
  if (acc > STEP * 8) acc = STEP * 8;
  // 这一帧产生的特效事件先留一份给客人（渲染时会清空 world.events）
  if (world.events.length > 0) {
    for (const ev of world.events) p2pEvents.push(ev);
    if (p2pEvents.length > 80) p2pEvents.splice(0, p2pEvents.length - 80);
  }
  // 防御：万一没人消费（例如房主在后台），别让事件数组无限增长
  if (world.events.length > 200) world.events.length = 200;
}

function hostCoopSend(dt: number): void {
  if (!p2p || !p2pReady || !world) return;
  p2pSendAcc += dt;
  if (p2pSendAcc < 1 / 60) return;
  p2pSendAcc = 0;
  const wire = serializeWorld(world, p2pEvents.splice(0, p2pEvents.length), appliedGuestSeq);
  p2p.sendState({ t: 'state', world: wire });
  if (DEBUG) measureSnapSize(wire);
  if (DEBUG && stateSent < 3) {
    stateSent++;
    console.log('[net] 发快照', stateSent);
  }
}

/** 调试：统计快照体积（每秒打印 avg/max 与实际 KB/s） */
let snapBytesSum = 0;
let snapBytesMax = 0;
let snapBytesN = 0;
let snapBytesAt = 0;
function measureSnapSize(wire: unknown): void {
  const n = JSON.stringify(wire).length;
  snapBytesSum += n;
  if (n > snapBytesMax) snapBytesMax = n;
  snapBytesN++;
  const now = performance.now();
  const elapsed = (now - snapBytesAt) / 1000;
  if (elapsed > 1) {
    if (snapBytesN > 0) {
      const avg = snapBytesSum / snapBytesN;
      const perSec = snapBytesSum / elapsed / 1024;
      console.log(
        '[net] 快照体积 avg ' + (avg / 1024).toFixed(2) + 'KB  max ' +
          (snapBytesMax / 1024).toFixed(2) + 'KB  ' + snapBytesN + '/s  ' +
          perSec.toFixed(0) + 'KB/s',
      );
    }
    snapBytesAt = now;
    snapBytesSum = 0;
    snapBytesMax = 0;
    snapBytesN = 0;
  }
}

/* ---------------- 切到后台也继续跑 ---------------- */

// rAF 在后台标签页会被暂停，timer 会被节流到 1Hz；MessageChannel 的自调度不受影响。
const hiddenChan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
let hiddenOn = false;
let hiddenLast = 0;
let hiddenLogAt = 0;
let hiddenTicks = 0;

function hiddenLoopStart(): void {
  if (!hiddenChan || hiddenOn) return;
  if (!(p2pMode && p2pRole === 'host' && (world || lobbyActive))) return;
  hiddenOn = true;
  hiddenLast = performance.now();
  hiddenLogAt = hiddenLast;
  hiddenTicks = 0;
  hiddenChan.port2.postMessage(0);
}

function hiddenLoopStop(): void {
  hiddenOn = false;
}

if (hiddenChan) {
  // MessageChannel 自调度不会被后台节流，但也意味着没有节流——必须自己按真实时间限速，
  // 否则一秒钟能跑十几万次 tick（世界 150 倍速，水晶瞬间被拆）。
  const HIDDEN_STEP = 1000 / 120;
  hiddenChan.port1.onmessage = () => {
    if (!hiddenOn) return;
    const now = performance.now();
    if (now - hiddenLast >= HIDDEN_STEP) {
      let steps = Math.floor((now - hiddenLast) / HIDDEN_STEP);
      hiddenLast += steps * HIDDEN_STEP;
      if (steps > 5) steps = 5;
      for (let i = 0; i < steps; i++) {
        // 大厅阶段也要推进（双方就绪倒计时 / 阶段切换）
        if (lobbyActive) updateCoopLobby(1 / 60);
        else {
          hostCoopTick(1 / 120);
          // 后台没有渲染器消费事件，不清空的话事件会越积越多、
          // 每拍都重复发给客人（客人那边一个爆炸会画出十几圈光波）
          if (world) world.events.length = 0;
          hostCoopSend(1 / 120);
        }
      }
      hiddenTicks += steps;
      if (DEBUG && now - hiddenLogAt > 1000) {
        console.log('[net] 后台继续运行', hiddenTicks, 'tick/s');
        hiddenLogAt = now;
        hiddenTicks = 0;
      }
    }
    if (!(p2pMode && p2pRole === 'host' && (world || lobbyActive))) {
      hiddenOn = false;
      return;
    }
    // 大厅空闲（没在倒计时）或对局已结束就不自旋，省 CPU；有事件时再唤醒
    const needLobby = lobbyActive && lobbyStartAt !== null;
    const needWorld = !!world && world.state === 'playing';
    if (!needLobby && !needWorld) {
      hiddenOn = false;
      return;
    }
    hiddenChan.port2.postMessage(0);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenLoopStart();
    else hiddenLoopStop();
  });
}

/* ---------------- 主循环 ---------------- */

let lastTime = performance.now();
let acc = 0;
// 模拟步长：120Hz。60Hz 时高刷屏上每 3 帧才更新一次位置，房主看着比客人还糙。
// 模拟本身是 dt 驱动的，缩小步长不改玩法，只是 CPU 翻倍。
const STEP = 1 / 120;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // 大厅阶段还没有世界，但它也要跑（双光标、双方就绪）
  if (lobbyActive) updateCoopLobby(dt);

  if (!world) return;

  const t0 = performance.now();
  if (p2pMode) {
    if (p2pRole === 'host') {
      // 前台用 rAF 驱动；后台由 hiddenLoop 兜底。
      // 注意不能用 document.hidden 判断：有些环境（自动化/无头）里它一直是 true，
      // 所以只要后台循环没在跑，就让 rAF 这边接着跑。
      if (!hiddenOn) {
        hostCoopTick(dt);
        hostCoopSend(dt);
      }
    } else {
      // Tab 开面板：客人本地不跑模拟，得自己切换状态再告诉房主
      if (edges.panel) {
        edges.panel = false;
        const gp = world.player;
        gp.panelOpen = !gp.panelOpen;
      }
      // 不要在这里清边沿：只有真正发出去的那一刻才清，
      // 否则 60fps 下按在「不发送」的那一帧会被吞掉。
      const inp = buildInput(false);
      // 只在收到新快照时重建世界对象；每帧重建纯属给 GC 添堵
      if (p2pSnap && p2pSnap !== lastAppliedSnap) {
        lastAppliedSnap = p2pSnap;
        const tAp = performance.now();
        applySnapshot(world, p2pSnap);
        snapAt = tAp;
        tApply += performance.now() - tAp;
        // 重放预测：用「房主权威位置 + 还没被处理的输入」算出目标位置。
        // 注意不能直接钉过去——重放只要有一两像素误差，硬设就会在 30Hz 上回跳，
        // 手感比不修还糟。这里只把目标当作纠偏方向，限速平滑跟过去。
        // 用快照里的世界时间估计房主的模拟速率：房主卡顿时它的模拟时间会走得比真实时间慢
        const wt = (p2pSnap as { time?: number }).time ?? 0;
        const nowRate = performance.now();
        if (hostTimePrev > 0 && wt > hostTimePrev && nowRate > hostTimePrevAt) {
          const r = (wt - hostTimePrev) / ((nowRate - hostTimePrevAt) / 1000);
          const clamped = r < 0.4 ? 0.4 : r > 1.6 ? 1.6 : r;
          hostSimRate += (clamped - hostSimRate) * 0.2;
        }
        hostTimePrev = wt;
        hostTimePrevAt = nowRate;
        const seqAck = (p2pSnap as { guestSeq?: number }).guestSeq ?? 0;
        if (seqAck > ackedGuestSeq) ackedGuestSeq = seqAck;
        const aw = p2pSnap.players[world.localIndex];
        const me0 = world.player;
        if (aw && me0.alive) {
          const sx = me0.pos.x;
          const sy = me0.pos.y;
          me0.pos.x = aw.x;
          me0.pos.y = aw.y;
          let replay = 0;
          for (const b of guestInputBuf) {
            if (b.seq <= ackedGuestSeq) continue;
            if (replay++ > 30) break;
            world.predictPlayerMove(me0, { moveX: b.moveX, moveY: b.moveY } as InputSnapshot, 1 / 60);
          }
          const tX = me0.pos.x;
          const tY = me0.pos.y;
          me0.pos.x = sx;
          me0.pos.y = sy;
          const ex = tX - sx;
          const ey = tY - sy;
          const d = Math.hypot(ex, ey);
          if (d > 150) {
            // 真的错位（复活/传送/被拒的动作）才硬对齐
            me0.pos.x = tX;
            me0.pos.y = tY;
          } else if (d > 2) {
            // 每秒最多追 220px：跟得上，但不会像被拽
            const step = Math.min(d, 220 / 60);
            me0.pos.x += (ex / d) * step;
            me0.pos.y += (ey / d) * step;
          }
          if (DEBUG) {
            if (d > 4) corrLog++;
            lastErr = d;
            const nowD = performance.now();
            if (nowD - corrDbgAt > 1000) {
              corrDbgAt = nowD;
              console.log('[net] 纠偏 err=' + d.toFixed(1) + 'px pending=' + guestInputBuf.length + ' head=' + (guestInputBuf[0]?.seq ?? -1) + ' tail=' + (guestInputBuf[guestInputBuf.length - 1]?.seq ?? -1) + ' replay=' + replay + ' acked=' + ackedGuestSeq + ' out=' + guestSeqOut);
              corrLog = 0;
            }
          }
          while (guestInputBuf.length > 0 && guestInputBuf[0].seq <= ackedGuestSeq) {
            guestInputBuf.shift();
          }
        }
      }
      // 面板开关是离散状态，变化即发，不必挤进 30Hz 输入
      const gpOpen = world.player.panelOpen;
      if (panelSent !== gpOpen) {
        panelSent = gpOpen;
        p2p?.sendInput({ t: 'ctl', panel: gpOpen });
      }
      if (p2p && p2pReady) {
        p2pSendAcc += dt;
        if (p2pSendAcc >= 1 / 60) {
          p2pSendAcc = 0;
          if (DEBUG && (inp.firePressed || inp.skillQ || inp.rollPressed)) {
            console.log('[net] 客人发出边沿', inp.firePressed ? 'fire' : inp.skillQ ? 'Q' : 'roll');
          }
          guestSeqOut++;
          p2p.sendInput({ t: 'input', snap: { ...inp, seq: guestSeqOut } });
          // 记下这帧的移动输入：房主确认前，这些要用于本地重放
          guestInputBuf.push({ seq: guestSeqOut, moveX: inp.moveX, moveY: inp.moveY });
          if (guestInputBuf.length > 240) guestInputBuf.shift();
          // 清的是按键边沿表（edges），不是快照；否则技能键会被持续发送
          clearEdges();
        }
      }
      // 客人不跑模拟，但自己的移动必须在本地预测，否则手感到不了快照间隔的延迟
      const me = world.player;
      // 瞄准角先本地算（下面的翻滚方向要用最新的准星）
      if (me.alive) {
        me.aim = Math.atan2(inp.aimY - me.pos.y, inp.aimX - me.pos.x);
      }
      // 翻滚也本地起步：等房主确认要晚一整个快照间隔，闪避会显得「滑」
      // 石卵（eggT>0）期间一定不能动，别做本地翻滚预测
      if (
        me.alive &&
        me.eggT <= 0 &&
        inp.rollPressed &&
        me.rollT <= 0 &&
        me.stamina >= ROLL.cost
      ) {
        let dx = inp.moveX;
        let dy = inp.moveY;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) {
          dx = Math.cos(me.aim);
          dy = Math.sin(me.aim);
        } else {
          dx /= len;
          dy /= len;
        }
        me.rollDir.x = dx;
        me.rollDir.y = dy;
        me.rollT = ROLL.duration;
        me.stamina -= ROLL.cost;
      }
      if (AUTOWALK) {
        const tt = performance.now() / 700;
        inp.moveX = Math.sin(tt);
        inp.moveY = Math.cos(tt * 0.7);
      }
      // 本地预测按房主的模拟速率缩放：房主慢，客人也慢，否则会一路跑到前面被拽回来
      const pdt = dt * hostSimRate;
      if (me.alive && !me.panelOpen) world.predictPlayerMove(me, inp, pdt);
      if (me.alive) {
        // 技能投掷预览的落点同样本地推，别等快照
        if (me.mode === 'throw' || me.mode === 'leapaim') {
          const range =
            me.mode === 'throw' ? (SKILLS.blackhole.range ?? 260) : (SKILLS.leap.range ?? 200);
          const dx = inp.aimX - me.pos.x;
          const dy = inp.aimY - me.pos.y;
          const d = Math.hypot(dx, dy);
          const k = d > range ? range / d : 1;
          me.throwTarget = { x: me.pos.x + dx * k, y: me.pos.y + dy * k };
        }
      }
      // 其他人/怪：在上一拍和这一拍之间线性插值，匀速、不跳
      const nowMs = performance.now();
      const alpha = (nowMs - snapAt) / Math.max(0.016, snapInterval);
      interpolateWorld(world, alpha, true);
      // 弹道（激光/飞行物）没有稳定 id，不做插值，改为按快照里的速度每帧外推
      extrapolateWorld(world, dt);
      // 黑洞雷/毒雾瓶按本地时间推进抛物线
      animateWorld(world, dt);
      if (DEBUG) {
        const l0 = world.lasers[0];
        if (l0) {
          if (projLastX !== null) {
            projFrames++;
            if (Math.hypot(l0.pos.x - projLastX, l0.pos.y - projLastY) > 0.05) projMoved++;
          }
          projLastX = l0.pos.x;
          projLastY = l0.pos.y;
        } else {
          projLastX = null;
        }
        if (performance.now() - projLogAt > 1000) {
          projLogAt = performance.now();
          if (projFrames > 0) {
            console.log(
              '[net] 弹道动帧 ' + projMoved + '/' + projFrames +
                ' = ' + Math.round((projMoved / projFrames) * 100) + '%',
            );
          }
          projFrames = 0;
          projMoved = 0;
        }
      }
      // 只做「大误差兜底」：小误差是网络延迟，靠重放预测吸收，不再往回拽（否则会有被牵住的手感）
      const net2 = me as unknown as { tx?: number; ty?: number };
      if (net2.tx !== undefined) {
        const dx = net2.tx - me.pos.x;
        const dy = (net2.ty ?? 0) - me.pos.y;
        if (dx * dx + dy * dy > 150 * 150) {
          me.pos.x = net2.tx;
          me.pos.y = net2.ty!;
        }
      }
    }
  } else if (ONLINE) {
    if (onlineReady) {
      // 只在收到新快照时重建世界对象，避免每帧 GC
      if (net.seq - lastSeq >= 2) {
        lastSeq = net.seq;
        const snap = net.takeSnapshot();
        if (snap) {
          world.localIndex = net.playerIndex;
          applySnapshot(world, snap);
        }
      }
      // 本地预测：自己的角色立刻按输入移动，不等服务器
      const me = world.player;
      // 这里不能吃掉边沿：输入是 30Hz 才发一次，边沿要留到真正发送的那一帧
      const inp = BOT ? buildBotInput(world, false) : buildInput(false);
      if (me.alive && !me.panelOpen) {
        const sp = 88;
        me.pos.x += inp.moveX * sp * dt;
        me.pos.y += inp.moveY * sp * dt;
      }
      smoothWorld(world, dt, net.interval);
      const tA = performance.now();
      // 偏差过大才拉回（小偏差靠平滑吸收）
      {
        const t = me as unknown as { tx?: number; ty?: number };
        if (t.tx !== undefined) {
          const dx = t.tx - me.pos.x;
          const dy = (t.ty ?? 0) - me.pos.y;
          if (dx * dx + dy * dy > 60 * 60) {
            me.pos.x = t.tx;
            me.pos.y = t.ty!;
          }
        }
      }
      // 输入 30Hz 发送即可
      inputAcc += dt;
      if (inputAcc >= 1 / 30) {
        inputAcc = 0;
        net.sendInput(inp);
        clearEdges();
      }
    }
  } else if (world.state === 'playing' && !paused) {
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 5) {
      world.tick(BOT ? buildBotInput(world) : buildInput(true), STEP);
      acc -= STEP;
      guard++;
      if (world.state !== 'playing') break;
    }
    // 调试：单机也量一下快照体积（用真实世界估算联机带宽）
    if (DEBUG) measureSnapSize(serializeWorld(world, []));
    if (acc > STEP * 3) acc = 0;
  }

  camera.update(world.player.pos, dt);

  const evs = world.events.splice(0, world.events.length);
  if (evs.length > 0) {
    renderer.handleEvents(evs);
    hud.handleEvents(evs);
  }

  const tD0 = performance.now();
  renderer.draw(world, camera, BOT ? buildBotInput(world, false) : buildInput(false), dt);
  const tD1 = performance.now();
  const tH0 = performance.now();
  hud.update(world, dt);
  const tH1 = performance.now();
  syncPanel();

  if (debugEl) {
    debugEl.textContent = `player ${world.player.pos.x.toFixed(0)},${world.player.pos.y.toFixed(0)}  hp ${world.player.hp.toFixed(0)}
camera ${camera.x.toFixed(0)},${camera.y.toFixed(0)}
enemies ${world.enemies.length}  wave ${world.wave.n}  pts ${world.player.points}
zoom ${document.documentElement.style.getPropertyValue('--s')}
vis ${document.visibilityState}  focus ${document.hasFocus()}  net ${p2pReady ? 'on' : 'off'}`;
  }

  if (SHOW_FPS && fpsEl) {
    fpsFrames++;
    fpsTime += dt;
    tDraw += tD1 - tD0;
    tHud += tH1 - tH0;
    if (fpsTime >= 0.5) {
      const fps = fpsFrames / fpsTime;
      const snapRate = p2pMode ? '  snap ' + Math.round(snapCount / fpsTime) + '/s' : '';
      const applyMs = '  apply ' + (tApply / fpsFrames).toFixed(2) + 'ms';
      fpsEl.textContent =
        'FPS ' + fps.toFixed(0) +
        '  draw ' + ((tDraw / fpsFrames) * 1).toFixed(1) + 'ms' +
        '  hud ' + ((tHud / fpsFrames) * 1).toFixed(1) + 'ms' +
        applyMs +
        snapRate +
        '  b:' + __BUILD_ID__ +
        '  online ' + (ONLINE ? 'yes' : 'no');
      fpsFrames = 0;
      fpsTime = 0;
      snapCount = 0;
      tApply = 0;
      tDraw = 0;
      tHud = 0;
    }
  }

  if (world.state !== 'playing') showEnd(world);
}

if (ONLINE) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // 开发模式（vite 5173）连独立的 3001；部署后同源
  const sameOrigin = location.port !== '5173';
  const host = PARAMS.get('server') ?? (sameOrigin ? location.host : location.hostname + ':3001');
  net.connect(proto + '//' + host + '/ws?room=' + ROOM);
  const tick = setInterval(() => {
    if (net.isConnected() && net.takeSnapshot()) {
      onlineReady = true;
      clearInterval(tick);
    }
  }, 200);
}

if (p2pMode) {
  warmSignal();
  if (p2pRole === 'guest') {
    // 客人：直接等房主，别让「开始游戏」开出单机世界
    screenTitle.classList.add('hidden');
    showGuestWait();
    startP2P(p2pRoom || 'MAIN', 'guest');
  } else if (p2pRoom) {
    // 带房间号的房主链接：直接进准备房间，不用再点菜单
    startP2P(p2pRoom, 'host');
    enterCoopLobby();
  } else {
    startP2P('MAIN', 'host');
  }
}

requestAnimationFrame(frame);
