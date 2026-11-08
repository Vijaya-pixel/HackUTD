import type { MessagingChannel, InboundHandler } from "./MessagingChannel.js";

export interface SimulatorMessage {
  id: string;
  sessionId: string;
  role: "scammer" | "user";
  text: string;
  ts: number;
}

/** In-memory store: sessionId → messages */
const store = new Map<string, SimulatorMessage[]>();
/** Pending reply callbacks: sessionId → resolve fns */
const pending = new Map<string, Array<() => void>>();

export function getSimulatorMessages(sessionId: string): SimulatorMessage[] {
  return store.get(sessionId) ?? [];
}

/** Called by the mobile app / simulator route to inject a user message */
export function injectUserMessage(sessionId: string, text: string): void {
  const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const msg: SimulatorMessage = { id, sessionId, role: "user", text, ts: Date.now() };
  const existing = store.get(sessionId) ?? [];
  store.set(sessionId, [...existing, msg]);
  // notify waiting listeners
  const cbs = pending.get(sessionId) ?? [];
  pending.delete(sessionId);
  cbs.forEach((cb) => cb());
}

export class SimulatorChannel implements MessagingChannel {
  private handler: InboundHandler | null = null;

  onMessage(handler: InboundHandler): void {
    this.handler = handler;
  }

  async send(to: string, text: string, sessionId?: string): Promise<void> {
    const sid = sessionId ?? to;
    const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg: SimulatorMessage = { id, sessionId: sid, role: "scammer", text, ts: Date.now() };
    const existing = store.get(sid) ?? [];
    store.set(sid, [...existing, msg]);
    // notify SSE subscribers
    const cbs = pending.get(`out:${sid}`) ?? [];
    pending.delete(`out:${sid}`);
    cbs.forEach((cb) => cb());
  }

  /** Wait for the next outbound message in a session (used by SSE endpoint) */
  waitForOutbound(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const key = `out:${sessionId}`;
      const cbs = pending.get(key) ?? [];
      pending.set(key, [...cbs, resolve]);
      // Auto-resolve after 30s to prevent leaks
      setTimeout(() => resolve(), 30_000);
    });
  }

  async start(): Promise<void> {
    console.log("[SimulatorChannel] Ready");
  }

  async stop(): Promise<void> {}
}

export const simulatorChannel = new SimulatorChannel();

/** Poll handler: processes injected user messages through the engine */
export function simulatorDispatch(sessionId: string, text: string): void {
  if (simulatorChannel["handler"]) {
    simulatorChannel["handler"]("simulator", text, sessionId).catch(console.error);
  }
}
