import type { InputSnapshot } from '../shared/types';
import type { ClientMsg, ServerMsg, WorldWire } from '../../server/protocol';

export class NetClient {
  private ws: WebSocket | null = null;
  private latest: WorldWire | null = null;
  private connected = false;
  playerIndex = 0;
  /** 快照序号，只有新快照才需要应用 */
  seq = 0;
  /** 快照平均间隔（秒），用于插值速度 */
  interval = 0.033;
  private lastAt = 0;

  connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      const msg: ClientMsg = { t: 'join', name: '域卫' };
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.playerIndex = msg.playerId - 1;
      if (msg.t === 'state') {
        const now = performance.now();
        if (this.lastAt > 0) {
          const d = (now - this.lastAt) / 1000;
          if (d > 0.005 && d < 0.5) this.interval = this.interval * 0.7 + d * 0.3;
        }
        this.lastAt = now;
        this.latest = msg.world;
        this.seq++;
      }
    };
    ws.onclose = () => {
      this.connected = false;
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  takeSnapshot(): WorldWire | null {
    return this.latest;
  }

  buyWeapon(id: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'buy', kind: 'weapon', id } as ClientMsg));
  }

  buySkill(skillId: string, id: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'buy', kind: 'skill', id, skillId } as ClientMsg));
  }

  sendInput(input: InputSnapshot): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: ClientMsg = {
      t: 'input',
      snap: {
        moveX: input.moveX,
        moveY: input.moveY,
        aimX: input.aimX,
        aimY: input.aimY,
        fireHeld: input.fireHeld,
        firePressed: input.firePressed,
        altHeld: input.altHeld,
        altPressed: input.altPressed,
        reloadPressed: input.reloadPressed,
        rollPressed: input.rollPressed,
        skillQ: input.skillQ,
        skillE: input.skillE,
        skillF: input.skillF,
        panel: input.panel,
        skip: input.skip,
      },
    };
    this.ws.send(JSON.stringify(msg));
  }
}
