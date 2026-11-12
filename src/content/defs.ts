import type { Resistance } from '../shared/types';
import type { Vec } from '../shared/util';

export const VIEW = { w: 480, h: 270 };

/* ---------------- 域卫 ---------------- */

export type HeroId = 'guard';

export interface HeroProfile {
  id: HeroId;
  name: string;
  roleLabel: string;
  maxHp: number;
  speed: number;
  radius: number;
  /** 减伤率 0~0.8：受到的伤害乘以 (1 - 减伤率) */
  damageReduction: number;
  /** 体力值：每格可供翻滚一次 */
  maxStamina: number;
  /** 体力回复率：每秒恢复多少格 */
  staminaRegen: number;
}

export const HERO_PROFILES: Record<HeroId, HeroProfile> = {
  guard: {
    id: 'guard',
    name: '域卫',
    roleLabel: '域卫',
    maxHp: 180,
    speed: 88,
    radius: 9,
    damageReduction: 0,
    maxStamina: 3,
    staminaRegen: 0.7,
  },
};

/* ---------------- 域兽 ---------------- */

export type EnemyKind = 'puze' | 'shiqia' | 'yueji' | 'qulin';

export interface FanAttack {
  windup: number;
  radius: number;
  halfAngle: number;
}

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  dmg: number;
  atkInterval: number;
  atkRange: number;
  aggro: number;
  resist: Resistance;
  ranged: boolean;
  keepDist: number;
  shotSpeed: number;
  shotRadius: number;
  fan?: FanAttack;
  /** 投掷污染瓶（越机） */
  bottle?: {
    flightTime: number;
    radius: number;
    duration: number;
    interval: number;
    damage: number;
  };
  /** 治疗友军（祛鳞） */
  heal?: { radius: number; amount: number; interval: number };
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  puze: {
    name: '普则',
    hp: 44,
    speed: 44,
    radius: 10,
    dmg: 13,
    atkInterval: 2.0,
    atkRange: 86,
    aggro: 168,
    resist: {},
    ranged: false,
    keepDist: 0,
    shotSpeed: 0,
    shotRadius: 0,
    fan: { windup: 0.8, radius: 104, halfAngle: 0.55 },
  },
  yueji: {
    name: '越机',
    hp: 40,
    speed: 34,
    radius: 11,
    dmg: 0,
    atkInterval: 2.6,
    atkRange: 175,
    aggro: 235,
    resist: {},
    ranged: true,
    keepDist: 150,
    shotSpeed: 0,
    shotRadius: 0,
    bottle: {
      flightTime: 0.75,
      radius: 58,
      duration: 4,
      interval: 0.7,
      damage: 7,
    },
  },
  qulin: {
    name: '祛鳞',
    hp: 52,
    speed: 36,
    radius: 10,
    dmg: 0,
    atkInterval: 999,
    atkRange: 0,
    aggro: 200,
    resist: {},
    ranged: false,
    keepDist: 0,
    shotSpeed: 0,
    shotRadius: 0,
    heal: { radius: 115, amount: 9, interval: 2.8 },
  },
  shiqia: {
    name: '失恰',
    hp: 36,
    speed: 38,
    radius: 9,
    dmg: 9,
    atkInterval: 2.2,
    atkRange: 150,
    aggro: 240,
    resist: {},
    ranged: true,
    keepDist: 118,
    shotSpeed: 220,
    shotRadius: 4,
  },
};

/* ---------------- 净化之路 ---------------- */

export const LEVEL = {
  width: 1200,
  height: 270,
  laneY: 135,
  road: { top: 54, bottom: 216 },
  rift: { x: 1178, y: 135 },
  path: [
    { x: 1185, y: 135 },
    { x: 1090, y: 135 },
    { x: 980, y: 135 },
    { x: 860, y: 135 },
    { x: 700, y: 135 },
    { x: 560, y: 135 },
    { x: 420, y: 135 },
    { x: 280, y: 135 },
    { x: 110, y: 135 },
  ] as Vec[],
  crystalPathIndex: [2, 4, 6],
  ascensionPathIndex: 8,
  start: { x: 205, y: 182 } as Vec,
};

export const CRYSTAL = {
  purifyHp: 520,
  ascensionHp: 1800,
  purifyRadius: 15,
  ascensionRadius: 22,
  auraRadius: 140,
  auraRegen: 6,
};

/* ---------------- 波次 ---------------- */

export const TOTAL_WAVES = 12; // 仅作参考，当前为无尽模式
export const FIRST_PREP = 10;
export const PREP_TIME = 20;

export function buildWave(n: number): EnemyKind[] {
  const count = Math.min(20, 2 + Math.ceil(n / 2));
  const list: EnemyKind[] = [];
  const shooters = n >= 3 ? Math.floor(n / 3) : 0;
  for (let i = 0; i < count; i++) list.push('puze');
  for (let i = 0; i < shooters; i++) list.push('shiqia');
  if (n >= 4) list.push('yueji');
  if (n >= 5 && n % 2 === 1) list.push('qulin');
  return list;
}

