import type { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  canRaiseTier,
  GOODS_OUTPUT_PERCENT,
  maxPostReach,
  missileTubes,
  navyScaled,
  POST_PATH_BARRACKS,
  POST_PATH_WATCHTOWER,
  postReach,
  RIG_DRILL_YIELD_PERCENT,
  RIG_HULL_HEALTH_PERCENT,
  RIG_PATH_PLATFORM,
  SAM_PATH_AEGIS,
  samRangeLevel,
  sellRefund,
  SILO_PATH_ARSENAL,
  SILO_PATH_PLAGUE,
  SILO_PATH_WARHEAD,
  SILO_PLAGUE_TICKS,
  siloReloadTicks,
  trainStopGold,
  upgradeGold,
  upgradeTicks,
} from "@openfront/engine-lib/game/Upgrades";
import { DefensePostExecution } from "@openfront/engine/execution/DefensePostExecution";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { OilRigExecution } from "@openfront/engine/execution/OilRigExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { UseRealAttackLogic } from "./util/TestConfig";
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

describe("Factory and SAM paths", () => {
  test("Freight pays more, Bandits steal, and level-5 Bandits charge a toll", () => {
    const base = 1000n;
    expect(trainStopGold(base, false, [5, 0, 0], 0)).toEqual({
      trainCut: 3000n,
      stationCut: 0n,
    });
    // Bandit 5 abroad: +10%, plus half the station owner's cut.
    expect(trainStopGold(base, true, [0, 0, 5], 0)).toEqual({
      trainCut: 1600n,
      stationCut: 500n,
    });
    // A plain train at a level-5 Bandit's station pays a quarter of its cut.
    expect(trainStopGold(base, true, [0, 0, 0], 5)).toEqual({
      trainCut: 750n,
      stationCut: 1250n,
    });
    // A Bandit train is never tolled.
    expect(trainStopGold(base, true, [0, 0, 1], 5).stationCut).toBe(1000n);
  });

  test("a Range-5 SAM reaches twice as far", () => {
    const samRange = (level: number) => 150 - 480 / (level + 5);
    expect(samRange(samRangeLevel([0, 0, 0]))).toBeCloseTo(70);
    expect(samRange(samRangeLevel([5, 0, 0]))).toBeCloseTo(140);
  });

  test("an Aegis SAM sinks an enemy boat in range", async () => {
    // 16x16: land at x <= 7, ocean beyond.
    const game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    const rome = game.player("rome");
    const carthage = game.player("carthage");
    rome.conquer(game.ref(7, 2));
    carthage.conquer(game.ref(0, 15));
    game.endSpawnPhase();
    const sam = rome.buildUnit(UnitType.SAMLauncher, game.ref(7, 2), {});
    sam.raiseTier(SAM_PATH_AEGIS);
    game.addExecution(new SAMLauncherExecution(rome, null, sam));
    const boat = carthage.buildUnit(UnitType.TransportShip, game.ref(9, 3), {
      troops: 100,
    });
    executeTicks(game, 20);
    expect(boat.isActive()).toBe(false);
  });
});

describe("Missile Silo paths", () => {
  let game: Game;
  let rome: Player;
  let carthage: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
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

  function nukeFrom(silo: Unit, tile: TileRef) {
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, carthage, tile, silo.tile()),
    );
    executeTicks(game, 200);
  }

  test("a Warhead silo's nukes blast wider and hit harder", () => {
    const silo = carthage.buildUnit(UnitType.MissileSilo, game.ref(70, 5), {});
    for (let i = 0; i < 5; i++) silo.raiseTier(SILO_PATH_WARHEAD);
    const city = rome.buildUnit(UnitType.City, game.ref(10, 10), {});
    for (let i = 0; i < 5; i++) city.raiseTier(0);
    // The test blast is 1 tile; at Warhead 5 it is 2.
    const near = rome.buildUnit(UnitType.City, game.ref(11, 10), {});
    nukeFrom(silo, city.tile());
    expect(city.tiers()).toEqual([2, 0, 0]);
    expect(near.isActive()).toBe(false);
  });

  test("an Arsenal silo holds more nukes and reloads faster", () => {
    const silo = carthage.buildUnit(UnitType.MissileSilo, game.ref(70, 5), {});
    for (let i = 0; i < 5; i++) silo.raiseTier(SILO_PATH_ARSENAL);
    expect(missileTubes(silo.type(), silo.tiers())).toBe(5);
    expect(siloReloadTicks(100, silo.tiers())).toBe(50);
  });

  test("a Plague nuke's land can't be taken until it wears off", async () => {
    const silo = carthage.buildUnit(UnitType.MissileSilo, game.ref(70, 5), {});
    silo.raiseTier(SILO_PATH_PLAGUE);
    const tile = game.ref(10, 10);
    nukeFrom(silo, tile);
    expect(game.owner(tile).isPlayer()).toBe(false);
    rome.conquer(tile);
    expect(game.owner(tile).isPlayer()).toBe(false);
    await expectSnapshotRoundTrip(game, "plains", 5);

    executeTicks(game, SILO_PLAGUE_TICKS[1]);
    rome.conquer(tile);
    expect(game.owner(tile)).toBe(rome);
  });
});

