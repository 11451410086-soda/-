/**
 * 联机房间：两个阶段
 *   1. ready   准备房间 —— 显示房间号/邀请链接，两人都可以准备
 *   2. loadout 选武器 —— 双方各选武器，互相可见，两人都点「出发」才开局
 *
 * 每个玩家自己的鼠标位置会同步给对方（归一化坐标），大厅里能看到两个光标。
 */

import { RAIL_WEAPON, SHIELD_WEAPON, SKILLS } from '../content/defs';

export type LobbyWeapon = 'railgun' | 'shield';
export type LobbyRole = 'host' | 'guest';
export type LobbyPhase = 'ready' | 'loadout';

export interface LobbyCard {
  weapon: LobbyWeapon;
  ready: boolean;
  cx: number;
  cy: number;
}

export interface LobbyView {
  role: LobbyRole;
  phase: LobbyPhase;
  room: string;
  self: LobbyCard;
  peer: LobbyCard | null;
  /** 数据通道已连上（但对面可能还没进房间/没广播） */
  peerConnected: boolean;
  countdown: boolean;
}

export interface CoopLobbyHandlers {
  onReady: (ready: boolean) => void;
  onWeapon: (weapon: LobbyWeapon) => void;
  onLeave: () => void;
  onMove: (nx: number, ny: number) => void;
  onInvite: () => void;
}

const WEAPON_NAME: Record<LobbyWeapon, string> = {
  railgun: RAIL_WEAPON.name,
  shield: SHIELD_WEAPON.name,
};

const SKILL_KEYS: [string, string][] = [
  ['blackhole', 'Q'],
  ['leap', 'E'],
  ['stone', 'F'],
];

interface CardEls {
  root: HTMLElement;
  badge: HTMLElement;
  state: HTMLElement;
  weapons: HTMLButtonElement[];
  skills: HTMLElement;
}

export class CoopLobby {
  private root: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private roomCode: HTMLElement;
  private inviteBtn: HTMLButtonElement;
  private readyBtn: HTMLButtonElement;
  private loadoutEl: HTMLElement;
  private heroPick: HTMLElement;
  private peerTitle: HTMLElement;
  private peerWeapon: HTMLElement;
  private peerTag: HTMLElement;
  private peerState: HTMLElement;
  private weaponCards: HTMLElement[] = [];
  private cards: Record<LobbyRole, CardEls>;
  private cursors: Record<LobbyRole, HTMLElement>;
  private handlers: CoopLobbyHandlers;
  private role: LobbyRole = 'host';
  private phase: LobbyPhase = 'ready';
  private self: LobbyCard = { weapon: 'railgun', ready: false, cx: 0.5, cy: 0.5 };

