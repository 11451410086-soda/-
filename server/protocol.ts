/** 客户端 → 服务器 */
export type ClientMsg =
  | { t: 'join'; name: string }
  | { t: 'input'; snap: InputSnapshotWire }
  | { t: 'buy'; kind: 'weapon' | 'skill'; id: string; skillId?: string }
  | { t: 'p2p-join'; room: string }
  | { t: 'p2p-offer'; room: string; sdp: string }
  | { t: 'p2p-answer'; room: string; sdp: string }
  | { t: 'p2p-ice'; room: string; cand: RTCIceCandidateInit; to: 'host' | 'guest' }
  | { t: 'ping'; at: number };

export interface InputSnapshotWire {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fireHeld: boolean;
  firePressed: boolean;
  altHeld: boolean;
  altPressed: boolean;
  reloadPressed: boolean;
  rollPressed: boolean;
  skillQ: boolean;
  skillE: boolean;
  skillF: boolean;
  panel: boolean;
  skip: boolean;
}

/** 服务器 → 客户端 */
export type ServerMsg =
  | { t: 'welcome'; playerId: number }
  | { t: 'state'; world: WorldWire }
  | { t: 'error'; msg: string };

export interface WorldWire {
  time: number;
  state: 'playing' | 'victory' | 'defeat';
  wave: { n: number; phase: string; timer: number; remaining: number };
  players: PlayerWire[];
  enemies: EnemyWire[];
  lasers: LaserWire[];
  zones: ZoneWire[];
  shots: ShotWire[];
  bottles: BottleWire[];
  crystals: CrystalWire[];
  events: unknown[];
  /** 屏幕震动强度，客人端要跟着抖 */
  shake?: number;
  /** 玩家投出的黑洞雷（抛物线飞行中） */
  grenades?: GrenadeWire[];
}

export interface PlayerWire {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  stamina: number;
  weaponId: string;
  shieldHp: number;
  shieldAngle: number;
  meteorT: number;
  stoneT: number;
  eggT: number;
  leapT: number;
  leapHangT: number;
  landT: number;
  rollT: number;
  reloading: boolean;
  ammo: number;
  charge: number;
  alive: boolean;
  coins: number;
  skillCd: number[];
  /** 受击红屏 / 无敌闪烁：客人端也要有 */
  hurtFlash?: number;
  invuln?: number;
  /** 武器塑造等级：客人开成长面板、画地面形态全靠它 */
  shapes?: Record<string, number>;
  eggTotal?: number;
  leapHung?: number;
  /** 预瞄状态：客人靠它画技能/武器预览（服务器权威模式可缺省） */
  mode?: string;
  throwTarget?: { x: number; y: number } | null;
  aiming?: boolean;
  leapTo?: { x: number; y: number };
}

export interface EnemyWire {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: number;
  windup: number;
  windupTotal: number;
  windupAngle: number;
  hitFlash: number;
  attackAnim: number;
  rootT: number;
  slowT: number;
}

export interface LaserWire {
  x: number;
  y: number;
  angle: number;
  radius: number;
  orb: boolean;
  lift: number;
  /** 速度：客人端用来在两次快照之间外推，让弹道每帧都在动 */
  vx?: number;
  vy?: number;
}

export interface ZoneWire {
  x: number;
  y: number;
  radius: number;
  ttl: number;
  maxTtl: number;
  poison: boolean;
}

export interface ShotWire {
  x: number;
  y: number;
  radius: number;
  vx?: number;
  vy?: number;
}

export interface BottleWire {
  x: number;
  y: number;
  /** 抛物线起点/终点与进度，客人端自己推进，避免 30Hz 瞬移 */
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  t?: number;
  dur?: number;
}

export interface GrenadeWire {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  dur: number;
}

export interface CrystalWire {
  x: number;
  y: number;
  kind: string;
  hp: number;
  maxHp: number;
  alive: boolean;
}
