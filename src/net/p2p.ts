/**
 * WebRTC 点对点连接（房主权威）
 *
 * 房主跑世界，30Hz 发快照；客人回传输入。信令只做转发，走现有 ws 服务器的 `p2p-*` 消息。
 *
 * 时序上的几个坑（上一版踩过）：
 * - 房主不能在 ws 一打开就发 offer：客人若晚到，offer 早被服务器丢掉了。
 *   所以房主只在收到 `p2p-join` 时才发 offer，客人没连上就每 1.2 秒重发 join。
 * - ICE 候选可能早于 remoteDescription 到达，必须排队，否则连接建不起来。
 * - 状态快照走不可靠通道（丢了下一帧就补上），输入走可靠通道（按键边沿不能丢）。
 */

export type P2PStatus = 'connecting' | 'waiting' | 'connected' | 'failed';

type SignalMsg =
  | { t: 'p2p-offer'; room: string; sdp: string }
  | { t: 'p2p-answer'; room: string; sdp: string }
  | { t: 'p2p-ice'; room: string; cand: RTCIceCandidateInit; to: 'host' | 'guest' }
  | { t: 'p2p-join'; room: string };

export interface P2POptions {
  room: string;
  role: 'host' | 'guest';
  signalUrl: string;
  onOpen: () => void;
  onData: (raw: string) => void;
  onFail: (reason: string) => void;
  onStatus?: (status: P2PStatus, detail?: string) => void;
  /** ?debug=1 时打印信令细节 */
  debug?: boolean;
}

/** STUN 免费；TURN 用 openrelay 公共节点兜底对称 NAT（未必长期可用，但不影响直连） */
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.cloudflare.com:3478',
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const JOIN_RETRY_MS = 1200;
/** 同一房间重复 join 时，offer 的最小间隔（避免双方互相打断） */
const OFFER_COOLDOWN_MS = 4000;
const CONNECT_TIMEOUT_MS = 15000;

export class P2P {
  private pc: RTCPeerConnection | null = null;
  private stateDc: RTCDataChannel | null = null;
  private inputDc: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private opts: P2POptions;
  private connected = false;
  private closed = false;
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private joinTimer: number | null = null;
  private connectTimer: number | null = null;
  private lastOfferAt = 0;
  private lastFailAt = 0;

  constructor(opts: P2POptions) {
    this.opts = opts;
  }

