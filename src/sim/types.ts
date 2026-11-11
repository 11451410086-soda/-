import type { EnemyKind } from '../content/defs';
import type { Immunity, Tag } from '../shared/types';
import type { Vec } from '../shared/util';

export interface Player {
  heroId: "sanhua" | "yunzhu" | "guard";
  pos: Vec;
  vel: Vec;
  aim: number;
  hp: number;
  maxHp: number;
  ammo: number;
  magSize: number;
  reloading: boolean;
  reloadT: number;
  reloadTotal: number;
  fireCd: number;
  qCd: number;
  eCd: number;
  qCdMax: number;
  eCdMax: number;
  mode: 'none' | 'throw' | 'leapaim';
  throwTarget: Vec | null;
  panelOpen: boolean;
  points: number;
  coins: number;
  shapes: Record<string, number>;
  /** 是否正在瞄准（按住右键） */
  aiming: boolean;
  /** 翻滚剩余时间 */
  rollT: number;
  /** 翻滚方向 */
  rollDir: Vec;
  /** 体力值（格） */
  stamina: number;
  /** 翻滚无敌帧剩余 */
  rollIframe: number;
  /** 已装配技能（Q/E/F 三个槽） */
  skills: string[];
  /** Q/E/F 冷却 */
  skillCd: number[];
  /** 磐石护体剩余时间 */
  stoneT: number;
  /** 技能塑造：key = `${skillId}.${shapeId}` */
  skillShapes: Record<string, boolean>;
  /** 引力超标：站在引力范围内的剩余刷新时间 */
  zoneBuffT: number;
  /** 护盾值 */
  shield: number;
  /** 石卵包裹剩余时间 */
  eggT: number;
  /** 石卵包裹总时长 */
  eggTotal: number;
  /** 当前武器 */
  weaponId: 'railgun' | 'shield';
  /** 盾牌朝向（独立于准星） */
  shieldAngle: number;
  /** 陨盾耐久 */
  shieldHp: number;
  /** 陨星状态剩余时间 */
  meteorT: number;
  /** 盾击冷却 */
  bashCd: number;
  /** 左键拖动转向：起始点与是否处于拖动 */
  dragX: number;
  dragY: number;
  dragging: boolean;
  fireHeldPrev: boolean;
  /** 跃迁滞空剩余时间 */
  leapT: number;
  leapFrom: Vec;
  leapTo: Vec;
  /** 后坐力：滞空剩余 / 已滞空时间 / 加成 */
  leapHangT: number;
  leapHung: number;
  leapBonus: number;
  /** 落地缓冲（视觉高度回落） */
  landT: number;
  /** 后坐力：松开左键后才允许再次触发 */
  leapArmed: boolean;
  /** 磐石冲击：本次翻滚已命中的敌人 id */
  rollHits: number[];
  nodes: Record<string, number>;
  killCount: number;
  killFrac: number;
  invuln: number;
  alive: boolean;
  respawnT: number;
  hurtFlash: number;
  totalDamage: number;
  shotsFired: number;
  /** 技能期间锁住普攻，松开左键才解锁 */
  fireLocked: boolean;
  /** 电磁炮蓄力秒数 */
  charge: number;
  altHeldPrev: boolean;
  /** 连射：排队中的后续子弹 */
  burstLeft: number;
  burstTimer: number;
  burstPierce: boolean;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: Vec;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  dmg: number;
  atkInterval: number;
  atkTimer: number;
  atkRange: number;
  aggro: number;
  immunity: Immunity;
  ranged: boolean;
  keepDist: number;
  shotCd: number;
  pathIndex: number;
  hitFlash: number;
  /** 被控制时的强制位移速度 */
  ext: { x: number; y: number; t: number; total: number } | null;
  attackAnim: number;
  facing: number;
  /** 陷地：剩余时间 > 0 时不可移动但可攻击 */
  rootT: number;
  /** 祛鳞的治疗冷却 */
  healCd: number;
  /** 减速剩余时间（土壤黏脚） */
  slowT: number;
  /** 当前减速幅度 */
  slowFactor: number;
  /** 施加陷地时的技能加成（后坐力），影响后续塑造数值 */
  rootBonus: number;
  /** 索敌后的追击剩余时间与追击锚点 */
  chaseT: number;
  chaseX: number;
  chaseY: number;
  /** 扇形蓄力：剩余时间 > 0 时站定并显示预警 */
  windup: number;
  windupTotal: number;
  windupAngle: number;
}

