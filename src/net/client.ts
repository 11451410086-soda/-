import type { InputSnapshot } from '../shared/types';
import type { ClientMsg, ServerMsg, WorldWire } from '../../server/protocol';

export class NetClient {
  private ws: WebSocket | null = null;
  private latest: WorldWire | null = null;
  private connected = false;
  playerIndex = 0;

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
      if (msg.t === 'state') this.latest = msg.world;
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
