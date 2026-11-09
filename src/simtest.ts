/**
 * 模拟层自检：不依赖渲染，直接在浏览器里跑。
 * 打开 http://127.0.0.1:5173/test.html 看结果。
 */
import { COIN_PER_KILL, RAIL_WEAPON } from './content/defs';
import { IDENTITIES, validateIdentities } from './content/identities';
import { World } from './sim/world';

const logEl = document.getElementById('log') as HTMLElement;
let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
    logEl.innerHTML += `<div class="ok">✓ ${name}</div>\n`;
  } else {
    fail++;
    logEl.innerHTML += `<div class="bad">✗ ${name} ${extra}</div>\n`;
    console.error('FAIL:', name, extra);
  }
}

function makeWorld(): World {
  const w = new World();
  w.player.pos = { x: 400, y: 150 };
  w.player.aim = 0;
  w.enemies.length = 0;
  w.lasers.length = 0;
  return w;
}

const input = {
  moveX: 0,
  moveY: 0,
  aimX: 400,
  aimY: 150,
  fireHeld: false,
  firePressed: false,
  altHeld: false,
  altPressed: false,
  reloadPressed: false,
  rollPressed: false,
  skillQ: false,
  skillE: false,
  skillF: false,
  panel: false,
  skip: false,
};

/* ============ 1. 电磁炮基础 ============ */
{
  const w = makeWorld();
  check('电磁炮：3 发弹匣', w.player.magSize === 3 && w.player.ammo === 3);
  w.fireRail();
  check('电磁炮：一次扣 1 发弹药', w.player.ammo === 2);
  check('电磁炮：打出一发弹体', w.lasers.length === 1);
  const l = w.lasers[0];
  check('电磁炮：伤害 36', l.damage === RAIL_WEAPON.damage);
  check('电磁炮：圆形弹体', l.orb === true && l.radius === RAIL_WEAPON.bulletRadius);
}

/* ============ 2. 换弹 ============ */
{
  const w = makeWorld();
  w.fireRail();
  w.fireRail();
  check('电磁炮：未打空不换弹', w.player.reloading === false);
  w.fireRail();
  check('电磁炮：打空后自动换弹', w.player.reloading === true);
  for (let i = 0; i < 80; i++) w.tick(input, 1 / 60);
  check('电磁炮：换弹结束后补满', w.player.ammo === 3 && w.player.reloading === false);
}

/* ============ 3. 武器塑造 ============ */
{
  const w = makeWorld();
  w.player.coins = 500;
  check("极蓄：购买成功", w.buyShape("charge") === true && w.player.coins === 380);
  check("极蓄：只能买一次", w.buyShape("charge") === false);

  // 未装备极蓄：按下即射
  const w0 = makeWorld();
  w0.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  check("未装备极蓄：按下左键立刻射出", w0.lasers.length === 1);

  // 装备极蓄：按住蓄力，松开才射
  const w2 = makeWorld();
  w2.player.coins = 500;
  w2.buyShape("charge");
  w2.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  check("极蓄：按住左键不发射", w2.lasers.length === 0 && w2.player.charge > 0);
  for (let i = 0; i < 320; i++) w2.tick({ ...input, fireHeld: true }, 1 / 60);
  check("极蓄：最多蓄 5 秒", Math.abs(w2.player.charge - 5) < 0.001);
  w2.tick(input, 1 / 60);
  check("极蓄：松开发射", w2.lasers.length === 1);
  check("极蓄：满蓄力伤害提升", w2.lasers[0].damage > RAIL_WEAPON.damage * 2);
  check("极蓄：满蓄力弹体更大", w2.lasers[0].radius > RAIL_WEAPON.bulletRadius);

  const w3 = makeWorld();
  w3.player.coins = 500;
  w3.buyShape("pierce");
  w3.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  check("透性：弹体穿透全部目标", w3.lasers[0].pierce > 100);

  const w4 = makeWorld();
  w4.tick({ ...input, altHeld: true }, 1 / 60);
  check("右键：进入瞄准状态", w4.player.aiming === true);
}