  constructor(handlers: CoopLobbyHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'coop';
    this.root.className = 'screen coop hidden';
    this.root.innerHTML =
      '<div class="coop-inner">' +
      '<div class="logo mini" id="coop-title">准备房间</div>' +
      '<div class="coop-sub" id="coop-sub">把邀请链接发给朋友，两人都准备后开始</div>' +
      '<div class="coop-room" id="coop-room">' +
      '<span class="coop-room-label">房间号</span>' +
      '<b id="coop-room-code">----</b>' +
      '<button id="coop-invite" class="btn small">复制邀请链接</button>' +
      '</div>' +
      '<div class="coop-cards" id="coop-cards"></div>' +
      '<div class="coop-loadout" id="coop-loadout">' +
      '<div class="hero-pick" id="coop-hero-pick"></div>' +
      '<div class="coop-peer-mini">' +
      '<div class="coop-peer-title" id="coop-peer-title">客人</div>' +
      '<div class="coop-peer-weapon" id="coop-peer-weapon">还未选择</div>' +
      '<div class="coop-peer-tag" id="coop-peer-tag"></div>' +
      '<div class="coop-peer-state" id="coop-peer-state">等待进入</div>' +
      '</div>' +
      '</div>' +
      '<div class="coop-actions">' +
      '<button id="coop-ready" class="btn">准 备</button>' +
      '<button id="coop-leave" class="btn ghost">离 开</button>' +
      '</div>' +
      '</div>' +
      '<div class="coop-cursor" data-side="host"><i></i><span>房主</span></div>' +
      '<div class="coop-cursor" data-side="guest"><i></i><span>客人</span></div>';
    document.body.appendChild(this.root);

    this.title = this.root.querySelector('#coop-title') as HTMLElement;
    this.sub = this.root.querySelector('#coop-sub') as HTMLElement;
    this.roomCode = this.root.querySelector('#coop-room-code') as HTMLElement;
    this.inviteBtn = this.root.querySelector('#coop-invite') as HTMLButtonElement;
    this.readyBtn = this.root.querySelector('#coop-ready') as HTMLButtonElement;
    this.loadoutEl = this.root.querySelector('#coop-loadout') as HTMLElement;
    this.heroPick = this.root.querySelector('#coop-hero-pick') as HTMLElement;
    this.peerTitle = this.root.querySelector('#coop-peer-title') as HTMLElement;
    this.peerWeapon = this.root.querySelector('#coop-peer-weapon') as HTMLElement;
    this.peerTag = this.root.querySelector('#coop-peer-tag') as HTMLElement;
    this.peerState = this.root.querySelector('#coop-peer-state') as HTMLElement;
    this.buildLoadout();
    this.cards = {
      host: this.makeCard('host'),
      guest: this.makeCard('guest'),
    };
    this.cursors = {
      host: this.root.querySelector('.coop-cursor[data-side="host"]') as HTMLElement,
      guest: this.root.querySelector('.coop-cursor[data-side="guest"]') as HTMLElement,
    };

    this.readyBtn.addEventListener('click', () => this.handlers.onReady(!this.self.ready));
    (this.root.querySelector('#coop-leave') as HTMLButtonElement).addEventListener('click', () =>
      this.handlers.onLeave(),
    );
    this.inviteBtn.addEventListener('click', () => {
      this.handlers.onInvite();
      this.inviteBtn.textContent = '已复制';
      window.setTimeout(() => {
        this.inviteBtn.textContent = '复制邀请链接';
      }, 1600);
    });

    this.root.addEventListener('mousemove', (e) => {
      const nx = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
      const ny = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
      this.self.cx = nx;
      this.self.cy = ny;
      this.placeCursor(this.role, nx, ny);
      this.handlers.onMove(nx, ny);
    });
  }

  private makeCard(side: LobbyRole): CardEls {
    const root = document.createElement('div');
    root.className = 'coop-card';
    root.dataset.side = side;
    root.innerHTML =
      '<div class="coop-card-head"><b>' +
      (side === 'host' ? '房主' : '客人') +
      '</b><span class="coop-badge">未连接</span></div>' +
      '<div class="coop-weapons">' +
      '<button class="coop-w" data-w="railgun">' + WEAPON_NAME.railgun + '</button>' +
      '<button class="coop-w" data-w="shield">' + WEAPON_NAME.shield + '</button>' +
      '</div>' +
      '<div class="coop-skills"></div>' +
      '<div class="coop-state">未准备</div>';
    (this.root.querySelector('#coop-cards') as HTMLElement).appendChild(root);

    const weapons = Array.from(root.querySelectorAll('.coop-w')) as HTMLButtonElement[];
    for (const btn of weapons) {
      btn.addEventListener('click', () => {
        if (root.dataset.side !== this.role) return;
        this.handlers.onWeapon(btn.dataset.w as LobbyWeapon);
      });
    }

    const skills = root.querySelector('.coop-skills') as HTMLElement;
    skills.innerHTML = SKILL_KEYS.map(
      ([id, key]) => '<span class="coop-skill"><i>' + key + '</i>' + SKILLS[id].name + '</span>',
    ).join('');

    return {
      root,
      badge: root.querySelector('.coop-badge') as HTMLElement,
      state: root.querySelector('.coop-state') as HTMLElement,
      weapons,
      skills,
    };
  }

  isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** 选武器阶段的大卡片：跟单机准备界面同一套样式 */
  private buildLoadout(): void {
    const rail = RAIL_WEAPON;
    const shield = SHIELD_WEAPON;
    const kv = (k: string, v: string) =>
      '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>';
    const ops = (rows: [string, string][]) =>
      '<div class="card-ops"><div class="card-ops-title">武器操作</div>' +
      rows
        .map(([k, v]) => '<div class="card-ops-row"><b>' + k + '</b><span>' + v + '</span></div>')
        .join('') +
      '</div>';

    this.heroPick.innerHTML =
      '<div class="prep-card weapon" data-w="railgun">' +
      '<div class="prep-card-head"><b>' + rail.name + '</b><span>远程</span></div>' +
      '<p class="prep-desc">射出一枚圆形蓝色电磁球（身份：飞行物），命中造成伤害。</p>' +
      '<div class="prep-detail">' +
      kv('飞行物伤害', String(rail.damage)) +
      kv('飞行物间隔', rail.fireInterval + ' 秒') +
      kv('飞行物范围', String(rail.range)) +
      kv('回复时间', rail.reload + ' 秒') +
      kv('容量', rail.magSize + ' 发') +
      ops([['左键', '射击'], ['右键', '瞄准'], ['R', '换弹']]) +
      '<div class="prep-tags"><i>远程</i><i>飞行物</i></div>' +
      '</div></div>' +
      '<div class="prep-card weapon" data-w="shield">' +
      '<div class="prep-card-head"><b>' + shield.name + '</b><span>近战</span></div>' +
      '<p class="prep-desc">身侧有可转向的抵挡范围，挡下飞行物与近战击；左键盾击、击退敌人。耐久耗尽会破碎，进入陨星状态。</p>' +
      '<div class="prep-detail">' +
      kv('近战击伤害', String(shield.damage)) +
      kv('近战击间隔', shield.interval + ' 秒') +
      kv('近战击范围', String(shield.range)) +
      kv('控制时长', shield.knockTime + ' 秒') +
      kv('耐久', String(shield.durabilityMax)) +
      kv('减益效果', '抵挡伤害 −' + Math.round(shield.blockDR * 100) + '%') +
      kv('增益加成', '陨星减伤 ' + Math.round(shield.meteorDR * 100) + '%') +
      ops([['左键', '盾击'], ['右键', '转向']]) +
      '<div class="prep-tags"><i>近战</i><i>近战击</i><i>生理控制</i></div>' +
      '</div></div>';

    this.weaponCards = Array.from(
      this.heroPick.querySelectorAll('.prep-card.weapon'),
    ) as HTMLElement[];
    for (const el of this.weaponCards) {
      el.addEventListener('click', () => this.handlers.onWeapon(el.dataset.w as LobbyWeapon));
    }
  }

