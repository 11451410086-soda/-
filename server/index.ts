import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { World } from '../src/sim/world';
import type { InputSnapshot } from '../src/shared/types';
import type { ClientMsg, ServerMsg, WorldWire } from './protocol';

const PORT = Number(process.env.PORT ?? 3001);
const STEP = 1 / 60;
const SNAPSHOT_HZ = 30;

const emptyInput = (): InputSnapshot => ({
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
});

interface Room {
  world: World;
  clients: Set<WebSocket>;
  slots: Map<WebSocket, number>;
  inputs: InputSnapshot[];
  acc: number;
  last: number;
}

const MAX_PLAYERS = 2;

const rooms = new Map<string, Room>();

function createRoom(id: string): Room {
  const world = new World('guard', 'railgun');
  const room: Room = {
    world,
    clients: new Set(),
    slots: new Map(),
    inputs: [emptyInput(), emptyInput()],
    acc: 0,
    last: Date.now(),
  };
  const timer = setInterval(() => tickRoom(room), 16);
  (room as unknown as { timer: NodeJS.Timeout }).timer = timer;

  rooms.set(id, room);
  return room;
}

function tickRoom(room: Room): void {
  const now = Date.now();
  const dt = Math.min(0.1, (now - room.last) / 1000);
  room.last = now;
  room.acc += dt;
  let guard = 0;
  while (room.acc >= STEP && guard < 5) {
    room.world.tick(room.inputs, STEP);
    for (const input of room.inputs) {
      input.firePressed = false;
      input.altPressed = false;
      input.reloadPressed = false;
      input.rollPressed = false;
      input.skillQ = false;
      input.skillE = false;
      input.skillF = false;
      input.panel = false;
      input.skip = false;
    }
    room.acc -= STEP;
    guard++;
  }
}