/** 无尽模式：血量随波次持续增长，越往后越快 */
export function waveHpScale(n: number): number {
  return 1 + 0.08 * (n - 1) + Math.max(0, n - 10) * 0.06;
}

/** 无尽模式：伤害成长（有上限，避免一击秒杀） */
export function waveDmgScale(n: number): number {
  return Math.min(2.6, 1 + 0.035 * (n - 1));
}

/** 无尽模式：移速成长（有上限） */
export function waveSpeedScale(n: number): number {
  return Math.min(1.3, 1 + 0.006 * (n - 1));
}

export const KILLS_PER_POINT = 8;
export const POINTS_PER_WAVE = 2;

export const COIN_PER_KILL = 2;
export const COIN_PER_WAVE = 10;

/* ---------------- 武器 ---------------- */

export const RAIL_WEAPON = {
  id: 'railgun',
  name: '电磁炮',
  identity: '远程',
  damage: 36,
  fireInterval: 0.45,
  bulletSpeed: 500,
  range: 160,
  bulletRadius: 9,
  reload: 1.2,
  magSize: 3,
  critChance: 0,
  critMult: 1,
};

export const SHIELD_WEAPON = {
  id: 'shield',
  name: '陨盾',
  identity: '近战',
  /** 盾击（近战击） */
  damage: 14,
  interval: 0.8,
  range: 72,
  half: 0.9,
  knock: 170,
  knockTime: 0.18,
  /** 盾击与肘击都消耗体力 */
  staminaCost: 1,
  /** 右键拖动转向的最大角速度（弧度/秒） */
  rotateSpeed: 3.2,
  /** 抵挡范围：半径与半角 */
  blockRadius: 46,
  blockHalf: 0.75,
  /** 抵挡一次伤害的耐久消耗与减伤比例 */
  durPerHit: 10,
  blockDR: 0.8,
  durabilityMax: 100,
  /** 破碎后的陨星状态 */
  meteorTime: 8,
  meteorDR: 0.35,
  /** 陨星状态下的肘击 */
  elbowDamage: 26,
  elbowRange: 78,
  elbowHalf: 0.95,
  elbowKnock: 220,
  elbowInterval: 0.7,
  /** 底盾（塑造）：固定圆形抵挡 */
  groundRadius: 32,
  groundDR: 0.5,
};

export interface ShapeDef {
  id: string;
  name: string;
  /** 最大等级，Infinity 表示可以无限升级 */
  max: number;
  levels: string[];
  /** 升到某一级（0 起）需要多少域币 */
  cost: (owned: number) => number;
}

/** 每把武器只有自己的专属塑造 */
export const WEAPON_SHAPES: Record<string, ShapeDef[]> = {
  shield: [
    {
      id: 'ground',
      name: '底盾',
      max: 1,
      levels: ['脚下多一个固定的圆形抵挡范围，命中它的范围区攻击也会被减伤。'],
      cost: () => 110,
    },
    {
      id: 'safety',
      name: '安全感',
      max: 1,
      levels: ['陨星状态额外获得生命回复。'],
      cost: () => 90,
    },
    {
      id: 'unyield',
      name: '坚不可摧',
      max: 1,
      levels: ['陨盾不再会破碎。'],
      cost: () => 130,
    },
  ],
  railgun: [
  {
    id: 'charge',
    name: '极蓄',
    max: 1,
    levels: ['长按左键蓄力，最多 5 秒；蓄力越久，弹药伤害与弹药体积越大。'],
    cost: () => 120,
  },
  {
    id: 'chain',
    name: '电传播',
    max: 1,
    levels: ['命中后向附近 1~2 只域兽放电（近战击）造成伤害。'],
    cost: () => 130,
  },
  {
    id: 'split',
    name: '动力分裂',
    max: 1,
    levels: ['每飞行 45 距离，向左右斜方分裂出小型电磁球（飞行物）。'],
    cost: () => 120,
  },
  {
    id: 'pierce',
    name: '磁透性',
    max: 1,
    levels: ['武器飞行物可穿透所有目标。'],
    cost: () => 120,
  },
  ],
};

/* ---------------- 技能 ---------------- */

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  cd: number;
  /** 需要预瞄（左键确认 / 右键取消） */
  targeting: "none" | "throw" | "area";
  range?: number;
  radius?: number;
}

export const SKILLS: Record<string, SkillDef> = {
  blackhole: {
    id: "blackhole",
    name: "黑洞雷",
    desc: "投出黑洞雷，落点生成一片 吸引区[[范围区]]，持续牵引范围内的域兽[[生理控制]]，并每隔一段时间造成 伤害[[范围区]]。",
    cd: 11,
    targeting: "throw",
    range: 180,
  },
  leap: {
    id: "leap",
    name: "陨落",
    desc: "跃向目标地点坠落，造成 伤害[[近战击]]，并使目标陷地[[生理控制]]（无法移动但可攻击）。",
    cd: 9,
    targeting: "area",
    range: 190,
    radius: 76,
  },
  stone: {
    id: "stone",
    name: "磐石护体",
    desc: "6 秒内减伤大幅提升[[增益效果]]，但移动速度降低[[减益效果]]。",
    cd: 18,
    targeting: "none",
  },
};

