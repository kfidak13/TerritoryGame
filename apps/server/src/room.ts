import { randomUUID } from "node:crypto";
import { TICKS_PER_SECOND, type GameConfig, type Intent, type Turn } from "@borderfall/engine";
import type { ClientIntent, ServerMessage } from "@borderfall/protocol";

export interface Connection {
  send(message: ServerMessage): void;
}

interface Session {
  clientId: string;
  intentsThisTurn: number;
}

const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_INTENTS_PER_TURN = 10;
/** How many reported hash ticks to remember for desync comparison. */
const HASH_HISTORY = 8;

/**
 * Lockstep relay for one match. The server never simulates: it orders client intents into
 * fixed-rate turns and broadcasts them; every client runs the deterministic engine itself.
 */
export class GameRoom {
  private tick = 0;
  private pending: Intent[] = [];
  /** Non-empty turns only, replayed to (re)joining clients. */
  private readonly history: Turn[] = [];
  private readonly sessions = new Map<Connection, Session>();
  private readonly tokens = new Map<string, string>();
  private readonly hashes = new Map<number, Map<string, number>>();
  private timer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;

  constructor(
    readonly id: string,
    readonly config: GameConfig,
  ) {}

  get connectionCount(): number {
    return this.sessions.size;
  }

  get currentTick(): number {
    return this.tick;
  }

  join(conn: Connection, name: string, token?: string): void {
    let clientId = token ? this.tokens.get(token) : undefined;
    if (!clientId || !token) {
      clientId = randomUUID();
      token = randomUUID();
      this.tokens.set(token, clientId);
    }
    for (const [other, s] of this.sessions) {
      if (s.clientId === clientId) this.sessions.delete(other);
    }
    this.sessions.set(conn, { clientId, intentsThisTurn: 0 });
    this.pending.push({ type: "join", clientId, name });
    conn.send({
      type: "welcome",
      clientId,
      token,
      config: this.config,
      tick: this.tick,
      turns: this.history,
    });
  }

  leave(conn: Connection): void {
    const session = this.sessions.get(conn);
    if (!session) return;
    this.sessions.delete(conn);
    this.pending.push({ type: "leave", clientId: session.clientId });
  }

  submitIntent(conn: Connection, intent: ClientIntent): void {
    const session = this.sessions.get(conn);
    if (!session || session.intentsThisTurn >= MAX_INTENTS_PER_TURN) return;
    session.intentsThisTurn++;
    this.pending.push({ ...intent, clientId: session.clientId });
  }

  reportHash(conn: Connection, tick: number, hash: number): void {
    const session = this.sessions.get(conn);
    if (!session || tick >= this.tick) return;
    let byClient = this.hashes.get(tick);
    if (!byClient) {
      if (this.hashes.size >= HASH_HISTORY) {
        const oldest = Math.min(...this.hashes.keys());
        if (tick < oldest) return;
        this.hashes.delete(oldest);
      }
      byClient = new Map();
      this.hashes.set(tick, byClient);
    }
    const mismatch = [...byClient.values()].some((h) => h !== hash);
    byClient.set(session.clientId, hash);
    if (mismatch) {
      console.warn(`[room ${this.id}] desync at tick ${tick}`);
      this.broadcast({ type: "desync", tick });
    }
  }

  /** Closes the current turn and broadcasts it. */
  step(): void {
    const turn: Turn = { tick: this.tick++, intents: this.pending };
    this.pending = [];
    if (turn.intents.length > 0) this.history.push(turn);
    for (const session of this.sessions.values()) session.intentsThisTurn = 0;
    this.broadcast({ type: "turn", turn });
  }

  start(): void {
    if (this.timer) return;
    this.nextTickAt = performance.now();
    const loop = () => {
      const now = performance.now();
      while (this.nextTickAt <= now) {
        this.step();
        this.nextTickAt += TICK_MS;
      }
      this.timer = setTimeout(loop, this.nextTickAt - performance.now());
    };
    loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private broadcast(message: ServerMessage): void {
    for (const conn of this.sessions.keys()) conn.send(message);
  }
}
