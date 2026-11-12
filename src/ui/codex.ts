import {
  BLACKHOLE,
  BLACKHOLE_SHAPE,
  ENEMIES,
  IMPACT,
  LEAP,
  LEAP_SHAPE,
  RAIL_SHAPE,
  RAIL_WEAPON,
  RECOIL,
  SHIELD_WEAPON,
  SKILLS,
  SKILL_SHAPES,
  STONE,
  STONE_SHAPE,
  WEAPON_SHAPES,
} from '../content/defs';
import type { EnemyKind } from '../content/defs';
import {
  ABILITY_IDENTITIES,
  IDENTITIES,
  RESISTANCES,
  SHAPE_IDENTITIES,
  attrName,
  numsOf,
  tagsOf,
} from '../content/identities';

/** 属性身份的一句话说明（图鉴用） */
const ATTR_DESC: Record<string, string> = {
  flight: '以弹体形式飞行的攻击，可被减速、拦截或加成。',
  meleeHit: '贴身或扇形范围内的直接打击。',
  zone: '持续存在的区域效果（吸引区、毒雾），有范围与存续时间。',
  mindControl: '作用于心智的控制（恐惧/嘲讽等）。当前版本没有来源，预留。',
  bodyControl: '作用于身体的控制：牵引、击退、减速、陷地、眩晕。',
  buff: '提升自身或友方能力的正面效果。',
  debuff: '削弱目标的负面效果（减伤、减速等）。',
};

/** 图鉴条目：属性身份 + 数值身份都写清楚 */
interface Entry {
  name: string;
  sub?: string;
  desc: string;
  /** 属性身份 */
  attrs: string[];
  /** 数值身份（名称 → 值） */
  nums: [string, string][];
}

const WEAPONS: Entry[] = [
  {
    name: RAIL_WEAPON.name,
    sub: '远程',
    desc: '射出圆形电磁球，命中造成伤害。',
    attrs: ['远程', ...tagsOf('railgun')],
    nums: [
      ['飞行物伤害', RAIL_WEAPON.damage + ''],
      ['飞行物间隔', RAIL_WEAPON.fireInterval + ' 秒'],
      ['飞行物范围', RAIL_WEAPON.range + ''],
      ['回复时间', RAIL_WEAPON.reload + ' 秒'],
      ['容量', RAIL_WEAPON.magSize + ' 发'],
    ],
  },
  {
    name: SHIELD_WEAPON.name,
    sub: '近战',
    desc: '身侧有可转向的抵挡范围，挡下飞行物与近战击；左键盾击击退敌人。耐久耗尽破碎，进入陨星状态。',
    attrs: ['近战', ...tagsOf('shieldStrike'), ...tagsOf('shieldGuard'), ...tagsOf('shieldMeteor')],
    nums: [
      ['近战击伤害', SHIELD_WEAPON.damage + ''],
      ['近战击间隔', SHIELD_WEAPON.interval + ' 秒'],
      ['近战击范围', SHIELD_WEAPON.range + ''],
      ['控制时长', SHIELD_WEAPON.knockTime + ' 秒'],
      ['生命值（耐久）', SHIELD_WEAPON.durabilityMax + ''],
      ['增益加成（抵挡）', '抵挡伤害 −' + Math.round(SHIELD_WEAPON.blockDR * 100) + '%'],
      ['增益加成（陨星）', '陨星减伤 ' + Math.round(SHIELD_WEAPON.meteorDR * 100) + '%'],
    ],
  },
];

function weaponShapeEntries(): Entry[] {
  const meta: Record<string, { attrs: string[]; nums: [string, string][] }> = {
    charge: {
      attrs: ['增益效果'],
      nums: [
        ['飞行物伤害', '蓄满 ×2.5'],
        ['飞行物范围', '蓄满 ×1.35'],
      ],
    },
    chain: {
      attrs: ['近战击'],
      nums: [['近战击伤害', RAIL_SHAPE.chainDamage + '']],
    },
    split: {
      attrs: ['飞行物'],
      nums: [['飞行物伤害', Math.round(RAIL_SHAPE.splitDamageRatio * 100) + '%']],
    },
    pierce: { attrs: ['增益效果'], nums: [] },
    ground: { attrs: ['减益效果'], nums: [['增益加成', '减伤 ' + Math.round(SHIELD_WEAPON.groundDR * 100) + '%']] },
    safety: { attrs: ['增益效果'], nums: [['增益加成', '生命回复 5/秒']] },
    unyield: { attrs: ['增益效果'], nums: [] },
  };
  const names: Record<string, string> = {
    railgun: RAIL_WEAPON.name,
    shield: SHIELD_WEAPON.name,
  };
  const out: Entry[] = [];
  for (const [weaponId, defs] of Object.entries(WEAPON_SHAPES)) {
    for (const s of defs) {
      const m = meta[s.id] ?? { attrs: [], nums: [] };
      out.push({
        name: s.name,
        sub: (names[weaponId] ?? weaponId) + ' · 塑造',
        desc: s.levels.join(' ') + (tagsOf(s.id).length ? '' : '（纯数值改造，不带属性身份）'),
        attrs: tagsOf(s.id),
        nums: m.nums,
      });
    }
  }
  return out;
}

