import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Good,
  GOODS,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  computeDeposits,
  countDeposits,
  depositGood,
  depositSeed,
  FOOD_SHORTAGE_GROWTH,
  foodState,
  GOODS_PRODUCTION_PER_TILE,
  goodsCost,
  regionSize,
} from "@openfront/engine-lib/game/Goods";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const MAP = "world";

/** Up to `n` land tiles carrying a deposit of `good`. */
function depositTiles(game: Game, good: Good, n: number): TileRef[] {
  const tiles: TileRef[] = [];
  game.map().forEachTile((t) => {
    if (tiles.length < n && game.depositAt(t) === good) tiles.push(t);
  });
  return tiles;
}

async function goodsGame(): Promise<{ game: Game; player: Player }> {
  const game = await setup(MAP, { goods: true, instantBuild: true }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
  ]);
  const player = game.player("alice");
  game.addExecution(new PlayerExecution(player));
  return { game, player };
}

describe("deposits", () => {
  test(
    "are deterministic, exclusive per region, and cover every good",
    { timeout: 60_000 },
    async () => {
      const game = await setup(MAP, { goods: true });
      const seed = depositSeed("World");
      const a = computeDeposits(game.map(), seed);
      const b = computeDeposits(game.map(), seed);
      expect(a).toEqual(b);
      expect(computeDeposits(game.map(), seed + 1)).not.toEqual(a);

      const counts = countDeposits(a);
      for (const g of GOODS) expect(counts[g]).toBeGreaterThan(100);

      // One good per region, and only on land.
      const map = game.map();
      const size = regionSize(map);
      const seen = new Map<string, Good>();
      let onWater = 0;
      let mixedRegions = 0;
      map.forEachTile((t) => {
        const good = depositGood(a[t]);
        if (good === null) return;
        if (!map.isLand(t)) onWater++;
        const key = `${Math.floor(map.x(t) / size)}:${Math.floor(map.y(t) / size)}`;
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, good);
        else if (prev !== good) mixedRegions++;
      });
      expect(onWater).toBe(0);
      expect(mixedRegions).toBe(0);
    },
  );

  test("are absent when goods are off", async () => {
    const game = await setup(MAP, {});
    let found = 0;
    game.map().forEachTile((t) => {
      if (game.depositAt(t) !== null) found++;
    });
    expect(found).toBe(0);
  });
});

describe("goods economy", () => {
  test("owned deposits produce, and counts follow conquest", async () => {
    const { game, player } = await goodsGame();
    const metal = depositTiles(game, Good.Metal, 10);
    for (const t of metal) player.conquer(t);
    expect(player.deposits()).toEqual([0, 0, 10]);

    game.executeNextTick();
    game.executeNextTick();
    const before = player.goods()[Good.Metal];
    game.executeNextTick();
    expect(player.goods()[Good.Metal] - before).toBeCloseTo(
      10 * GOODS_PRODUCTION_PER_TILE,
    );

    player.relinquish(metal[0]);
    expect(player.deposits()[Good.Metal]).toBe(9);
  });

  test("starving troops grow slower", async () => {
    const { game, player } = await goodsGame();
    player.conquer(depositTiles(game, Good.Oil, 1)[0]);
    player.setTroops(100_000);
    expect(foodState(player)).toBe("shortage");
    const starving = game.config().troopIncreaseRate(player);

    // Same land, same troops: only the granary differs.
    player.addGoods([10, 0, 0]);
    expect(foodState(player)).toBe("normal");
    const fed = game.config().troopIncreaseRate(player);
    expect(starving / fed).toBeCloseTo(FOOD_SHORTAGE_GROWTH, 2);
  });

  test("metal gates and pays for a defense post", async () => {
    const { game, player } = await goodsGame();
    const tile = depositTiles(game, Good.Food, 1)[0];
    player.conquer(tile);
    player.addGold(10_000_000n);

    const before = player
      .buildableUnits(tile)
      .find((u) => u.type === UnitType.DefensePost)!;
    expect(before.goodsCost).toEqual(goodsCost(UnitType.DefensePost, false));
    expect(before.goodsShort).toBe(true);
    expect(before.canBuild).toBe(false);

    player.addGoods([0, 0, 50]);
    const after = player
      .buildableUnits(tile)
      .find((u) => u.type === UnitType.DefensePost)!;
    expect(after.goodsShort).toBe(false);
    expect(after.canBuild).not.toBe(false);

    player.buildUnit(UnitType.DefensePost, tile, {});
    expect(player.goods()[Good.Metal]).toBe(30);
  });

  test("survives a snapshot round trip", async () => {
    const { game, player } = await goodsGame();
    for (const t of depositTiles(game, Good.Oil, 5)) player.conquer(t);
    player.addGoods([3, 0, 7]);
    game.executeNextTick();

    const { restored } = await roundTrip(game, MAP);
    const twin = restored.player("alice");
    expect(twin.goods()).toEqual(player.goods());
    expect(twin.deposits()).toEqual([0, 5, 0]);
  });
});
