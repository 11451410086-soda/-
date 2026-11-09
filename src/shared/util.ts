export interface Vec {
  x: number;
  y: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function angleTo(a: Vec, b: Vec): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** 返回 a-b 归一化到 [-PI, PI] 的角差 */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randInt(a: number, b: number): number {
  return Math.floor(a + Math.random() * (b - a + 1));
}

export function norm(x: number, y: number): Vec {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/** 线段与圆是否相交 */
export function segmentCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = ax + dx * t;
  const py = ay + dy * t;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
}

/** 点是否在扇形内（角度用弧度，halfAngle 为半张角） */
export function inFan(
  ox: number,
  oy: number,
  angle: number,
  halfAngle: number,
  range: number,
  px: number,
  py: number,
  pad = 0,
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + pad) return false;
  if (d < 0.001) return true;
  return Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= halfAngle;
}

/** 点在线段/折线上的最近距离 */
export function distToPolyline(p: Vec, pts: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < best) best = d;
  }
  return best;
}

/** 确定性随机数（用于地图装饰烘焙） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${s}`;
}
