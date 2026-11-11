import './style.css';
import { RAIL_WEAPON, SHIELD_WEAPON, SKILLS } from './content/defs';
import { VIEW } from './content/defs';
import type { HeroId } from './content/defs';
import { Camera, Renderer } from './render/renderer';
import { NetClient } from './net/client';
import { P2P } from './net/p2p';
import { serializeWorld } from './net/snapshot';
import { applySnapshot, smoothWorld } from './net/apply';
import type { InputSnapshot } from './shared/types';
import type { WorldWire } from '../server/protocol';
import { clamp } from './shared/util';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import { Codex } from './ui/codex';
import { GrowthPanel } from './ui/panel';
import { CoopLobby } from './ui/coop';
import type { LobbyCard, LobbyWeapon } from './ui/coop';

window.addEventListener('error', (e) => {
  console.error('BOOT ERROR:', e.message, '@', e.filename, e.lineno, e.colno);
});

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screenTitle = document.getElementById('screen-title') as HTMLElement;
const screenEnd = document.getElementById('screen-end') as HTMLElement;
const endTitle = document.getElementById('end-title') as HTMLElement;
const endSub = document.getElementById('end-sub') as HTMLElement;
const endStats = document.getElementById('end-stats') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const pauseScreen = document.getElementById('pause') as HTMLElement;
const prepScreen = document.getElementById('prep') as HTMLElement;
let paused = false;

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
const lobbyCopy = document.getElementById("lobby-copy") as HTMLElement;
let roomCode = "";

function onlineUrl(code: string, role: "host" | "guest"): string {
  const base = location.origin + location.pathname;
  return base + "?p2p=1&room=" + code + "&role=" + role;
}