const SKILL_ENTRIES: Entry[] = [
  {
    name: SKILLS.blackhole.name,
    sub: '冷却 ' + SKILLS.blackhole.cd + ' 秒',
    desc: '投出黑洞雷，落点生成吸引区：持续牵引域兽并周期造成伤害。',
    attrs: [...tagsOf('blackholeThrow'), ...tagsOf('blackholeZone')],
    nums: [
      ['范围区伤害', BLACKHOLE.tickDamage + ' / 次'],
      ['范围区范围', BLACKHOLE.radius + ''],
      ['范围区时间', BLACKHOLE.duration + ' 秒'],
      ['范围区间隔', BLACKHOLE.tickInterval + ' 秒'],
      ['控制时长', BLACKHOLE.pullTime + ' 秒'],
      ['冷却时间', SKILLS.blackhole.cd + ' 秒'],
      ['容量', '1'],
    ],
  },
  {
    name: SKILLS.leap.name,
    sub: '冷却 ' + SKILLS.leap.cd + ' 秒',
    desc: '跃向目标点坠落，造成伤害并使目标陷地。',
    attrs: tagsOf('leap'),
    nums: [
      ['近战击伤害', LEAP.damage + ''],
      ['近战击范围', SKILLS.leap.radius + ''],
      ['控制时长', LEAP.root + ' 秒'],
      ['冷却时间', SKILLS.leap.cd + ' 秒'],
      ['容量', '1'],
    ],
  },
  {
    name: SKILLS.stone.name,
    sub: '冷却 ' + SKILLS.stone.cd + ' 秒',
    desc: '一段时间内大幅减伤，但移速降低。',
    attrs: tagsOf('stone'),
    nums: [
      ['增益加成', '减伤 +' + Math.round(STONE.dr * 100) + '%'],
      ['减益加成', '移速 −' + Math.round((1 - STONE.speedMult) * 100) + '%'],
      ['增益时间', STONE.duration + ' 秒'],
      ['冷却时间', SKILLS.stone.cd + ' 秒'],
      ['容量', '1'],
    ],
  },
];

function skillShapeEntries(): Entry[] {
  const meta: Record<string, { attrs: string[]; nums: [string, string][] }> = {
    detonate: {
      attrs: ['近战击'],
      nums: [
        ['近战击伤害', BLACKHOLE_SHAPE.blastDamage + ''],
        ['冷却时间', BLACKHOLE_SHAPE.blastCd + ' 秒'],
      ],
    },
    whiteout: {
      attrs: ['近战击', '生理控制'],
      nums: [
        ['近战击伤害', BLACKHOLE_SHAPE.whiteoutDamage + ''],
        ['控制时长', BLACKHOLE_SHAPE.whiteoutKnockTime + ' 秒'],
      ],
    },
    overflow: { attrs: ['增益效果'], nums: [['增益加成', '移速 +25% · 回血 ' + BLACKHOLE_SHAPE.buffRegen + '/秒']] },
    slowfield: { attrs: ['减益效果'], nums: [['减益加成', '飞行速度 −55%']] },
    deepen: {
      attrs: ['生理控制'],
      nums: [
        ['控制时长', '每次 +' + LEAP_SHAPE.deepenAdd + ' 秒'],
        ['冷却时间', LEAP_SHAPE.deepenCd + ' 秒'],
      ],
    },
    sticky: {
      attrs: ['减益效果'],
      nums: [
        ['减益加成', '移速 −' + Math.round(LEAP_SHAPE.stickySlow * 100) + '%'],
        ['减益时间', LEAP_SHAPE.stickyTime + ' 秒'],
      ],
    },
    recoil: {
      attrs: ['增益效果', '近战击'],
      nums: [
        ['近战击伤害', '+' + Math.round(RECOIL.gainPerSec * 100) + '% / 秒（上限 +40%）'],
        ['持续上限（滞空）', RECOIL.maxHang + ' 秒'],
      ],
    },
    eggshell: { attrs: ['生理控制', '增益效果'], nums: [['增益加成', '减伤 +' + Math.round(STONE_SHAPE.eggDR * 100) + '%']] },
    siphon: { attrs: ['增益效果'], nums: [['护盾值', '伤害的 ' + Math.round(STONE_SHAPE.siphonRate * 100) + '%']] },
    impact: {
      attrs: ['近战击', '生理控制'],
      nums: [
        ['近战击伤害', IMPACT.damage + ''],
        ['近战击范围', IMPACT.radius + ''],
        ['控制时长', IMPACT.knockTime + ' 秒'],
      ],
    },
  };
  const out: Entry[] = [];
  for (const [skillId, defs] of Object.entries(SKILL_SHAPES)) {
    for (const s of defs) {
      const m = meta[s.id] ?? { attrs: [], nums: [] };
      out.push({
        name: s.name,
        sub: SKILLS[skillId].name + ' · 塑造',
        desc: s.desc + (tagsOf(s.id).length ? '' : '（纯数值改造，不带属性身份）'),
        attrs: tagsOf(s.id),
        nums: m.nums,
      });
    }
  }
  return out;
}

