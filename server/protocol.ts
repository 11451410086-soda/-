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
}

export interface BottleWire {
  x: number;
  y: number;
}

export interface CrystalWire {
  x: number;
  y: number;
  kind: string;
  hp: number;
  maxHp: number;
  alive: boolean;
}
