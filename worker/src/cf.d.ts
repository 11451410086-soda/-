/**
 * Cloudflare Workers 运行时类型的最小声明。
 * 只声明这个 worker 用到的部分，避免为了部署再装 @cloudflare/workers-types。
 */

declare class DurableObjectId {}

declare class DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(req: Request): Promise<Response> };
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

/** Workers 的 WebSocket 额外有 accept()，DOM 类型里没有 */
interface WebSocket {
  accept(): void;
}

interface ResponseInitWithSocket extends ResponseInit {
  webSocket?: WebSocket;
}