export interface Laser {
  /** >0 时命中/到点会产生范围爆炸 */
  blast: number;
  /** 弹体半径（判定与绘制共用） */
  radius: number;
  /** 圆形弹体（否则按激光绘制） */
  orb: boolean;
  /** 身份标签 */
  tag: Tag;
  /** 是否已经在引力范围内引爆过 */
  detonated: boolean;
  /** 动力分裂：已分裂次数 */
  splitCount: number;
  /** 视觉高度偏移（空中开火时子弹跟着抬高） */
  lift: number;
  pos: Vec;
  vel: Vec;
  angle: number;
  damage: number;
  pierce: number;
  hitIds: number[];
  life: number;
  /** 已飞行距离（用于激光拖尾长度） */
  travel: number;
  small: boolean;
  homing: boolean;
  targetZone: number;
}

export interface EnemyShot {
  /** 身份 */
  tag: Tag;
  pos: Vec;
  vel: Vec;
  dmg: number;
  radius: number;
  life: number;
}

/** 污染瓶（越机投掷） */
export interface Bottle {
  from: Vec;
  to: Vec;
  pos: Vec;
  t: number;
  dur: number;
  radius: number;
  duration: number;
  interval: number;
  damage: number;
}

export interface Grenade {
  from: Vec;
  to: Vec;
  t: number;
  dur: number;
}

export interface Zone {
  /** 归属：玩家投掷 / 域兽生成 */
  owner?: 'player' | 'enemy';
  /** 玩家投出的范围区记下是谁投的（击杀奖励要算在对的人头上） */
  ownerIdx?: number;
  /** 毒雾（越机），伤害玩家 */
  poison?: boolean;
  damage?: number;
  interval?: number;
  id: number;
  pos: Vec;
  radius: number;
  ttl: number;
  maxTtl: number;
  tick: number;
  blastLock: number;
  pulse: number;
}

export interface Crystal {
  id: string;
  name: string;
  kind: 'purify' | 'ascension';
  pos: Vec;
  hp: number;
  maxHp: number;
  radius: number;
  pathIndex: number;
  alive: boolean;
  hitFlash: number;
  healPulse: number;
}

export interface WaveState {
  n: number;
  phase: 'intermission' | 'spawning' | 'fighting';
  timer: number;
  queue: EnemyKind[];
  spawnTimer: number;
}

export type WorldEvent =
  | { type: 'shoot'; x: number; y: number; angle: number }
  | { type: 'laserHit'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; r: number }
  | { type: 'impact'; x: number; y: number; r: number; dmg?: number }
  | { type: 'enemyDeath'; x: number; y: number; kind: EnemyKind }
  | { type: 'crystalHit'; x: number; y: number; kind: 'purify' | 'ascension' }
  | { type: 'crystalDown'; x: number; y: number }
  | { type: 'zoneSpawn'; x: number; y: number; r: number }
  | { type: 'zonePulse'; x: number; y: number; r: number }
  | { type: 'immune'; x: number; y: number }
  | { type: 'dodge'; x: number; y: number }
  | { type: 'roll'; x: number; y: number }
  | { type: 'stone'; x: number; y: number }
  | { type: 'egg'; x: number; y: number }
  | { type: 'shieldRestore'; x: number; y: number }
  | { type: 'chain'; x: number; y: number; x2: number; y2: number }
  | { type: 'bottleThrow'; x: number; y: number }
  | { type: 'bottleLand'; x: number; y: number }
  | { type: 'healPulse'; x: number; y: number }
  | { type: 'stoneImpact'; x: number; y: number }
  | { type: 'throwCast'; x: number; y: number; angle: number }
  | { type: 'throwLand'; x: number; y: number }
  | { type: 'leapLand'; x: number; y: number }
  | { type: 'whiteout'; x: number; y: number }
  | { type: 'detonate'; x: number; y: number }
  | { type: 'push'; x: number; y: number; angle: number; range: number; half: number }
  | { type: 'fanStrike'; x: number; y: number; angle: number; radius: number; half: number }
  | { type: 'shieldBash'; x: number; y: number; angle: number; range: number; half: number }
  | { type: 'shieldBlock'; x: number; y: number }
  | { type: 'shieldBreak'; x: number; y: number }
  | { type: 'slamJump'; x: number; y: number }
  | { type: 'slamLand'; x: number; y: number; r: number }
  | { type: 'ultimate'; x: number; y: number }
  | { type: 'elbow'; x: number; y: number; angle: number; range: number; half: number }
  | { type: 'playerHurt' }
  | { type: 'playerDown' }
  | { type: 'playerRespawn' }
  | { type: 'waveStart'; n: number }
  | { type: 'waveClear'; n: number }
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'growth'; id: string; level: number };
