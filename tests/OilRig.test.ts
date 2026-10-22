import {
  Good,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  depositByte,
  OIL_RIG_MAX_HEALTH,
  OIL_RIG_REPAIR_PER_TICK,
  OIL_RIG_YIELD_PER_TICK,
} from "@openfront/engine-lib/game/Goods";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Land at x <= coastX, ocean beyond.
const coastX = 7;
let game: Game;
let rome: Player;
let carthage: Player;

/** Lays the map's only offshore Oil on a row of sea tiles. */
function offshoreOil(y: number, xs: number[]) {
  const deposits = (game as unknown as { _deposits: Uint8Array })._deposits;
  deposits.fill(0);
  for (const x of xs) deposits[game.ref(x, y)] = depositByte(Good.Oil);
}

function buildRig(player: Player, x: number, y: number) {
  game.addExecution(
    new ConstructionExecution(player, UnitType.OilRig, game.ref(x, y)),
  );
  executeTicks(game, 2);
  return player.units(UnitType.OilRig)[0];
}

describe("Oil Rigs", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { goods: true, infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("rome", PlayerType.Human, null, "rome"),
        new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
      ],
    );
    rome = game.player("rome");
    carthage = game.player("carthage");
    for (let y = 6; y <= 10; y++) {
      for (let x = coastX - 3; x <= coastX; x++) rome.conquer(game.ref(x, y));
    }
    carthage.conquer(game.ref(0, 15));
    rome.addGoods([0, 0, 1000]);
    carthage.addGoods([0, 0, 1000]);
    offshoreOil(10, [coastX + 4, coastX + 5, coastX + 6]);
    executeTicks(game, 50);
  });

  test("stand on offshore Oil near their owner's land, one per field", () => {
    const tile = game.ref(coastX + 4, 10);
    expect(rome.canBuild(UnitType.OilRig, tile)).toBe(tile);
    // Plain sea, or too far from any land carthage holds.
    expect(rome.canBuild(UnitType.OilRig, game.ref(coastX + 4, 3))).toBe(false);
    expect(carthage.canBuild(UnitType.OilRig, tile)).toBe(false);

    const rig = buildRig(rome, coastX + 4, 10);
    expect(rig.tile()).toBe(tile);
    expect(rome.canBuild(UnitType.OilRig, game.ref(coastX + 6, 10))).toBe(
      false,
    );
  });

  test("pump Oil, and repair between attacks", () => {
    const before = rome.goodsIncome()[Good.Oil];
    const rig = buildRig(rome, coastX + 4, 10);
    expect(rome.goodsIncome()[Good.Oil] - before).toBeCloseTo(
      OIL_RIG_YIELD_PER_TICK,
      10,
    );

    game.addExecution(new PlayerExecution(rome));
    executeTicks(game, 1);
    rig.modifyHealth(-100);
    executeTicks(game, 1);
    expect(rig.health()).toBe(
      OIL_RIG_MAX_HEALTH - 100 + OIL_RIG_REPAIR_PER_TICK,
    );
  });

  test("an enemy warship sinks a rig rather than capturing it", () => {
    const rig = buildRig(rome, coastX + 4, 10);
    game.addExecution(new PlayerExecution(rome));
    const warship = carthage.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 7, 14),
      { patrolTile: game.ref(coastX + 7, 14) },
    );
    game.addExecution(new WarshipExecution(warship));

    for (let i = 0; i < 600 && rig.isActive(); i++) game.executeNextTick();
    expect(rig.isActive()).toBe(false);
    expect(carthage.units(UnitType.OilRig)).toHaveLength(0);
  });

  test("nations build them off their own coast", () => {
    const ai = new NationStructureBehavior(new PseudoRandom(0), game, rome);
    expect((ai as any).maybeBuildOilRig()).toBe(true);
    executeTicks(game, 2);
    expect(rome.units(UnitType.OilRig)).toHaveLength(1);
    // One field, now taken.
    expect((ai as any).maybeBuildOilRig()).toBe(false);
  });
});
