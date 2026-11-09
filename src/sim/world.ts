import {
  CRYSTAL,
  ENEMIES,
  FIRST_PREP,
  HERO_PROFILES,
  KILLS_PER_POINT,
  LEVEL,
  POINTS_PER_WAVE,
  COIN_PER_KILL,
  COIN_PER_WAVE,
  SKILLS,
  BLACKHOLE,
  LEAP,
  STONE,
  SKILL_SHAPES,
  BLACKHOLE_SHAPE,
  LEAP_SHAPE,
  RECOIL,
  IMPACT,
  STONE_SHAPE,
  ROLL,
  PREP_TIME,
  TOTAL_WAVES,
  RAIL_WEAPON,
  RAIL_SHAPE,
  SHIELD_WEAPON,
  WEAPON_SHAPES,
  buildWave,
  waveHpScale,
  waveDmgScale,
  waveSpeedScale,
} from '../content/defs';
import type { EnemyKind, HeroId, HeroProfile, ShapeDef } from '../content/defs';
import type { CCKind, GameState, InputSnapshot, TagSource } from '../shared/types';
import type { Vec } from '../shared/util';
import { angleDiff, angleTo, clamp, dist, inFan, lerp, norm, rand, segmentCircle } from '../shared/util';
import type {
  Zone,
  Bottle,
  Crystal,
  Enemy,
  EnemyShot,
  Grenade,
  Laser,
  Player,
  WaveState,
  WorldEvent,
} from './types';

const CHASE_HOLD = 2.2;
const CHASE_RANGE = 130;

export class World {
  heroId: HeroId;
  hero: HeroProfile;
  state: GameState = 'playing';
  time = 0;
  /** 联机：本地玩家在 players 中的下标 */
  localIndex = 0;

  /** 所有玩家（联机时多个） */
  players: Player[] = [];
  /** 当前正在结算的玩家（内部用） */
  private actor: Player | null = null;

  /** 兼容旧代码：默认指第一个玩家 */
  get player(): Player {
    return this.actor ?? this.players[this.localIndex] ?? this.players[0];
  }
  enemies: Enemy[] = [];
  lasers: Laser[] = [];
  zones: Zone[] = [];
  private zoneId = 0;
  /** 斥爆触发冷却剩余 */
  private detonateCd = 0;
  /** 状况加深触发冷却 */
  private deepenCd = 0;
  shots: EnemyShot[] = [];
  grenades: Grenade[] = [];
  bottles: Bottle[] = [];
  crystals: Crystal[] = [];
  events: WorldEvent[] = [];
  wave: WaveState;
  shake = 0;
  nextId = 1;
  totalKills = 0;

  constructor(heroId: HeroId = 'guard', weaponId: 'railgun' | 'shield' = 'railgun') {
    this.heroId = heroId;
    this.hero = HERO_PROFILES[heroId];
    this.players.push({
      heroId,
      pos: { ...LEVEL.start },
      vel: { x: 0, y: 0 },
      aim: 0,
      hp: this.hero.maxHp,
      maxHp: this.hero.maxHp,
      ammo: RAIL_WEAPON.magSize,
      magSize: RAIL_WEAPON.magSize,
      reloading: false,
      reloadT: 0,
      reloadTotal: 0,
      fireCd: 0,
      qCd: 0,
      eCd: 0,
      qCdMax: 1,
      eCdMax: 1,
      mode: 'none',
      throwTarget: null,
      panelOpen: false,
      points: 0,
      coins: 0,
      shapes: {},
      aiming: false,
      rollT: 0,
      rollDir: { x: 0, y: 0 },
      stamina: HERO_PROFILES.guard.maxStamina,
      rollIframe: 0,
      skills: ['blackhole', 'leap', 'stone'],
      skillCd: [0, 0, 0],
      stoneT: 0,
      skillShapes: {},
      zoneBuffT: 0,
      shield: 0,
      eggT: 0,
      eggTotal: 0,
      weaponId,
      shieldAngle: 0,
      shieldHp: SHIELD_WEAPON.durabilityMax,
      meteorT: 0,
      bashCd: 0,
      dragX: 0,
      dragY: 0,
      dragging: false,
      fireHeldPrev: false,
      leapT: 0,
      leapFrom: { x: 0, y: 0 },
      leapTo: { x: 0, y: 0 },
      leapHangT: 0,
      leapHung: 0,
      leapBonus: 0,
      landT: 0,
      leapArmed: false,
      rollHits: [],
      nodes: {},
      killCount: 0,
      killFrac: 0,
      invuln: 0,
      alive: true,
      respawnT: 0,
      hurtFlash: 0,
      totalDamage: 0,
      shotsFired: 0,
      fireLocked: false,
      altHeldPrev: false,
      charge: 0,
      burstLeft: 0,
      burstTimer: 0,
      burstPierce: false,
    });

    const names = ['一', '二', '三'];
    this.crystals = LEVEL.crystalPathIndex.map((idx, i) => ({
      id: 'purify' + i,
      name: '净化水晶 · ' + (names[i] ?? String(i + 1)),
      kind: 'purify' as const,
      pos: { ...LEVEL.path[idx] },
      hp: CRYSTAL.purifyHp,
      maxHp: CRYSTAL.purifyHp,
      radius: CRYSTAL.purifyRadius,
      pathIndex: idx,
      alive: true,
      hitFlash: 0,
      healPulse: 0,
    }));
    this.crystals.push({
      id: 'ascension',
      name: '升华水晶',
      kind: 'ascension',
      pos: { ...LEVEL.path[LEVEL.ascensionPathIndex] },
      hp: CRYSTAL.ascensionHp,
      maxHp: CRYSTAL.ascensionHp,
      radius: CRYSTAL.ascensionRadius,
      pathIndex: LEVEL.ascensionPathIndex,
      alive: true,
      hitFlash: 0,
      healPulse: 0,
    });

    this.wave = { n: 0, phase: 'intermission', timer: FIRST_PREP, queue: [], spawnTimer: 0 };
    this.player.magSize = RAIL_WEAPON.magSize;
    this.player.ammo = RAIL_WEAPON.magSize;
  }

  /* ================= 主循环 ================= */

