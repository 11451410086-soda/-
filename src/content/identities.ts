/**
 * 身份大全（唯一数据源）
 *
 * 三组身份：
 *  - cat  武器类别：近战 / 远程
 *  - attr 属性身份：飞行物 / 近战击 / 范围区 / 心理控制 / 生理控制 / 增益效果 / 减益效果
 *  - num  数值身份：可被加成、可被面板展示的数值类别
 *
 * 属性身份不带来源，武器 / 技能 / 域兽共用同一套名字。
 * 一个数值身份可以同时属于多个属性身份（伤害/间隔/范围 各分三种）。
 */

export type IdentityGroup = 'cat' | 'attr' | 'num';

/** 通用数值身份的归属，图鉴按它分卡 */
export type NumOwner = 'weapon' | 'skill' | 'character';

export interface IdentityDef {
  key: string;
  name: string;
  group: IdentityGroup;
  /** 归属的属性身份 */
  attrs?: string[];
  /** 属性身份才有阵营：友方 / 敌方 */
  scoped?: boolean;
  /** 数值身份：通用数值归谁用（武器 / 技能 / 角色），图鉴分组用 */
  owner?: NumOwner;
}

export const IDENTITIES: Record<string, IdentityDef> = {
  /* ---------------- 武器类别 ---------------- */
  melee: { key: 'melee', name: '近战', group: 'cat' },
  ranged: { key: 'ranged', name: '远程', group: 'cat' },

  /* ---------------- 属性身份 ---------------- */
  flight: { key: 'flight', name: '飞行物', group: 'attr', scoped: true },
  meleeHit: { key: 'meleeHit', name: '近战击', group: 'attr', scoped: true },
  zone: { key: 'zone', name: '范围区', group: 'attr', scoped: true },
  mindControl: { key: 'mindControl', name: '心理控制', group: 'attr', scoped: true },
  bodyControl: { key: 'bodyControl', name: '生理控制', group: 'attr', scoped: true },
  buff: { key: 'buff', name: '增益效果', group: 'attr', scoped: true },
  debuff: { key: 'debuff', name: '减益效果', group: 'attr', scoped: true },

  /* ---------------- 数值身份：伤害 ---------------- */
  flightDamage: { key: 'flightDamage', name: '飞行物伤害', group: 'num', attrs: ['flight'] },
  meleeDamage: { key: 'meleeDamage', name: '近战击伤害', group: 'num', attrs: ['meleeHit'] },
  zoneDamage: { key: 'zoneDamage', name: '范围区伤害', group: 'num', attrs: ['zone'] },

  /* ---------------- 数值身份：间隔 ---------------- */
  flightInterval: { key: 'flightInterval', name: '飞行物间隔', group: 'num', attrs: ['flight'] },
  meleeInterval: { key: 'meleeInterval', name: '近战击间隔', group: 'num', attrs: ['meleeHit'] },
  zoneInterval: { key: 'zoneInterval', name: '范围区间隔', group: 'num', attrs: ['zone'] },

  /* ---------------- 数值身份：范围 ---------------- */
  flightRange: { key: 'flightRange', name: '飞行物范围', group: 'num', attrs: ['flight'] },
  meleeRange: { key: 'meleeRange', name: '近战击范围', group: 'num', attrs: ['meleeHit'] },
  zoneRange: { key: 'zoneRange', name: '范围区范围', group: 'num', attrs: ['zone'] },
  zoneTime: { key: 'zoneTime', name: '范围区时间', group: 'num', attrs: ['zone'] },

  /* ---------------- 数值身份：通用 ---------------- */
  reloadTime: { key: 'reloadTime', name: '回复时间', group: 'num', owner: 'weapon' },
  capacity: { key: 'capacity', name: '容量', group: 'num', owner: 'weapon' },
  cooldown: { key: 'cooldown', name: '冷却时间', group: 'num', owner: 'skill' },
  cooldownRate: { key: 'cooldownRate', name: '冷却缩减', group: 'num', owner: 'skill' },
  controlTime: {
    key: 'controlTime',
    name: '控制时长',
    group: 'num',
    attrs: ['bodyControl', 'mindControl'],
  },
  buffPower: { key: 'buffPower', name: '增益加成', group: 'num', attrs: ['buff'] },
  debuffPower: { key: 'debuffPower', name: '减益加成', group: 'num', attrs: ['debuff'] },
  buffTime: { key: 'buffTime', name: '增益时间', group: 'num', attrs: ['buff'] },
  debuffTime: { key: 'debuffTime', name: '减益时间', group: 'num', attrs: ['debuff'] },

  /* ---------------- 数值身份：角色 ---------------- */
  maxHp: { key: 'maxHp', name: '生命值', group: 'num', owner: 'character' },
  speed: { key: 'speed', name: '移速', group: 'num', owner: 'character' },
  damageReduction: { key: 'damageReduction', name: '减伤率', group: 'num', owner: 'character' },
  stamina: { key: 'stamina', name: '体力值', group: 'num', owner: 'character' },
  staminaRegen: { key: 'staminaRegen', name: '体力回复率', group: 'num', owner: 'character' },
  hpRegen: { key: 'hpRegen', name: '生命回复', group: 'num', owner: 'character' },
  shield: { key: 'shield', name: '护盾值', group: 'num', owner: 'character' },
};

