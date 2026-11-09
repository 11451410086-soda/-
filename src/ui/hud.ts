import { BLACKHOLE, LEAP, SKILLS, STONE } from '../content/defs';
import type { WorldEvent } from '../sim/types';
import type { World } from '../sim/world';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export class Hud {
  private hpText = el('hp-text');
  private hpBar = el('hp-bar');
  private ammoEl = el('ammo');
  private reloadText = el('reload-text');
  private staminaEl = el('stamina');
  private shieldWrap = el('shield-wrap');
  private shieldBar = el('shield-bar');
  private lastStamina = -1;
  private waveTitle = el('wave-title');
  private waveSub = el('wave-sub');
  private pointsEl = el('points');
  private coinsEl = el('coins');
  private skillQ = el('skill-q');
  private skillE = el('skill-e');
  private cdQ = el('cd-q');
  private cdE = el('cd-e');
  private toastEl = el('toast');
  private centerEl = el('center-msg');
  private skipHint = el('skip-hint');
  private heroName = el('hero-name');
  private ammoLabel = el('ammo-label');
  private skillQName = el('skill-q-name');
  private skillEName = el('skill-e-name');
  private skillF = el('skill-f');
  private skillFName = el('skill-f-name');
  private cdF = el('cd-f');
  private cdFText = document.createElement('span');
  private fTextReady = false;
  private tip = document.getElementById('skill-tip') as HTMLElement;
  private tipReady = false;
  private tipSkill = '';
  private shieldText = el('shield-text');
  private heroShown = '';
  private skillRmb = el('skill-rmb');
  private cdRmb = el('cd-rmb');
  private keyHints = el('key-hints');
  private formLine = el('form-line');
  private formText = el('form-text');
  private onSkip: () => void;

  private cdQText: HTMLElement;
  private cdRmbText: HTMLElement;
  private cdEText: HTMLElement;
  private built = false;
  private toastTimer = 0;
  private lastMag = -1;

  constructor(onSkip: () => void = () => {}) {
    this.onSkip = onSkip;
    this.skipHint.addEventListener('click', () => this.onSkip());
    this.cdQText = document.createElement('span');
    this.cdQText.className = 'skill-cd-text';
    this.skillQ.appendChild(this.cdQText);
    this.cdEText = document.createElement('span');
    this.cdEText.className = 'skill-cd-text';
    this.skillE.appendChild(this.cdEText);
    this.cdRmbText = document.createElement('span');
    this.cdRmbText.className = 'skill-cd-text';
    this.skillRmb.appendChild(this.cdRmbText);
  }

  reset(): void {
    this.built = false;
    this.lastMag = -1;
    this.toastTimer = 0;
    this.toastEl.classList.remove('show');
    this.centerEl.classList.remove('show');
  }

  private setupSkillTip(): void {
    const bind = (card: HTMLElement, id: string) => {
      card.classList.add('clickable');
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.tip.classList.contains('hidden') || this.tipSkill !== id) {
          this.tipSkill = id;
          this.showSkillTip(card, id);
        } else {
          this.tip.classList.add('hidden');
          this.tipSkill = '';
        }
      });
    };
    bind(this.skillQ, 'blackhole');
    bind(this.skillE, 'leap');
    bind(this.skillF, 'stone');
    window.addEventListener('click', () => {
      this.tip.classList.add('hidden');
      this.tipSkill = '';
    });
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.tip.classList.add('hidden');
      this.tipSkill = '';
    });
    this.tipReady = true;
  }

  private skillRows(id: string): { rows: [string, string][]; tags: string[] } {
    if (id === 'blackhole') {
      return {
        rows: [
          ['范围区伤害', BLACKHOLE.tickDamage + ' / 次'],
          ['范围区范围', BLACKHOLE.radius + ''],
          ['范围区时间', BLACKHOLE.duration + ' 秒'],
          ['冷却时间', SKILLS.blackhole.cd + ' 秒'],
          ['容量', '1'],
          ['控制时长', BLACKHOLE.pullTime + ' 秒'],
        ],
        tags: ['技能范围区', '技能近战击', '技能控制'],
      };
    }
    if (id === 'leap') {
      return {
        rows: [
          ['近战击伤害', LEAP.damage + ''],
          ['近战击范围', SKILLS.leap.radius + ''],
          ['冷却时间', SKILLS.leap.cd + ' 秒'],
          ['容量', '1'],
          ['控制时长', LEAP.root + ' 秒'],
        ],
        tags: ['技能近战击', '技能控制'],
      };
    }
    return {
      rows: [
        ['冷却时间', SKILLS.stone.cd + ' 秒'],
        ['容量', '1'],
        ['增益加成', '减伤 +' + Math.round(STONE.dr * 100) + '%'],
        ['减益加成', '移速 −' + Math.round((1 - STONE.speedMult) * 100) + '%'],
        ['增益时间', STONE.duration + ' 秒'],
        ['减益时间', STONE.duration + ' 秒'],
      ],
      tags: ['自身增益'],
    };
  }

  private showSkillTip(card: HTMLElement, id: string): void {
    const def = SKILLS[id];
    const info = this.skillRows(id);
    const rows = info.rows
      .map(([k, v]) => `<div class="tip-row"><span>${k}</span><b>${v}</b></div>`)
      .join('');
    const desc = def.desc.replace(/\[\[(.+?)\]\]/g, '<span class="tip-tag">$1</span>');
    this.tip.innerHTML = `<h4>${def.name}</h4><div class="tip-desc">${desc}</div>${rows}`;

    const r = card.getBoundingClientRect();
    const stage = document.getElementById('stage')!.getBoundingClientRect();
    this.tip.classList.remove('hidden');
    this.tip.style.left = r.left - stage.left + 'px';
    this.tip.style.top = r.top - stage.top - this.tip.offsetHeight - 10 + 'px';
  }

  private build(_world: World): void {
    this.built = true;
  }

  handleEvents(events: WorldEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'waveStart':
          this.toast(`第 ${ev.n} 波 · 域兽来袭`);
          break;
        case 'waveClear':
          this.toast(`第 ${ev.n} 波 · 净化完成`);
          break;
        case 'crystalDown':
          this.toast('净化水晶被摧毁 · 域兽狂暴');
          break;
        case 'playerDown':
          this.toast('域卫倒下');
          break;
        case 'victory':
          this.toast('净化成功');
          break;
        case 'defeat':
          this.toast('升华水晶破碎');
          break;
        default:
          break;
      }
    }
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.4;
  }

  update(world: World, dt: number): void {
    if (!this.built) this.build(world);
    if (!this.tipReady) this.setupSkillTip();
    if (!this.fTextReady) {
      this.cdFText.className = 'skill-cd-text';
      this.skillF.appendChild(this.cdFText);
      this.fTextReady = true;
    }
    const p = world.player;

    if (this.heroShown !== world.heroId) {
      this.heroShown = world.heroId;
      this.heroName.textContent = '域卫';
      this.ammoLabel.textContent = '电磁炮';
      this.skillQ.style.display = 'flex';
      this.skillE.style.display = 'flex';
      this.skillF.style.display = 'flex';
      this.skillQName.textContent = '黑洞雷';
      this.skillEName.textContent = '陨落';
      this.skillFName.textContent = '磐石护体';
      this.skillRmb.style.display = 'none';
      this.formLine.style.display = 'none';
      this.ammoEl.style.display = world.player.weaponId === 'shield' ? 'none' : 'flex';
      this.reloadText.style.display = '';
      this.keyHints.innerHTML =
        '<b>左键</b>开火　<b>R</b>换弹　<b>Tab</b>塑造　<b>Esc</b>菜单　<b>空格</b>跳过';
    }

    // 生命
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    const hpFrac = Math.max(0, p.hp / p.maxHp);
    this.hpBar.style.width = `${hpFrac * 100}%`;
    this.hpBar.parentElement?.classList.toggle('low', hpFrac < 0.32);

    // 弹药
    if (this.lastMag !== p.magSize) {
      this.lastMag = p.magSize;
      this.ammoEl.innerHTML = '';
      for (let i = 0; i < p.magSize; i++) this.ammoEl.appendChild(document.createElement('i'));
    }
    const pips = this.ammoEl.children;
    for (let i = 0; i < pips.length; i++) {
      (pips[i] as HTMLElement).classList.toggle('empty', i >= p.ammo);
    }
    if (p.weaponId === 'shield') {
      this.ammoLabel.textContent = '陨盾';
      this.reloadText.textContent =
        p.meteorT > 0 ? `陨星 ${p.meteorT.toFixed(1)}s` : `耐久 ${Math.round(p.shieldHp)}%`;
    } else {
      this.ammoLabel.textContent = '电磁炮';
      this.reloadText.textContent = p.reloading ? `换弹 ${p.reloadT.toFixed(1)}s` : '';
    }

    // 护盾
    const maxShield = 60;
    if (p.shield > 0.5) {
      this.shieldWrap.classList.remove('hidden');
      this.shieldBar.style.width = Math.min(100, (p.shield / maxShield) * 100) + '%';
    } else {
      this.shieldWrap.classList.add('hidden');
    }

    // 体力
    const maxSt = world.hero.maxStamina;
    if (this.lastStamina !== maxSt) {
      this.lastStamina = maxSt;
      this.staminaEl.innerHTML = '';
      for (let i = 0; i < maxSt; i++) this.staminaEl.appendChild(document.createElement('i'));
    }
    const spips = this.staminaEl.children;
    for (let i = 0; i < spips.length; i++) {
      (spips[i] as HTMLElement).classList.toggle('empty', i >= Math.floor(p.stamina));
    }

    // 波次
    const w = world.wave;
    this.skipHint.classList.toggle('show', w.phase === 'intermission');
    if (w.phase === 'intermission') {
      if (w.n === 0) {
        this.waveTitle.textContent = '准备阶段';
        this.waveSub.textContent = `域兽将于 ${Math.ceil(w.timer)} 秒后抵达`;
      } else {
        this.waveTitle.textContent = `第 ${w.n} 波 · 完成`;
        this.waveSub.textContent = `下一波 ${Math.ceil(w.timer)} 秒后`;
      }
    } else {
      this.waveTitle.textContent = `第 ${w.n} 波`;
      this.waveSub.textContent =
        w.phase === 'spawning' ? '域兽正在涌入' : `剩余 ${world.remainingEnemies()} 只`;
    }

    // 域币
    this.coinsEl.textContent = String(p.coins);

    // 技能冷却（Q/E/F）
    const skills = p.skills;
    const cds = p.skillCd;
    const setCard = (card: HTMLElement, bar: HTMLElement, text: HTMLElement, idx: number) => {
      const id = skills[idx];
      const def = id ? SKILLS[id] : null;
      const cd = cds[idx] ?? 0;
      const frac = def ? Math.min(1, cd / def.cd) : 0;
      bar.style.height = `${frac * 100}%`;
      text.textContent = cd > 0 ? cd.toFixed(1) : '';
      card.classList.toggle('ready', cd <= 0 && !!def);
    };
    setCard(this.skillQ, this.cdQ, this.cdQText, 0);
    setCard(this.skillE, this.cdE, this.cdEText, 1);
    setCard(this.skillF, this.cdF, this.cdFText, 2);

    // 中央提示
    let msg = '';
    if (world.state === 'playing') {
      if (!p.alive) msg = `域卫倒下 · ${Math.ceil(p.respawnT)} 秒后归位`;
      else if (p.panelOpen) msg = '成长面板开启 · 无法攻击';
    }
    if (msg) {
      this.centerEl.textContent = msg;
      this.centerEl.classList.add('show');
    } else {
      this.centerEl.classList.remove('show');
    }

    // toast 计时
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
