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

export interface IdentityDef {
  key: string;
  name: string;
  group: IdentityGroup;
  /** 归属的属性身份 */
  attrs?: string[];
}

export const IDENTITIES: Record<string, IdentityDef> = {
  /* ---------------- 武器类别 ---------------- */
  melee: { key: 'melee', name: '近战', group: 'cat' },
  ranged: { key: 'ranged', name: '远程', group: 'cat' },

  /* ---------------- 属性身份 ---------------- */
  flight: { key: 'flight', name: '飞行物', group: 'attr' },
  meleeHit: { key: 'meleeHit', name: '近战击', group: 'attr' },
  zone: { key: 'zone', name: '范围区', group: 'attr' },
  mindControl: { key: 'mindControl', name: '心理控制', group: 'attr' },
  bodyControl: { key: 'bodyControl', name: '生理控制', group: 'attr' },
  buff: { key: 'buff', name: '增益效果', group: 'attr' },
  debuff: { key: 'debuff', name: '减益效果', group: 'attr' },

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
  reloadTime: { key: 'reloadTime', name: '回复时间', group: 'num' },
  capacity: { key: 'capacity', name: '容量', group: 'num' },
  cooldown: { key: 'cooldown', name: '冷却时间', group: 'num' },
  cooldownRate: { key: 'cooldownRate', name: '冷却缩减', group: 'num' },
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
  maxHp: { key: 'maxHp', name: '生命值', group: 'num' },
  speed: { key: 'speed', name: '移速', group: 'num' },
  damageReduction: { key: 'damageReduction', name: '减伤率', group: 'num' },
  stamina: { key: 'stamina', name: '体力值', group: 'num' },
  staminaRegen: { key: 'staminaRegen', name: '体力回复率', group: 'num' },
  hpRegen: { key: 'hpRegen', name: '生命回复', group: 'num' },
  shield: { key: 'shield', name: '护盾值', group: 'num' },
};

/** 免控身份：按控制类型划分 */
export const IMMUNITIES = {
  mind: '心理免控',
  body: '生理免控',
} as const;

export function idName(key: string): string {
  return IDENTITIES[key]?.name ?? key;
}

/** 某一属性身份下挂的数值身份 */
export function numsOf(attrKey: string): IdentityDef[] {
  return Object.values(IDENTITIES).filter(
    (d) => d.group === 'num' && (d.attrs ?? []).includes(attrKey),
  );
}

/** 校验：每个属性身份都必须至少有一个对应的数值身份 */
export function validateIdentities(): string[] {
  const attrs = Object.values(IDENTITIES).filter((d) => d.group === 'attr');
  return attrs.filter((a) => numsOf(a.key).length === 0).map((a) => a.name);
}