function enemyEntries(): Entry[] {
  const meta: Record<EnemyKind, { attrs: string[]; desc: string }> = {
    puze: { attrs: tagsOf('puzeFan'), desc: '近战单位，蓄力后劈出扇形攻击。' },
    shiqia: { attrs: tagsOf('shiqiaShot'), desc: '远程射手，会保持距离射击。' },
    yueji: { attrs: [...tagsOf('yuejiBottle'), ...tagsOf('yuejiZone')], desc: '朝玩家投掷污染瓶，落地生成持续伤害的毒雾。' },
    qulin: { attrs: tagsOf('qulinHeal'), desc: '治疗附近的域兽，自身没有攻击能力。' },
  };
  return (Object.keys(ENEMIES) as EnemyKind[]).map((k) => {
    const e = ENEMIES[k];
    const nums: [string, string][] = [
      ['生命值', e.hp + ''],
      ['移速', e.speed + ''],
    ];
    if (e.fan) {
      nums.push(['近战击范围', e.fan.radius + ''], ['近战击间隔', e.atkInterval + ' 秒']);
    }
    if (e.ranged && e.shotSpeed > 0) {
      nums.push(['飞行物伤害', e.dmg + ''], ['飞行物间隔', e.atkInterval + ' 秒']);
    }
    if (e.bottle) {
      nums.push(
        ['范围区伤害', e.bottle.damage + ' / 次'],
        ['范围区范围', e.bottle.radius + ''],
        ['范围区时间', e.bottle.duration + ' 秒'],
        ['范围区间隔', e.bottle.interval + ' 秒'],
      );
    }
    if (e.heal) {
      nums.push(['增益加成', '回血 ' + e.heal.amount + ' / ' + e.heal.interval + ' 秒']);
    }
    return { name: e.name, sub: e.ranged ? '远程' : '近战', desc: meta[k].desc, attrs: meta[k].attrs, nums };
  });
}

/* ---------------- 身份大全 ---------------- */