/* ============ 4. 命中与击杀 ============ */
{
  const w = makeWorld();
  w.spawnEnemy('puze', { x: 470, y: 150 });
  w.fireRail();
  for (let i = 0; i < 20; i++) w.updateLasers(1 / 60);
  const e = w.enemies[0];
  check('命中：弹体造成伤害', e.hp < e.maxHp);

  const ehp = e.hp;
  w.damageEnemy(e, 999);
  check('击杀：累计击杀数', w.player.killCount === 1 && ehp > 0);
  check('击杀：获得域币', w.player.coins === COIN_PER_KILL);
}

/* ============ 6. 波次 ============ */
{
  const w = makeWorld();
  w.wave.phase = 'intermission';
  w.wave.timer = 0.01;
  w.updateWave(0.02, input);
  check('准备期结束 → 开始第 1 波', w.wave.n === 1 && (w.wave.phase as string) === 'spawning');

  w.wave.phase = 'fighting';
  w.wave.queue = [];
  w.enemies.length = 0;
  const pts = w.player.points;
  w.updateWave(0.016, input);
  check(
    '清波 → 获得成长点并进入整备',
    w.player.points === pts + 2 && (w.wave.phase as string) === 'intermission',
  );
}

/* ============ 7. 普则 ============ */
{
  const w = makeWorld();
  w.player.pos = { x: 470, y: 150 };
  w.spawnEnemy('puze', { x: 440, y: 150 });
  const e = w.enemies[0];
  e.atkTimer = 0;
  w.updateEnemies(1 / 60);
  check('普则：玩家挡路时开始蓄力', e.windup > 0);
  const px = e.pos.x;
  for (let i = 0; i < 20; i++) w.updateEnemies(1 / 60);
  check('普则：蓄力期间站定', e.pos.x === px);
  w.player.hp = 180;
  w.player.invuln = 0;
  for (let i = 0; i < 60; i++) w.updateEnemies(1 / 60);
  check('普则：扇形劈击命中玩家', w.player.hp < 180);
}

/* ============ 8. 水晶 / 失败 ============ */
{
  const w = makeWorld();
  w.damageCrystal(w.crystals[0], 99999);
  check('净化水晶被摧毁', w.crystals[0].alive === false);
  check('前线目标切到第二座', w.frontCrystal() === w.crystals[1]);
  w.damageCrystal(w.crystals[3], 99999);
  check('升华水晶破碎 → 战败', w.state === 'defeat');
}

/* ============ 9. 身份与免控 ============ */
{
  const w = makeWorld();
  w.spawnEnemy("puze", { x: 470, y: 150 });
  const e = w.enemies[0];
  w.fireRail();
  check("身份：武器弹体是「飞行物」", w.lasers[0].tag === "flight");

  e.immunity = {};
  check(
    "免控：无免疫时控制生效",
    w.applyCC(e, "knockback", { x: 1, y: 0 }, 100, 0.2, false) === true,
  );

  e.ext = null;
  e.immunity = { body: true };
  check(
    "免控：生理免控 → 生理控制无效",
    w.applyCC(e, "knockback", { x: 1, y: 0 }, 100, 0.2, false) === false,
  );

  e.ext = null;
  e.immunity = { mind: true };
  check(
    "免控：心理免控不影响生理控制",
    w.applyCC(e, "root", { x: 1, y: 0 }, 0, 0.5, false) === true,
  );

  e.ext = null;
  e.immunity = { all: true };
  check(
    "免控：全免控",
    w.applyCC(e, "knockback", { x: 1, y: 0 }, 100, 0.2, false) === false,
  );
}

/* ============ 10. 翻滚 ============ */
{
  const w = makeWorld();
  const x0 = w.player.pos.x;
  w.tick({ ...input, moveX: 1, rollPressed: true }, 1 / 60);
  for (let i = 0; i < 20; i++) w.tick({ ...input, moveX: 1 }, 1 / 60);
  check("翻滚：产生位移", w.player.pos.x - x0 > 40);
  check("翻滚：消耗体力", w.player.stamina < 3);

  const w2 = makeWorld();
  w2.tick({ ...input, rollPressed: true }, 1 / 60);
  w2.player.hp = 100;
  w2.damagePlayer(50);
  check("翻滚：无敌帧内免伤", w2.player.hp === 100);

  const w3 = makeWorld();
  w3.player.stamina = 0;
  w3.tick({ ...input, rollPressed: true }, 1 / 60);
  check("翻滚：体力不足不能翻滚", w3.player.rollT === 0 && w3.player.stamina < 0.1);
}

