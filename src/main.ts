import './style.css';
import { RAIL_WEAPON, SHIELD_WEAPON, SKILLS } from './content/defs';
import { VIEW } from './content/defs';
import type { HeroId } from './content/defs';
import { Camera, Renderer } from './render/renderer';
import { NetClient } from './net/client';
import { applySnapshot, smoothWorld } from './net/apply';
import type { InputSnapshot } from './shared/types';
import { clamp } from './shared/util';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import { Codex } from './ui/codex';
import { GrowthPanel } from './ui/panel';

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
  startGame(lastHero);
});
document.getElementById('btn-codex')!.addEventListener('click', () => codex.show());
document.getElementById('btn-restart')!.addEventListener('click', () => startGame(lastHero));
document.getElementById('btn-cheat')!.addEventListener('click', () => {
  if (!world) return;
  world.player.coins += 1000;
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
let lastSeq = -2;
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

  if (!world) return;

  if (ONLINE) {
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
      smoothWorld(world, dt);
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

  renderer.draw(world, camera, BOT ? buildBotInput(world, false) : buildInput(false), dt);
  hud.update(world, dt);
  syncPanel();

  if (debugEl) {
    debugEl.textContent = `player ${world.player.pos.x.toFixed(0)},${world.player.pos.y.toFixed(0)}  hp ${world.player.hp.toFixed(0)}
camera ${camera.x.toFixed(0)},${camera.y.toFixed(0)}
enemies ${world.enemies.length}  wave ${world.wave.n}  pts ${world.player.points}
zoom ${document.documentElement.style.getPropertyValue('--s')}`;
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

requestAnimationFrame(frame);