/** 阵营：属性身份才有（数值身份不带阵营） */
export type Scope = 'ally' | 'enemy';

/** 抗性身份：百分比 0~1，100% 即绝对免疫 */
export const RESISTANCES: Record<
  'mind' | 'body' | 'debuff',
  { key: ResistanceKey; name: string; desc: string }
> = {
  mind: { key: 'mind', name: '心理抗性', desc: '心理控制时长 ×(1−r)' },
  body: { key: 'body', name: '生理抗性', desc: '生理控制时长 ×(1−r)（牵引/击退/减速/陷地/眩晕）' },
  debuff: { key: 'debuff', name: '减益抗性', desc: '减益加成与减益时间 ×(1−r)' },
};

export type ResistanceKey = 'mind' | 'body' | 'debuff';

export function idName(key: string): string {
  return IDENTITIES[key]?.name ?? key;
}

/** 带阵营的属性身份名：友方范围区 / 敌方飞行物 */
export function attrName(key: string, scope: Scope): string {
  return (scope === 'ally' ? '友方' : '敌方') + idName(key);
}

/** 某一属性身份下挂的数值身份 */
export function numsOf(attrKey: string): IdentityDef[] {
  return Object.values(IDENTITIES).filter(
    (d) => d.group === 'num' && (d.attrs ?? []).includes(attrKey),
  );
}

/**
 * 取某个事物的属性身份全名，如 ['友方范围区', '友方生理控制']。
 * key 同时支持 ABILITY_IDENTITIES 与 SHAPE_IDENTITIES。
 */
export function tagsOf(key: string): string[] {
  const hit =
    ABILITY_IDENTITIES.find((a) => a.key === key) ?? SHAPE_IDENTITIES.find((a) => a.key === key);
  if (!hit) return [];
  return hit.attrs.map((a) => attrName(a.attr, a.scope));
}

/** 仅用于数值身份分组展示 */
export function numsByGroup(): Record<string, IdentityDef[]> {
  const out: Record<string, IdentityDef[]> = {};
  for (const d of Object.values(IDENTITIES)) {
    if (d.group !== 'num') continue;
    const g = (d.attrs ?? [])[0] ?? 'general';
    (out[g] ??= []).push(d);
  }
  return out;
}

/** 校验：每个属性身份都必须至少有一个对应的数值身份 */
export function validateIdentities(): string[] {
  const attrs = Object.values(IDENTITIES).filter((d) => d.group === 'attr');
  return attrs.filter((a) => numsOf(a.key).length === 0).map((a) => a.name);
}

/* ---------------- 当前所有事物挂的属性身份 ---------------- */

export interface AbilityIdentity {
  key: string;
  name: string;
  /** 属性身份 + 阵营（范围区/飞行物等可以同时挂多个） */
  attrs: Array<{ attr: string; scope: Scope }>;
}

/**
 * 归属规则：身份记「效果属于哪一方」，不记「对谁有利」。
 * - 玩家投出的黑洞雷 → 友方范围区（作用对象是敌方，但归属仍是友方）
 * - 祛鳞治疗（治疗域兽）→ 敌方增益效果
 * - 陨盾抵挡（使自身受伤减少）→ 友方增益效果
 */