  tick(inputs: InputSnapshot | InputSnapshot[], dt: number): void {
    if (this.state !== 'playing') return;
    const list = Array.isArray(inputs) ? inputs : [inputs];
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 14);

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      this.actor = p;
      this.updatePlayer(list[i] ?? list[0], dt);
      this.actor = null;
      // 单机：打开面板时暂停世界
      if (p.panelOpen) return;
    }

    this.updateEnemies(dt);
    this.updateLasers(dt);
    if (this.detonateCd > 0) this.detonateCd = Math.max(0, this.detonateCd - dt);
    if (this.deepenCd > 0) this.deepenCd = Math.max(0, this.deepenCd - dt);
    this.updateZones(dt);
    this.updateGrenades(dt);
    this.updateBottles(dt);
    this.updateShots(dt);
    this.updateCrystals(dt);
    this.updateWave(dt, list[0]);

    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  /* ================= 玩家 ================= */

  updatePlayer(input: InputSnapshot, dt: number): void {
    const p = this.player;

    if (input.panel) {
      p.panelOpen = !p.panelOpen;
      p.mode = 'none';
      p.throwTarget = null;
    }

    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) this.respawnPlayer();
      return;
    }

    if (p.panelOpen) {
      p.mode = 'none';
      p.throwTarget = null;
      return;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3.5);
    p.qCd = Math.max(0, p.qCd - dt);
    p.eCd = Math.max(0, p.eCd - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
    if (p.landT > 0) p.landT = Math.max(0, p.landT - dt);
    p.bashCd = Math.max(0, p.bashCd - dt);

    if (p.reloading) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) this.finishReload();
    }

    if (!input.fireHeld && !input.firePressed) p.fireLocked = false;

    // 陨石坠：空中阶段
    // 移动（石卵包裹期间无法移动）
    const len = Math.hypot(input.moveX, input.moveY);
    if (len > 0.01 && p.eggT <= 0) {
      const zoneBuff = p.zoneBuffT > 0 ? 1 + BLACKHOLE_SHAPE.buffSpeed : 1;
      const stoneSlow = p.stoneT > 0 ? STONE.speedMult : 1;
      const spd = this.hero.speed * stoneSlow * zoneBuff;
      p.pos.x += (input.moveX / len) * spd * dt;
      p.pos.y += (input.moveY / len) * spd * dt;
    }
    p.pos.x = clamp(p.pos.x, 10, LEVEL.width - 10);
    p.pos.y = clamp(p.pos.y, LEVEL.road.top + 16, LEVEL.road.bottom - 10);

    p.aim = angleTo(p.pos, { x: input.aimX, y: input.aimY });

    if (p.panelOpen) {
      // 面板打开：整局暂停（连冷却/计时都停）
      p.mode = 'none';
      p.throwTarget = null;
      return;
    }

    this.updateGuard(input, dt);
  }

  /* ---------------- 三华求御 ---------------- */


  /** 磐石冲击：磐石护体期间翻滚，撞到的敌人受伤并被击退 */
  rollImpact(): void {
    const p = this.player;
    if (p.stoneT <= 0) return;
    if (!this.hasSkillShape('stone', 'impact')) return;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      this.actor = this.nearestPlayer(e.pos);
      if (p.rollHits.includes(e.id)) continue;
      if (dist(e.pos, p.pos) > IMPACT.radius + e.radius) continue;
      p.rollHits.push(e.id);
      this.damageEnemy(e, IMPACT.damage);
      if (e.hp <= 0) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      this.applyCC(e, 'knockback', { x: dx / d, y: dy / d }, IMPACT.knock, IMPACT.knockTime, false);
      this.events.push({ type: 'stoneImpact', x: e.pos.x, y: e.pos.y });
    }
  }

  /* ---------------- 陨盾（近战） ---------------- */

  inShieldArc(pos: Vec, half: number, radius: number): boolean {
    const p = this.player;
    const d = dist(p.pos, pos);
    if (d > radius) return false;
    return Math.abs(angleDiff(angleTo(p.pos, pos), p.shieldAngle)) <= half;
  }

  breakShield(): void {
    const p = this.player;
    if (this.hasShape('shield', 'unyield')) {
      p.shieldHp = 1;
      return;
    }
    p.shieldHp = 0;
    p.meteorT = SHIELD_WEAPON.meteorTime;
    this.events.push({ type: 'shieldBreak', x: p.pos.x, y: p.pos.y });
    this.shake = Math.max(this.shake, 6);
  }

  /** 抵挡一次伤害，返回实际伤害 */
  absorbShield(pos: Vec, dmg: number, radius = SHIELD_WEAPON.blockRadius): number {
    const p = this.player;
    if (p.meteorT > 0 || p.shieldHp <= 0) return dmg;
    if (!this.inShieldArc(pos, SHIELD_WEAPON.blockHalf, radius)) return dmg;
    p.shieldHp = Math.max(0, p.shieldHp - SHIELD_WEAPON.durPerHit);
    if (p.shieldHp <= 0) this.breakShield();
    this.events.push({ type: 'shieldBlock', x: pos.x, y: pos.y });
    return dmg * (1 - SHIELD_WEAPON.blockDR);
  }

  /** 底盾：扇形是否压在脚下的圆形抵挡范围上 */
  groundOverlapsFan(e: Enemy): boolean {
    const fan = ENEMIES[e.kind].fan;
    const p = this.player;
    if (!fan) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = p.pos.x + Math.cos(a) * SHIELD_WEAPON.groundRadius;
      const y = p.pos.y + 3 + Math.sin(a) * SHIELD_WEAPON.groundRadius;
      if (inFan(e.pos.x, e.pos.y, e.windupAngle, fan.halfAngle, fan.radius, x, y, 2)) return true;
    }
    return false;
  }

  /** 攻击的扇形是否压在盾面上（不看方向来源，只看范围是否重叠） */
  shieldOverlapsFan(e: Enemy): boolean {
    const fan = ENEMIES[e.kind].fan;
    const p = this.player;
    if (!fan) return false;

    for (let i = -2; i <= 2; i++) {
      const a = p.shieldAngle + (i / 2) * SHIELD_WEAPON.blockHalf;
      for (const r of [10, 26, 44]) {
        const x = p.pos.x + Math.cos(a) * r;
        const y = p.pos.y + Math.sin(a) * r;
        if (inFan(e.pos.x, e.pos.y, e.windupAngle, fan.halfAngle, fan.radius, x, y, 2)) {
          return true;
        }
      }
    }
    return false;
  }

  /** 只扣耐久与减伤，不做方向判定（供范围重叠类攻击使用） */
  absorbHit(dmg: number): number {
    const p = this.player;
    if (p.meteorT > 0 || p.shieldHp <= 0) return dmg;
    p.shieldHp = Math.max(0, p.shieldHp - SHIELD_WEAPON.durPerHit);
    if (p.shieldHp <= 0) this.breakShield();
    this.events.push({ type: 'shieldBlock', x: p.pos.x, y: p.pos.y });
    return dmg * (1 - SHIELD_WEAPON.blockDR);
  }

  updateShield(input: InputSnapshot, dt: number): void {
    const p = this.player;

    // 右键按住：盾牌缓慢转向鼠标方向
    if (input.altHeld) {
      const target = angleTo(p.pos, { x: input.aimX, y: input.aimY });
      const diff = angleDiff(target, p.shieldAngle);
      const step = SHIELD_WEAPON.rotateSpeed * dt;
      p.shieldAngle += Math.max(-step, Math.min(step, diff));
    }

    const broken = p.meteorT > 0;
    const interval = broken ? SHIELD_WEAPON.elbowInterval : SHIELD_WEAPON.interval;
    const cost = SHIELD_WEAPON.staminaCost;

    // 左键：盾击 / 肘击
    if (input.firePressed && p.fireCd <= 0 && p.stamina >= cost) {
      p.fireCd = interval;
      p.stamina -= cost;
      this.doBash(broken);
    }
  }

  doBash(broken: boolean): void {
    const p = this.player;
    const cfg = SHIELD_WEAPON;
    const range = broken ? cfg.elbowRange : cfg.range;
    const half = broken ? cfg.elbowHalf : cfg.half;
    const dmg = broken ? cfg.elbowDamage : cfg.damage;
    const knock = broken ? cfg.elbowKnock : cfg.knock;

    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (!this.inShieldArc(e.pos, half, range + e.radius)) continue;
      this.damageEnemy(e, dmg);
      if (e.hp <= 0) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      this.applyCC(e, 'knockback', { x: dx / d, y: dy / d }, knock, cfg.knockTime, false);
    }
    // 斥爆：近战击命中引力范围也会引爆
    if (this.hasSkillShape('blackhole', 'detonate') && this.detonateCd <= 0) {
      const z = this.blackholeZone();
      if (z) {
        const d = dist(p.pos, z.pos);
        const inAngle = Math.abs(angleDiff(angleTo(p.pos, z.pos), p.shieldAngle)) <= half + 0.35;
        if (d <= range + z.radius && inAngle) {
          this.explodeAt(z.pos.x, z.pos.y, BLACKHOLE_SHAPE.blastRadius, BLACKHOLE_SHAPE.blastDamage);
          this.events.push({ type: 'detonate', x: z.pos.x, y: z.pos.y });
          this.detonateCd = BLACKHOLE_SHAPE.blastCd;
        }
      }
    }

    if (broken) {
      this.events.push({ type: 'elbow', x: p.pos.x, y: p.pos.y, angle: p.shieldAngle, range, half });
    } else {
      this.events.push({ type: 'shieldBash', x: p.pos.x, y: p.pos.y, angle: p.shieldAngle, range, half });
    }
    this.shake = Math.max(this.shake, 3);
  }

  /* ---------------- 域卫（通用） ---------------- */

  /** 状态计时：面板打开时也会继续走 */
  tickStatus(dt: number): void {
    const p = this.player;
    for (let i = 0; i < p.skillCd.length; i++) p.skillCd[i] = Math.max(0, p.skillCd[i] - dt);
    if (p.stoneT > 0) p.stoneT = Math.max(0, p.stoneT - dt);
    if (p.zoneBuffT > 0) {
      p.zoneBuffT = Math.max(0, p.zoneBuffT - dt);
      p.hp = Math.min(p.maxHp, p.hp + BLACKHOLE_SHAPE.buffRegen * dt);
    }
    p.stamina = Math.min(this.hero.maxStamina, p.stamina + this.hero.staminaRegen * dt);
    if (p.rollIframe > 0) p.rollIframe = Math.max(0, p.rollIframe - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);

    // 陨星状态计时（结束后陨盾重新凝聚）
    if (p.meteorT > 0) {
      p.meteorT = Math.max(0, p.meteorT - dt);
      if (p.meteorT === 0 && p.weaponId === 'shield') {
        p.shieldHp = SHIELD_WEAPON.durabilityMax;
        this.events.push({ type: 'shieldRestore', x: p.pos.x, y: p.pos.y });
      }
    }
    if (p.meteorT > 0 && this.hasShape('shield', 'safety')) {
      p.hp = Math.min(p.maxHp, p.hp + 5 * dt);
    }
  }

  /** 所有武器共用：计时、体力、翻滚、跃迁、技能 */
  updateCommon(input: InputSnapshot, dt: number): boolean {
    const p = this.player;
    p.aiming = input.altHeld;
    this.tickStatus(dt);

    // 石卵
    if (p.eggT > 0) {
      if (input.skillF) {
        p.eggT = 0;
        p.eggTotal = 0;
        p.stoneT = 0;
        return true;
      }
      p.eggT = Math.max(0, p.eggT - dt);
      return true;
    }

    // 翻滚
    if (p.rollT > 0) {
      p.rollT = Math.max(0, p.rollT - dt);
      p.pos.x += p.rollDir.x * ROLL.speed * dt;
      p.pos.y += p.rollDir.y * ROLL.speed * dt;
      this.clampToLane();
      this.rollImpact();
      return true;
    }
    if (input.rollPressed && p.stamina >= ROLL.cost) {
      let dx = input.moveX;
      let dy = input.moveY;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) {
        dx = Math.cos(p.aim);
        dy = Math.sin(p.aim);
      } else {
        dx /= len;
        dy /= len;
      }
      p.rollDir = { x: dx, y: dy };
      p.rollHits = [];
      p.rollT = ROLL.duration;
      p.rollIframe = ROLL.iframe;
      p.stamina -= ROLL.cost;
      this.events.push({ type: 'roll', x: p.pos.x, y: p.pos.y });
      return true;
    }

    // 后坐力：滞空
    if (p.leapHangT > 0) {
      if (this.hasSkillShape('leap', 'recoil')) {
        p.leapHangT = Math.max(0, p.leapHangT - dt);
        p.leapHung += dt;
        // 微调落点：直接移动角色（落地位置 = 当前所在），避免瞬移
        const drift = 52 * dt;
        p.pos.x = clamp(p.pos.x + Math.cos(p.aim) * drift, 20, LEVEL.width - 20);
        p.pos.y = clamp(p.pos.y + Math.sin(p.aim) * drift, LEVEL.road.top + 12, LEVEL.road.bottom - 12);
        p.leapTo.x = p.pos.x;
        p.leapTo.y = p.pos.y;
        if (p.leapHangT <= 0) {
          this.clampToLane();
          this.landLeap();
        }
        this.handleWeapon(input, dt);
        return true;
      }
      p.leapHangT = 0;
    }

    // 跃迁滞空
    if (p.leapT > 0) {
      // 后坐力：空中攻击则滞留
      if (!input.fireHeld) p.leapArmed = true;
      if (
        this.hasSkillShape('leap', 'recoil') &&
        p.leapArmed &&
        input.firePressed &&
        p.leapHung <= 0
      ) {
        p.leapHangT = RECOIL.maxHang;
        p.leapT = 0;
        this.handleWeapon(input, dt);
        return true;
      }
      p.leapT = Math.max(0, p.leapT - dt);
      const k = Math.min(1, 1 - p.leapT / LEAP.airTime);
      p.pos.x = lerp(p.leapFrom.x, p.leapTo.x, k);
      p.pos.y = lerp(p.leapFrom.y, p.leapTo.y, k);
      if (p.leapT <= 0) this.landLeap();
      this.handleWeapon(input, dt);
      return true;
    }

    // 技能预瞄
    if (p.mode === 'throw' || p.mode === 'leapaim') {
      p.charge = 0;
      const maxR = p.mode === 'throw' ? SKILLS.blackhole.range! : SKILLS.leap.range!;
      p.throwTarget = this.aimPoint(input, maxR);
      if (input.altPressed) {
        p.mode = 'none';
        p.throwTarget = null;
        return true;
      }
      if (input.firePressed && p.throwTarget) {
        if (p.mode === 'throw') {
          this.grenades.push({
            from: { x: p.pos.x, y: p.pos.y },
            to: { x: p.throwTarget.x, y: p.throwTarget.y },
            t: 0,
            dur: 0.45,
          });
          this.events.push({ type: 'throwCast', x: p.pos.x, y: p.pos.y, angle: p.aim });
          p.skillCd[0] = SKILLS.blackhole.cd;
        } else {
          p.leapFrom = { x: p.pos.x, y: p.pos.y };
          p.leapTo = { x: p.throwTarget.x, y: p.throwTarget.y };
          p.leapT = LEAP.airTime;
          p.leapArmed = false;
          p.skillCd[1] = SKILLS.leap.cd;
        }
        p.mode = 'none';
        p.throwTarget = null;
      }
      return true;
    }

    // 石卵：磐石护体持续期间再按 F
    if (input.skillF && p.stoneT > 0 && this.hasSkillShape('stone', 'eggshell')) {
      p.eggT = p.stoneT;
      p.eggTotal = STONE.duration;
      p.stoneT = 0;
      this.events.push({ type: 'egg', x: p.pos.x, y: p.pos.y });
      return true;
    }

    // 白扩：引力范围存在时再按 Q
    if (input.skillQ && this.hasSkillShape('blackhole', 'whiteout')) {
      const z = this.blackholeZone();
      if (z) {
        this.whiteout(z);
        return true;
      }
    }

    // 技能键
    const slot = input.skillQ ? 0 : input.skillE ? 1 : input.skillF ? 2 : -1;
    if (slot >= 0 && p.skillCd[slot] <= 0) {
      const id = p.skills[slot];
      if (id === 'blackhole') {
        p.charge = 0;
        p.mode = 'throw';
        p.throwTarget = this.aimPoint(input, SKILLS.blackhole.range!);
        return true;
      }
      if (id === 'leap') {
        p.charge = 0;
        p.mode = 'leapaim';
        p.throwTarget = this.aimPoint(input, SKILLS.leap.range!);
        return true;
      }
      if (id === 'stone') {
        p.stoneT = STONE.duration;
        p.skillCd[slot] = SKILLS.stone.cd;
        this.events.push({ type: 'stone', x: p.pos.x, y: p.pos.y });
        return true;
      }
    }

    return false;
  }

  updateGuard(input: InputSnapshot, dt: number): void {
    if (this.updateCommon(input, dt)) return;
    this.handleWeapon(input, dt);
  }

  /** 武器开火（跃迁 / 滞空时也会调用） */
  handleWeapon(input: InputSnapshot, dt: number): void {
    const p = this.player;

    if (p.weaponId === 'shield') {
      this.updateShield(input, dt);
      return;
    }

    // 电磁炮：换弹与开火
    if (input.reloadPressed && !p.reloading && p.ammo < p.magSize) {
      p.reloading = true;
      p.reloadTotal = RAIL_WEAPON.reload;
      p.reloadT = RAIL_WEAPON.reload;
    }

    const hasCharge = this.shapeLevel('charge') > 0;
    const canFire = !p.reloading && p.ammo > 0 && p.fireCd <= 0;

    if (!hasCharge) {
      if (input.firePressed && canFire) this.fireRail(0);
      return;
    }

    if (input.fireHeld && !p.reloading && p.ammo > 0) {
      p.charge = Math.min(5, p.charge + dt);
      return;
    }
    if (p.charge > 0.02) {
      if (canFire) this.fireRail(Math.min(1, p.charge / 5));
      p.charge = 0;
    }
  }

  /** 角色当前的视觉高度（空中） */
  playerLift(): number {
    const p = this.player;
    if (p.leapHangT > 0) return 30;
    if (p.leapT > 0) {
      const k = 1 - p.leapT / LEAP.airTime;
      return Math.sin(Math.min(1, k) * Math.PI * 0.9) * 26;
    }
    if (p.landT > 0) return 30 * (p.landT / 0.18);
    return 0;
  }

  /** 把鼠标位置限制在射程内 */
  aimPoint(input: InputSnapshot, maxRange: number): Vec {
    const p = this.player;
    const dx = input.aimX - p.pos.x;
    const dy = input.aimY - p.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      return { x: p.pos.x + Math.cos(p.aim) * maxRange, y: p.pos.y + Math.sin(p.aim) * maxRange };
    }
    const k = Math.min(1, maxRange / d);
    return { x: p.pos.x + dx * k, y: p.pos.y + dy * k };
  }

  clampToLane(): void {
    const p = this.player;
    p.pos.x = clamp(p.pos.x, 14, LEVEL.width - 14);
    p.pos.y = clamp(p.pos.y, LEVEL.road.top + 8, LEVEL.road.bottom - 8);
  }

  updateGrenades(dt: number): void {
    for (const g of this.grenades) {
      g.t += dt;
      if (g.t >= g.dur) {
        this.spawnZone(g.to);
      }
    }
    this.grenades = this.grenades.filter((g) => g.t < g.dur);
  }

  grenadePos(g: Grenade): Vec {
    const k = Math.min(1, g.t / g.dur);
    return {
      x: lerp(g.from.x, g.to.x, k),
      y: lerp(g.from.y, g.to.y, k) - Math.sin(k * Math.PI) * 30,
    };
  }

  /** 白扩：立即引爆引力范围 */
  whiteout(z: Zone): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist(e.pos, z.pos) > z.radius + e.radius) continue;
      this.damageEnemy(e, BLACKHOLE_SHAPE.whiteoutDamage);
      if (e.hp <= 0) continue;
      const dx = e.pos.x - z.pos.x;
      const dy = e.pos.y - z.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      this.applyCC(
        e,
        'knockback',
        { x: dx / d, y: dy / d },
        BLACKHOLE_SHAPE.whiteoutKnock,
        BLACKHOLE_SHAPE.whiteoutKnockTime,
        false,
      );
    }
    z.ttl = 0;
    this.events.push({ type: 'whiteout', x: z.pos.x, y: z.pos.y });
    this.shake = Math.max(this.shake, 4);
    void p;
  }

  /** 斥爆：武器飞行物进入引力范围时引爆 */
  checkDetonate(l: Laser): boolean {
    if (this.detonateCd > 0) return false;
    if (!this.hasSkillShape('blackhole', 'detonate')) return false;
    if (l.tag !== 'flight') return false;
    const z = this.blackholeZone();
    if (!z) return false;
    if (dist(l.pos, z.pos) > z.radius) return false;
    // 从引力范围中心向外扩散
    this.explodeAt(z.pos.x, z.pos.y, BLACKHOLE_SHAPE.blastRadius, BLACKHOLE_SHAPE.blastDamage);
    this.events.push({ type: 'detonate', x: z.pos.x, y: z.pos.y });
    this.detonateCd = BLACKHOLE_SHAPE.blastCd;
    return true;
  }

  /** 把范围内的敌人朝中心拉一段（技能控制） */
  pullEnemies(z: Zone): void {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist(e.pos, z.pos) > z.radius + e.radius) continue;
      const dx = z.pos.x - e.pos.x;
      const dy = z.pos.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      this.applyCC(e, 'pull', { x: dx / d, y: dy / d }, BLACKHOLE.pull / BLACKHOLE.pullTime, BLACKHOLE.pullTime, false);
    }
  }

  spawnZone(pos: Vec): void {
    this.zones.push({
      id: ++this.zoneId,
      owner: 'player',
      pos: { x: pos.x, y: pos.y },
      radius: BLACKHOLE.radius,
      ttl: BLACKHOLE.duration,
      maxTtl: BLACKHOLE.duration,
      tick: BLACKHOLE.tickInterval,
      blastLock: 0,
      pulse: 0,
    });
    this.events.push({ type: 'throwLand', x: pos.x, y: pos.y });
    const z = this.zones[this.zones.length - 1];
    if (z) this.pullEnemies(z);
  }

  updateZones(dt: number): void {
    for (const z of this.zones) {
      z.ttl -= dt;
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = z.poison ? (z.interval ?? 0.7) : BLACKHOLE.tickInterval;
        if (z.poison) {
          const p = this.player;
          if (p.alive && dist(p.pos, z.pos) <= z.radius + this.hero.radius) {
            let dmg = z.damage ?? 7;
            // 底盾：范围区落在脚下的圆形抵挡范围内 → 伤害减少
            if (p.weaponId === 'shield' && this.hasShape('shield', 'ground')) {
              if (dist(p.pos, z.pos) <= z.radius + SHIELD_WEAPON.groundRadius) {
                dmg *= 1 - SHIELD_WEAPON.groundDR;
              }
            }
            this.damagePlayer(dmg, z.pos);
          }
          continue;
        }
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (dist(e.pos, z.pos) > z.radius + e.radius) continue;
          this.damageEnemy(e, BLACKHOLE.tickDamage);
        }
        this.pullEnemies(z);
      }
    }
    if (this.hasSkillShape('blackhole', 'overflow')) {
      const p = this.player;
      const z = this.blackholeZone();
      if (z && dist(p.pos, z.pos) <= z.radius) p.zoneBuffT = 0.2;
    }
    this.zones = this.zones.filter((z) => z.ttl > 0);
  }

  landLeap(): void {
    const p = this.player;
    const bonus = Math.min(0.4, (p.leapHung / RECOIL.maxHang) * RECOIL.gainPerSec * 2);
    const radius = SKILLS.leap.radius! * (1 + bonus * 0.5);
    this.explodeAt(p.pos.x, p.pos.y, radius, LEAP.damage * (1 + bonus));
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist(e.pos, p.pos) > radius + e.radius) continue;
      e.rootT = Math.max(e.rootT, LEAP.root * (1 + bonus * 0.8));
      e.rootBonus = 1 + bonus;
    }
    p.leapHung = 0;
    p.leapBonus = bonus;
    p.leapHangT = 0;
    p.leapT = 0;
    p.landT = 0.18;
    // 斥爆：近战击（陨落落地）命中引力范围也会引爆
    if (this.hasSkillShape('blackhole', 'detonate') && this.detonateCd <= 0) {
      const z = this.blackholeZone();
      if (z && dist(p.pos, z.pos) <= radius + z.radius) {
        this.explodeAt(z.pos.x, z.pos.y, BLACKHOLE_SHAPE.blastRadius, BLACKHOLE_SHAPE.blastDamage);
        this.events.push({ type: 'detonate', x: z.pos.x, y: z.pos.y });
        this.detonateCd = BLACKHOLE_SHAPE.blastCd;
      }
    }

    this.events.push({ type: 'leapLand', x: p.pos.x, y: p.pos.y });
    this.shake = Math.max(this.shake, 5);
  }

  /* ---------------- 陨主 ---------------- */

  railStats(): { damage: number; range: number; blast: number; chargeK: number } {
    const p = this.player;
    const w = RAIL_WEAPON;
    const mult = 1;
    const ck = 0;
    return {
      damage: w.damage * mult * (1 + ck * 1.0),
      range: w.range * (1 + ck * 0.5),
      blast: 0,
      chargeK: ck,
    };
  }

  fireRail(chargeK = 0): void {
    const p = this.player;
    const w = RAIL_WEAPON;
    if (p.reloading || p.ammo <= 0) return;

    const k = Math.max(0, Math.min(1, chargeK));
    const damage = w.damage * (1 + k * 1.5);
    const radius = w.bulletRadius * (1 + k * 0.8);
    const range = w.range * (1 + k * 0.35);
    const offsets = [p.aim];
    const lift = this.playerLift();
    const pierce = this.shapeLevel('pierce') > 0 ? 999 : 0;

    for (const a2 of offsets) {
      const dx = Math.cos(a2);
      const dy = Math.sin(a2);
      this.lasers.push({
        pos: { x: p.pos.x + dx * 16, y: p.pos.y + dy * 16 },
        vel: { x: dx * w.bulletSpeed, y: dy * w.bulletSpeed },
        angle: a2,
        damage,
        pierce,
        hitIds: [],
        life: Math.max(0, range - 16) / w.bulletSpeed,
        travel: 0,
        blast: 0,
        radius,
        orb: true,
        tag: 'flight',
        lift,
        detonated: false,
        splitCount: 0,
        small: false,
        homing: false,
        targetZone: 0,
      });
    }
    p.fireCd = w.fireInterval;
    p.shotsFired += 1;
    p.ammo -= 1;
    p.charge = 0;
    if (p.ammo <= 0) {
      p.reloading = true;
      p.reloadTotal = w.reload;
      p.reloadT = w.reload;
    }
    this.events.push({ type: 'shoot', x: p.pos.x, y: p.pos.y, angle: p.aim });
  }

  /** 范围爆炸，返回命中数 */
  explodeAt(x: number, y: number, radius: number, damage: number): number {
    let hits = 0;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (dist(e.pos, { x, y }) <= radius + e.radius) {
        this.damageEnemy(e, damage);
        hits++;
      }
    }
    this.events.push({ type: 'explosion', x, y, r: radius });
    this.shake = Math.max(this.shake, 4);
    return hits;
  }

  /** 电磁炮的落点预览：第一只挡路的敌人或射程尽头 */
  /** 落点预览：与 fireRail 使用同一套射程计算 */
  railPreview(chargeK = 0): { x: number; y: number; radius: number } {
    const p = this.player;
    const w = RAIL_WEAPON;
    const k = Math.max(0, Math.min(1, chargeK));
    const range = w.range * (1 + k * 0.35);
    const cos = Math.cos(p.aim);
    const sin = Math.sin(p.aim);
    let best = range;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      const along = dx * cos + dy * sin;
      if (along < 8 || along > range + e.radius) continue;
      const perp = Math.abs(-dx * sin + dy * cos);
      const rr = e.radius + w.bulletRadius * (1 + k * 0.8);
      if (perp > rr) continue;
      const back = Math.sqrt(rr * rr - perp * perp);
      const t = Math.max(8, along - back);
      if (t < best) best = t;
    }
    return { x: p.pos.x + cos * best, y: p.pos.y + sin * best, radius: 0 };
  }


  respawnPlayer(): void {
    const p = this.player;
    const asc = this.crystals.find((c) => c.kind === 'ascension');
    p.alive = true;
    p.hp = p.maxHp * 0.6;
    p.pos.x = clamp((asc ? asc.pos.x : LEVEL.start.x) + 46, 12, LEVEL.width - 12);
    p.pos.y = clamp(LEVEL.laneY + 46, LEVEL.road.top + 16, LEVEL.road.bottom - 10);
    p.invuln = 1.6;
    p.ammo = p.magSize;
    p.reloading = false;
    p.reloadT = 0;
    p.mode = 'none';
    this.events.push({ type: 'playerRespawn' });
  }

  /* ================= 武器 ================= */

  finishReload(): void {
    const p = this.player;
    p.reloading = false;
    p.reloadT = 0;
    p.ammo = p.magSize;
  }

  applyCC(
    e: Enemy,
    kind: CCKind,
    dir: Vec,
    speed: number,
    duration: number,
    interrupt = true,
  ): boolean {
    if (e.immunity.all || e.immunity.body) {
      this.events.push({ type: 'immune', x: e.pos.x, y: e.pos.y });
      return false;
    }
    e.ext = { x: dir.x * speed, y: dir.y * speed, t: duration, total: duration };
    /* 击退是否打断蓄力由调用方决定 */
    if (interrupt && kind === 'knockback') e.windup = 0;
    return true;
  }

  /* ================= 域兽 ================= */

  updateEnemies(dt: number): void {
    const objective = this.frontCrystal();

    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      e.attackAnim = Math.max(0, e.attackAnim - dt * 4);
      e.atkTimer = Math.max(0, e.atkTimer - dt);
      if (e.rootT > 0) {
        e.rootT = Math.max(0, e.rootT - dt);
        if (e.rootT <= 0 && this.hasSkillShape('leap', 'sticky')) {
          e.slowT = LEAP_SHAPE.stickyTime * e.rootBonus;
          e.slowFactor = Math.min(0.85, LEAP_SHAPE.stickySlow * e.rootBonus);
        }
      }
      if (e.slowT > 0) e.slowT = Math.max(0, e.slowT - dt);
      if (e.rootT > 0) e.ext = null;
      this.healAllies(e, dt);

      if (e.ext) {
        e.pos.x = clamp(e.pos.x + e.ext.x * dt, 8, LEVEL.width - 8);
        e.pos.y = clamp(e.pos.y + e.ext.y * dt, LEVEL.road.top + 14, LEVEL.road.bottom - 14);
        this.clampEnemy(e);
        e.ext.t -= dt;
        if (e.ext.t <= 0) e.ext = null;
        continue;
      }

      // 蓄力：站定不动，时间到就劈出扇形
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) this.fanStrike(e);
        continue;
      }

      if (!objective) continue;

      const p = this.player;
      // 玩家进入索敌范围 → 开始追击，并记下追击锚点
      const nearPlayer =
        ENEMIES[e.kind].ranged && dist(e.pos, p.pos) <= ENEMIES[e.kind].aggro;
      if (this.playerInTheWay(e, objective) || nearPlayer) {
        if (e.chaseT <= 0) {
          e.chaseX = e.pos.x;
          e.chaseY = e.pos.y;
        }
        e.chaseT = CHASE_HOLD;
      }

      // 追击有距离上限：离锚点太远、或玩家倒下，就放弃并回防
      if (e.chaseT > 0) {
        const leash = Math.hypot(e.pos.x - e.chaseX, e.pos.y - e.chaseY);
        if (!p.alive || leash > CHASE_RANGE) e.chaseT = 0;
      }

      if (e.chaseT > 0) {
        e.chaseT = Math.max(0, e.chaseT - dt);
        this.engagePlayer(e, dt);
      } else {
        this.advancePath(e, objective, dt);
      }
    }
    this.actor = null;
  }

  /** 越机：朝玩家投出污染瓶 */
  throwBottle(e: Enemy): void {
    const cfg = ENEMIES[e.kind].bottle;
    if (!cfg) return;
    this.bottles.push({
      from: { x: e.pos.x, y: e.pos.y },
      to: { x: this.player.pos.x, y: this.player.pos.y },
      pos: { x: e.pos.x, y: e.pos.y },
      t: 0,
      dur: cfg.flightTime,
      radius: cfg.radius,
      duration: cfg.duration,
      interval: cfg.interval,
      damage: cfg.damage * waveDmgScale(Math.max(1, this.wave.n)),
    });
    this.events.push({ type: 'bottleThrow', x: e.pos.x, y: e.pos.y });
  }

  updateBottles(dt: number): void {
    for (const b of this.bottles) {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.pos.x = lerp(b.from.x, b.to.x, k);
      b.pos.y = lerp(b.from.y, b.to.y, k) - Math.sin(k * Math.PI) * 30;
      if (b.t >= b.dur) {
        this.zones.push({
          id: ++this.zoneId,
          owner: 'enemy',
          pos: { x: b.to.x, y: b.to.y },
          radius: b.radius,
          ttl: b.duration,
          maxTtl: b.duration,
          tick: b.interval,
          blastLock: 0,
          pulse: 0,
          poison: true,
          damage: b.damage,
          interval: b.interval,
        });
        this.events.push({ type: 'bottleLand', x: b.to.x, y: b.to.y });
      }
    }
    this.bottles = this.bottles.filter((b) => b.t < b.dur);
  }

  /** 祛鳞：给附近域兽回血 */
  healAllies(e: Enemy, dt: number): void {
    const cfg = ENEMIES[e.kind].heal;
    if (!cfg) return;
    e.healCd = (e.healCd ?? 0) - dt;
    if (e.healCd > 0) return;
    e.healCd = cfg.interval;
    let healed = false;
    const amount = cfg.amount * Math.min(2, 1 + 0.03 * (Math.max(1, this.wave.n) - 1));
    for (const o of this.enemies) {
      if (o.hp <= 0 || o.hp >= o.maxHp) continue;
      if (dist(o.pos, e.pos) > cfg.radius) continue;
      o.hp = Math.min(o.maxHp, o.hp + amount);
      healed = true;
    }
    if (healed) this.events.push({ type: 'healPulse', x: e.pos.x, y: e.pos.y });
  }

  /** 玩家挡在路上：停下并攻击玩家 */
  engagePlayer(e: Enemy, dt: number): void {
    const p = this.player;
    const d = dist(e.pos, p.pos);
    e.facing = angleTo(e.pos, p.pos);
    const fan = ENEMIES[e.kind].fan;

    if (fan) {
      if (d <= e.atkRange && e.atkTimer <= 0) {
        this.startWindup(e, angleTo(e.pos, p.pos));
        return;
      }
      if (d > e.atkRange - 12) this.moveToward(e, p.pos, this.enemySpeed(e, e.speed) * dt);
      return;
    }
    if (e.ranged) {
      const keep = ENEMIES[e.kind].keepDist;
      if (d > keep + 8) {
        this.moveToward(e, p.pos, this.enemySpeed(e, e.speed) * dt);
      } else if (d < keep - 24) {
        const away = { x: e.pos.x + (e.pos.x - p.pos.x), y: e.pos.y + (e.pos.y - p.pos.y) };
        const len = Math.hypot(away.x - e.pos.x, away.y - e.pos.y) || 1;
        e.pos.x += ((away.x - e.pos.x) / len) * e.speed * dt * 0.7;
        e.pos.y += ((away.y - e.pos.y) / len) * e.speed * dt * 0.7;
        this.clampEnemy(e);
      }
      e.shotCd = Math.max(0, e.shotCd - dt);
      if (e.shotCd <= 0 && d <= e.atkRange) {
        e.shotCd = e.atkInterval;
        if (ENEMIES[e.kind].bottle) this.throwBottle(e);
        else this.enemyShoot(e, p.pos);
      }
      return;
    }
    if (e.dmg <= 0) return;
    if (d > e.atkRange + this.hero.radius) {
      this.moveToward(e, p.pos, this.enemySpeed(e, e.speed) * dt);
    } else if (e.atkTimer <= 0) {
      e.atkTimer = e.atkInterval;
      e.attackAnim = 1;
      this.damagePlayer(e.dmg, e.pos);
    }
  }

  /**
   * 玩家是否进入域兽的索敌范围。
   * 优先拆水晶，但玩家靠得太近也会被攻击：
   * - 身后 / 侧面：小范围（贴身）
   * - 正前方（挡路）：更大的范围
   */
  playerInTheWay(e: Enemy, objective: Crystal): boolean {
    const p = this.player;
    if (!p.alive) return false;
    const dx = p.pos.x - e.pos.x;
    const dy = p.pos.y - e.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) return true;

    // 贴身：不分方向
    const near = e.radius + 16;
    if (d <= near) return true;

    // 前方挡路：范围更大，但必须朝着目标方向
    const blockReach = e.radius + 34;
    if (d > blockReach) return false;
    const tx = objective.pos.x - e.pos.x;
    const ty = objective.pos.y - e.pos.y;
    const tl = Math.hypot(tx, ty) || 1;
    const dot = (dx * tx + dy * ty) / (d * tl);
    return dot > 0.15;
  }

  advancePath(e: Enemy, objective: Crystal, dt: number): void {
    const fan = ENEMIES[e.kind].fan;
    const reach = e.atkRange + objective.radius;
    const dObj = dist(e.pos, objective.pos);

    if (dObj > reach) {
      const targetIdx = objective.pathIndex;
      if (e.pathIndex > targetIdx) e.pathIndex = targetIdx;
      const wp = LEVEL.path[Math.min(e.pathIndex, LEVEL.path.length - 1)];
      if (dist(e.pos, wp) < 9) {
        if (e.pathIndex < targetIdx) e.pathIndex++;
      } else {
        e.facing = angleTo(e.pos, wp);
        this.moveToward(e, wp, this.enemySpeed(e, e.speed) * dt);
      }
      return;
    }

    e.facing = angleTo(e.pos, objective.pos);

    if (fan) {
      if (e.atkTimer <= 0) this.startWindup(e, angleTo(e.pos, objective.pos));
      return;
    }
    if (e.ranged) {
      e.shotCd = Math.max(0, e.shotCd - dt);
      if (e.shotCd <= 0) {
        e.shotCd = e.atkInterval;
        this.enemyShoot(e, objective.pos);
      }
      return;
    }
    if (e.atkTimer <= 0) {
      e.atkTimer = e.atkInterval;
      e.attackAnim = 1;
      this.damageCrystal(objective, e.dmg);
    }
  }

  startWindup(e: Enemy, angle: number): void {
    const fan = ENEMIES[e.kind].fan;
    if (!fan) return;
    e.windup = fan.windup;
    e.windupTotal = fan.windup;
    e.windupAngle = angle;
    e.atkTimer = e.atkInterval;
    e.attackAnim = 1;
  }

  /** 普则的扇形劈击：预警结束，结算命中 */
  fanStrike(e: Enemy): void {
    const fan = ENEMIES[e.kind].fan;
    if (!fan) return;
    const p = this.player;
    let hit = false;

    // 盾是实体：只要扇形压在盾面上就挡下（不要求打中角色）
    let shieldBlocked = false;
    if (p.alive && this.player.weaponId === 'shield' && this.shieldOverlapsFan(e)) {
      shieldBlocked = true;
      this.absorbHit(0);
    }

    const airborne = p.leapT > 0 || p.leapHangT > 0;
    if (
      p.alive &&
      !airborne &&
      inFan(e.pos.x, e.pos.y, e.windupAngle, fan.halfAngle, fan.radius, p.pos.x, p.pos.y, this.hero.radius)
    ) {
      let dealt = shieldBlocked ? e.dmg * (1 - SHIELD_WEAPON.blockDR) : e.dmg;
      if (dealt > 0) this.damagePlayer(dealt, e.pos);
      hit = true;
    }
    for (const c of this.crystals) {
      if (!c.alive) continue;
      if (
        inFan(e.pos.x, e.pos.y, e.windupAngle, fan.halfAngle, fan.radius, c.pos.x, c.pos.y, c.radius)
      ) {
        if (e.dmg > 0) this.damageCrystal(c, e.dmg * 1.7);
        hit = true;
      }
    }

    this.events.push({
      type: 'fanStrike',
      x: e.pos.x,
      y: e.pos.y,
      angle: e.windupAngle,
      radius: fan.radius,
      half: fan.halfAngle,
    });
    this.shake = Math.max(this.shake, hit ? 5 : 2.5);
    e.windup = 0;
    e.attackAnim = 1;
  }

  /** 域兽当前实际移速（含土壤黏脚减速） */
  enemySpeed(e: Enemy, base: number): number {
    return e.slowT > 0 ? base * (1 - e.slowFactor) : base;
  }

  moveToward(e: Enemy, target: Vec, amount: number): void {
    if (e.rootT > 0) return;
    const d = dist(e.pos, target);
    if (d < 0.001) return;
    e.pos.x += ((target.x - e.pos.x) / d) * amount;
    e.pos.y += ((target.y - e.pos.y) / d) * amount;
    this.clampEnemy(e);
  }

  /** 域兽不许走出道路/地图 */
  clampEnemy(e: Enemy): void {
    e.pos.x = clamp(e.pos.x, e.radius + 4, LEVEL.width - e.radius - 4);
    e.pos.y = clamp(e.pos.y, LEVEL.road.top + e.radius, LEVEL.road.bottom - e.radius);
  }

  enemyShoot(e: Enemy, target: Vec): void {
    const def = ENEMIES[e.kind];
    const a = angleTo(e.pos, target) + rand(-0.05, 0.05);
    this.shots.push({
      tag: 'flight',
      pos: { x: e.pos.x, y: e.pos.y },
      vel: { x: Math.cos(a) * def.shotSpeed, y: Math.sin(a) * def.shotSpeed },
      dmg: e.dmg,
      radius: def.shotRadius,
      life: 3,
    });
  }

  spawnEnemy(kind: EnemyKind, pos: Vec, pathIndex = 0): void {
    const def = ENEMIES[kind];
    const wave = Math.max(1, this.wave.n);
    const scale = waveHpScale(wave);
    const hp = Math.round(def.hp * scale);
    this.enemies.push({
      id: this.nextId++,
      kind,
      pos: { x: pos.x, y: pos.y },
      hp,
      maxHp: hp,
      speed: def.speed * waveSpeedScale(wave),
      radius: def.radius,
      dmg: def.dmg * waveDmgScale(wave),
      atkInterval: def.atkInterval,
      atkTimer: rand(0.25, 0.7),
      atkRange: def.atkRange,
      aggro: def.aggro,
      immunity: def.immunity,
      ranged: def.ranged,
      keepDist: def.keepDist,
      shotCd: rand(0.4, 1.3),
      pathIndex,
      hitFlash: 0,
      ext: null,
      attackAnim: 0,
      facing: 0,
      rootT: 0,
      slowT: 0,
      healCd: 0,
      slowFactor: LEAP_SHAPE.stickySlow,
      rootBonus: 1,
      windup: 0,
      windupTotal: 0,
      windupAngle: 0,
      chaseT: 0,
      chaseX: 0,
      chaseY: 0,
    });
  }

  spawnPoint(): Vec {
    return {
      x: clamp(LEVEL.rift.x - rand(0, 20), 0, LEVEL.width - 8),
      y: clamp(LEVEL.laneY + rand(-28, 28), LEVEL.road.top + 12, LEVEL.road.bottom - 12),
    };
  }

  /* ================= 弹道 / 范围 ================= */

  /** 电传播：命中后向附近其它域兽放电（近战击） */
  tryChain(from: Enemy): void {
    if (!this.hasShape('railgun', 'chain')) return;
    let count = 0;
    for (const o of this.enemies) {
      if (o === from || o.hp <= 0) continue;
      if (count >= RAIL_SHAPE.chainMax) break;
      if (dist(o.pos, from.pos) > RAIL_SHAPE.chainRadius) continue;
      this.damageEnemy(o, RAIL_SHAPE.chainDamage);
      this.events.push({ type: 'chain', x: from.pos.x, y: from.pos.y, x2: o.pos.x, y2: o.pos.y });
      count++;
    }
  }

  /** 动力分裂：飞行途中向左右斜方分裂小弹 */
  trySplit(l: Laser): void {
    if (!this.hasShape('railgun', 'split')) return;
    if (l.small) return;
    const idx = Math.floor(l.travel / RAIL_SHAPE.splitEvery);
    if (idx <= l.splitCount) return;
    l.splitCount = idx;
    for (const sign of [1, -1]) {
      const a = l.angle + RAIL_SHAPE.splitAngle * sign;
      this.lasers.push({
        pos: { x: l.pos.x, y: l.pos.y },
        vel: { x: Math.cos(a) * 420, y: Math.sin(a) * 420 },
        angle: a,
        damage: l.damage * RAIL_SHAPE.splitDamageRatio,
        lift: l.lift,
        pierce: 0,
        hitIds: [],
        life: 95 / 420,
        travel: 0,
        blast: 0,
        radius: l.radius * 0.55,
        orb: true,
        tag: 'flight',
        detonated: false,
        splitCount: 0,
        small: true,
        homing: false,
        targetZone: 0,
      });
    }
  }

  updateLasers(dt: number): void {
    const p = this.player;

    for (const l of this.lasers) {
      if (l.life <= 0) continue;

      if (!l.detonated && this.checkDetonate(l)) l.detonated = true;

      const px = l.pos.x;
      const py = l.pos.y;
      l.pos.x += l.vel.x * dt;
      l.pos.y += l.vel.y * dt;
      l.travel += Math.hypot(l.vel.x, l.vel.y) * dt;
      this.trySplit(l);
      l.life -= dt;

      // 命中域兽
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (l.hitIds.includes(e.id)) continue;
        if (segmentCircle(px, py, l.pos.x, l.pos.y, e.pos.x, e.pos.y, e.radius + l.radius)) {
          l.hitIds.push(e.id);
          if (l.blast > 0) {
            l.life = 0;
            break;
          }
          this.damageEnemy(e, l.damage);
          this.events.push({ type: 'laserHit', x: e.pos.x, y: e.pos.y });
          this.tryChain(e);
          if (l.pierce > 0) l.pierce -= 1;
          else {
            l.life = 0;
            break;
          }
        }
      }

      if (
        l.pos.x < -24 ||
        l.pos.y < -24 ||
        l.pos.x > LEVEL.width + 24 ||
        l.pos.y > LEVEL.height + 24
      ) {
        l.life = 0;
      }
    }

    this.lasers = this.lasers.filter((l) => {
      if (l.life > 0) return true;
      if (l.blast > 0) this.explodeAt(l.pos.x, l.pos.y, l.blast, l.damage);
      return false;
    });
  }

  updateShots(dt: number): void {
    const p = this.player;
    for (const s of this.shots) {
      let slow = 1;
      if (this.hasSkillShape('blackhole', 'slowfield')) {
        const z = this.blackholeZone();
        if (z && dist(s.pos, z.pos) <= z.radius) slow = BLACKHOLE_SHAPE.slowMult;
      }
      s.pos.x += s.vel.x * dt * slow;
      s.pos.y += s.vel.y * dt * slow;
      s.life -= dt;
      // 盾是实体：子弹进入盾面的扇形区域就被挡下
      if (
        p.alive &&
        s.life > 0 &&
        this.player.weaponId === 'shield' &&
        p.meteorT <= 0 &&
        p.shieldHp > 0
      ) {
        const d = dist(s.pos, p.pos);
        const incoming = angleTo(p.pos, { x: s.pos.x - s.vel.x * 0.2, y: s.pos.y - s.vel.y * 0.2 });
        if (
          d <= SHIELD_WEAPON.blockRadius &&
          Math.abs(angleDiff(incoming, p.shieldAngle)) <= SHIELD_WEAPON.blockHalf
        ) {
          s.life = 0;
          this.absorbHit(0);
          continue;
        }
      }
      if (p.alive && s.life > 0 && dist(s.pos, p.pos) <= this.hero.radius + s.radius) {
        s.life = 0;
        this.damagePlayer(s.dmg, s.pos);
      }
      if (s.pos.x < 0 || s.pos.y < 0 || s.pos.x > LEVEL.width || s.pos.y > LEVEL.height) s.life = 0;
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  damageEnemy(e: Enemy, amount: number): void {
    const wasRooted = e.rootT > 0;
    if (e.hp <= 0) return;
    const dealt = amount;
    e.hp -= dealt;

    // 状况加深：命中陷地中的域兽 → 延长陷地
    if (wasRooted && this.hasSkillShape('leap', 'deepen') && this.deepenCd <= 0) {
      e.rootT += LEAP_SHAPE.deepenAdd * e.rootBonus;
      this.deepenCd = LEAP_SHAPE.deepenCd;
    }

    // 磐能吸取：石肤期间造成的伤害转化为护盾
    if (this.player.stoneT > 0 && this.hasSkillShape('stone', 'siphon')) {
      this.player.shield = Math.min(
        STONE_SHAPE.shieldMax,
        this.player.shield + dealt * STONE_SHAPE.siphonRate,
      );
    }
    e.hitFlash = 1;
    /* 被打了就会记仇，短时间转向玩家 */
    this.player.totalDamage += amount;
    this.events.push({
      type: 'impact',
      x: e.pos.x + rand(-3, 3),
      y: e.pos.y + rand(-3, 3),
      r: 4,
      dmg: Math.round(amount),
    });
    if (e.hp <= 0) {
      e.hp = 0;
      this.player.killCount++;
      this.totalKills++;
      this.events.push({ type: 'enemyDeath', x: e.pos.x, y: e.pos.y, kind: e.kind });
      this.player.killFrac += 1;
      this.player.coins += COIN_PER_KILL;
      if (this.player.killFrac >= KILLS_PER_POINT) {
        this.player.killFrac -= KILLS_PER_POINT;
        this.player.points += 1;
      }
      this.shake = Math.max(this.shake, 1.4);
    }
  }

  damagePlayer(amount: number, src?: Vec): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    if (p.rollIframe > 0) return;

    const eggDR = p.eggT > 0 ? STONE_SHAPE.eggDR : 0;
    const stoneDR = Math.max(p.stoneT > 0 ? STONE.dr : 0, eggDR);
    const dr = Math.max(0, Math.min(0.85, this.hero.damageReduction + stoneDR));
    let dmg = amount * (1 - dr);

    // 护盾优先承伤
    if (p.shield > 0) {
      const absorb = Math.min(p.shield, dmg);
      p.shield -= absorb;
      dmg -= absorb;
    }
    p.hp -= dmg;
    p.invuln = 0.42;
    p.hurtFlash = 1;
    this.events.push({ type: 'playerHurt' });
    this.shake = Math.max(this.shake, 3.5);
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.respawnT = 7;
      p.mode = 'none';
      this.events.push({ type: 'playerDown' });
    }
  }

  damageCrystal(c: Crystal, amount: number): void {
    if (!c.alive) return;
    c.hp -= amount;
    c.hitFlash = 1;
    this.events.push({ type: 'crystalHit', x: c.pos.x, y: c.pos.y, kind: c.kind });
    if (c.hp <= 0) {
      c.hp = 0;
      c.alive = false;
      this.events.push({ type: 'crystalDown', x: c.pos.x, y: c.pos.y });
      this.shake = Math.max(this.shake, 8);
      if (c.kind === 'ascension') {
        this.state = 'defeat';
        this.events.push({ type: 'defeat' });
      }
    }
  }

  /* ================= 水晶 ================= */

  updateCrystals(dt: number): void {
    const p = this.player;
    for (const c of this.crystals) {
      c.hitFlash = Math.max(0, c.hitFlash - dt * 3.5);
      c.healPulse = Math.max(0, c.healPulse - dt * 1.5);

      /* 只有升华水晶提供恢复，净化水晶不回血 */
      if (!c.alive || c.kind !== 'ascension') continue;
      if (p.alive && dist(p.pos, c.pos) <= CRYSTAL.auraRadius && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + CRYSTAL.auraRegen * dt);
        c.healPulse = 0.6;
      }
    }
  }

  frontCrystal(): Crystal | null {
    for (const c of this.crystals) {
      if (c.kind === 'purify' && c.alive) return c;
    }
    const asc = this.crystals.find((c) => c.kind === 'ascension');
    return asc && asc.alive ? asc : null;
  }

  /* ================= 波次 ================= */

  updateWave(dt: number, input: InputSnapshot): void {
    const w = this.wave;

    if (w.phase === 'intermission') {
      w.timer -= dt;
      if (w.timer <= 0 || input.skip) this.startWave();
    } else if (w.phase === 'spawning') {
      w.spawnTimer -= dt;
      if (w.spawnTimer <= 0 && w.queue.length > 0) {
        this.spawnEnemy(w.queue.pop()!, this.spawnPoint());
        w.spawnTimer = 0.32;
      }
      if (w.queue.length === 0) w.phase = 'fighting';
    }

    if (w.phase === 'fighting' && this.enemies.length === 0) this.clearWave();
  }

  startWave(): void {
    const w = this.wave;
    w.n += 1;
    w.phase = 'spawning';
    w.queue = buildWave(w.n);
    for (let i = w.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = w.queue[i];
      w.queue[i] = w.queue[j];
      w.queue[j] = t;
    }
    w.spawnTimer = 0;
    this.events.push({ type: 'waveStart', n: w.n });
  }

  clearWave(): void {
    const w = this.wave;
    this.player.points += POINTS_PER_WAVE;
    this.player.coins += COIN_PER_WAVE;
    this.events.push({ type: 'waveClear', n: w.n });
    // 无尽模式：没有通关，只有能撑多久
    w.phase = 'intermission';
    w.timer = PREP_TIME;
  }

  remainingEnemies(): number {
    return this.wave.queue.length + this.enemies.filter((e) => e.hp > 0).length;
  }

  /** 距目标最近的玩家 */
  nearestPlayer(pos: Vec): Player {
    let best = this.players[0];
    let bd = Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = dist(p.pos, pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** 联机：加入一名新玩家 */
  addPlayer(weaponId: 'railgun' | 'shield'): Player {
    const src = this.players[0];
    const clone: Player = {
      ...src,
      weaponId,
      pos: { x: src.pos.x + 26, y: src.pos.y + 14 },
      vel: { x: 0, y: 0 },
      hp: this.hero.maxHp,
      maxHp: this.hero.maxHp,
      alive: true,
      ammo: RAIL_WEAPON.magSize,
      shapes: {},
      skillCd: [0, 0, 0],
      stoneT: 0,
      eggT: 0,
      shield: 0,
      shieldHp: SHIELD_WEAPON.durabilityMax,
      meteorT: 0,
      leapT: 0,
      leapHangT: 0,
      leapHung: 0,
      leapBonus: 0,
      landT: 0,
      rollT: 0,
      rollHits: [],
      charge: 0,
      reloading: false,
      mode: 'none',
      throwTarget: null,
      panelOpen: false,
      invuln: 0,
      hurtFlash: 0,
      coins: 0,
      points: 0,
      respawnT: 0,
    };
    this.players.push(clone);
    return clone;
  }

  /* ================= 成长面板 ================= */

  hasSkillShape(skillId: string, shapeId: string): boolean {
    return this.player.skillShapes[skillId + '.' + shapeId] === true;
  }

  buySkillShape(skillId: string, shapeId: string, playerIndex = this.localIndex): boolean {
    const p = this.players[playerIndex];
    const list = SKILL_SHAPES[skillId];
    const def = list?.find((s) => s.id === shapeId);
    if (!def) return false;
    const key = skillId + '.' + shapeId;
    if (p.skillShapes[key]) return false;
    if (p.coins < def.cost) return false;
    p.coins -= def.cost;
    p.skillShapes[key] = true;
    return true;
  }

  /** 严格：只认「玩家自己投出的黑洞范围区」 */
  blackholeZone(): Zone | undefined {
    return this.zones.find((z) => z.ttl > 0 && z.owner === 'player' && !z.poison);
  }

  /** 当前武器的专属塑造 */
  weaponName(): string {
    return this.player.weaponId === 'shield' ? SHIELD_WEAPON.name : RAIL_WEAPON.name;
  }

  weaponShapes(): ShapeDef[] {
    return WEAPON_SHAPES[this.player.weaponId] ?? [];
  }

  hasShape(weaponId: string, shapeId: string): boolean {
    return this.player.weaponId === weaponId && this.shapeLevel(shapeId) > 0;
  }

  shapeLevel(id: string): number {
    return this.player.shapes[id] ?? 0;
  }

  buyShape(id: string, playerIndex = this.localIndex): boolean {
    const p = this.players[playerIndex];
    const def = this.weaponShapes().find((s) => s.id === id);
    if (!def) return false;
    const owned = this.shapeLevel(id);
    if (owned >= def.max) return false;
    const cost = def.cost(owned);
    if (p.coins < cost) return false;
    p.coins -= cost;
    p.shapes[id] = owned + 1;
    return true;
  }



}
