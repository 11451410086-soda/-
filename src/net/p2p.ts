/** WebRTC 点对点连接（房主权威） */

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
}

export class P2P {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private opts: P2POptions;
  private opened = false;

  constructor(opts: P2POptions) {
    this.opts = opts;
  }

  start(): void {
    const ws = new WebSocket(this.opts.signalUrl);
    this.ws = ws;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
    });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !this.ws) return;
      this.send({
        t: 'p2p-ice',
        room: this.opts.room,
        cand: ev.candidate.toJSON(),
        to: this.opts.role === 'host' ? 'guest' : 'host',
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.opts.onFail('直连失败（可能是网络/NAT 限制）');
    };

    if (this.opts.role === 'host') {
      const dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });
      this.bindChannel(dc);
    } else {
      pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    }

    ws.onopen = () => {
      this.send({ t: 'p2p-join', room: this.opts.room });
      if (this.opts.role === 'host') {
        void pc.createOffer().then((offer) => {
          void pc.setLocalDescription(offer);
          this.send({ t: 'p2p-offer', room: this.opts.room, sdp: JSON.stringify(offer) });
        });
      }
    };

    ws.onmessage = (ev) => {
      let msg: SignalMsg;
      try {
        msg = JSON.parse(String(ev.data)) as SignalMsg;
      } catch {
        return;
      }
      if (msg.room !== this.opts.room) return;

      if (msg.t === 'p2p-offer' && this.opts.role === 'guest') {
        const offer = JSON.parse(msg.sdp) as RTCSessionDescriptionInit;
        void pc.setRemoteDescription(offer).then(async () => {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send({ t: 'p2p-answer', room: this.opts.room, sdp: JSON.stringify(answer) });
        });
      } else if (msg.t === 'p2p-answer' && this.opts.role === 'host') {
        const answer = JSON.parse(msg.sdp) as RTCSessionDescriptionInit;
        void pc.setRemoteDescription(answer);
      } else if (msg.t === 'p2p-ice') {
        void pc.addIceCandidate(msg.cand).catch(() => undefined);
      }
    };
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      this.opened = true;
      this.opts.onOpen();
    };
    dc.onmessage = (ev) => this.opts.onData(String(ev.data));
    dc.onclose = () => {
      if (this.opened) this.opts.onFail('对方已断开');
    };
  }

  private send(msg: SignalMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendData(payload: unknown): void {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(payload));
  }
}
