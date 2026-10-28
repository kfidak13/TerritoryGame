import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  canRaiseTier,
  navyScaled,
  sellRefund,
  upgradeGold,
  upgradeTicks,
} from "@openfront/engine-lib/game/Upgrades";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("Upgrade paths", () => {
  test("Bloons rules: one path to 5, a second to 2, the third shut", () => {
    const city = UnitType.City;
    expect(canRaiseTier(city, [0, 0, 0], 2)).toBe(true);
    expect(canRaiseTier(city, [4, 0, 0], 0)).toBe(true);
    expect(canRaiseTier(city, [5, 0, 0], 0)).toBe(false);
    expect(canRaiseTier(city, [5, 1, 0], 1)).toBe(true);
    expect(canRaiseTier(city, [5, 2, 0], 1)).toBe(false);
    expect(canRaiseTier(city, [3, 2, 0], 2)).toBe(false);
    expect(canRaiseTier(city, [2, 2, 0], 0)).toBe(true);
    // Goods buildings have one path.
    expect(canRaiseTier(UnitType.Farm, [0, 0, 0], 1)).toBe(false);
  });

  test("each tier costs twice the last", () => {
    expect([1, 2, 3, 4, 5].map((t) => upgradeGold(UnitType.City, t))).toEqual([
      125_000n,
      250_000n,
      500_000n,
      1_000_000n,
      2_000_000n,
    ]);
    // Half of the base build and both tiers back.
    expect(sellRefund(UnitType.City, [2, 0, 0]).gold).toBe(250_000n);
  });

  test("Navy tiers scale warship health and shell damage", () => {
    expect(navyScaled(1000, [0, 0, 0])).toBe(1000);
    expect(navyScaled(1000, [0, 5, 0])).toBe(2500);
  });
});

describe("Upgraded buildings in a game", () => {
  let game: Game;
  let rome: Player;
  let carthage: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true }, [
      new PlayerInfo("rome", PlayerType.Human, "rome", "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    rome = game.player("rome");
    carthage = game.player("carthage");
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 80; x++) {
        (x < 40 ? rome : carthage).conquer(game.ref(x, y));
      }
    }
    game.endSpawnPhase();
  });

  function upgrade(unit: Unit, path: number, amount = 1) {
    game.addExecution(
      new UpgradeStructureExecution(rome, unit.id(), amount, path),
    );
  }

  test("a tier idles the building, then lands", () => {
    const city = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    upgrade(city, 0);
    executeTicks(game, 2);
    expect(city.isUnderConstruction()).toBe(true);
    expect(city.tiers()).toEqual([0, 0, 0]);
    executeTicks(game, upgradeTicks(1));
    expect(city.isUnderConstruction()).toBe(false);
    expect(city.tiers()).toEqual([1, 0, 0]);
  });

  test("a Metropolis houses millions, and two level 5s per type is the cap", () => {
    const before = game.config().maxTroops(rome);
    const cities = [5, 20, 35].map((x) =>
      rome.buildUnit(UnitType.City, game.ref(x, 30), {}),
    );
    for (const city of cities) for (let i = 0; i < 5; i++) city.raiseTier(0);
    // Only the first two reached 5 through raiseTier; the cap is a buy rule.
    expect(rome.canUpgradeUnit(cities[2])).toBe(false);
    const third = rome.buildUnit(UnitType.City, game.ref(20, 10), {});
    for (let i = 0; i < 4; i++) third.raiseTier(0);
    expect(rome.canUpgradeUnit(third, 0)).toBe(false);
    expect(rome.canUpgradeUnit(third, 1)).toBe(true);
    // 10M shown people per level-5 Metropolis, plus the base city.
    expect(game.config().maxTroops(rome) - before).toBeGreaterThan(
      3 * 100_000_000,
    );
  });

  test("a Market city pays gold every tick", () => {
    const base = game.config().goldAdditionRate(rome);
    const city = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    for (let i = 0; i < 5; i++) city.raiseTier(1);
    expect(game.config().goldAdditionRate(rome) - base).toBe(2_500n);
  });

  test("capture costs a tier", () => {
    const city = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    city.raiseTier(0);
    city.raiseTier(0);
    carthage.captureUnit(city);
    expect(city.tiers()).toEqual([1, 0, 0]);
  });

  test("a nuke takes as many tiers as it is strong", () => {
    const silo = carthage.buildUnit(UnitType.MissileSilo, game.ref(70, 5), {});
    const strong = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    for (let i = 0; i < 5; i++) strong.raiseTier(0);
    const plain = rome.buildUnit(UnitType.City, game.ref(10, 30), {});
    // A silo per nuke: one launch tube each.
    const silo2 = carthage.buildUnit(
      UnitType.MissileSilo,
      game.ref(70, 30),
      {},
    );
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        carthage,
        strong.tile(),
        silo.tile(),
      ),
      new NukeExecution(
        UnitType.AtomBomb,
        carthage,
        plain.tile(),
        silo2.tile(),
      ),
    );
    executeTicks(game, 200);
    expect(strong.isActive()).toBe(true);
    expect(strong.tiers()).toEqual([4, 0, 0]);
    expect(plain.isActive()).toBe(false);
  });

  test("selling gives half back", () => {
    const city = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    city.raiseTier(0);
    executeTicks(game, game.config().deleteUnitCooldown());
    const gold = rome.gold();
    game.addExecution(new DeleteUnitExecution(rome, city.id()));
    executeTicks(game, game.config().deletionMarkDuration() + 2);
    expect(city.isActive()).toBe(false);
    expect(rome.gold() - gold).toBeGreaterThanOrEqual(
      sellRefund(UnitType.City, [1, 0, 0]).gold,
    );
  });

  test("a level-5 Invasion port sends each boat order in two boats", () => {
    const port = rome.buildUnit(UnitType.Port, game.ref(5, 5), {});
    const boats = () =>
      new Executor(game, "game", "rome")
        .createExecs({
          turnNumber: 0,
          intents: [
            { type: "boat", clientID: "rome", dst: 0, troops: 100 } as never,
          ],
        })
        .filter((e) => e instanceof TransportShipExecution);
    expect(boats()).toHaveLength(1);
    for (let i = 0; i < 5; i++) port.raiseTier(2);
    expect(boats()).toHaveLength(2);
  });
});
