import type { Vec } from './util';

export type { Vec };

/**
 * 身份标签。
 * 两类来源（武器 / 技能）× 四种形态（飞行物 / 近战击 / 范围区 / 控制）。
 * 注意：范围区（zone）指的是"持续存在的区域"，不是伤害类型。
 * 以后「只对飞行物生效」「控制被免疫」这类组合都靠它筛选目标。
 */
/** 属性身份：不带来源，武器 / 技能 / 域兽共用 */
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
 * 免控：不分等级，列出的类型直接免疫。
 * 来源免疫（weaponControl / skillControl）优先于种类免疫。
 */
export interface Immunity {
  /** 免疫全部控制 */
  all?: boolean;
  /** 心理免控 */
  mind?: boolean;
  /** 生理免控 */
  body?: boolean;
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
