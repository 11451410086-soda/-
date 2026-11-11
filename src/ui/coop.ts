/**
 * 联机准备大厅：房主和客人看同一个界面，两个鼠标都可见。
 * 「出发」必须双方都点，右键取消自己的选择。
 */

export type LobbyWeapon = 'railgun' | 'shield';
export type LobbyRole = 'host' | 'guest';

export interface LobbyCard {
  weapon: LobbyWeapon;
  ready: boolean;
  cx: number;
  cy: number;
}

export interface LobbyView {
  role: LobbyRole;
  self: LobbyCard;
  peer: LobbyCard | null;
  countdown: boolean;
}

export interface CoopLobbyHandlers {
  onReady: (ready: boolean) => void;
  onWeapon: (weapon: LobbyWeapon) => void;
  onLeave: () => void;
  onMove: (nx: number, ny: number) => void;
}

interface CardEls {
  root: HTMLElement;
  badge: HTMLElement;
  state: HTMLElement;
  weapons: HTMLButtonElement[];
}

const WEAPON_NAME: Record<LobbyWeapon, string> = {
  railgun: '电磁炮',
  shield: '盾',
};

export class CoopLobby {
  private root: HTMLElement;
  private sub: HTMLElement;
  private readyBtn: HTMLButtonElement;
  private cards: Record<LobbyRole, CardEls>;
  private cursors: Record<LobbyRole, HTMLElement>;
  private handlers: CoopLobbyHandlers;
  private role: LobbyRole = 'host';
  private self: LobbyCard = { weapon: 'railgun', ready: false, cx: 0.5, cy: 0.5 };

  constructor(handlers: CoopLobbyHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'coop';
    this.root.className = 'screen coop hidden';
    this.root.innerHTML =
      '<div class="coop-inner">' +
      '<div class="logo mini">联机准备</div>' +
      '<div class="coop-sub" id="coop-sub">两人都点「出发」才会开始 · 右键取消</div>' +
      '<div class="coop-cards" id="coop-cards"></div>' +
      '<div class="coop-actions">' +
      '<button id="coop-ready" class="btn">出 发</button>' +
      '<button id="coop-leave" class="btn ghost">离 开</button>' +
      '</div>' +
      '</div>' +
      '<div class="coop-cursor" data-side="host"><i></i><span>房主</span></div>' +
      '<div class="coop-cursor" data-side="guest"><i></i><span>客人</span></div>';
    document.body.appendChild(this.root);

    this.sub = this.root.querySelector('#coop-sub') as HTMLElement;
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

    this.root.addEventListener('mousemove', (e) => {
      const nx = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
      const ny = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
      this.self.cx = nx;
      this.self.cy = ny;
      this.placeCursor(this.role, nx, ny);
      this.handlers.onMove(nx, ny);
    });

    // 右键取消自己的就绪
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
      '<div class="coop-state">未就绪</div>';
    (this.root.querySelector('#coop-cards') as HTMLElement).appendChild(root);

    const weapons = Array.from(root.querySelectorAll('.coop-w')) as HTMLButtonElement[];
    for (const btn of weapons) {
      btn.addEventListener('click', () => {
        if (root.dataset.side !== this.role) return;
        this.handlers.onWeapon(btn.dataset.w as LobbyWeapon);
      });
    }

    return {
      root,
      badge: root.querySelector('.coop-badge') as HTMLElement,
      state: root.querySelector('.coop-state') as HTMLElement,
      weapons,
    };
  }

  isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(role: LobbyRole, weapon: LobbyWeapon): void {
    this.role = role;
    this.self = { weapon, ready: false, cx: 0.5, cy: 0.5 };
    this.root.dataset.self = role;
    this.root.classList.remove('hidden');
    this.placeCursor(role, 0.5, 0.5);
    this.cursors[role === 'host' ? 'guest' : 'host'].style.display = 'none';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 自机光标本地即时跟随，不等网络 */
  setSelfCursor(nx: number, ny: number): void {
    this.placeCursor(this.role, nx, ny);
  }

  setPeerCursor(nx: number, ny: number): void {
    const side: LobbyRole = this.role === 'host' ? 'guest' : 'host';
    this.placeCursor(side, nx, ny);
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
    const peerSide: LobbyRole = view.role === 'host' ? 'guest' : 'host';

    this.renderCard(view.role, view.self, true, true);
    this.renderCard(peerSide, view.peer, false, view.peer !== null);

    const up = view.self.ready;
    this.readyBtn.textContent = up ? '已就绪 · 右键取消' : '出 发';
    this.readyBtn.classList.toggle('ready', up);

    if (view.countdown) {
      this.sub.textContent = '双方已就绪，即将开始…';
      this.sub.classList.add('good');
    } else if (!view.peer) {
      this.sub.textContent = '等待对方进入…';
      this.sub.classList.remove('good');
    } else if (view.peer.ready && !view.self.ready) {
      this.sub.textContent = '对方已就绪，等你点「出发」';
      this.sub.classList.add('good');
    } else {
      this.sub.textContent = '两人都点「出发」才会开始 · 右键取消';
      this.sub.classList.remove('good');
    }
  }

  private renderCard(side: LobbyRole, card: LobbyCard | null, isSelf: boolean, connected: boolean): void {
    const els = this.cards[side];
    els.badge.textContent = isSelf ? '你' : connected ? '已连接' : '未连接';
    els.badge.classList.toggle('self', isSelf);
    els.root.classList.toggle('is-self', isSelf);
    els.root.classList.toggle('is-ready', !!card?.ready);
    els.root.classList.toggle('offline', !connected);

    for (const btn of els.weapons) {
      const on = card?.weapon === btn.dataset.w;
      btn.classList.toggle('on', on);
      btn.disabled = !isSelf;
    }

    if (!connected || !card) {
      els.state.textContent = isSelf ? (this.self.ready ? '已就绪' : '未就绪') : '等待进入';
      return;
    }
    els.state.textContent = card.ready ? '已就绪' : '未就绪';
  }
}