function snapshot(room: Room): WorldWire {
  const w = room.world;
  return {
    time: w.time,
    state: w.state as WorldWire['state'],
    wave: {
      n: w.wave.n,
      phase: w.wave.phase,
      timer: w.wave.timer,
      remaining: w.remainingEnemies(),
    },
    players: w.players.map((p, i) => ({
        id: i + 1,
        x: p.pos.x,
        y: p.pos.y,
        aim: p.aim,
        hp: p.hp,
        maxHp: p.maxHp,
        stamina: p.stamina,
        weaponId: p.weaponId,
        shieldHp: p.shieldHp,
        shieldAngle: p.shieldAngle,
        meteorT: p.meteorT,
        stoneT: p.stoneT,
        eggT: p.eggT,
        leapT: p.leapT,
        leapHangT: p.leapHangT,
        landT: p.landT,
        rollT: p.rollT,
        reloading: p.reloading,
        ammo: p.ammo,
        charge: p.charge,
        alive: p.alive,
        coins: p.coins,
        skillCd: p.skillCd.slice(),
      })),
    enemies: w.enemies.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.pos.x,
      y: e.pos.y,
      hp: e.hp,
      maxHp: e.maxHp,
      facing: e.facing,
      windup: e.windup,
      windupTotal: e.windupTotal,
      windupAngle: e.windupAngle,
      hitFlash: e.hitFlash,
      attackAnim: e.attackAnim,
      rootT: e.rootT,
      slowT: e.slowT,
    })),
    lasers: w.lasers.map((l) => ({
      x: l.pos.x,
      y: l.pos.y,
      angle: l.angle,
      radius: l.radius,
      orb: l.orb,
      lift: l.lift,
    })),
    zones: w.zones.map((z) => ({
      x: z.pos.x,
      y: z.pos.y,
      radius: z.radius,
      ttl: z.ttl,
      maxTtl: z.maxTtl,
      poison: !!z.poison,
    })),
    shots: w.shots.map((s) => ({ x: s.pos.x, y: s.pos.y, radius: s.radius })),
    bottles: w.bottles.map((b) => ({ x: b.pos.x, y: b.pos.y })),
    crystals: w.crystals.map((c) => ({
      x: c.pos.x,
      y: c.pos.y,
      kind: c.kind,
      hp: c.hp,
      maxHp: c.maxHp,
      alive: c.alive,
    })),
    events: [],
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const staticRoot = join(process.cwd(), 'dist');
const httpServer = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = url === '/' ? '/index.html' : url;
  try {
    const data = await readFile(join(staticRoot, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(staticRoot, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function roomIdOf(req: { url?: string }): string {
  const q = (req.url ?? '').split('?')[1] ?? '';
  const id = new URLSearchParams(q).get('room');
  return (id ?? 'main').slice(0, 16).toUpperCase();
}

wss.on('connection', (ws, req) => {
  let room: Room | null = null;
  let roomKey = 'main';

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === 'join') {
      roomKey = roomIdOf(req);
      room = rooms.get(roomKey) ?? createRoom(roomKey);
      // 清理已断开的连接，避免幽灵玩家占位
      for (const c of Array.from(room.clients)) {
        if (c.readyState !== WebSocket.OPEN) {
          room.clients.delete(c);
          room.slots.delete(c);
        }
      }
      if (room.clients.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'error', msg: '房间已满' } as ServerMsg));
        ws.close();
        return;
      }
      const used = new Set(room.clients.size ? Array.from(room.slots.values()) : []);
      let slot = 0;
      while (used.has(slot)) slot++;
      room.clients.add(ws);
      room.slots.set(ws, slot);
      if (slot > 0 && room.world.players.length <= slot) {
        room.world.addPlayer('shield');
      }
      room.world.players[slot].panelOpen = false;
      const welcome: ServerMsg = { t: 'welcome', playerId: slot + 1 };
      console.log('[server] 房间', roomKey, '玩家', slot + 1, '加入（当前', room.clients.size, '人）');
      ws.send(JSON.stringify(welcome));
      return;
    }

    if (msg.t === 'buy' && room) {
      const slot = room.slots.get(ws) ?? 0;
      room.world.localIndex = slot;
      if (msg.kind === 'weapon') room.world.buyShape(msg.id, slot);
      else if (msg.skillId) room.world.buySkillShape(msg.skillId, msg.id, slot);
      room.world.localIndex = 0;
      return;
    }

    if (msg.t === 'input' && room) {
      const slot = room.slots.get(ws) ?? 0;
      const s = msg.snap;
      const li = room.inputs[slot];
      li.moveX = s.moveX;
      li.moveY = s.moveY;
      li.aimX = s.aimX;
      li.aimY = s.aimY;
      li.fireHeld = s.fireHeld;
      li.altHeld = s.altHeld;
      li.firePressed = li.firePressed || s.firePressed;
      li.altPressed = li.altPressed || s.altPressed;
      li.reloadPressed = li.reloadPressed || s.reloadPressed;
      li.rollPressed = li.rollPressed || s.rollPressed;
      li.skillQ = li.skillQ || s.skillQ;
      li.skillE = li.skillE || s.skillE;
      li.skillF = li.skillF || s.skillF;
      li.panel = li.panel || s.panel;
      li.skip = li.skip || s.skip;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);
    room.slots.delete(ws);
    if (room.clients.size === 0) {
      const r = room;
      setTimeout(() => {
        if (r.clients.size === 0) {
          clearInterval((r as unknown as { timer?: NodeJS.Timeout }).timer);
          rooms.delete(roomKey);
          console.log('[server] 房间', roomKey, '已清空，世界重置');
        }
      }, 8000);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.clients.size === 0) continue;
    const payload = JSON.stringify({ t: 'state', world: snapshot(room) } as ServerMsg);
    for (const c of room.clients) {
      if (c.readyState === WebSocket.OPEN) c.send(payload);
    }
  }
}, 1000 / SNAPSHOT_HZ);

httpServer.listen(PORT, () => console.log('[server] http+ws 已启动，端口 ' + PORT));
