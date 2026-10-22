import {
  DisasterKind,
  Good,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  CROWDING_SAFE_LEVELS,
  crowdingLevels,
  DROUGHT_TICKS,
  EARTHQUAKE_TROOP_LOSS,
  OUTBREAK_TICKS,
  outbreakChance,
  TORNADO_TICKS,
} from "@openfront/engine-lib/game/Disasters";
import { workingLevels } from "@openfront/engine-lib/game/Goods";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { DisasterExecution } from "@openfront/engine/execution/DisasterExecution";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

// 16x16: land at x <= coastX, ocean beyond.
const MAP = "half_land_half_ocean";
const coastX = 7;
let game: Game;
let rome: Player;
let carthage: Player;
let disasters: DisasterExecution;

function levels(p: Player, ...types: UnitType[]): number {
  return p.units(types).reduce((n, u) => n + u.level(), 0);
}

describe("Disasters", () => {
  beforeEach(async () => {
    game = await setup(MAP, { goods: true, disasters: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    rome = game.player("rome");
    carthage = game.player("carthage");
    // Rome holds the north half of the land, Carthage the south.
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x <= coastX; x++) {
        (y < 8 ? rome : carthage).conquer(game.ref(x, y));
      }
    }
    rome.setTroops(100_000);
    carthage.setTroops(100_000);
    disasters = new DisasterExecution(1);
    game.addExecution(disasters);
    executeTicks(game, 1);
  });

  test("are off unless the lobby turns them on", async () => {
    const off = await setup(MAP, {});
    expect(off.config().disastersEnabled()).toBe(false);
    expect(game.config().disastersEnabled()).toBe(true);
  });

  test("an earthquake kills troops by the land it shakes and damages buildings", () => {
    for (let i = 0; i < 4; i++) {
      const city = rome.buildUnit(UnitType.City, game.ref(1 + i, 2 + i), {});
      city.increaseLevel();
    }
    const before = levels(rome, UnitType.City);
    disasters.strike(DisasterKind.Earthquake, game.ref(3, 3));

    expect(rome.troops()).toBeLessThan(100_000);
    expect(rome.troops()).toBeGreaterThanOrEqual(
      100_000 * (1 - EARTHQUAKE_TROOP_LOSS),
    );
    expect(levels(rome, UnitType.City)).toBeLessThan(before);
  });

  test("a hurricane sinks boats and batters warships and rigs", () => {
    const sea = game.ref(coastX + 2, 4);
    const boat = carthage.buildUnit(UnitType.TransportShip, sea, {
      troops: 100,
    });
    const warship = carthage.buildUnit(UnitType.Warship, sea, {
      patrolTile: sea,
    });
    const rig = rome.buildUnit(UnitType.OilRig, game.ref(coastX + 1, 3), {});
    const warshipHealth = warship.health();
    const rigHealth = rig.health();

    disasters.strike(DisasterKind.Hurricane, game.ref(coastX, 4));

    expect(boat.isActive()).toBe(false);
    expect(warship.health()).toBeLessThan(warshipHealth);
    expect(rig.health()).toBeLessThan(rigHealth);
    expect(rome.troops()).toBeLessThan(100_000);
  });

  test("a drought stops Farms for a while", () => {
    const farm = rome.buildUnit(UnitType.Farm, game.ref(2, 2), {});
    expect(workingLevels(rome)[Good.Food]).toBe(1);

    disasters.strike(DisasterKind.Drought, game.ref(2, 3));
    expect(farm.isDisrupted()).toBe(true);
    expect(workingLevels(rome)[Good.Food]).toBe(0);

    executeTicks(game, DROUGHT_TICKS + 1);
    expect(farm.isDisrupted()).toBe(false);
    expect(workingLevels(rome)[Good.Food]).toBe(1);
  });

  test("a tornado wrecks what it passes over", () => {
    const city = rome.buildUnit(UnitType.City, game.ref(3, 3), {});
    disasters.strike(DisasterKind.Tornado, game.ref(3, 3));
    executeTicks(game, TORNADO_TICKS + 1);
    expect(city.isActive()).toBe(false);
    expect(rome.troops()).toBeLessThan(100_000);
  });
});

describe("Disease", () => {
  beforeEach(async () => {
    game = await setup(MAP, { disasters: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    rome = game.player("rome");
    carthage = game.player("carthage");
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x <= coastX; x++) rome.conquer(game.ref(x, y));
    }
    rome.setTroops(100_000);
    disasters = new DisasterExecution(1);
    game.addExecution(disasters);
    executeTicks(game, 1);
  });

  test("risk grows with crowding past the safe level", () => {
    expect(outbreakChance(CROWDING_SAFE_LEVELS)).toBe(0);
    expect(outbreakChance(CROWDING_SAFE_LEVELS + 1)).toBeCloseTo(0.1);
    expect(outbreakChance(100)).toBe(0.5);

    rome.buildUnit(UnitType.City, game.ref(2, 2), {});
    rome.buildUnit(UnitType.Port, game.ref(coastX, 2), {});
    rome.buildUnit(UnitType.DefensePost, game.ref(3, 3), {});
    // Only the player's own cities, ports and factories count.
    carthage.conquer(game.ref(coastX + 0, 15));
    expect(crowdingLevels(game, rome, game.ref(2, 3))).toBe(2);
    expect(crowdingLevels(game, carthage, game.ref(2, 3))).toBe(0);
  });

  test("an outbreak stops crowded buildings and drains troops until it ends", () => {
    const city = rome.buildUnit(UnitType.City, game.ref(2, 2), {});
    const port = rome.buildUnit(UnitType.Port, game.ref(coastX, 3), {});
    const capWithCity = game.config().maxTroops(rome);

    disasters.outbreak(rome, city.tile(), game.ticks());
    expect(city.isDisrupted()).toBe(true);
    expect(port.isDisrupted()).toBe(true);
    // A sick city adds no troops.
    expect(game.config().maxTroops(rome)).toBeLessThan(capWithCity);

    rome.setTroops(100_000);
    executeTicks(game, 10);
    // Ten ticks of drain outweigh ten ticks of growth.
    expect(rome.troops()).toBeLessThan(100_000);

    executeTicks(game, OUTBREAK_TICKS);
    expect(city.isDisrupted()).toBe(false);
    expect(game.config().maxTroops(rome)).toBe(capWithCity);
  });

  test("nations keep crowding buildings apart", () => {
    for (let i = 0; i < CROWDING_SAFE_LEVELS; i++) {
      rome.buildUnit(UnitType.City, game.ref(1 + (i % 4), 1 + i), {});
    }
    const ai = new NationStructureBehavior(new PseudoRandom(0), game, rome);
    const safe = (type: UnitType) =>
      (ai as any).crowdingSafe(type, game.ref(2, 4));
    expect(safe(UnitType.City)).toBe(false);
    expect(safe(UnitType.Factory)).toBe(false);
    expect(safe(UnitType.SAMLauncher)).toBe(true);
  });

  test("survive a snapshot round trip mid-outbreak and mid-tornado", async () => {
    const city = rome.buildUnit(UnitType.City, game.ref(2, 2), {});
    disasters.outbreak(rome, city.tile(), game.ticks());
    disasters.strike(DisasterKind.Tornado, game.ref(4, 10));
    executeTicks(game, 3);
    await expectSnapshotRoundTrip(game, MAP);
  });
});
