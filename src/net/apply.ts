import type { World } from '../sim/world';
import type { WorldWire } from '../../server/protocol';
import type { Enemy } from '../sim/types';

/** 把服务器快照写进本地世界对象（渲染层直接复用） */

export function applySnapshot(world: World, wire: WorldWire): void {
  while (world.players.length < wire.players.length) world.addPlayer('railgun');
  for (let idx = 0; idx < wire.players.length; idx++) {
    const p = world.players[idx];
    const pw = wire.players[idx];
    if (!pw) continue;
    (p as unknown as { tx: number; ty: number }).tx = pw.x;
    (p as unknown as { tx: number; ty: number }).ty = pw.y;
    if (!(p as unknown as { init?: boolean }).init) {
      p.pos.x = pw.x;
      p.pos.y = pw.y;
      (p as unknown as { init?: boolean }).init = true;
    }
    p.aim = pw.aim;
    p.hp = pw.hp;
    p.maxHp = pw.maxHp;
    p.stamina = pw.stamina;
    p.weaponId = pw.weaponId as 'railgun' | 'shield';
    p.shieldHp = pw.shieldHp;
    p.shieldAngle = pw.shieldAngle;
    p.meteorT = pw.meteorT;
    p.stoneT = pw.stoneT;
    p.eggT = pw.eggT;
    p.leapT = pw.leapT;
    p.leapHangT = pw.leapHangT;
    p.landT = pw.landT;
    p.rollT = pw.rollT;
    p.reloading = pw.reloading;
    p.ammo = pw.ammo;
    p.charge = pw.charge;
    p.alive = pw.alive;
    p.coins = pw.coins;
    for (let i = 0; i < p.skillCd.length; i++) p.skillCd[i] = pw.skillCd[i] ?? 0;
  }

  world.state = wire.state;
  world.wave.n = wire.wave.n;
  world.wave.phase = wire.wave.phase as typeof world.wave.phase;
  world.wave.timer = wire.wave.timer;

  const prevEnemies = new Map(world.enemies.map((e) => [e.id, e]));
  world.enemies = wire.enemies.map((e) => ({
    id: e.id,
    kind: e.kind as Enemy['kind'],
    pos: { x: prevEnemies.get(e.id)?.pos.x ?? e.x, y: prevEnemies.get(e.id)?.pos.y ?? e.y },
    tx: e.x,
    ty: e.y,
    hp: e.hp,
    maxHp: e.maxHp,
    speed: 0,
    radius: 10,
    dmg: 0,
    atkInterval: 1,
    atkTimer: 0,
    atkRange: 0,
    aggro: 0,
    immunity: {},
    ranged: false,
    keepDist: 0,
    shotCd: 0,
    pathIndex: 0,
    hitFlash: e.hitFlash,
    ext: null,
    attackAnim: e.attackAnim,
    facing: e.facing,
    rootT: e.rootT,
    slowT: e.slowT,
    healCd: 0,
    slowFactor: 0,
    rootBonus: 1,
    windup: e.windup,
    windupTotal: e.windupTotal,
    windupAngle: e.windupAngle,
    chaseT: 0,
    chaseX: 0,
    chaseY: 0,
  })) as unknown as World['enemies'];

  world.lasers = wire.lasers.map((l) => ({
    pos: { x: l.x, y: l.y },
    vel: { x: 0, y: 0 },
    angle: l.angle,
    damage: 0,
    pierce: 0,
    hitIds: [],
    life: 1,
    travel: 0,
    blast: 0,
    radius: l.radius,
    orb: l.orb,
    tag: 'flight',
    detonated: false,
    splitCount: 0,
    lift: l.lift,
    small: false,
    homing: false,
    targetZone: 0,
  })) as unknown as World['lasers'];

  world.zones = wire.zones.map((z, i) => ({
    id: i + 1,
    owner: z.poison ? 'enemy' : 'player',
    pos: { x: z.x, y: z.y },
    radius: z.radius,
    ttl: z.ttl,
    maxTtl: z.maxTtl,
    tick: 0,
    blastLock: 0,
    pulse: 0,
    poison: z.poison,
  })) as unknown as World['zones'];

  world.shots = wire.shots.map((s) => ({
    tag: 'flight',
    pos: { x: s.x, y: s.y },
    vel: { x: 0, y: 0 },
    radius: s.radius,
    dmg: 0,
    life: 1,
  })) as unknown as World['shots'];

  world.bottles = wire.bottles.map((b) => ({
    from: { x: b.x, y: b.y },
    to: { x: b.x, y: b.y },
    pos: { x: b.x, y: b.y },
    t: 0,
    dur: 1,
    radius: 0,
    duration: 0,
    interval: 0,
    damage: 0,
  })) as unknown as World['bottles'];

  for (let i = 0; i < world.crystals.length; i++) {
    const c = world.crystals[i];
    const cw = wire.crystals[i];
    if (!c || !cw) continue;
    c.hp = cw.hp;
    c.maxHp = cw.maxHp;
    c.alive = cw.alive;
  }
}

/** 每帧朝目标位置靠拢（不分配新对象，帧率友好） */
export function smoothWorld(world: World, dt: number, interval = 0.033): void {
  const k = Math.min(1, dt / Math.max(0.016, interval * 1.1));
  for (const p of world.players) {
    const t = p as unknown as { tx?: number; ty?: number };
    if (t.tx === undefined) continue;
    p.pos.x += (t.tx - p.pos.x) * k;
    p.pos.y += (t.ty! - p.pos.y) * k;
  }
  for (const e of world.enemies) {
    const t = e as unknown as { tx?: number; ty?: number };
    if (t.tx === undefined) continue;
    e.pos.x += (t.tx - e.pos.x) * k;
    e.pos.y += (t.ty! - e.pos.y) * k;
  }
}