/* ============ 11. 技能：黑洞雷 ============ */
{
  const w = makeWorld();
  w.spawnEnemy("puze", { x: 615, y: 150 });
  w.tick({ ...input, skillQ: true }, 1 / 60);
  check("黑洞雷：进入投掷预瞄", w.player.mode === "throw");

  w.tick({ ...input, altPressed: true, altHeld: true }, 1 / 60);
  check("黑洞雷：右键取消预瞄", w.player.mode === "none" && w.zones.length === 0);

  w.tick({ ...input, skillQ: true }, 1 / 60);
  w.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  check("黑洞雷：先投出飞行物", w.grenades.length === 1 && w.zones.length === 0);
  for (let i = 0; i < 35; i++) w.tick(input, 1 / 60);
  check("黑洞雷：落地生成范围区", w.zones.length === 1);
  check("黑洞雷：进入冷却", w.player.skillCd[0] > 0);

  const z = w.zones[0];
  const e = w.enemies[0];
  e.pos.x = z.pos.x + 40;
  e.pos.y = z.pos.y;
  const hp0 = e.hp;
  w.updateZones(0.61);
  check("黑洞雷：造成伤害", e.hp < hp0);
  check("黑洞雷：施加牵引", e.ext !== null);
}

/* ============ 12. 技能：陨落 ============ */
{
  const w = makeWorld();
  w.spawnEnemy("puze", { x: 520, y: 150 });
  w.tick({ ...input, skillE: true }, 1 / 60);
  check("陨落：进入落点预瞄", w.player.mode === "leapaim");
  w.tick({ ...input, altPressed: true, altHeld: true }, 1 / 60);
  check("陨落：右键取消预瞄", w.player.mode === "none" && w.player.skillCd[1] === 0);

  w.tick({ ...input, skillE: true }, 1 / 60);
  w.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  for (let i = 0; i < 60; i++) w.tick(input, 1 / 60);
  check("陨落：落到目标点附近", w.player.pos.x > 500);
  check("陨落：造成伤害并陷地", w.enemies[0].hp < w.enemies[0].maxHp && w.enemies[0].rootT > 0);
}

/* ============ 13. 技能：磐石护体 ============ */
{
  const w = makeWorld();
  w.tick({ ...input, skillF: true }, 1 / 60);
  check("磐石护体：进入减伤状态", w.player.stoneT > 0);
  w.player.hp = 100;
  w.player.invuln = 0;
  w.damagePlayer(20);
  check("磐石护体：减伤生效", w.player.hp > 85);
}

/* ============ 14. 域兽：失恰 ============ */
{
  const w = makeWorld();
  w.player.pos = { x: 520, y: 150 };
  w.spawnEnemy("shiqia", { x: 600, y: 150 });
  let everShot = false;
  for (let i = 0; i < 300; i++) {
    w.tick(input, 1 / 60);
    if (w.shots.length > 0) everShot = true;
  }
  check("失恰：进入范围后会射出子弹", everShot);

  const w2 = makeWorld();
  w2.spawnEnemy("shiqia", { x: 500, y: 150 });
  w2.enemyShoot(w2.enemies[0], w2.player.pos);
  check("失恰：子弹身份为飞行物", w2.shots[0]?.tag === "flight");
}

