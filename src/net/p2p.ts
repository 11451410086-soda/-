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
  | { t: 'p2p-ice'; room: string; cand: RTCIceCandidateInit | RelayEnvelope; to?: 'host' | 'guest' }
  | { t: 'p2p-join'; room: string };

/**
 * 中继信封：直连建不起来时，把 P2P 报文塞进 `p2p-ice` 走信令服务器转发。
 * 借用已有的消息类型，老版本服务器不用改也能转发。
 */
interface RelayEnvelope {
  relay: 1;
  kind: 'mode' | 'data';
  data?: unknown;
}

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

/** 构建时注入的 TURN（VITE_TURN_URL/USER/PASS），没有就用公共 openrelay 兜底 */
function env(name: string): string {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  return meta.env?.[name] ?? '';
}

function envTurn(): RTCIceServer[] {
  const urls = env('VITE_TURN_URL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return [];
  return [{ urls, username: env('VITE_TURN_USER'), credential: env('VITE_TURN_PASS') }];
}

const STUN_URLS = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

const OWN_TURN = envTurn();

const ICE_SERVERS: RTCIceServer[] = [
  { urls: STUN_URLS },
  ...(OWN_TURN.length > 0
    ? OWN_TURN
    : [
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        } satisfies RTCIceServer,
      ]),
];