function identityEntries(): Entry[] {
  const out: Entry[] = [];

  out.push({
    name: '阵营规则',
    sub: '只有属性身份分友方 / 敌方',
    desc:
      '属性身份记「效果属于哪一方」，不记「对谁有利」：玩家投出的黑洞雷是友方范围区（作用对象是敌方），' +
      '祛鳞治疗是敌方增益效果（治疗域兽）。数值身份中立，不带阵营，阵营从来源继承。',
    attrs: ['友方', '敌方'],
    nums: [],
  });

  for (const d of Object.values(IDENTITIES)) {
    if (d.group !== 'attr') continue;
    const numNames = numsOf(d.key).map((n) => n.name).join(' · ');
    out.push({
      name: d.name,
      sub: '属性身份',
      desc: (ATTR_DESC[d.key] ?? '') + (numNames ? '　挂载的数值身份：' + numNames : ''),
      attrs: [attrName(d.key, 'ally'), attrName(d.key, 'enemy')],
      nums: [],
    });
  }

  out.push({
    name: '抗性身份',
    sub: '百分比 · 100% 即绝对免疫',
    desc: Object.values(RESISTANCES)
      .map((r) => r.name + '：' + r.desc)
      .join('；'),
    attrs: Object.values(RESISTANCES).map((r) => r.name),
    nums: [],
  });

  // 通用数值身份按归属分卡：武器 / 技能 / 角色
  const general = Object.values(IDENTITIES).filter(
    (d) => d.group === 'num' && (d.attrs ?? []).length === 0,
  );
  const ownerCards: Array<{ owner: 'weapon' | 'skill' | 'character'; name: string; desc: string }> = [
    { owner: 'weapon', name: '通用数值身份 · 武器', desc: '武器专用：装填与容量。' },
    { owner: 'skill', name: '通用数值身份 · 技能', desc: '技能专用：冷却相关。' },
    {
      owner: 'character',
      name: '通用数值身份 · 角色',
      desc: '域卫与域兽共用：生命、移动、承受与体力。',
    },
  ];
  for (const c of ownerCards) {
    const items = general.filter((d) => d.owner === c.owner);
    if (items.length === 0) continue;
    out.push({
      name: c.name,
      sub: items.length + ' 项',
      desc: c.desc + '　' + items.map((d) => d.name).join(' · '),
      attrs: [],
      nums: [],
    });
  }

  const other = general.filter((d) => !d.owner);
  if (other.length > 0) {
    out.push({
      name: '其他数值身份',
      sub: '未归类',
      desc: other.map((d) => d.name).join(' · '),
      attrs: [],
      nums: [],
    });
  }

  const roster: [string, string][] = [];
  for (const a of ABILITY_IDENTITIES) roster.push([a.name, tagsOf(a.key).join(' + ') || '纯数值']);
  for (const a of SHAPE_IDENTITIES) roster.push([a.name + '（塑造）', tagsOf(a.key).join(' + ') || '纯数值']);
  out.push({
    name: '事物身份一览',
    sub: ABILITY_IDENTITIES.length + ' 项战斗事物 + ' + SHAPE_IDENTITIES.length + ' 个塑造',
    desc: '属性身份全名，按「阵营 + 属性」显示。',
    attrs: [],
    nums: roster,
  });

  return out;
}

const TABS: { key: string; title: string; build: () => Entry[] }[] = [
  { key: 'ident', title: '身份大全', build: identityEntries },
  { key: 'weapon', title: '武器', build: () => WEAPONS },
  { key: 'wshape', title: '武器塑造', build: weaponShapeEntries },
  { key: 'skill', title: '技能', build: () => SKILL_ENTRIES },
  { key: 'sshape', title: '技能塑造', build: skillShapeEntries },
  { key: 'enemy', title: '域兽', build: enemyEntries },
];

export class Codex {
  private root = document.getElementById('codex') as HTMLElement;
  private tabsEl = document.getElementById('codex-tabs') as HTMLElement;
  private listEl = document.getElementById('codex-list') as HTMLElement;
  private closeBtn = document.getElementById('codex-close') as HTMLButtonElement;
  private built = false;
  private active = 'weapon';

  constructor() {
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    if (!this.built) this.build();
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private build(): void {
    this.tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'codex-tab';
      b.textContent = t.title;
      b.dataset.key = t.key;
      b.addEventListener('click', () => {
        this.active = t.key;
        this.render();
      });
      this.tabsEl.appendChild(b);
    }
    this.built = true;
  }

  private render(): void {
    for (const el of Array.from(this.tabsEl.children)) {
      el.classList.toggle('active', (el as HTMLElement).dataset.key === this.active);
    }
    const tab = TABS.find((t) => t.key === this.active)!;
    this.listEl.innerHTML = tab
      .build()
      .map((e) => {
        const tags = [...new Set(e.attrs)];
        const attrs = tags.map((a) => `<i>${a}</i>`).join('');
        const nums = e.nums
          .map(([k, v]) => `<div class="codex-row"><span>${k}</span><b>${v}</b></div>`)
          .join('');
        return `<div class="codex-card">
          <div class="codex-head"><b>${e.name}</b><span>${e.sub ?? ''}</span></div>
          <p class="codex-desc">${e.desc}</p>
          ${attrs ? `<div class="codex-block"><div class="codex-label">属性身份</div><div class="codex-tags">${attrs}</div></div>` : ''}
          ${nums ? `<div class="codex-block"><div class="codex-label">数值身份</div>${nums}</div>` : ''}
        </div>`;
      })
      .join('');
  }
}
