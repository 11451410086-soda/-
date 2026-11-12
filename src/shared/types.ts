import type { Vec } from './util';

export type { Vec };

/**
 * 属性身份标签（中立词条，不带阵营）。
 * 阵营（友方 / 敌方）挂在实例上，见 content/identities.ts 的 scope。
 * 注意：范围区（zone）指的是"持续存在的区域"，不是伤害类型。
 */
export type Tag =
  | 'flight'
  | 'meleeHit'
  | 'zone'
  | 'mindControl'
  | 'bodyControl'
  | 'buff'
  | 'debuff';

/** 标签的来源大类 */
export type TagSource = 'weapon' | 'skill';

export function tagSource(t: Tag): TagSource {
  return t.startsWith('weapon') ? 'weapon' : 'skill';
}

export type CCKind = 'pull' | 'knockback' | 'stun' | 'slow' | 'root';

export interface CCEffect {
  kind: CCKind;
  duration: number;
  speed: number;
  /** 这次控制的来源：武器还是技能 */
  source?: TagSource;
}

/**
 * 抗性身份（百分比 0~1）：100% 即绝对免疫。
 * - mind  心理抗性：心理控制时长 ×(1-r)
 * - body  生理抗性：生理控制时长 ×(1-r)（牵引/击退/减速/陷地/眩晕）
 * - debuff 减益抗性：减益加成与减益时间 ×(1-r)
 */
export interface Resistance {
  /** 心理抗性 0~1 */
  mind?: number;
  /** 生理抗性 0~1 */
  body?: number;
  /** 减益抗性 0~1 */
  debuff?: number;
}

export type GameState = 'title' | 'playing' | 'victory' | 'defeat';

/** 每帧输入快照（客户端 → 模拟层） */
export interface InputSnapshot {
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