describe("Defense Post paths", () => {
  test("a Watchtower post reaches twice as far at level 5", () => {
    expect(postReach(30, [0, 0, 0])).toBe(30);
    expect(postReach(30, [0, 5, 0])).toBe(60);
    expect(maxPostReach(30)).toBe(60);
  });

  test("Fortress hardens nearby land, Barracks speed regrowth and house troops", async () => {
    const game = await setup("plains", { infiniteGold: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
    ]);
    const rome = game.player("rome");
    for (let x = 0; x < 40; x++) rome.conquer(game.ref(x, 10));
    rome.setTroops(1_000);
    const config = game.config();
    const growth = config.troopIncreaseRate(rome);
    const cap = config.maxTroops(rome);
    const post = rome.buildUnit(UnitType.DefensePost, game.ref(5, 10), {});
    for (let i = 0; i < 5; i++) post.raiseTier(POST_PATH_BARRACKS);
    expect(config.troopIncreaseRate(rome)).toBeGreaterThan(growth * 1.4);
    expect(config.maxTroops(rome) - cap).toBe(5_000_000);

    const attack = (fortress: number) =>
      UseRealAttackLogic.prototype.attackLogic.call(config, {
        terrain: game.terrainType(game.ref(5, 10)),
        attackTroops: 10_000,
        attacker: { type: PlayerType.Human, numTiles: 100 },
        defender: {
          type: PlayerType.Human,
          numTiles: 100,
          troops: 10_000,
          isTraitor: false,
          isDisconnectedTeammate: false,
        },
        defenderHasDefensePost: true,
        defensePostFortress: fortress,
        falloutRatio: null,
        borderSize: 10,
      });
    expect(attack(5).attackerTroopLoss).toBeGreaterThan(
      attack(0).attackerTroopLoss * 4,
    );
    expect(attack(5).tickFraction).toBeGreaterThan(attack(0).tickFraction);
  });

  test("a level-2 Watchtower shells an enemy boat in reach", async () => {
    // 16x16: land at x <= 7, ocean beyond.
    const game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    const rome = game.player("rome");
    const carthage = game.player("carthage");
    rome.conquer(game.ref(7, 2));
    carthage.conquer(game.ref(0, 15));
    game.endSpawnPhase();
    const post = rome.buildUnit(UnitType.DefensePost, game.ref(7, 2), {});
    post.raiseTier(POST_PATH_WATCHTOWER);
    post.raiseTier(POST_PATH_WATCHTOWER);
    game.addExecution(new DefensePostExecution(post));
    const boat = carthage.buildUnit(UnitType.TransportShip, game.ref(9, 3), {
      troops: 100,
    });
    // A post reloads for defensePostShellAttackRate (10 s) from the start.
    executeTicks(game, 140);
    expect(boat.isActive()).toBe(false);
  });
});

describe("Oil Rig and goods paths", () => {
  test("a rig's Platform guns sink an enemy boat, and survive a snapshot", async () => {
    // 16x16: land at x <= 7, ocean beyond.
    const game = await setup(
      "half_land_half_ocean",
      { instantBuild: true, goods: true },
      [
        new PlayerInfo("rome", PlayerType.Human, null, "rome"),
        new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
      ],
    );
    const rome = game.player("rome");
    const carthage = game.player("carthage");
    rome.conquer(game.ref(7, 2));
    carthage.conquer(game.ref(0, 15));
    game.endSpawnPhase();
    const rig = rome.buildUnit(UnitType.OilRig, game.ref(10, 2), {});
    for (let i = 0; i < 2; i++) rig.raiseTier(RIG_PATH_PLATFORM);
    game.addExecution(new OilRigExecution(rig));
    executeTicks(game, 2);
    await expectSnapshotRoundTrip(game, "half_land_half_ocean", 3);
    const boat = carthage.buildUnit(UnitType.TransportShip, game.ref(12, 4), {
      troops: 100,
    });
    executeTicks(game, 100);
    expect(boat.isActive()).toBe(false);
  });

  test("Hull toughens a rig, Drill and Output grow goods", () => {
    expect(RIG_HULL_HEALTH_PERCENT[5]).toBe(400);
    expect(RIG_DRILL_YIELD_PERCENT[5]).toBe(400);
    expect(GOODS_OUTPUT_PERCENT[5]).toBe(500);
  });
});