export const ABILITY_IDENTITIES: AbilityIdentity[] = [
  { key: 'railgun', name: '电磁炮·弹体', attrs: [{ attr: 'flight', scope: 'ally' }] },
  { key: 'shieldStrike', name: '陨盾·盾击', attrs: [{ attr: 'meleeHit', scope: 'ally' }] },
  { key: 'shieldGuard', name: '陨盾·抵挡', attrs: [{ attr: 'buff', scope: 'ally' }] },
  { key: 'shieldMeteor', name: '陨星·减伤', attrs: [{ attr: 'buff', scope: 'ally' }] },
  { key: 'blackholeThrow', name: '黑洞雷·投掷物', attrs: [{ attr: 'flight', scope: 'ally' }] },
  {
    key: 'blackholeZone',
    name: '黑洞雷·范围区',
    attrs: [
      { attr: 'zone', scope: 'ally' },
      { attr: 'bodyControl', scope: 'ally' },
    ],
  },
  {
    key: 'leap',
    name: '陨落',
    attrs: [
      { attr: 'meleeHit', scope: 'ally' },
      { attr: 'bodyControl', scope: 'ally' },
    ],
  },
  {
    key: 'stone',
    name: '磐石护体',
    attrs: [
      { attr: 'buff', scope: 'ally' },
      { attr: 'debuff', scope: 'ally' },
    ],
  },
  { key: 'puzeFan', name: '普则·扇形劈击', attrs: [{ attr: 'meleeHit', scope: 'enemy' }] },
  { key: 'yuejiBottle', name: '越机·毒雾瓶', attrs: [{ attr: 'flight', scope: 'enemy' }] },
  { key: 'yuejiZone', name: '越机·毒雾', attrs: [{ attr: 'zone', scope: 'enemy' }] },
  { key: 'shiqiaShot', name: '失恰·远程弹', attrs: [{ attr: 'flight', scope: 'enemy' }] },
  { key: 'qulinHeal', name: '祛鳞·治疗', attrs: [{ attr: 'buff', scope: 'enemy' }] },
];

/**
 * 塑造（支线升级）挂的属性身份。
 * attrs 为空 = 纯数值改造（只动数值身份，不产生新的属性身份）。
 */
export const SHAPE_IDENTITIES: AbilityIdentity[] = [
  // 陨盾
  { key: 'ground', name: '底盾', attrs: [{ attr: 'buff', scope: 'ally' }] },
  { key: 'safety', name: '安全感', attrs: [{ attr: 'buff', scope: 'ally' }] },
  { key: 'unyield', name: '坚不可摧', attrs: [{ attr: 'buff', scope: 'ally' }] },
  // 电磁炮
  { key: 'charge', name: '极蓄', attrs: [] },
  { key: 'chain', name: '电传播', attrs: [{ attr: 'meleeHit', scope: 'ally' }] },
  { key: 'split', name: '动力分裂', attrs: [{ attr: 'flight', scope: 'ally' }] },
  { key: 'pierce', name: '磁透性', attrs: [] },
  // 黑洞雷
  { key: 'detonate', name: '斥爆', attrs: [{ attr: 'meleeHit', scope: 'ally' }] },
  {
    key: 'whiteout',
    name: '白扩',
    attrs: [
      { attr: 'meleeHit', scope: 'ally' },
      { attr: 'bodyControl', scope: 'ally' },
    ],
  },
  { key: 'overflow', name: '引力超标', attrs: [{ attr: 'buff', scope: 'ally' }] },
  { key: 'slowfield', name: '噬速力', attrs: [{ attr: 'debuff', scope: 'ally' }] },
  // 陨落
  { key: 'deepen', name: '状况加深', attrs: [] },
  { key: 'recoil', name: '后坐力', attrs: [] },
  { key: 'sticky', name: '土壤黏脚', attrs: [{ attr: 'debuff', scope: 'ally' }] },
  // 磐石护体
  {
    key: 'eggshell',
    name: '石卵',
    attrs: [
      { attr: 'bodyControl', scope: 'ally' },
      { attr: 'buff', scope: 'ally' },
    ],
  },
  {
    key: 'impact',
    name: '磐石冲击',
    attrs: [
      { attr: 'meleeHit', scope: 'ally' },
      { attr: 'bodyControl', scope: 'ally' },
    ],
  },
  { key: 'siphon', name: '磐能吸取', attrs: [{ attr: 'buff', scope: 'ally' }] },
];

/** 校验：ABILITY_IDENTITIES / SHAPE_IDENTITIES 里的属性身份必须存在且是 attr 组 */
export function validateAbilityIdentities(): string[] {
  const bad: string[] = [];
  for (const ab of [...ABILITY_IDENTITIES, ...SHAPE_IDENTITIES]) {
    for (const a of ab.attrs) {
      const def = IDENTITIES[a.attr];
      if (!def || def.group !== 'attr') bad.push(ab.name + ' → ' + a.attr);
    }
  }
  return bad;
}