export const BLACKHOLE = {
  radius: 66,
  duration: 3,
  tickInterval: 0.6,
  tickDamage: 8,
  /** 每次牵引的距离 */
  pull: 30,
  /** 控制时长：一次牵引持续多久 */
  pullTime: 0.12,
};

export const LEAP = {
  damage: 26,
  root: 1.4,
  airTime: 0.7,
};

export const STONE = {
  duration: 6,
  dr: 0.45,
  speedMult: 0.7,
};

export const ROLL = {
  duration: 0.22,
  speed: 260,
  iframe: 0.3,
  /** 每次翻滚消耗的体力格数 */
  cost: 1,
};

/* ---------------- 技能塑造（每个技能专属） ---------------- */

export interface SkillShapeDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
}

export const SKILL_SHAPES: Record<string, SkillShapeDef[]> = {
  blackhole: [
    {
      id: "detonate",
      name: "斥爆",
      desc: "引力范围持续期间，武器飞行物或武器近战击命中范围会引发一次爆炸（技能近战击）。",
      cost: 90,
    },
    {
      id: "whiteout",
      name: "白扩",
      desc: "引力范围持续期间再次按 Q 立即引爆：造成伤害（技能近战击）并把范围内的域兽向外击退（技能控制）。",
      cost: 90,
    },
    {
      id: "overflow",
      name: "引力超标",
      desc: "进入引力范围的玩家获得移速加成与生命恢复（增益效果）。",
      cost: 110,
    },
    {
      id: "slowfield",
      name: "噬速力",
      desc: "进入引力范围的敌方武器飞行物飞行速度大幅降低（减益效果）。",
      cost: 110,
    },
  ],
  leap: [
    {
      id: 'deepen',
      name: '状况加深',
      desc: '飞行物 / 近战击 / 范围区 命中陷地中的域兽时，使其陷地时间延长一点。',
      cost: 90,
    },
    {
      id: 'recoil',
      name: '后坐力',
      desc: '跃起至空中时若使用武器攻击，会滞空一段时间：滞空期间近战击打不到你，可微调落点，且技能所有数值随滞空变强。',
      cost: 120,
    },
    {
      id: 'sticky',
      name: '土壤黏脚',
      desc: '被陷地的域兽结束陷地后会被减速一段时间。',
      cost: 90,
    },
  ],
  stone: [
    {
      id: 'eggshell',
      name: '石卵',
      desc: '技能持续期间再次按 F 进入磐石包裹（生理控制）：无法行动，但获得巨量减伤。',
      cost: 110,
    },
    {
      id: 'impact',
      name: '磐石冲击',
      desc: '技能持续期间使用闪避，会对沿途的域兽造成伤害（近战击）并击退（生理控制）。',
      cost: 110,
    },
    {
      id: 'siphon',
      name: '磐能吸取',
      desc: '技能持续期间造成的伤害按比例转化为护盾值。',
      cost: 110,
    },
  ],
};

/** 陨落 / 磐石 的塑造参数 */
/** 电磁炮塑造参数 */
export const RAIL_SHAPE = {
  /** 电传播：搜索半径与伤害 */
  chainRadius: 95,
  chainDamage: 10,
  chainMax: 2,
  /** 动力分裂：每飞行多少距离分裂一次、分裂角度、伤害比例 */
  splitEvery: 45,
  splitAngle: 0.62,
  splitDamageRatio: 0.55,
};

/** 后坐力：滞空时长与增益 */
export const RECOIL = {
  maxHang: 2.0,
  /** 每滞空 1 秒提升的比例 */
  gainPerSec: 0.25,
};

/** 磐石冲击 */
export const IMPACT = {
  damage: 16,
  radius: 26,
  knock: 210,
  knockTime: 0.18,
};

export const LEAP_SHAPE = {
  /** 状况加深：每次命中延长多少陷地 */
  deepenAdd: 0.15,
  /** 状况加深：触发冷却 */
  deepenCd: 0.25,
  /** 土壤黏脚：减速时长与减速比例 */
  stickyTime: 1.2,
  stickySlow: 0.45,
};

export const STONE_SHAPE = {
  /** 石卵：巨量减伤 */
  eggDR: 0.85,
  /** 磐能吸取：伤害转护盾的比例 */
  siphonRate: 0.25,
  /** 护盾上限 */
  shieldMax: 60,
};

export const BLACKHOLE_SHAPE = {
  blastRadius: 40,
  /** 斥爆的触发冷却 */
  blastCd: 0.35,
  blastDamage: 14,
  whiteoutDamage: 18,
  whiteoutKnock: 210,
  whiteoutKnockTime: 0.2,
  buffSpeed: 0.25,
  buffRegen: 8,
  slowMult: 0.45,
};
