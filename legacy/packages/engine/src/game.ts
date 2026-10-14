import type { GameMap } from "./map.ts";
import { generateMap } from "./mapgen.ts";

export interface GameConfig {
  seed: number;
  width: number;
  height: number;
}

/**
 * Intents are the only way to change game state. The server stamps each one with the sender's
 * clientId and orders them into turns; every client applies the same turns and stays in sync.
 * Intents come from untrusted clients, so applying an invalid one must be a silent no-op.
 */
export type Intent =
  | { type: "join"; clientId: string; name: string }
  | { type: "leave"; clientId: string }
  | { type: "spawn"; clientId: string; tile: number };

export interface Turn {
  tick: number;
  intents: Intent[];
}

export interface Player {
  /** 1-based; 0 in the owner grid means unowned. */
  readonly id: number;
  readonly clientId: string;
  name: string;
  readonly color: number;
  connected: boolean;
  spawnTile: number | null;
  tileCount: number;
}

export const TICKS_PER_SECOND = 10;
export const SPAWN_RADIUS = 3;

const PLAYER_COLORS = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c,
  0xfabebe, 0x008080, 0xe6beff, 0x9a6324, 0xfffac8, 0x800000, 0xaaffc3,
];

export class Game {
  readonly map: GameMap;
  /** Owner player id per tile (0 = unowned). */
  readonly owner: Uint16Array;
  readonly players: Player[] = [];
  tick = 0;

  private readonly byClient = new Map<string, Player>();
  private changed: number[] = [];

  constructor(readonly config: GameConfig) {
    this.map = generateMap(config);
    this.owner = new Uint16Array(this.map.size);
  }

  executeTurn(turn: Turn): void {
    if (turn.tick !== this.tick) {
      throw new Error(`turn ${turn.tick} applied out of order (expected ${this.tick})`);
    }
    for (const intent of turn.intents) this.apply(intent);
    this.tick++;
  }

  player(id: number): Player | undefined {
    return this.players[id - 1];
  }

  playerByClient(clientId: string): Player | undefined {
    return this.byClient.get(clientId);
  }

  /** Returns and clears the tiles whose owner changed since the last call. */
  takeChangedTiles(): number[] {
    const changed = this.changed;
    this.changed = [];
    return changed;
  }

  /** FNV-1a over the full simulation state, used by clients to detect desyncs. */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h = Math.imul(h ^ (v & 0xffff), 0x01000193);
      h = Math.imul(h ^ (v >>> 16), 0x01000193);
    };
    mix(this.tick);
    for (let i = 0; i < this.owner.length; i++) mix(this.owner[i]!);
    for (const p of this.players) {
      mix(p.id);
      mix(p.tileCount);
      mix(p.spawnTile ?? 0xffffffff);
      mix(p.connected ? 1 : 0);
    }
    return h >>> 0;
  }

  private apply(intent: Intent): void {
    switch (intent.type) {
      case "join":
        return this.join(intent.clientId, intent.name);
      case "leave": {
        const p = this.byClient.get(intent.clientId);
        if (p) p.connected = false;
        return;
      }
      case "spawn":
        return this.spawn(intent.clientId, intent.tile);
    }
  }

  private join(clientId: string, name: string): void {
    const existing = this.byClient.get(clientId);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      return;
    }
    const id = this.players.length + 1;
    const player: Player = {
      id,
      clientId,
      name,
      color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length]!,
      connected: true,
      spawnTile: null,
      tileCount: 0,
    };
    this.players.push(player);
    this.byClient.set(clientId, player);
  }

  private spawn(clientId: string, tile: number): void {
    const player = this.byClient.get(clientId);
    const { map } = this;
    if (!player || !map.isValidTile(tile) || !map.isLand(tile)) return;
    const centerOwner = this.owner[tile]!;
    if (centerOwner !== 0 && centerOwner !== player.id) return;

    // Re-picking a spawn releases the previous one.
    if (player.spawnTile !== null) {
      for (let i = 0; i < this.owner.length; i++) {
        if (this.owner[i] === player.id) this.setOwner(i, 0);
      }
    }

    player.spawnTile = tile;
    const cx = map.x(tile);
    const cy = map.y(tile);
    for (let dy = -SPAWN_RADIUS; dy <= SPAWN_RADIUS; dy++) {
      for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
        if (dx * dx + dy * dy > SPAWN_RADIUS * SPAWN_RADIUS) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        const t = map.tile(x, y);
        if (map.isLand(t) && this.owner[t] === 0) this.setOwner(t, player.id);
      }
    }
  }

  private setOwner(tile: number, id: number): void {
    const prev = this.owner[tile]!;
    if (prev === id) return;
    if (prev !== 0) this.player(prev)!.tileCount--;
    if (id !== 0) this.player(id)!.tileCount++;
    this.owner[tile] = id;
    this.changed.push(tile);
  }
}
