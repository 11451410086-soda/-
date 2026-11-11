import { ENEMIES, LEAP, LEVEL, RAIL_WEAPON, RECOIL, SHIELD_WEAPON, SKILLS, VIEW } from '../content/defs';
import type { InputSnapshot } from '../shared/types';
import type { Vec } from '../shared/util';
import { clamp, distToPolyline, lerp, mulberry32 } from '../shared/util';
import type { Crystal, Enemy, Laser, Player, WorldEvent, Zone } from '../sim/types';
import type { World } from '../sim/world';
import * as S from './sprites';

export class Camera {
  x = LEVEL.start.x - VIEW.w / 2;
  y = LEVEL.start.y - VIEW.h / 2;

  update(target: Vec, dt: number, snap = false): void {
    const tx = clamp(target.x - VIEW.w / 2, 0, LEVEL.width - VIEW.w);
    const ty = clamp(target.y - VIEW.h / 2, 0, LEVEL.height - VIEW.h);
    if (snap) {
      this.x = tx;
      this.y = ty;
      return;
    }
    const k = 1 - Math.exp(-9 * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  drag: number;
  grav: number;
  glow: boolean;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

const CYAN = 'rgba(120, 230, 255, 1)';
const PURPLE = 'rgba(180, 120, 255, 1)';
const ORANGE = 'rgba(255, 176, 90, 1)';

const QUERY = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const TOUCH_MOBILE =
  typeof navigator !== 'undefined' &&
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
// 手机默认低画质：粒子/暗角在移动 GPU 上很吃帧；想看全效果加 ?high=1
const LOW_QUALITY = !!QUERY && (QUERY.has('low') || (TOUCH_MOBILE && !QUERY.has('high')));

export const renderStats = { low: LOW_QUALITY };

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bg: HTMLCanvasElement;
  vignette: HTMLCanvasElement;
  particles: Particle[] = [];
  numbers: FloatText[] = [];
  rings: Ring[] = [];
  t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.bg = this.bakeBackground();
    this.vignette = this.bakeVignette();
  }

  /* ================= 背景烘焙 ================= */

  bakeBackground(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = LEVEL.width;
    cv.height = LEVEL.height;
    const g = cv.getContext('2d')!;
    const rnd = mulberry32(20261104);


    const top = LEVEL.road.top;
    const bot = LEVEL.road.bottom;

    // 岩壁底色
    g.fillStyle = '#070b12';
    g.fillRect(0, 0, cv.width, cv.height);

    // 路面
    g.fillStyle = '#141e2c';
    g.fillRect(0, top, cv.width, bot - top);

    // 路面噪点
    for (let y = top; y < bot; y += 8) {
      for (let x = 0; x < cv.width; x += 8) {
        const v = rnd();
        if (v > 0.6) {
          g.fillStyle = `rgba(62, 98, 146, ${0.015 + (v - 0.6) * 0.05})`;
          g.fillRect(x, y, 8, 8);
        }
      }
    }

    // 路面大色块
    for (let i = 0; i < 44; i++) {
      const x = rnd() * cv.width;
      const y = top + rnd() * (bot - top);
      const r = 40 + rnd() * 100;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const hue = rnd() > 0.5 ? '72,118,176' : '56,140,144';
      grad.addColorStop(0, `rgba(${hue},${0.02 + rnd() * 0.04})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 上下岩壁锯齿
    for (let x = 0; x < cv.width; x += 8) {
      const h1 = 4 + Math.floor(rnd() * 12);
      g.fillStyle = '#0a111c';
      g.fillRect(x, top - h1, 8, h1 + 1);
      g.fillStyle = 'rgba(60, 96, 142, 0.3)';
      g.fillRect(x, top - 1, 8, 1);

      const h2 = 4 + Math.floor(rnd() * 12);
      g.fillStyle = '#0a111c';
      g.fillRect(x, bot, 8, h2 + 1);
      g.fillStyle = 'rgba(60, 96, 142, 0.3)';
      g.fillRect(x, bot, 8, 1);
    }

    // 岩壁里的晶体矿脉
    for (let i = 0; i < 30; i++) {
      const x = rnd() * cv.width;
      const up = rnd() > 0.5;
      const y = up ? rnd() * (top - 8) : bot + 8 + rnd() * (cv.height - bot - 14);
      g.fillStyle = 'rgba(95, 215, 255, 0.28)';
      g.fillRect(x, y, 2, 1);
      g.fillStyle = 'rgba(95, 215, 255, 0.1)';
      g.fillRect(x - 1, y + 1, 4, 1);
    }

    // 车道边线
    g.fillStyle = 'rgba(95, 215, 255, 0.22)';
    g.fillRect(0, top, cv.width, 1);
    g.fillStyle = 'rgba(95, 215, 255, 0.14)';
    g.fillRect(0, bot - 1, cv.width, 1);

    // 中心虚线
    for (let x = 10; x < cv.width; x += 46) {
      g.fillStyle = 'rgba(95, 215, 255, 0.1)';
      g.fillRect(x, LEVEL.laneY - 1, 22, 2);
    }

    // 侧灯
    for (let x = 26; x < cv.width; x += 54) {
      for (const yy of [top + 8, bot - 8]) {
        const r = 12;
        const grad = g.createRadialGradient(x, yy, 0, x, yy, r);
        grad.addColorStop(0, 'rgba(95,215,255,0.2)');
        grad.addColorStop(1, 'rgba(95,215,255,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, yy - r, r * 2, r * 2);
        g.fillStyle = 'rgba(185,245,255,0.55)';
        g.fillRect(x - 1, yy - 1, 2, 2);
      }
    }

    // 路面碎石与裂缝
    for (let i = 0; i < 110; i++) {
      const x = rnd() * cv.width;
      const y = top + 6 + rnd() * (bot - top - 12);
      if (rnd() < 0.55) {
        const w = 1 + Math.floor(rnd() * 3);
        g.fillStyle = 'rgba(28, 41, 60, 0.9)';
        g.fillRect(x, y, w + 1, w);
        g.fillStyle = 'rgba(58, 84, 118, 0.5)';
        g.fillRect(x, y, w + 1, 1);
      } else {
        g.fillStyle = 'rgba(5, 9, 16, 0.45)';
        g.fillRect(x, y, 4 + rnd() * 10, 1);
      }
    }

    // 左右两端压暗
    const edge = g.createLinearGradient(0, 0, cv.width, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.35)');
    edge.addColorStop(0.1, 'rgba(0,0,0,0)');
    edge.addColorStop(0.9, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = edge;
    g.fillRect(0, 0, cv.width, cv.height);

    // 右端裂隙的焦痕
    const rx = LEVEL.rift.x;
    const rg = g.createRadialGradient(rx, LEVEL.laneY, 0, rx, LEVEL.laneY, 80);
    rg.addColorStop(0, 'rgba(90, 40, 140, 0.35)');
    rg.addColorStop(1, 'rgba(90, 40, 140, 0)');
    g.fillStyle = rg;
    g.fillRect(rx - 80, LEVEL.laneY - 80, 160, 160);

    return cv;
  }

  bakeVignette(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = VIEW.w;
    cv.height = VIEW.h;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(
      VIEW.w / 2,
      VIEW.h / 2,
      VIEW.h * 0.32,
      VIEW.w / 2,
      VIEW.h / 2,
      VIEW.w * 0.72,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = grad;
    g.fillRect(0, 0, VIEW.w, VIEW.h);
    return cv;
  }

  /* ================= 事件 → 特效 ================= */

  handleEvents(events: WorldEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot': {
          const mx = ev.x + Math.cos(ev.angle) * 16;
          const my = ev.y + Math.sin(ev.angle) * 16;
          this.addParticle(mx, my, Math.cos(ev.angle) * 40, Math.sin(ev.angle) * 40, 0.12, 2, CYAN, true);
          break;
        }
        case 'impact': {
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 30 + Math.random() * 70;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.18 + Math.random() * 0.2, 1.4, CYAN, true);
          }
          if (ev.dmg && ev.dmg > 0) {
            this.addNumber(ev.x, ev.y - 6, String(ev.dmg), '#bfe9ff');
          }
          break;
        }
        case 'laserHit': {
          this.addRing(ev.x, ev.y, 2, 7, 0.16, 'rgba(160,240,255,0.9)', 1);
          break;
        }
        case 'explosion': {
          this.addRing(ev.x, ev.y, ev.r * 0.4, ev.r, 0.36, 'rgba(200,140,255,0.85)', 2);
          this.addRing(ev.x, ev.y, ev.r * 0.2, ev.r * 0.7, 0.5, 'rgba(255,220,160,0.6)', 1);
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 60 + Math.random() * 170;
            const col = Math.random() > 0.5 ? PURPLE : ORANGE;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.45, 2.2, col, true);
          }
          break;
        }
        case 'detonate': {
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            this.addParticle(ev.x, ev.y, Math.cos(a) * 165, Math.sin(a) * 165, 0.4, 2.4, PURPLE, true);
          }
          this.addRing(ev.x, ev.y, 8, 52, 0.34, 'rgba(160,130,255,0.95)', 2);
          break;
        }
        case 'chain': {
          for (let i = 0; i <= 8; i++) {
            const k = i / 8;
            this.addParticle(ev.x + (ev.x2 - ev.x) * k, ev.y + (ev.y2 - ev.y) * k, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.2, 1.8, CYAN, true);
          }
          break;
        }
        case 'stoneImpact': {
          this.addRing(ev.x, ev.y, 3, 18, 0.22, 'rgba(255,196,110,0.9)', 1);
          break;
        }
        case 'enemyDeath': {
          const col = 'rgba(90,230,200,1)';
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 40 + Math.random() * 120;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + Math.random() * 0.4, 2, col, true);
          }
          this.addRing(ev.x, ev.y, 3, 16, 0.25, 'rgba(90,230,200,0.5)', 1);
          break;
        }
        case 'crystalHit': {
          this.addParticle(ev.x + (Math.random() - 0.5) * 16, ev.y - 8, 0, -30, 0.3, 2, ORANGE, true);
          break;
        }
        case 'crystalDown': {
          this.addRing(ev.x, ev.y, 10, 120, 0.8, 'rgba(255,120,120,0.7)', 3);
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 40 + Math.random() * 200;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 0.6, 2.4, 'rgba(255,150,140,1)', true);
          }
          break;
        }
        case 'zoneSpawn': {
          this.addRing(ev.x, ev.y, ev.r * 1.2, ev.r, 0.4, 'rgba(180,120,255,0.8)', 2);
          break;
        }
        case 'zonePulse': {
          this.addRing(ev.x, ev.y, ev.r * 0.85, ev.r * 1.02, 0.45, 'rgba(150,100,255,0.35)', 1);
          break;
        }
        case 'immune': {
          this.addNumber(ev.x, ev.y - 12, '免疫', '#9fb8d0');
          break;
        }
        case 'push': {
          for (let i = 0; i < 14; i++) {
            const a = ev.angle + (Math.random() * 2 - 1) * ev.half;
            const r = ev.range * (0.35 + Math.random() * 0.6);
            const x = ev.x + Math.cos(a) * r;
            const y = ev.y + Math.sin(a) * r;
            this.addParticle(x, y, Math.cos(a) * 110, Math.sin(a) * 110, 0.24, 2, 'rgba(255,180,90,1)', true);
          }
          break;
        }
        case 'fanStrike': {
          for (let i = 0; i < 18; i++) {
            const a = ev.angle + (Math.random() * 2 - 1) * ev.half;
            const r = ev.radius * (0.45 + Math.random() * 0.5);
            const x = ev.x + Math.cos(a) * r;
            const y = ev.y + Math.sin(a) * r;
            this.addParticle(x, y, Math.cos(a) * 70, Math.sin(a) * 70, 0.28, 2, 'rgba(255,120,110,1)', true);
          }
          break;
        }
        case 'dodge':
          this.addNumber(ev.x, ev.y - 12, '闪避', '#9fe8ff');
          break;
        case 'playerHurt': {
          break;
        }
        case 'shieldBash': {
          for (let i = 0; i < 12; i++) {
            const a = ev.angle + (Math.random() * 2 - 1) * ev.half;
            const r = ev.range * (0.4 + Math.random() * 0.5);
            this.addParticle(
              ev.x + Math.cos(a) * r,
              ev.y + Math.sin(a) * r,
              Math.cos(a) * 80,
              Math.sin(a) * 80,
              0.22,
              2,
              'rgba(180,220,255,1)',
              true,
            );
          }
          break;
        }
        case 'shieldBlock': {
          this.addRing(ev.x, ev.y, 2, 9, 0.2, 'rgba(180,220,255,0.9)', 1);
          break;
        }
        case 'shieldBreak': {
          this.addRing(ev.x, ev.y, 6, 70, 0.6, 'rgba(255,190,120,0.85)', 3);
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 60 + Math.random() * 180;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, 2, 'rgba(255,180,110,1)', true);
          }
          break;
        }
        case 'slamJump': {
          this.addRing(ev.x, ev.y, 4, 22, 0.3, 'rgba(255,190,120,0.6)', 2);
          break;
        }
        case 'slamLand': {
          this.addRing(ev.x, ev.y, 10, ev.r, 0.4, 'rgba(255,170,90,0.9)', 3);
          for (let i = 0; i < 30; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 80 + Math.random() * 220;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.4, 2.4, 'rgba(255,190,120,1)', true);
          }
          break;
        }
        case 'ultimate': {
          this.addRing(ev.x, ev.y, 10, 90, 0.7, 'rgba(255,215,110,0.9)', 3);
          for (let i = 0; i < 22; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 50 + Math.random() * 150;
            this.addParticle(ev.x, ev.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5, 2, 'rgba(255,220,140,1)', true);
          }
          break;
        }
        case 'elbow': {
          for (let i = 0; i < 14; i++) {
            const a = ev.angle + (Math.random() * 2 - 1) * ev.half;
            const r = ev.range * (0.3 + Math.random() * 0.6);
            this.addParticle(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r, Math.cos(a) * 120, Math.sin(a) * 120, 0.25, 2, 'rgba(255,220,140,1)', true);
          }
          break;
        }
        case 'waveClear': {
          break;
        }
        default:
          break;
      }
    }
  }

  addParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
    glow: boolean,
  ): void {
    if (this.particles.length > 520) return;
    this.particles.push({
      x,
      y,
      vx,
      vy,
      life,
      maxLife: life,
      size,
      color,
      drag: 4,
      grav: 0,
      glow,
    });
  }

  addNumber(x: number, y: number, text: string, color: string): void {
    if (this.numbers.length > 60) return;
    this.numbers.push({
      x: x + (Math.random() - 0.5) * 6,
      y,
      vy: -26,
      life: 0.55,
      maxLife: 0.55,
      text,
      color,
      size: 6,
    });
  }

  addRing(x: number, y: number, r0: number, r1: number, life: number, color: string, width: number): void {
    this.rings.push({ x, y, r0, r1, life, maxLife: life, color, width });
  }

  /* ================= 主绘制 ================= */

  draw(world: World, cam: Camera, input: InputSnapshot, dt: number): void {
    this.t += dt;
    const ctx = this.ctx;
    const t = this.t;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    const sh = world.shake;
    const sx = Math.round((Math.random() - 0.5) * sh);
    const sy = Math.round((Math.random() - 0.5) * sh);
    ctx.translate(-Math.round(cam.x) + sx, -Math.round(cam.y) + sy);

    ctx.drawImage(this.bg, 0, 0);

    this.drawRift(ctx, t);
    for (const b of world.bottles) {
      ctx.fillStyle = "rgba(30,40,20,0.9)";
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(150,220,90,0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(190,255,120,0.9)";
      ctx.beginPath();
      ctx.arc(b.pos.x - 1, b.pos.y - 1, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const g of world.grenades) {
      const gp = world.grenadePos(g);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(150,90,255,1)";
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#1a1030";
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(200,150,255,0.95)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(220,180,255,0.9)";
      ctx.beginPath();
      ctx.arc(gp.x - 1, gp.y - 1, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 范围区：剩余时间进度条（拥有白扩时提示可引爆）
    for (const z of world.zones) {
      const k = Math.max(0, Math.min(1, z.ttl / z.maxTtl));
      const bw = 56;
      const bx = z.pos.x - bw / 2;
      const by = z.pos.y - z.radius - 12;
      ctx.fillStyle = "rgba(6,12,20,0.85)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = k > 0.35 ? "#b788ff" : "#ff9ad1";
      ctx.fillRect(bx, by, bw * k, 3);
      ctx.strokeStyle = "rgba(200,160,255,0.65)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1, by - 1, bw + 2, 5);
      if (world.hasSkillShape('blackhole', 'whiteout')) {
        ctx.fillStyle = "rgba(220,190,255,0.9)";
        ctx.font = "6px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Q 引爆", z.pos.x, by - 5);
      }
    }

    for (const z of world.zones) this.drawZone(ctx, z, t);
    for (const c of world.crystals) this.drawCrystal(ctx, c, t);

    // 按 y 排序绘制
    const order = world.enemies.filter((e) => e.hp > 0).sort((a, b) => a.pos.y - b.pos.y);
    let drewPlayer = false;
    for (const e of order) {
      if (!drewPlayer && e.pos.y > world.player.pos.y) {
        for (const pl of world.players) this.drawPlayer(ctx, world, pl, t);
        drewPlayer = true;
      }
      this.drawEnemy(ctx, e, t);
    }
    if (!drewPlayer) for (const pl of world.players) this.drawPlayer(ctx, world, pl, t);

    for (const l of world.lasers) {
      if (l.lift) {
        ctx.save();
        ctx.translate(0, -l.lift);
        this.drawLaser(ctx, l);
        ctx.restore();
      } else {
        this.drawLaser(ctx, l);
      }
    }
    for (const s of world.shots) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,95,160,0.95)';
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(s.pos.x, s.pos.y, s.radius * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const g of world.grenades) {
      const k = g.t / g.dur;
      const x = lerp(g.from.x, g.to.x, k);
      const y = lerp(g.from.y, g.to.y, k);
      const h = Math.sin(k * Math.PI) * 46;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gimg = S.glowTex('rgba(190,130,255,0.9)', 20);
      ctx.drawImage(gimg, x - 20, y - h - 20);
      ctx.restore();
      ctx.fillStyle = '#0b0614';
      ctx.beginPath();
      ctx.arc(x, y - h, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(220,170,255,1)';
      ctx.beginPath();
      ctx.arc(x, y - h, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!LOW_QUALITY) this.drawParticles(ctx, dt);
    this.drawAim(ctx, world, input, t);

    ctx.restore();

    // 屏幕层
    if (!LOW_QUALITY) ctx.drawImage(this.vignette, 0, 0);
    this.drawMinimap(ctx, world, cam);

    const p = world.player;
    if (p.hurtFlash > 0.01) {
      ctx.fillStyle = `rgba(255,40,60,${p.hurtFlash * 0.22})`;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }
    if (!p.alive && world.state === 'playing') {
      ctx.fillStyle = 'rgba(4,8,16,0.35)';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }
  }

  drawRift(ctx: CanvasRenderingContext2D, t: number): void {
    const { x, y } = LEVEL.rift;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const img = S.glowTex('rgba(150,80,220,0.5)', 62);
    ctx.globalAlpha = 0.55 + Math.sin(t * 2.2) * 0.12;
    ctx.drawImage(img, x - 62, y - 62);
    ctx.restore();

    // 竖直的空间裂隙
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(190,130,255,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,70,200,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, Math.sin(t * 1.8) * 4, 9, 32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(14,5,28,0.94)';
    ctx.beginPath();
    ctx.ellipse(x, y, 8, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    // 裂隙中心的光丝
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(200,150,255,${0.4 + Math.sin(t * 4) * 0.15})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 26);
    ctx.lineTo(x, y + 26);
    ctx.stroke();
    ctx.restore();
  }

  drawZone(ctx: CanvasRenderingContext2D, z: Zone, t: number): void {
    const a = clamp(z.ttl / z.maxTtl, 0, 1);
    ctx.save();
    if (z.poison) {
      ctx.fillStyle = `rgba(30,50,18,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(z.pos.x, z.pos.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(160,220,90,${0.5 * a})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const ang = t * 0.8 + (i * Math.PI * 2) / 5;
        const rr = z.radius * (0.3 + 0.35 * ((i % 3) / 2));
        ctx.fillStyle = `rgba(150,220,90,${0.35 * a})`;
        ctx.beginPath();
        ctx.arc(z.pos.x + Math.cos(ang) * rr, z.pos.y + Math.sin(ang) * rr * 0.6, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = `rgba(14,6,30,${0.5 * a})`;
    ctx.beginPath();
    ctx.arc(z.pos.x, z.pos.y, z.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(170,110,255,${0.55 * a})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(z.pos.x, z.pos.y, z.radius, 0, Math.PI * 2);
    ctx.stroke();

    // 旋涡
    for (let i = 0; i < 3; i++) {
      const base = t * 2.4 + (i * Math.PI * 2) / 3;
      ctx.strokeStyle = `rgba(200,140,255,${0.35 * a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(z.pos.x, z.pos.y, z.radius * (0.36 + i * 0.18), base, base + 1.5);
      ctx.stroke();
    }

    // 中心
    const img = S.glowTex('rgba(150,90,255,0.8)', 22);
    ctx.globalAlpha = 0.5 * a;
    ctx.drawImage(img, z.pos.x - 22, z.pos.y - 22);
    ctx.restore();
  }

  drawCrystal(ctx: CanvasRenderingContext2D, c: Crystal, t: number): void {
    const spr = c.kind === 'ascension' ? S.ASCENSION_SPRITE : S.PURIFY_SPRITE;
    const baseY = c.pos.y + 6;
    const bob = Math.sin(t * 1.8 + c.pos.x * 0.1) * 1.2;

    // 地面光环
    ctx.save();
    ctx.strokeStyle = c.alive
      ? c.kind === 'ascension'
        ? 'rgba(255,209,102,0.28)'
        : 'rgba(95,215,255,0.22)'
      : 'rgba(120,120,120,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.ellipse(c.pos.x, baseY, c.radius + 12, (c.radius + 12) * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (!c.alive) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(spr.img, c.pos.x - spr.w / 2, baseY - spr.h + bob);
      ctx.globalAlpha = 1;
      return;
    }

    // 光晕
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gcol =
      c.kind === 'ascension' ? 'rgba(255,200,90,0.5)' : 'rgba(95,215,255,0.42)';
    const rad = c.kind === 'ascension' ? 52 : 38;
    const img = S.glowTex(gcol, rad);
    const pulse = 0.7 + Math.sin(t * 2.4 + c.pos.x * 0.05) * 0.15 + c.hitFlash * 0.3 + c.healPulse * 0.2;
    ctx.globalAlpha = pulse;
    ctx.drawImage(img, c.pos.x - rad, baseY - spr.h * 0.55 - rad);
    ctx.restore();

    ctx.drawImage(spr.img, Math.round(c.pos.x - spr.w / 2), Math.round(baseY - spr.h + bob));

    // 血条直接画在水晶上方
    const frac = Math.max(0, c.hp / c.maxHp);
    if (frac < 0.999) {
      const bw = c.kind === 'ascension' ? 40 : 32;
      const bx = c.pos.x - bw / 2;
      const by = baseY - spr.h + bob - 8;
      ctx.fillStyle = 'rgba(6,12,20,0.8)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
      ctx.fillStyle = frac > 0.3
        ? c.kind === 'ascension' ? '#ffd166' : '#6fd8ff'
        : '#ff6b6b';
      ctx.fillRect(bx, by, bw * frac, 2);
    }

    if (c.hitFlash > 0.02) {
      ctx.globalAlpha = c.hitFlash * 0.85;
      ctx.drawImage(spr.flash, Math.round(c.pos.x - spr.w / 2), Math.round(baseY - spr.h + bob));
      ctx.globalAlpha = 1;
    }
  }

  drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, t: number): void {
    const spr =
      e.kind === 'shiqia'
        ? S.SHIQIA_SPRITE
        : e.kind === 'yueji'
          ? S.YUEJI_SPRITE
          : e.kind === 'qulin'
            ? S.QULIN_SPRITE
            : S.PUZE_SPRITE;

    // 蓄力预警扇形（画在实体下面）
    this.drawFanTelegraph(ctx, e);

    const x = Math.round(e.pos.x - spr.w / 2);
    const y = Math.round(e.pos.y + 4 - spr.h);

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(e.pos.x, e.pos.y + 4, spr.w * 0.34, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // 域兽身上的微光，提高暗场可读性
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gi = S.glowTex('rgba(64,220,190,0.26)', 17);
    ctx.drawImage(gi, e.pos.x - 17, e.pos.y - 17 + 2);
    ctx.restore();

    const squash = e.attackAnim > 0 ? 1 + Math.sin(e.attackAnim * Math.PI) * 0.14 : 1;
    if (squash !== 1) {
      ctx.save();
      ctx.translate(e.pos.x, e.pos.y + 4);
      ctx.scale(2 - squash, squash);
      ctx.translate(-e.pos.x, -(e.pos.y + 4));
      ctx.drawImage(spr.img, x, y);
      ctx.restore();
    } else {
      ctx.drawImage(spr.img, x, y);
    }

    if (e.hitFlash > 0.02) {
      ctx.globalAlpha = e.hitFlash * 0.8;
      ctx.drawImage(spr.flash, x, y);
      ctx.globalAlpha = 1;
    }

    // 血条
    if (e.hp < e.maxHp) {
      const w = Math.max(10, spr.w);
      const bx = e.pos.x - w / 2;
      const by = e.pos.y - spr.h - 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, w, 2);
      ctx.fillStyle = '#ff6b8a';
      ctx.fillRect(bx, by, w * (e.hp / e.maxHp), 2);
    }
  }

  /** 普则的蓄力预警：扇形随蓄力逐渐填满 */
  drawFanTelegraph(ctx: CanvasRenderingContext2D, e: Enemy): void {
    const fan = ENEMIES[e.kind].fan;
    if (!fan || e.windup <= 0) return;
    const total = e.windupTotal > 0 ? e.windupTotal : fan.windup;
    const prog = clamp(1 - e.windup / total, 0, 1);
    const a0 = e.windupAngle - fan.halfAngle;
    const a1 = e.windupAngle + fan.halfAngle;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(e.pos.x, e.pos.y);
    ctx.arc(e.pos.x, e.pos.y, fan.radius, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,70,90,${0.07 + prog * 0.15})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,110,120,${0.4 + prog * 0.5})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 内圈蓄力进度
    ctx.beginPath();
    ctx.moveTo(e.pos.x, e.pos.y);
    ctx.arc(e.pos.x, e.pos.y, fan.radius * prog, a0, a1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,90,110,0.2)';
    ctx.fill();

    // 快满了就亮边
    if (prog > 0.72) {
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, fan.radius, a0, a1);
      ctx.strokeStyle = `rgba(255,225,140,${(prog - 0.72) * 3})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlayer(ctx: CanvasRenderingContext2D, world: World, p: Player, t: number): void {
    if (!p.alive) return;

    // 陨落：空中弧线 / 滞空
    const lift = world.playerLift();
    const spr = S.GUARD_SPRITE;
    const blink = p.invuln > 0 && Math.floor(t * 16) % 2 === 0;

    ctx.globalAlpha = blink ? 0.55 : 1;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(p.pos.x, p.pos.y + 5, 8, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pg = S.glowTex("rgba(120,200,255,0.3)", 20);
    ctx.drawImage(pg, p.pos.x - 20, p.pos.y - 22);
    ctx.restore();

    ctx.drawImage(spr.img, Math.round(p.pos.x - spr.w / 2), Math.round(p.pos.y + 5 - spr.h - lift));
    if (lift > 1) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(p.pos.x, p.pos.y + 5, 7, 2.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 电磁炮：只有远程武器才画枪管
    if (p.weaponId === 'railgun') {
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y - 3 - lift);
      ctx.rotate(p.aim);
      ctx.fillStyle = "#2a3346";
      ctx.fillRect(3, -3, 14, 6);
      ctx.fillStyle = "#5c7391";
      ctx.fillRect(3, -3, 14, 1.6);
      ctx.fillStyle = "#7fd8ff";
      ctx.fillRect(14, -1.8, 4, 3.6);
      ctx.restore();
    }

    // 陨盾：抵挡范围
    if (p.weaponId === 'shield' && p.meteorT <= 0) {
      const cfg = SHIELD_WEAPON;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y - 2 - lift);
      ctx.arc(p.pos.x, p.pos.y - 2 - lift, cfg.blockRadius, p.shieldAngle - cfg.blockHalf, p.shieldAngle + cfg.blockHalf);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,200,255,0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,225,255,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 底盾（塑造）：脚下固定圆形抵挡
      if (world.shapeLevel('ground') > 0) {
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y + 3, SHIELD_WEAPON.groundRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,200,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,210,255,0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 石卵包裹
    if (p.eggT > 0) {
      const g = ctx.createRadialGradient(p.pos.x, p.pos.y - 2, 2, p.pos.x, p.pos.y - 2, 18);
      g.addColorStop(0, 'rgba(210,225,240,0.55)');
      g.addColorStop(1, 'rgba(120,140,160,0.15)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.pos.x, p.pos.y - 2, 15, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.pos.x, p.pos.y - 2, 15, 17, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 磐石护体
    if (p.stoneT > 0) {
      const k = Math.min(1, p.stoneT / 1);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,196,110,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y - 2, 15 + Math.sin(t * 4) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "rgba(255,180,80,1)";
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y - 2, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      void k;
    }

    // 陨星状态光环
    if (p.meteorT > 0) {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 5);
      ctx.strokeStyle = "rgba(255,160,90,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y - 2, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 状态进度条（磐石护体 / 石卵）
    if (p.stoneT > 0 || p.eggT > 0) {
      const isEgg = p.eggT > 0;
      const k = isEgg
        ? Math.min(1, p.eggT / Math.max(0.01, p.eggTotal))
        : Math.min(1, p.stoneT / 6);
      const bw = 30;
      const bx = p.pos.x - bw / 2;
      const by = p.pos.y - 30;
      ctx.fillStyle = "rgba(6,12,20,0.85)";
      ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, 5 + 3);
      ctx.strokeStyle = isEgg ? "rgba(230,240,255,0.7)" : "rgba(255,196,110,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, 8);
      ctx.fillStyle = isEgg ? "#dfe9f5" : "#ffc46e";
      ctx.fillRect(bx, by, bw * k, 5);
    }

    // 蓄力条
    if (p.charge > 0.02) {
      const k = Math.min(1, p.charge / 5);
      const bw = 30;
      const bh = 5;
      const bx = p.pos.x - bw / 2;
      const by = p.pos.y - 30;

      ctx.fillStyle = "rgba(6,12,20,0.85)";
      ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
      ctx.strokeStyle = "rgba(120,200,255,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);

      const full = k >= 0.999;
      ctx.fillStyle = full ? "#ffd166" : "#6fd8ff";
      ctx.fillRect(bx, by, bw * k, bh);

      if (full) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12);
        ctx.strokeStyle = "#ffe9a8";
        ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
        ctx.globalAlpha = 1;
      }
    }

    if (p.hurtFlash > 0.02) {
      ctx.globalAlpha = p.hurtFlash * 0.8;
      ctx.drawImage(spr.flash, Math.round(p.pos.x - spr.w / 2), Math.round(p.pos.y + 5 - spr.h));
    }
    ctx.globalAlpha = 1;
  }

  drawLaser(ctx: CanvasRenderingContext2D, l: Laser): void {
    const dx = Math.cos(l.angle);
    const dy = Math.sin(l.angle);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    if (l.orb) {
      /* 电磁炮弹体：蓝色圆球 */
      const rad = l.radius || 9;
      const a = Math.min(1, l.life / 0.08);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(130,215,255,1)";
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(225,248,255,1)";
      ctx.beginPath();
      ctx.arc(l.pos.x - rad * 0.2, l.pos.y - rad * 0.2, rad * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = "rgba(120,210,255,1)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.pos.x - dx * rad * 1.8, l.pos.y - dy * rad * 1.8);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (l.blast > 0) {
      /* 电磁炮：圆球弹体 */
      const r = 7;
      const a = Math.min(1, l.life / 0.08);
      ctx.globalAlpha = a * 0.3;
      ctx.fillStyle = 'rgba(255,190,90,1)';
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,228,165,1)';
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,248,1)';
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = 'rgba(255,200,110,1)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.pos.x - dx * 15, l.pos.y - dy * 15);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (l.small) {
      /* 小激光：像子弹——短拖尾 + 明亮弹头 */
      const tail = 7;
      ctx.strokeStyle = 'rgba(255,190,110,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.pos.x - dx * tail, l.pos.y - dy * tail);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,190,1)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(l.pos.x - dx * tail * 0.7, l.pos.y - dy * tail * 0.7);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,245,210,1)';
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      /* 激光：一整条不断开的长光束 */
      const maxLen = 118;
      const len = Math.min(maxLen, Math.max(14, l.travel));
      const x0 = l.pos.x - dx * len;
      const y0 = l.pos.y - dy * len;
      const fade = Math.min(1, l.life / 0.06);

      ctx.globalAlpha = fade * 0.26;
      ctx.strokeStyle = 'rgba(80,210,255,1)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();

      ctx.globalAlpha = fade * 0.55;
      ctx.strokeStyle = 'rgba(120,235,255,1)';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();

      ctx.globalAlpha = fade;
      ctx.strokeStyle = 'rgba(225,252,255,1)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();

      // 枪口端渐隐
      ctx.globalAlpha = fade * 0.5;
      const g = ctx.createLinearGradient(x0, y0, l.pos.x, l.pos.y);
      g.addColorStop(0, 'rgba(120,235,255,0)');
      g.addColorStop(1, 'rgba(225,252,255,1)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(l.pos.x, l.pos.y);
      ctx.stroke();

      // 弹头高亮
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(240,255,255,1)';
      ctx.beginPath();
      ctx.arc(l.pos.x, l.pos.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 右下角小地图 */
  drawMinimap(ctx: CanvasRenderingContext2D, world: World, cam: Camera): void {
    const W = 118;
    const H = 30;
    const x = VIEW.w - W - 8;
    const y = VIEW.h - H - 8;

    ctx.save();
    ctx.fillStyle = "rgba(8,16,26,0.82)";
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = "rgba(95,215,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, W, H);

    const sx = (px: number) => x + 4 + (px / LEVEL.width) * (W - 8);
    const sy = (py: number) => y + 4 + ((py - 40) / 190) * (H - 8);

    // 道路
    ctx.fillStyle = "rgba(70,110,150,0.25)";
    ctx.fillRect(x + 4, sy(LEVEL.road.top), W - 8, sy(LEVEL.road.bottom) - sy(LEVEL.road.top));

    // 水晶
    for (const c of world.crystals) {
      const frac = Math.max(0, c.hp / c.maxHp);
      ctx.fillStyle = !c.alive
        ? "rgba(90,100,110,0.8)"
        : c.kind === "ascension"
          ? "rgba(255,215,130," + (0.35 + 0.65 * frac) + ")"
          : "rgba(120,210,255," + (0.35 + 0.65 * frac) + ")";
      ctx.fillRect(sx(c.pos.x) - 1.5, sy(c.pos.y) - 1.5, 3, 3);
    }

    // 域兽
    ctx.fillStyle = "rgba(255,90,90,0.9)";
    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      ctx.fillRect(sx(e.pos.x) - 1, sy(e.pos.y) - 1, 2, 2);
    }

    // 玩家
    const p = world.player;
    ctx.fillStyle = "rgba(240,250,255,1)";
    ctx.fillRect(sx(p.pos.x) - 1.5, sy(p.pos.y) - 1.5, 3, 3);

    // 视野框
    const cx = cam.x;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(sx(cx), y + 3, (VIEW.w / LEVEL.width) * (W - 8), H - 6);
    ctx.restore();
  }

  drawParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    // 粒子
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = 1 - p.drag * dt;
      p.vx *= d;
      p.vy *= d;
      p.vy += p.grav * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    ctx.save();
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      if (p.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      r.life -= dt;
      const a = clamp(r.life / r.maxLife, 0, 1);
      const radius = lerp(r.r1, r.r0, a);
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    ctx.restore();

    // 伤害数字
    for (const n of this.numbers) {
      n.life -= dt;
      n.y += n.vy * dt;
      n.vy *= 1 - 3 * dt;
    }
    this.numbers = this.numbers.filter((n) => n.life > 0);
    ctx.save();
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    for (const f of this.numbers) {
      const a = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  drawAim(ctx: CanvasRenderingContext2D, world: World, input: InputSnapshot, t: number): void {
    const p = world.player;
    if (!p.alive) return;

    // 准星
    const mx = input.aimX;
    const my = input.aimY;
    ctx.save();
    ctx.strokeStyle = p.mode === 'none' ? 'rgba(150,235,255,0.75)' : 'rgba(255,210,120,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - 7, my);
    ctx.lineTo(mx - 4, my);
    ctx.moveTo(mx + 4, my);
    ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7);
    ctx.lineTo(mx, my - 4);
    ctx.moveTo(mx, my + 4);
    ctx.lineTo(mx, my + 7);
    ctx.stroke();
    ctx.restore();

    if (p.panelOpen) return;

    // 技能预瞄
    if ((p.mode === 'throw' || p.mode === 'leapaim') && p.throwTarget) {
      const tx = p.throwTarget.x;
      const ty = p.throwTarget.y;
      const radius = p.mode === 'throw' ? 66 : 76;
      ctx.save();
      if (p.mode === 'throw') {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(185,130,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const k = i / 20;
          const x = lerp(p.pos.x, tx, k);
          const y = lerp(p.pos.y, ty, k) - Math.sin(k * Math.PI) * 34;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,180,90,0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.pos.x, p.pos.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(tx, ty, radius, 0, Math.PI * 2);
      ctx.fillStyle = p.mode === 'throw' ? 'rgba(140,90,255,0.12)' : 'rgba(255,150,60,0.13)';
      ctx.fill();
      ctx.strokeStyle = p.mode === 'throw' ? 'rgba(200,150,255,0.9)' : 'rgba(255,200,120,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230,200,255,0.95)';
      ctx.fill();
      ctx.restore();
    }

    // 陨落：空中/滞空时显示坠落伤害范围
    if (p.leapHangT > 0 || p.leapT > 0) {
      const bonus = Math.min(0.4, (p.leapHung / RECOIL.maxHang) * RECOIL.gainPerSec * 2);
      const radius = SKILLS.leap.radius! * (1 + bonus * 0.5);
      const cx = p.leapHangT > 0 ? p.pos.x : p.leapTo.x;
      const cy = p.leapHangT > 0 ? p.pos.y : p.leapTo.y;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,140,60,0.12)';
      ctx.fill();
      ctx.strokeStyle = p.leapHangT > 0 ? 'rgba(255,190,110,0.95)' : 'rgba(255,150,80,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,220,170,0.9)';
      ctx.font = '6px sans-serif';
      ctx.textAlign = 'center';
      if (p.leapHangT > 0) {
        ctx.fillText('坠落范围 +' + Math.round(bonus * 100) + '%', cx, cy - radius - 4);
      }
      ctx.restore();
    }

    // 陨盾：右键显示盾击 / 肘击范围
    if (p.weaponId === 'shield' && input.altHeld) {
      const broken = p.meteorT > 0;
      const range = broken ? SHIELD_WEAPON.elbowRange : SHIELD_WEAPON.range;
      const half = broken ? SHIELD_WEAPON.elbowHalf : SHIELD_WEAPON.half;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.arc(p.pos.x, p.pos.y, range, p.shieldAngle - half, p.shieldAngle + half);
      ctx.closePath();
      ctx.fillStyle = broken ? 'rgba(255,150,80,0.14)' : 'rgba(120,200,255,0.14)';
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = broken ? 'rgba(255,180,110,0.85)' : 'rgba(160,225,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    // 武器预瞄：带状弹道 + 落点
    if (p.weaponId === 'railgun' && (p.aiming || p.charge > 0.05)) {
      const ck = Math.min(1, p.charge / 5);
      const rp = world.railPreview(ck);
      const bulletR = RAIL_WEAPON.bulletRadius * (1 + ck * 0.8);
      const ca = Math.cos(p.aim);
      const sa = Math.sin(p.aim);
      const sx = p.pos.x + ca * 14;
      const sy = p.pos.y + sa * 14;
      const hw = bulletR;
      const nx = -sa * hw;
      const ny = ca * hw;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx + nx, sy + ny);
      ctx.lineTo(rp.x + nx, rp.y + ny);
      ctx.lineTo(rp.x - nx, rp.y - ny);
      ctx.lineTo(sx - nx, sy - ny);
      ctx.closePath();
      ctx.fillStyle = "rgba(120,200,255,0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(150,220,255,0.45)";
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.setLineDash([6, 7]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = "rgba(190,240,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(rp.x, rp.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (rp.radius > 0) {
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(120,200,255,0.1)";
        ctx.fill();
        ctx.strokeStyle = "rgba(170,230,255,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