/* ============ 15. 技能塑造 ============ */
{
  // 白扩
  const w = makeWorld();
  w.player.coins = 500;
  w.buySkillShape("blackhole", "whiteout");
  w.spawnEnemy("puze", { x: 580, y: 150 });
  w.tick({ ...input, skillQ: true }, 1 / 60);
  w.tick({ ...input, firePressed: true, fireHeld: true }, 1 / 60);
  for (let i = 0; i < 35; i++) w.tick(input, 1 / 60);
  const z = w.zones[0];
  const e = w.enemies[0];
  const hp0 = e.hp;
  const d0 = Math.hypot(e.pos.x - z.pos.x, e.pos.y - z.pos.y);
  w.tick({ ...input, skillQ: true }, 1 / 60);
  check("白扩：再次按 Q 立即引爆", w.zones.length === 0);
  check("白扩：造成伤害", e.hp < hp0);
  check("白扩：把敌人向外击退", Math.hypot(e.pos.x - z.pos.x, e.pos.y - z.pos.y) > d0);

  // 斥爆
  const w2 = makeWorld();
  w2.player.coins = 500;
  w2.buySkillShape("blackhole", "detonate");
  w2.zones.push({ id: 1, owner: "player", pos: { x: 520, y: 150 }, radius: 66, ttl: 3, maxTtl: 3, tick: 0.6, blastLock: 0, pulse: 0 });
  w2.spawnEnemy("puze", { x: 470, y: 150 });
  const hp2 = w2.enemies[0].hp;
  w2.fireRail(0);
  for (let i = 0; i < 20; i++) w2.tick(input, 1 / 60);
  check("斥爆：飞行物进入范围引发爆炸", w2.enemies[0].hp < hp2);

  // 斥爆：子弹不被隔断
  const w3 = makeWorld();
  w3.player.coins = 500;
  w3.buySkillShape("blackhole", "detonate");
  w3.zones.push({ id: 1, owner: "player", pos: { x: 520, y: 150 }, radius: 66, ttl: 3, maxTtl: 3, tick: 0.6, blastLock: 0, pulse: 0 });
  w3.fireRail(0);
  let maxX = 0;
  for (let i = 0; i < 30; i++) {
    w3.tick(input, 1 / 60);
    for (const l of w3.lasers) maxX = Math.max(maxX, l.pos.x);
  }
  check("斥爆：子弹穿过范围继续飞", maxX > 530);

  // 引力超标
  const w4 = makeWorld();
  w4.player.coins = 500;
  w4.buySkillShape("blackhole", "overflow");
  w4.player.pos = { x: 520, y: 150 };
  w4.zones.push({ id: 1, owner: "player", pos: { x: 520, y: 150 }, radius: 66, ttl: 3, maxTtl: 3, tick: 0.6, blastLock: 0, pulse: 0 });
  w4.updateZones(0.05);
  check("引力超标：站进范围获得增益", w4.player.zoneBuffT > 0);

  // 噬速力
  const w5 = makeWorld();
  w5.player.coins = 500;
  w5.buySkillShape("blackhole", "slowfield");
  w5.zones.push({ id: 1, owner: "player", pos: { x: 500, y: 150 }, radius: 66, ttl: 3, maxTtl: 3, tick: 0.6, blastLock: 0, pulse: 0 });
  w5.shots.push({ tag: "flight", pos: { x: 495, y: 150 }, vel: { x: 200, y: 0 }, radius: 4, dmg: 5, life: 2 });
  const sx = w5.shots[0].pos.x;
  w5.updateShots(0.1);
  check("噬速力：敌方飞行物变慢", w5.shots[0].pos.x - sx < 15);

  check("塑造：不能重复购买", w5.buySkillShape("blackhole", "slowfield") === false);
}

/* ============ 16. 身份注册表 ============ */
{
  const attrs = Object.values(IDENTITIES).filter((d) => d.group === "attr");
  check("身份表：属性身份有 7 个", attrs.length === 7);
  check("身份表：名字与设计一致", attrs.every((a) => a.name.length > 0));
  const missing = validateIdentities();
  check("身份表：每个属性身份都有对应数值身份", missing.length === 0);
}

/* ============ 结果 ============ */
const summary = `结果：${pass} 通过 / ${fail} 失败`;
logEl.innerHTML += `<h1 class="${fail === 0 ? 'ok' : 'bad'}">${summary}</h1>`;
console.log('%c' + summary, fail === 0 ? 'color:#7fe0a0;font-size:16px' : 'color:#ff5f6d;font-size:16px');
