import { RAIL_WEAPON, SHIELD_WEAPON, SKILLS, SKILL_SHAPES } from '../content/defs';
import type { ShapeDef } from '../content/defs';
import type { World } from '../sim/world';

const WEAPON_BASE_STATS: Record<string, [string, string][]> = {
  shield: [
    ['近战击伤害', SHIELD_WEAPON.damage + ''],
    ['近战击间隔', SHIELD_WEAPON.interval + ' 秒'],
    ['近战击范围', SHIELD_WEAPON.range + ''],
    ['控制时长', SHIELD_WEAPON.knockTime + ' 秒'],
    ['耐久', SHIELD_WEAPON.durabilityMax + ''],
    ['减益效果', '抵挡伤害 −' + Math.round(SHIELD_WEAPON.blockDR * 100) + '%'],
    ['增益加成', '陨星减伤 ' + Math.round(SHIELD_WEAPON.meteorDR * 100) + '%'],
  ],
  railgun: [
    ['飞行物伤害', RAIL_WEAPON.damage + ''],
    ['飞行物间隔', RAIL_WEAPON.fireInterval + ' 秒'],
    ['飞行物范围', RAIL_WEAPON.range + ''],
    ['回复时间', RAIL_WEAPON.reload + ' 秒'],
    ['容量', RAIL_WEAPON.magSize + ' 发'],
  ],
};

const WEAPON_SHAPE_STATS: Record<string, [string, string][]> = {
  charge: [
    ['飞行物伤害', '蓄满 ×2'],
    ['飞行物范围', '蓄满 ×1.35'],
  ],
  pierce: [['飞行物范围', '穿透全部']],
  ground: [['增益加成', '减伤 50%']],
  safety: [['增益加成', '生命回复 5/秒']],
};

const SKILL_SHAPE_STATS: Record<string, [string, string][]> = {
  detonate: [
    ['近战击伤害', '14'],
    ['冷却时间', '0.35 秒'],
  ],
  whiteout: [
    ['近战击伤害', '18'],
    ['控制时长', '0.2 秒'],
  ],
  overflow: [['增益加成', '移速 +25% · 回血 8/秒']],
  slowfield: [['减益加成', '飞行速度 −55%']],
  deepen: [
    ['控制时长', '每次 +0.15 秒'],
    ['冷却时间', '0.25 秒'],
  ],
  sticky: [
    ['减益加成', '移速 −45%'],
    ['减益时间', '1.2 秒'],
  ],
  eggshell: [['增益加成', '减伤 +85%']],
  siphon: [['护盾值', '伤害的 25%']],
};

interface ShapeUI {
  card: HTMLElement;
  desc: HTMLElement;
  buy: HTMLButtonElement;
}

export class GrowthPanel {
  private root = document.getElementById('panel') as HTMLElement;
  private pointsEl = document.getElementById('panel-points') as HTMLElement;
  private tracksEl = document.getElementById('tracks') as HTMLElement;
  private closeBtn = document.getElementById('panel-close') as HTMLButtonElement;
  private shapeList = document.getElementById('shape-list') as HTMLElement;
  private shapeCoins = document.getElementById('shape-coins') as HTMLElement;
  private shapeCards = new Map<string, ShapeUI>();
  private shapeDefs: ShapeDef[] = [];
  private builtWeapon = '';
  private skillShapeList = document.getElementById('skill-shape-list') as HTMLElement;
  private skillShapeCoins = document.getElementById('skill-shape-coins') as HTMLElement;
  private shapeTitle = document.getElementById('shape-title') as HTMLElement;
  private skillShapeCards = new Map<string, ShapeUI>();
  private skillShapeSkill: Record<string, string> = {};
  private world: World | null = null;
  private built = false;

  constructor(onClose: () => void) {
    this.closeBtn.addEventListener('click', onClose);
  }

  isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(world: World): void {
    this.world = world;
    if (this.built && this.builtWeapon !== world.player.weaponId) {
      this.built = false;
    }
    this.builtWeapon = world.player.weaponId;
    this.shapeTitle.textContent = world.weaponName();
    if (!this.built) this.build();
    this.root.classList.remove('hidden');
    this.refresh();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private build(): void {
    this.tracksEl.innerHTML = '';
    this.tracksEl.style.display = 'none';
    this.shapeDefs = this.world ? this.world.weaponShapes() : [];
    this.buildShapes();
    this.buildSkillShapes();
    this.built = true;
  }

  private buildShapes(): void {
    this.shapeList.innerHTML = '';
    this.shapeCards.clear();
    for (const def of this.shapeDefs) {
      const card = document.createElement('div');
      card.className = 'equip-card';
      const name = document.createElement('div');
      name.className = 'equip-name';
      name.textContent = def.name;
      const desc = document.createElement('div');
      desc.className = 'equip-desc';
      desc.textContent = def.levels[0];
      const stats = document.createElement('div');
      stats.className = 'shape-stats';
      for (const [k, v] of WEAPON_SHAPE_STATS[def.id] ?? []) {
        const row = document.createElement('div');
        row.className = 'shape-row';
        row.innerHTML = '<span>' + k + '</span><b>' + v + '</b>';
        stats.appendChild(row);
      }
      const btn = document.createElement('button');
      btn.className = 'buy';
      btn.addEventListener('click', () => {
        if (!this.world) return;
        if (this.world.buyShape(def.id)) this.refresh();
      });
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(stats);
      card.appendChild(btn);
      this.shapeList.appendChild(card);
      this.shapeCards.set(def.id, { card, desc, buy: btn });
    }
  }

  private buildSkillShapes(): void {
    this.skillShapeList.innerHTML = '';
    this.skillShapeCards.clear();
    const order = ['blackhole', 'leap', 'stone'];
    for (const skillId of order) {
      const defs = SKILL_SHAPES[skillId] ?? [];
      if (defs.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'shape-group';
      const title = document.createElement('div');
      title.className = 'shape-group-title clickable';
      title.innerHTML =
        '<b>' + SKILLS[skillId].name + '</b><span>' + defs.length + ' 个塑造</span>';
      const list = document.createElement('div');
      list.className = 'equip-list';
      title.addEventListener('click', () => {
        group.classList.toggle('collapsed');
      });
      group.appendChild(title);
      group.appendChild(list);

      for (const def of defs) {
        const card = document.createElement('div');
        card.className = 'equip-card';
        const name = document.createElement('div');
        name.className = 'equip-name';
        name.textContent = def.name;
        const desc = document.createElement('div');
        desc.className = 'equip-desc';
        desc.textContent = def.desc;
        const stats = document.createElement('div');
        stats.className = 'shape-stats';
        for (const [k, v] of SKILL_SHAPE_STATS[def.id] ?? []) {
          const row = document.createElement('div');
          row.className = 'shape-row';
          row.innerHTML = '<span>' + k + '</span><b>' + v + '</b>';
          stats.appendChild(row);
        }
        const btn = document.createElement('button');
        btn.className = 'buy';
        btn.addEventListener('click', () => {
          if (!this.world) return;
          if (this.world.buySkillShape(skillId, def.id)) this.refresh();
        });
        card.appendChild(name);
        card.appendChild(desc);
        card.appendChild(stats);
        card.appendChild(btn);
        list.appendChild(card);
        this.skillShapeCards.set(skillId + '.' + def.id, { card, desc, buy: btn });
      }
      this.skillShapeList.appendChild(group);
    }
  }

  refresh(): void {
    const w = this.world;
    if (!w) return;
    const coins = String(w.player.coins);
    this.pointsEl.textContent = coins;
    this.shapeCoins.textContent = coins;
    this.skillShapeCoins.textContent = coins;
    for (const skillId of Object.keys(SKILL_SHAPES)) {
      for (const def of SKILL_SHAPES[skillId]) {
      const ui = this.skillShapeCards.get(skillId + '.' + def.id);
      if (!ui) continue;
      const owned = w.hasSkillShape(skillId, def.id);
      ui.card.classList.toggle('owned', owned);
      ui.buy.disabled = owned || w.player.coins < def.cost;
      ui.buy.textContent = owned ? '已获得' : def.cost + ' 域币';
      }
    }



    for (const def of this.shapeDefs) {
      const ui = this.shapeCards.get(def.id);
      if (!ui) continue;
      const lvl = w.shapeLevel(def.id);
      const maxed = lvl >= def.max;
      const desc = def.levels[Math.min(lvl, def.levels.length - 1)];
      ui.desc.textContent = desc;
      const cost = def.cost(lvl);
      ui.buy.disabled = maxed || w.player.coins < cost;
      ui.buy.textContent = maxed ? '已获得' : cost + ' 域币';
      ui.card.classList.toggle('owned', lvl > 0);
    }
  }
}
