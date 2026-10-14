import { describe, expect, it } from "vitest";
import { Game, type GameConfig, type Turn } from "../src/index.ts";

const config: GameConfig = { seed: 7, width: 160, height: 100 };

function landTiles(game: Game): number[] {
  const tiles: number[] = [];
  for (let t = 0; t < game.map.size; t++) if (game.map.isLand(t)) tiles.push(t);
  return tiles;
}

/** Map borders are always ocean. */
const CORNER_WATER_TILE = 0;

function play(game: Game, turns: Turn[]) {
  for (const turn of turns) game.executeTurn(turn);
}

describe("Game", () => {
  it("adds players on join and keeps ids stable on rejoin", () => {
    const game = new Game(config);
    play(game, [
      { tick: 0, intents: [{ type: "join", clientId: "a", name: "Ann" }] },
      { tick: 1, intents: [{ type: "join", clientId: "b", name: "Bob" }] },
      { tick: 2, intents: [{ type: "leave", clientId: "a" }] },
      { tick: 3, intents: [{ type: "join", clientId: "a", name: "Ann2" }] },
    ]);
    expect(game.players.map((p) => [p.id, p.name, p.connected])).toEqual([
      [1, "Ann2", true],
      [2, "Bob", true],
    ]);
  });

  it("claims a disc of land on spawn and releases it on re-spawn", () => {
    const game = new Game(config);
    const land = landTiles(game);
    const first = land[Math.floor(land.length / 3)]!;
    const second = land[Math.floor((land.length * 2) / 3)]!;
    play(game, [
      { tick: 0, intents: [{ type: "join", clientId: "a", name: "Ann" }] },
      { tick: 1, intents: [{ type: "spawn", clientId: "a", tile: first }] },
    ]);
    const p = game.playerByClient("a")!;
    expect(game.owner[first]).toBe(p.id);
    expect(p.tileCount).toBeGreaterThan(1);
    expect(game.takeChangedTiles()).toHaveLength(p.tileCount);

    game.executeTurn({ tick: 2, intents: [{ type: "spawn", clientId: "a", tile: second }] });
    expect(game.owner[first]).toBe(0);
    expect(game.owner[second]).toBe(p.id);
    expect(game.owner.filter((o) => o === p.id)).toHaveLength(p.tileCount);
  });

  it("ignores invalid spawns", () => {
    const game = new Game(config);
    const land = landTiles(game);
    const tile = land[100]!;
    play(game, [
      {
        tick: 0,
        intents: [
          { type: "join", clientId: "a", name: "Ann" },
          { type: "join", clientId: "b", name: "Bob" },
        ],
      },
      { tick: 1, intents: [{ type: "spawn", clientId: "a", tile }] },
      {
        tick: 2,
        intents: [
          { type: "spawn", clientId: "b", tile },
          { type: "spawn", clientId: "b", tile: CORNER_WATER_TILE },
          { type: "spawn", clientId: "b", tile: -1 },
          { type: "spawn", clientId: "b", tile: 1.5 },
          { type: "spawn", clientId: "ghost", tile: land[500]! },
        ],
      },
    ]);
    expect(game.playerByClient("b")!.tileCount).toBe(0);
    expect(game.playerByClient("b")!.spawnTile).toBeNull();
  });

  it("rejects out-of-order turns", () => {
    const game = new Game(config);
    expect(() => game.executeTurn({ tick: 1, intents: [] })).toThrow();
  });

  it("produces identical hashes for identical turn streams", () => {
    const a = new Game(config);
    const b = new Game(config);
    const land = landTiles(a);
    const turns: Turn[] = [
      { tick: 0, intents: [{ type: "join", clientId: "a", name: "Ann" }] },
      { tick: 1, intents: [{ type: "spawn", clientId: "a", tile: land[300]! }] },
      { tick: 2, intents: [] },
    ];
    play(a, turns);
    play(b, turns);
    expect(a.hash()).toBe(b.hash());

    b.executeTurn({ tick: 3, intents: [{ type: "spawn", clientId: "a", tile: land[900]! }] });
    a.executeTurn({ tick: 3, intents: [] });
    expect(a.hash()).not.toBe(b.hash());
  });
});
