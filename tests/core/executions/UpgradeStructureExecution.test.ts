import type { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { upgradeGold } from "@openfront/engine-lib/game/Upgrades";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";

describe("UpgradeStructureExecution", () => {
  it("upgrades a structure the specified amount of times", async () => {
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Singleplayer, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    const playerInfo = new PlayerInfo(
      "player1",
      PlayerType.Human,
      null,
      "player1_id",
    );
    game.addPlayer(playerInfo);
    const player = game.player("player1_id")!;

    let landTile: TileRef | undefined = undefined;
    for (let y = 0; y < game.map().height(); y++) {
      for (let x = 0; x < game.map().width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) {
          landTile = t;
          break;
        }
      }
      if (landTile !== undefined) break;
    }

    player.conquer(landTile!);
    const city = player.buildUnit(UnitType.City, landTile!, {});

    game.endSpawnPhase();

    player.addGold(10_000_000n);

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(6);
  });

  it("stops upgrading early if player cannot afford remaining amounts", async () => {
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Singleplayer, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    const playerInfo = new PlayerInfo(
      "player1",
      PlayerType.Human,
      null,
      "player1_id",
    );
    game.addPlayer(playerInfo);
    const player = game.player("player1_id")!;

    let landTile: TileRef | undefined = undefined;
    for (let y = 0; y < game.map().height(); y++) {
      for (let x = 0; x < game.map().width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) {
          landTile = t;
          break;
        }
      }
      if (landTile !== undefined) break;
    }

    player.conquer(landTile!);
    const city = player.buildUnit(UnitType.City, landTile!, {});

    game.endSpawnPhase();

    player.addGold(750_000n);

    expect(city.level()).toBe(1);

    const execution = new UpgradeStructureExecution(player, city.id(), 5);
    game.addExecution(execution);
    game.executeNextTick();

    expect(city.level()).toBe(3);
  });

  it("advertised bulk upgrade totals match what is actually charged", async () => {
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Singleplayer, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    const playerInfo = new PlayerInfo(
      "player1",
      PlayerType.Human,
      null,
      "player1_id",
    );
    game.addPlayer(playerInfo);
    const player = game.player("player1_id")!;

    let landTile: TileRef | undefined = undefined;
    for (let y = 0; y < game.map().height(); y++) {
      for (let x = 0; x < game.map().width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) {
          landTile = t;
          break;
        }
      }
      if (landTile !== undefined) break;
    }

    player.conquer(landTile!);
    const city = player.buildUnit(UnitType.City, landTile!, {});

    game.endSpawnPhase();

    player.addGold(10_000_000n);

    const goldBefore = player.gold();
    game.addExecution(new UpgradeStructureExecution(player, city.id(), 5));
    game.executeNextTick();

    expect(city.tiers()).toEqual([5, 0, 0]);
    // Borderfall: five tiers up the first path, each twice the last.
    expect(goldBefore - player.gold()).toBe(
      upgradeGold(UnitType.City, 1) * 31n,
    );
  });
});
