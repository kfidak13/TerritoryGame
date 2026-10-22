// @vitest-environment jsdom
import { GOODS } from "@openfront/engine-api/game/GameTypes";
import { depositGood } from "@openfront/engine-lib/game/Goods";
import { Game } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import type { MapRenderer } from "../src/client/render/gl";
import type { GameView } from "../src/client/view";
import { WebGLFrameBuilder } from "../src/client/WebGLFrameBuilder";
import { setup } from "./util/Setup";

// Borderfall: the map markers must show exactly the deposits the engine
// pays out for, and are pushed to the renderer once per game.
function viewOf(game: Game): GameView {
  const map = game.map();
  return {
    config: () => game.config(),
    width: () => map.width(),
    height: () => map.height(),
    ref: (x: number, y: number) => map.ref(x, y),
    x: (t: number) => map.x(t),
    y: (t: number) => map.y(t),
    isLand: (t: number) => map.isLand(t),
    isImpassable: (t: number) => map.isImpassable(t),
    isShoreline: (t: number) => map.isShoreline(t),
    terrainType: (t: number) => map.terrainType(t),
    isOcean: (t: number) => map.isOcean(t),
    isOceanShore: (t: number) => map.isOceanShore(t),
    forEachTile: (fn: (t: number) => void) => map.forEachTile(fn),
    forEachNeighbor: (t: number, fn: (n: number) => void) =>
      map.forEachNeighbor(t, fn),
  } as unknown as GameView;
}

function pushes(game: Game): (Uint8Array | null)[] {
  const pushed: (Uint8Array | null)[] = [];
  const renderer = {
    setDeposits: (d: Uint8Array | null) => pushed.push(d),
  } as unknown as MapRenderer;
  const builder = new WebGLFrameBuilder(renderer);
  const view = viewOf(game);
  (builder as any).syncDeposits(view);
  (builder as any).syncDeposits(view);
  return pushed;
}

describe("WebGLFrameBuilder deposits", () => {
  it(
    "pushes the engine's deposits once when goods are on",
    { timeout: 60_000 },
    async () => {
      const game = await setup("world", { goods: true });
      const pushed = pushes(game);

      expect(pushed).toHaveLength(1);
      const deposits = pushed[0]!;
      const seen = new Set<number>();
      game.map().forEachTile((t) => {
        const good = depositGood(deposits[t]);
        expect(good).toBe(game.depositAt(t));
        if (good !== null) seen.add(good);
      });
      expect([...seen].sort()).toEqual([...GOODS]);
    },
  );

  it("pushes nothing when goods are off", async () => {
    const game = await setup("world", { goods: false });
    expect(pushes(game)).toHaveLength(0);
  });
});