  show(role: LobbyRole, weapon: LobbyWeapon, room: string): void {    this.role = role;
    this.phase = 'ready';
    this.self = { weapon, ready: false, cx: 0.5, cy: 0.5 };
    this.root.dataset.self = role;
    this.root.classList.remove('hidden');
    this.roomCode.textContent = room;
    this.placeCursor(role, 0.5, 0.5);
    this.cursors[role === 'host' ? 'guest' : 'host'].style.display = 'none';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setSelfCursor(nx: number, ny: number): void {
    this.placeCursor(this.role, nx, ny);
  }

  setPeerCursor(nx: number, ny: number): void {
    this.placeCursor(this.role === 'host' ? 'guest' : 'host', nx, ny);
  }

  private placeCursor(side: LobbyRole, nx: number, ny: number): void {
    const el = this.cursors[side];
    el.style.display = '';
    el.style.left = (nx * 100).toFixed(2) + '%';
    el.style.top = (ny * 100).toFixed(2) + '%';
  }

  update(view: LobbyView): void {
    this.role = view.role;
    this.self = view.self;
    this.phase = view.phase;
    const peerSide: LobbyRole = view.role === 'host' ? 'guest' : 'host';

    this.root.classList.toggle('phase-ready', view.phase === 'ready');
    this.root.classList.toggle('phase-loadout', view.phase === 'loadout');
    this.root.dataset.self = view.role;
    this.roomCode.textContent = view.room;

    this.title.textContent = view.phase === 'ready' ? '准备房间' : '选择武器';
    const normalLabel = view.phase === 'ready' ? '准 备' : '出 发';
    const cancelLabel = view.phase === 'ready' ? '取消准备' : '取消出发';
    this.readyBtn.textContent = view.self.ready ? cancelLabel : normalLabel;
    this.readyBtn.classList.toggle('ready', view.self.ready);

    this.renderCard(view.role, view.self, true, true, view.phase);
    this.renderCard(peerSide, view.peer, false, view.peer !== null || view.peerConnected, view.phase);

    // 选武器阶段：大卡片跟单机准备界面一致，对方只显示简略信息
    for (const el of this.weaponCards) {
      el.classList.toggle('selected', el.dataset.w === view.self.weapon);
    }
    this.peerTitle.textContent = view.role === 'guest' ? '房主' : '客人';
    if (view.peer) {
      this.peerWeapon.textContent = WEAPON_NAME[view.peer.weapon];
      this.peerTag.textContent = view.peer.weapon === 'shield' ? '近战 · 陨盾' : '远程 · 电磁炮';
      this.peerState.textContent = view.peer.ready ? '已出发' : '未准备';
    } else {
      this.peerWeapon.textContent = '还未选择';
      this.peerTag.textContent = '';
      this.peerState.textContent = view.peerConnected ? '已连接' : '等待进入';
    }

    if (view.countdown) {
      this.sub.textContent = '双方已就绪，即将开始…';
      this.sub.classList.add('good');
    } else if (!view.peer) {
      this.sub.textContent =
        view.role === 'guest'
          ? '等待房主…'
          : view.phase === 'ready'
            ? '等待朋友加入…先复制邀请链接发给他'
            : '等待对方…';
      this.sub.classList.remove('good');
    } else if (view.phase === 'ready') {
      this.sub.textContent = view.self.ready
        ? '已准备，等对方…（再点按钮可取消）'
        : view.peer.ready
          ? '对方已准备，等你点「准备」'
          : '把邀请链接发给朋友，两人都准备后开始';
      this.sub.classList.toggle('good', view.peer.ready && !view.self.ready);
    } else {
      this.sub.textContent = view.self.ready
        ? '已出发，等对方…（再点按钮可取消）'
        : view.peer.ready
          ? '对方已出发，等你点「出发」'
          : '各自选武器，两个人都点「出发」就开始';
      this.sub.classList.toggle('good', view.peer.ready && !view.self.ready);
    }

    if (view.peer) this.setPeerCursor(view.peer.cx, view.peer.cy);
  }

  private renderCard(
    side: LobbyRole,
    card: LobbyCard | null,
    isSelf: boolean,
    connected: boolean,
    phase: LobbyPhase,
  ): void {
    const els = this.cards[side];
    els.badge.textContent = isSelf ? '你' : connected ? '已连接' : '未连接';
    els.badge.classList.toggle('self', isSelf);
    els.root.classList.toggle('is-self', isSelf);
    els.root.classList.toggle('is-ready', !!card?.ready);
    els.root.classList.toggle('offline', !connected);
    // 准备阶段不显示武器/技能，进入选武器阶段才出现
    els.root.classList.toggle('show-kit', phase === 'loadout');

    for (const btn of els.weapons) {
      btn.classList.toggle('on', card?.weapon === btn.dataset.w);
      btn.disabled = !isSelf;
    }

    if (!connected || !card) {
      els.state.textContent = isSelf ? (this.self.ready ? '已准备' : '未准备') : '等待进入';
      return;
    }
    const label = phase === 'ready' ? '已准备' : '已出发';
    els.state.textContent = card.ready ? label : '未准备';
  }
}
