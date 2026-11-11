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
    this.cards = {
      host: this.makeCard('host'),
      guest: this.makeCard('guest'),
    };
    this.cursors = {
      host: this.root.querySelector('.coop-cursor[data-side="host"]') as HTMLElement,
      guest: this.root.querySelector('.coop-cursor[data-side="guest"]') as HTMLElement,
    };

    this.readyBtn.addEventListener('click', () => this.handlers.onReady(true));
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

    // 右键取消自己的准备 / 出发
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.handlers.onReady(false);
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

  show(role: LobbyRole, weapon: LobbyWeapon, room: string): void {
    this.role = role;
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
    this.readyBtn.textContent = view.phase === 'ready' ? '准 备' : '出 发';
    this.readyBtn.classList.toggle('ready', view.self.ready);

    this.renderCard(view.role, view.self, true, true, view.phase);
    this.renderCard(peerSide, view.peer, false, view.peer !== null, view.phase);

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
        ? '已准备，等对方准备…'
        : view.peer.ready
          ? '对方已准备，等你点「准备」'
          : '把邀请链接发给朋友，两人都准备后开始';
      this.sub.classList.toggle('good', view.peer.ready && !view.self.ready);
    } else {
      this.sub.textContent = view.self.ready
        ? '已出发，等对方…'
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