document.getElementById("btn-online")!.addEventListener("click", () => {
  lobby.classList.remove("hidden");
  lobbyTip.textContent = "创建一个房间，把链接发给朋友即可";
});
document.getElementById("lobby-close")!.addEventListener("click", () => lobby.classList.add("hidden"));
document.getElementById("lobby-create")!.addEventListener("click", () => {
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase();
  lobbyCodeEl.textContent = roomCode;
  lobbyCopy.classList.remove("hidden");
  lobbyTip.textContent = "房间已创建 · 复制链接发给朋友，关闭此窗口后点「开始游戏 → 出发」";
});
lobbyCopy.addEventListener("click", () => {
  if (!roomCode) return;
  const url = onlineUrl(roomCode, "guest");
  void navigator.clipboard?.writeText(url);
  lobbyTip.textContent = "已复制：" + url;
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
    if (world && world.state === 'playing' && !ended) setPaused(!paused);
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
  paused = v;
  pauseScreen.classList.toggle('hidden', !v);
  if (v) {
    keys.clear();
    mouse.left = false;
    mouse.right = false;
    clearEdges();
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
  prepScreen.classList.add('hidden');
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
document.getElementById('btn-codex')!.addEventListener('click', () => codex.show());
document.getElementById('btn-restart')!.addEventListener('click', () => {
  if (p2pRole === 'guest' && p2pMode) return;
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
let stateSent = 0;
let lastSeq = -2;
let lastAppliedSnap: WorldWire | null = null;

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
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // 开发模式（vite 5173）连独立的 3001；部署后同源
  const host = location.port === '5173' ? location.hostname + ':3001' : location.host;
  return proto + '//' + host + '/ws?room=' + p2pRoom;
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
      // 客人连上就进准备大厅，和房主看同一个界面
      else enterCoopLobby();
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
          // 客人收到第一帧快照才建世界，避免空跑
          if (p2pRole === 'guest' && !world) enterGuestWorld();
        } else if (msg.t === 'input' && msg.snap) {
          p2pInput = mergeInput(p2pInput, msg.snap);
        } else if (msg.t === 'lobby') {
          if (p2pRole === 'host') {
            if (typeof msg.ready === 'boolean') {
              lobbyPeer = {
                ready: msg.ready,
                weapon: msg.weapon === 'shield' ? 'shield' : 'railgun',
                cx: typeof msg.cx === 'number' ? msg.cx : 0.5,
                cy: typeof msg.cy === 'number' ? msg.cy : 0.5,
              };
              renderCoopLobby();
            }
          } else if (msg.host) {
            lobbyRemoteHost = msg.host;
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
        }
      } catch {
        /* 坏包直接丢 */
      }
    },
    onFail: (r) => {
      p2pReady = false;
      p2pInput = null;
      // 断线后别让大厅还显示对方「已就绪」
      lobbyPeer = null;
      lobbyRemoteHost = null;
      if (lobbyActive) renderCoopLobby();
      setNetStatus('联机失败：' + r, 'bad');
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
let lobbyStartAt: number | null = null;
let lobbySelf: { ready: boolean; weapon: LobbyWeapon; cx: number; cy: number } | null = null;
let lobbyPeer: { ready: boolean; weapon: LobbyWeapon; cx: number; cy: number } | null = null;
let lobbyRemoteHost: { ready?: boolean; weapon?: string; cx?: number; cy?: number } | null = null;
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
  coop.update({ role: p2pRole, self, peer, countdown: lobbyStartAt !== null });
  if (peer) coop.setPeerCursor(peer.cx, peer.cy);
}

function enterCoopLobby(): void {
  if (lobbyActive) return;
  lobbyActive = true;
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
  hudEl.classList.remove('on');
  coop.show(p2pRole, selectedWeapon);
  renderCoopLobby();
}

function leaveCoop(): void {
  lobbyActive = false;
  lobbyStartAt = null;
  coop.hide();
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
}

function updateCoopLobby(dt: number): void {
  if (!p2p || !p2pReady || !lobbySelf) return;
  lobbyAcc += dt;
  if (lobbyAcc < 1 / 30) return;
  lobbyAcc = 0;
  if (p2pRole === 'host') {
    p2p.sendState({ t: 'lobby', host: lobbySelf, guest: lobbyPeer });
    maybeStartCoop();
  } else {
    p2p.sendInput({
      t: 'lobby',
      ready: lobbySelf.ready,
      weapon: lobbySelf.weapon,
      cx: lobbySelf.cx,
      cy: lobbySelf.cy,
    });
  }
}

/** 双方都点了「出发」才开始，留一点时间让对面看到「即将开始」 */
function maybeStartCoop(): void {
  const both = !!lobbySelf?.ready && !!lobbyPeer?.ready;
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

/* ---------------- 主循环 ---------------- */

let lastTime = performance.now();
let acc = 0;
const STEP = 1 / 60;

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
      const inp = BOT ? buildBotInput(world, false) : buildInput(true);
      if (world.state === 'playing' && !paused) {
        acc += dt;
        let guard = 0;
        while (acc >= STEP && guard < 5) {
          // 房主权威：自己的输入 + 客人最新输入，一起推进世界
          const guestInp = p2pInput ?? EMPTY_INPUT;
          if (DEBUG && (guestInp.skillQ || guestInp.skillE || guestInp.firePressed)) {
            console.log('[net] 客人边沿', guestInp.skillQ ? 'Q' : guestInp.skillE ? 'E' : 'fire');
          }
          world.tick([inp, guestInp], STEP);
          clearInputEdges(guestInp);
          acc -= STEP;
          guard++;
        }
      }
      if (p2p && p2pReady) {
        p2pSendAcc += dt;
        if (p2pSendAcc >= 1 / 30) {
          p2pSendAcc = 0;
          p2p.sendState({ t: 'state', world: serializeWorld(world) });
          if (DEBUG && stateSent < 3) {
            stateSent++;
            console.log('[net] 发快照', stateSent);
          }
        }
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
        applySnapshot(world, p2pSnap);
      }
      // 面板开关是离散状态，变化即发，不必挤进 30Hz 输入
      const gpOpen = world.player.panelOpen;
      if (panelSent !== gpOpen) {
        panelSent = gpOpen;
        p2p?.sendInput({ t: 'ctl', panel: gpOpen });
      }
      if (p2p && p2pReady) {
        p2pSendAcc += dt;
        if (p2pSendAcc >= 1 / 30) {
          p2pSendAcc = 0;
          if (DEBUG && (inp.firePressed || inp.skillQ || inp.rollPressed)) {
            console.log('[net] 客人发出边沿', inp.firePressed ? 'fire' : inp.skillQ ? 'Q' : 'roll');
          }
          p2p.sendInput({ t: 'input', snap: inp });
          // 清的是按键边沿表（edges），不是快照；否则技能键会被持续发送
          clearEdges();
        }
      }
      // 客人不跑模拟：只按房主快照插值
      smoothWorld(world, dt, 1 / 30);
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
      const inp = BOT ? buildBotInput(world, false) : buildInput(true);
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
        net.sendInput(BOT ? buildBotInput(world, false) : buildInput(true));
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
    tApply += tD1 - tD0;
    tDraw += tD1 - tD0;
    tHud += tH1 - tH0;
    if (fpsTime >= 0.5) {
      const fps = fpsFrames / fpsTime;
      fpsEl.textContent =
        'FPS ' + fps.toFixed(0) +
        '  draw ' + ((tDraw / fpsFrames) * 1).toFixed(1) + 'ms' +
        '  hud ' + ((tHud / fpsFrames) * 1).toFixed(1) + 'ms' +
        '  online ' + (ONLINE ? 'yes' : 'no');
      fpsFrames = 0;
      fpsTime = 0;
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
  if (p2pRole === 'guest') {
    // 客人：直接等房主，别让「开始游戏」开出单机世界
    screenTitle.classList.add('hidden');
    showGuestWait();
    startP2P(p2pRoom || 'MAIN', 'guest');
  } else {
    startP2P(p2pRoom || 'MAIN', 'host');
  }
}

requestAnimationFrame(frame);