  private log(...args: unknown[]): void {
    if (this.opts.debug) console.log('[p2p]', this.opts.role, ...args);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  start(): void {
    this.opts.onStatus?.('connecting', '正在连接信令服务器…');
    const ws = new WebSocket(this.opts.signalUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.sendSignal({ t: 'p2p-join', room: this.opts.room });
      this.opts.onStatus?.(
        'waiting',
        this.opts.role === 'host' ? '等待朋友加入…' : '正在连接房主…',
      );
      // 客人没连上就不断重发 join，房主收到后才发 offer
      this.joinTimer = window.setInterval(() => {
        if (!this.connected) this.sendSignal({ t: 'p2p-join', room: this.opts.room });
      }, JOIN_RETRY_MS);
    };

    ws.onmessage = (ev) => this.onSignal(ev);
    ws.onerror = () => this.opts.onStatus?.('failed', '信令服务器连接失败');
    ws.onclose = () => {
      if (!this.closed && !this.connected) this.fail('信令服务器断开');
    };
  }

  /** 房主 → 客人：世界快照（不可靠通道，丢帧无妨） */
  sendState(payload: unknown): void {
    this.sendOn(this.stateDc, payload);
  }

  /** 客人 → 房主：输入（可靠通道，按键边沿不能丢） */
  sendInput(payload: unknown): void {
    this.sendOn(this.inputDc, payload);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    if (this.joinTimer !== null) window.clearInterval(this.joinTimer);
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.joinTimer = null;
    this.connectTimer = null;
    this.stateDc?.close();
    this.inputDc?.close();
    this.pc?.close();
    this.ws?.close();
    this.stateDc = null;
    this.inputDc = null;
    this.pc = null;
    this.ws = null;
  }

  /* ---------------- 信令 ---------------- */

  private onSignal(ev: MessageEvent): void {
    let msg: SignalMsg;
    try {
      msg = JSON.parse(String(ev.data)) as SignalMsg;
    } catch {
      return;
    }
    if (msg.room !== this.opts.room) return;
    this.log('收到', msg.t);
    if (msg.t === 'p2p-join') {
      if (this.opts.role === 'host') this.hostOffer();
      return;
    }

    if (msg.t === 'p2p-offer' && this.opts.role === 'guest') {
      void this.guestAnswer(msg.sdp);
      return;
    }

    if (msg.t === 'p2p-answer' && this.opts.role === 'host') {
      const pc = this.pc;
      if (!pc || this.connected) return;
      void pc
        .setRemoteDescription(JSON.parse(msg.sdp) as RTCSessionDescriptionInit)
        .then(() => {
          this.remoteSet = true;
          this.flushIce();
        })
        .catch(() => this.fail('应答协商失败'));
      return;
    }

    if (msg.t === 'p2p-ice') this.addIce(msg.cand);
  }

  private hostOffer(): void {
    if (this.connected || this.closed) return;
    const now = Date.now();
    if (now - this.lastOfferAt < OFFER_COOLDOWN_MS) return;
    this.lastOfferAt = now;

    const pc = this.resetPeer();
    this.log('发 offer');
    void pc
      .createOffer()
      .then(async (offer) => {
        await pc.setLocalDescription(offer);
        this.sendSignal({
          t: 'p2p-offer',
          room: this.opts.room,
          sdp: JSON.stringify(offer),
        });
      })
      .catch(() => this.fail('发起连接失败'));
    this.armConnectTimer('直连超时（对方可能不在线或网络受限）');
  }

  private async guestAnswer(sdp: string): Promise<void> {
    if (this.connected || this.closed) return;
    this.lastOfferAt = Date.now();
    const pc = this.resetPeer();
    try {
      await pc.setRemoteDescription(JSON.parse(sdp) as RTCSessionDescriptionInit);
      this.remoteSet = true;
      this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({
        t: 'p2p-answer',
        room: this.opts.room,
        sdp: JSON.stringify(answer),
      });
      this.armConnectTimer('连接房主超时');
    } catch {
      this.fail('应答协商失败');
    }
  }

  private addIce(cand: RTCIceCandidateInit): void {
    if (!this.pc) return;
    if (!this.remoteSet) {
      this.pendingIce.push(cand);
      return;
    }
    void this.pc.addIceCandidate(cand).catch(() => undefined);
  }

  private flushIce(): void {
    const pc = this.pc;
    if (!pc) return;
    const list = this.pendingIce.splice(0, this.pendingIce.length);
    for (const cand of list) void pc.addIceCandidate(cand).catch(() => undefined);
  }

  /* ---------------- 连接 ---------------- */

  private resetPeer(): RTCPeerConnection {
    this.stateDc?.close();
    this.inputDc?.close();
    this.pc?.close();
    this.stateDc = null;
    this.inputDc = null;
    this.remoteSet = false;
    this.pendingIce.length = 0;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      this.log('ice', ev.candidate.type, ev.candidate.protocol, ev.candidate.address);
      this.sendSignal({
        t: 'p2p-ice',
        room: this.opts.room,
        cand: ev.candidate.toJSON(),
        to: this.opts.role === 'host' ? 'guest' : 'host',
      });
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      this.log('connection', st);
      if (st === 'failed') this.fail('直连失败（可能是 NAT / 网络限制）');
      else if (st === 'disconnected' && this.connected) {
        this.opts.onStatus?.('failed', '连接不稳定…');
      }
    };

    if (this.opts.role === 'host') {
      this.bindChannel(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      this.bindChannel(pc.createDataChannel('input', { ordered: true }));
    } else {
      pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    }
    return pc;
  }

  private bindChannel(dc: RTCDataChannel): void {
    if (dc.label === 'state') this.stateDc = dc;
    else this.inputDc = dc;

    dc.onopen = () => this.checkConnected();
    dc.onmessage = (ev) => this.opts.onData(String(ev.data));
    dc.onclose = () => {
      if (this.connected && !this.closed) this.fail('对方已断开');
    };
  }

  private checkConnected(): void {
    if (this.connected) return;
    if (this.stateDc?.readyState !== 'open' || this.inputDc?.readyState !== 'open') return;
    this.connected = true;
    this.clearConnectTimer();
    this.opts.onStatus?.('connected', '已连接');
    this.opts.onOpen();
  }

  private armConnectTimer(reason: string): void {
    this.clearConnectTimer();
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (!this.connected) this.fail(reason);
    }, CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.log('fail:', reason);
    this.connected = false;
    this.clearConnectTimer();
    const now = Date.now();
    if (now - this.lastFailAt < 3000) return;
    this.lastFailAt = now;
    this.opts.onStatus?.('failed', reason);
    this.opts.onFail(reason);
  }

  /* ---------------- 发送 ---------------- */

  private sendSignal(msg: SignalMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* 关闭瞬间发送失败，忽略 */
    }
  }

  private sendOn(dc: RTCDataChannel | null, payload: unknown): void {
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(JSON.stringify(payload));
    } catch {
      /* 通道刚关闭，丢一帧 */
    }
  }
}
