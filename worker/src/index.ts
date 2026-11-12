/**
 * 界域净化 · 联机信令/中继（Cloudflare Worker + Durable Object）
 *
 * 和 Render 版协议完全一致：客户端连 wss://<worker>/ws?room=XXXX，
 * 消息体里带 room 字段，服务器按 room 转发给同房间的其他人。
 * 支持的消息：p2p-join / p2p-offer / p2p-answer / p2p-ice（中继数据也塞在 p2p-ice 里）。
 *
 * 用 Durable Object 是因为 WebSocket 需要跨请求持有连接状态；
 * 全部房间放同一个 DO 实例（这个体量完全够），省去路由复杂度。
 */

export interface Env {
  ROOMS: DurableObjectNamespace;
}

type Room = Set<WebSocket>;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // 普通 HTTP 请求：健康检查 / 唤醒用
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('jie-yu-jing-hua signaling ok', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    void url;
    const id = env.ROOMS.idFromName('global');
    return env.ROOMS.get(id).fetch(req);
  },
};

export class RoomHub {
  private rooms = new Map<string, Room>();
  /** socket -> 它所在的房间（一个连接只在一个房间里） */
  private socketRoom = new WeakMap<WebSocket, string>();

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    server.addEventListener('message', (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      if (!raw) return;
      let msg: { t?: string; room?: string };
      try {
        msg = JSON.parse(raw) as { t?: string; room?: string };
      } catch {
        return;
      }
      const room = typeof msg.room === 'string' ? msg.room : '';
      if (!room) return;

      if (msg.t === 'p2p-join') this.socketRoom.set(server, room);
      const mine = this.socketRoom.get(server);
      if (mine !== room) this.socketRoom.set(server, room);

      const set = this.rooms.get(room) ?? new Set<WebSocket>();
      if (!this.rooms.has(room)) this.rooms.set(room, set);
      set.add(server);

      // 转发给同房间的其他人（包括 join，房主靠它决定发 offer）
      for (const peer of set) {
        if (peer === server) continue;
        try {
          peer.send(raw);
        } catch {
          set.delete(peer);
        }
      }
    });

    const detach = (): void => {
      const room = this.socketRoom.get(server);
      if (!room) return;
      const set = this.rooms.get(room);
      set?.delete(server);
      if (set && set.size === 0) this.rooms.delete(room);
    };
    server.addEventListener('close', detach);
    server.addEventListener('error', detach);

    return new Response(null, { status: 101, webSocket: client } as ResponseInitWithSocket);
  }
}