const JOIN_RETRY_MS = 1200;
/** 同一房间重复 join 时，offer 的最小间隔（避免双方互相打断） */
const OFFER_COOLDOWN_MS = 4000;
const CONNECT_TIMEOUT_MS = 15000;
/** 直连迟迟不通时，多久自动切到服务端中继 */
const RELAY_AFTER_MS = 7000;

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
  private wsRetry: number | null = null;
  private wsRetryCount = 0;
  /** 走服务端中继（直连打不通时） */
  private relayMode = false;
  private relayTimer: number | null = null;
  /** 中继模式下快照降到 30Hz，省带宽 */
  private relayStateSkip = false;
  /** 「我走中继」的广播定时器与次数 */
  private relayAnnounceTimer: number | null = null;
  private relayAnnounceCount = 0;
  /** 是否已收到对方的中继报文（握手完成） */
  private peerRelaySeen = false;
  /** 是否曾经真正连上过（区分「没连上→试中继」和「连上后又断了→直接报错」） */
  private everConnected = false;
  /** 断开宽限期：WebRTC 的 disconnected 可能是暂时的 */
  private disconnectTimer: number | null = null;
  /** 中继模式下最后一次收到对方报文的时间（用于判断对面掉线） */
  private lastPeerAt = 0;
  private relayHeartbeat: number | null = null;

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
    this.connectSignal();
  }

  /** 信令连接：失败自动重试（Render 免费实例会休眠，第一次常常连不上） */
  private connectSignal(): void {
    const ws = new WebSocket(this.opts.signalUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.wsRetryCount = 0;
      this.sendSignal({ t: 'p2p-join', room: this.opts.room });
      this.opts.onStatus?.(
        'waiting',
        this.opts.role === 'host' ? '等待朋友加入…' : '正在连接房主…',
      );
      if (this.joinTimer !== null) window.clearInterval(this.joinTimer);
      // 客人没连上就不断重发 join，房主收到后才发 offer
      this.joinTimer = window.setInterval(() => {
        if (!this.connected) this.sendSignal({ t: 'p2p-join', room: this.opts.room });
      }, JOIN_RETRY_MS);
      // 中继模式：ws 重连后要重新声明一次，并重新武装超时
      const forceRelay =
        typeof location !== 'undefined' && /[?&]relay=1/.test(location.search);
      if (this.relayMode || forceRelay) this.switchToRelay(true);
      else this.armRelayTimer();
    };

    ws.onmessage = (ev) => this.onSignal(ev);
    ws.onerror = () => {
      /* 具体处理放在 onclose */
    };
    ws.onclose = () => {
      // 直连通了就不管信令；中继模式下信令就是数据通道，必须重连
      if (this.closed) return;
      if (this.connected && !this.relayMode) return;
      this.opts.onStatus?.('connecting', '信令服务器无响应，正在重试…');
      this.scheduleSignalRetry();
    };
  }

  /** 直连迟迟不通 → 切服务端中继 */
  private armRelayTimer(): void {
    if (this.relayTimer !== null) window.clearTimeout(this.relayTimer);
    this.relayTimer = window.setTimeout(() => {
      this.relayTimer = null;
      if (!this.connected) this.switchToRelay(true);
    }, RELAY_AFTER_MS);
  }

  private switchToRelay(notify: boolean): void {
    if (this.closed) return;
    if (!this.relayMode) {
      this.relayMode = true;
      this.log('直连未通，切换到服务端中继');
      if (this.relayTimer !== null) window.clearTimeout(this.relayTimer);
      this.relayTimer = null;
    }
    // 中继模式下收到对方的任何中继报文，就说明握手完成，不用再广播了
    if (notify) this.startRelayAnnounce();
    this.becomeConnected();
  }

  /**
   * 反复广播「我走中继」，直到收到对方的任何中继报文。
   * 只发一次的话，如果对方那时还没进信令房间，就会一条直连一条中继、数据单向丢失。
   */
  private startRelayAnnounce(): void {
    if (this.relayAnnounceTimer !== null) return;
    const tick = () => {
      if (this.closed || this.peerRelaySeen) {
        this.stopRelayAnnounce();
        return;
      }
      this.sendRelay({ kind: 'mode' });
      this.relayAnnounceCount++;
      if (this.relayAnnounceCount > 40) {
        this.stopRelayAnnounce();
        return;
      }
      this.relayAnnounceTimer = window.setTimeout(tick, 400);
    };
    this.relayAnnounceCount = 0;
    this.relayAnnounceTimer = window.setTimeout(tick, 0);
  }

  private stopRelayAnnounce(): void {
    if (this.relayAnnounceTimer !== null) window.clearTimeout(this.relayAnnounceTimer);
    this.relayAnnounceTimer = null;
  }

  private becomeConnected(): void {
    if (this.connected) return;
    this.connected = true;
    this.everConnected = true;
    this.clearConnectTimer();
    this.clearDisconnectGrace();
    if (this.relayMode) this.startRelayHeartbeat();
    this.opts.onStatus?.(
      'connected',
      this.relayMode ? '已连接（中继模式，延迟略高）' : '已连接',
    );
    this.opts.onOpen();
  }

  /** WebRTC 报 disconnected 后给几秒缓冲，还不恢复就当断开 */
  private armDisconnectGrace(): void {
    if (this.disconnectTimer !== null) return;
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      const st = this.pc?.connectionState;
      if (!this.closed && this.connected && st !== 'connected') this.fail('对方已断开');
    }, 4000);
  }

  private clearDisconnectGrace(): void {
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  /**
   * 中继模式没有 ICE 状态可看：靠「多久没收到对方报文」判断掉线。
   * 大厅和对局里双方都持续有报文，静默超过 6 秒就当对面走了。
   */
  private startRelayHeartbeat(): void {
    if (this.relayHeartbeat !== null) return;
    this.lastPeerAt = Date.now();
    this.relayHeartbeat = window.setInterval(() => {
      if (this.closed || !this.relayMode) return;
      if (Date.now() - this.lastPeerAt > 6000) {
        this.fail('对方已断开');
      }
    }, 2000);
  }

  private stopRelayHeartbeat(): void {
    if (this.relayHeartbeat !== null) window.clearInterval(this.relayHeartbeat);
    this.relayHeartbeat = null;
  }

  private scheduleSignalRetry(): void {
    if (this.wsRetry !== null) return;
    this.wsRetry = window.setTimeout(() => {
      this.wsRetry = null;
      if (this.closed) return;
      this.wsRetryCount++;
      // 中继模式下信令就是数据通道，连续重连不上就别静默卡死
      if (this.relayMode && this.wsRetryCount > 10) {
        this.fail('中继连接断开，请重新进入房间');
        return;
      }
      if (!this.connected || this.relayMode) this.connectSignal();
    }, 2500);
  }

  /** 房主 → 客人：世界快照（不可靠通道，丢帧无妨） */
  sendState(payload: unknown): void {
    if (this.relayMode) {
      // 中继模式下隔一帧发一次，60Hz → 30Hz
      this.relayStateSkip = !this.relayStateSkip;
      if (this.relayStateSkip) return;
      this.sendRelay({ kind: 'data', data: payload });
      return;
    }
    this.sendOn(this.stateDc, payload);
  }

  /** 客人 → 房主：输入（可靠通道，按键边沿不能丢） */
  sendInput(payload: unknown): void {
    if (this.relayMode) {
      this.sendRelay({ kind: 'data', data: payload });
      return;
    }
    this.sendOn(this.inputDc, payload);
  }

  /** 把 P2P 报文包成中继信封，借 p2p-ice 让信令服务器转发 */
  private sendRelay(env: Partial<RelayEnvelope> & { kind: 'mode' | 'data' }): void {
    this.sendSignal({
      t: 'p2p-ice',
      room: this.opts.room,
      cand: { relay: 1, kind: env.kind, data: env.data } as RelayEnvelope,
    });
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    if (this.joinTimer !== null) window.clearInterval(this.joinTimer);
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    if (this.wsRetry !== null) window.clearTimeout(this.wsRetry);
    if (this.relayTimer !== null) window.clearTimeout(this.relayTimer);
    this.stopRelayAnnounce();
    this.stopRelayHeartbeat();
    this.clearDisconnectGrace();
    this.joinTimer = null;
    this.connectTimer = null;
    this.wsRetry = null;
    this.relayTimer = null;
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

    if (msg.t === 'p2p-ice') {
      const cand = msg.cand as RelayEnvelope & RTCIceCandidateInit;
      if ((cand as RelayEnvelope).relay === 1) {
        // 收到对方的中继报文：握手完成，停掉广播；如果自己还在直连就一起切过来
        this.peerRelaySeen = true;
        this.lastPeerAt = Date.now();
        this.stopRelayAnnounce();
        if (cand.kind === 'mode') {
          this.switchToRelay(false);
        } else {
          this.switchToRelay(false);
          this.opts.onData(JSON.stringify(cand.data));
        }
        return;
      }
      this.addIce(msg.cand as RTCIceCandidateInit);
    }
  }

  private hostOffer(): void {
    if (this.closed) return;
    // 已经在中继模式：别再发 offer（否则对方会建直连，两边通道不一致）
    if (this.relayMode) {
      this.startRelayAnnounce();
      return;
    }
    if (this.connected) return;
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
    // 已经走中继就不要再建直连通道
    if (this.closed || this.relayMode) return;
    if (this.connected) return;
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
      if (st === 'failed') {
        this.fail(this.everConnected ? '对方已断开' : '直连失败（可能是 NAT / 网络限制）');
      } else if (st === 'disconnected' && this.connected) {
        this.opts.onStatus?.('failed', '连接不稳定…');
        this.armDisconnectGrace();
      } else if (st === 'connected') {
        this.clearDisconnectGrace();
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
    dc.onmessage = (ev) => {
      // 已经切中继就只认中继的包，避免两条路都进来重复处理
      if (this.relayMode) return;
      this.opts.onData(String(ev.data));
    };
    dc.onclose = () => {
      if (this.connected && !this.closed && !this.relayMode) this.fail('对方已断开');
    };
  }

  private checkConnected(): void {
    if (this.connected || this.relayMode) return;
    if (this.stateDc?.readyState !== 'open' || this.inputDc?.readyState !== 'open') return;
    this.becomeConnected();
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
    // 「从没连上过」的失败才值得改走中继；连上后又断的直接报错
    if (!this.everConnected && !this.relayMode && reason !== '对方已断开') {
      this.log('直连失败，改走中继：', reason);
      this.switchToRelay(true);
      return;
    }
    this.log('fail:', reason);
    this.connected = false;
    this.clearConnectTimer();
    this.clearDisconnectGrace();
    this.stopRelayHeartbeat();
    this.stopRelayAnnounce();
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
