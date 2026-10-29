import {
  DisasterKind,
  Good,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  DROUGHT_FOOD_SPOIL,
  DROUGHT_TICKS,
  EARTHQUAKE_TROOP_LOSS,
  EARTHQUAKE_TROOP_SHOCK,
  OUTBREAK_CHECK_TICKS,
  OUTBREAK_TICKS,
  outbreakChance,
  POLLUTION_SAFE_LEVELS,
  pollutionLevels,
  TORNADO_TICKS,
} from "@openfront/engine-lib/game/Disasters";
import { workingLevels } from "@openfront/engine-lib/game/Goods";
import { isZombieHorde } from "@openfront/engine-lib/game/Zombies";
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

  test("mostly strike people rather than nations", async () => {
    const g = await setup(MAP, { disasters: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Nation, null, "carthage"),
    ]);
    const r = g.player("rome");
    const c = g.player("carthage");
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x <= coastX; x++) (y < 8 ? r : c).conquer(g.ref(x, y));
    }
    const exec = new DisasterExecution(7);
    g.addExecution(exec);
    executeTicks(g, 1);
    let onRome = 0;
    for (let i = 0; i < 400; i++) {
      const t = (exec as any).pickTile(DisasterKind.Earthquake);
      if (g.owner(t) === r) onRome++;
    }
    // Equal land: 60% aimed at Rome plus half of the rest, about 80%.
    expect(onRome / 400).toBeGreaterThan(0.7);
  });

  test("one roll in twenty raises a zombie horde instead", () => {
    (disasters as any).quietUntil = 0;
    // Every roll comes up 0: a disaster strikes, it is zombies, and the
    // picked tile is (0, 0), so they rise inside Rome.
    (disasters as any).random.next = () => 0;
    executeTicks(game, 1);
    const horde = game.players().find((p) => isZombieHorde(p));
    expect(horde).toBeDefined();
    expect(rome.numTilesOwned()).toBeLessThan(8 * (coastX + 1));
    expect(carthage.numTilesOwned()).toBe(8 * (coastX + 1));
  });

  test("an earthquake kills troops by the land it shakes and damages buildings", () => {
    for (let i = 0; i < 4; i++) {
      const city = rome.buildUnit(UnitType.City, game.ref(1 + i, 2 + i), {});
      city.increaseLevel();
    }
    const before = levels(rome, UnitType.City);
    disasters.strike(DisasterKind.Earthquake, game.ref(3, 3));

    expect(rome.troops()).toBeLessThan(100_000);
    // Everyone it touches loses the shock share, more for more land.
    expect(rome.troops()).toBeLessThanOrEqual(
      100_000 * (1 - EARTHQUAKE_TROOP_SHOCK),
    );
    expect(rome.troops()).toBeGreaterThanOrEqual(
      100_000 * (1 - EARTHQUAKE_TROOP_SHOCK - EARTHQUAKE_TROOP_LOSS) - 1,
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

  test("a drought stops Farms for a while and spoils stored food", () => {
    const farm = rome.buildUnit(UnitType.Farm, game.ref(2, 2), {});
    expect(workingLevels(rome)[Good.Food]).toBe(1);
    rome.addGoods([400, 0, 0]);

    disasters.strike(DisasterKind.Drought, game.ref(2, 3));
    expect(rome.goods()[Good.Food]).toBeCloseTo(400 * (1 - DROUGHT_FOOD_SPOIL));
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

  /** A building of `type` at (x, y) with `level` levels. */
  function build(type: UnitType, x: number, y: number, level = 1) {
    const u = rome.buildUnit(type, game.ref(x, y), {});
    for (let i = 1; i < level; i++) u.increaseLevel();
    return u;
  }

  /** Whether `city` falls sick within `checks` disease checks. */
  function fallsSick(city: { isDisrupted(): boolean }, checks: number) {
    for (let i = 0; i < checks * OUTBREAK_CHECK_TICKS; i++) {
      game.executeNextTick();
      if (city.isDisrupted()) return true;
    }
    return false;
  }

  test("risk grows with the industry near a city", () => {
    expect(outbreakChance(POLLUTION_SAFE_LEVELS)).toBe(0);
    expect(outbreakChance(POLLUTION_SAFE_LEVELS + 1)).toBeCloseTo(0.1);
    expect(outbreakChance(100)).toBe(0.5);

    build(UnitType.City, 2, 2, 5);
    build(UnitType.Port, coastX, 2);
    build(UnitType.Factory, 3, 5, 2);
    build(UnitType.DefensePost, 3, 3);
    // Only the player's own factories and ports count, not cities.
    carthage.conquer(game.ref(coastX, 15));
    expect(pollutionLevels(game, rome, game.ref(2, 3))).toBe(3);
    expect(pollutionLevels(game, carthage, game.ref(2, 3))).toBe(0);
  });

  test("cities away from industry never get sick, however many", () => {
    const city = build(UnitType.City, 2, 2, 5);
    for (let i = 0; i < 6; i++) build(UnitType.City, 1 + (i % 3), 5 + i, 3);
    expect(fallsSick(city, 20)).toBe(false);
  });

  test("cities next to heavy industry do, and the industry keeps running", () => {
    const city = build(UnitType.City, 2, 2);
    const factory = build(UnitType.Factory, 3, 5, 6);
    expect(fallsSick(city, 20)).toBe(true);
    expect(factory.isDisrupted()).toBe(false);
  });

  test("an outbreak stops cities and drains troops until it ends", () => {
    const city = build(UnitType.City, 2, 2);
    const port = build(UnitType.Port, coastX, 3);
    const capWithCity = game.config().maxTroops(rome);

    disasters.outbreak(rome, city.tile(), game.ticks());
    expect(city.isDisrupted()).toBe(true);
    expect(port.isDisrupted()).toBe(false);
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

  test("nations keep cities away from industry", () => {
    build(UnitType.City, 2, 2);
    build(UnitType.Factory, 3, 5, POLLUTION_SAFE_LEVELS);
    const ai = new NationStructureBehavior(new PseudoRandom(0), game, rome);
    const safe = (type: UnitType) =>
      (ai as any).crowdingSafe(type, game.ref(2, 8));
    // More industry would sicken the city; another city here is still fine.
    expect(safe(UnitType.Factory)).toBe(false);
    expect(safe(UnitType.Port)).toBe(false);
    expect(safe(UnitType.City)).toBe(true);
    expect(safe(UnitType.SAMLauncher)).toBe(true);

    build(UnitType.Port, coastX, 10);
    expect(safe(UnitType.City)).toBe(false);
  });

  test("survive a snapshot round trip mid-outbreak and mid-tornado", async () => {
    const city = rome.buildUnit(UnitType.City, game.ref(2, 2), {});
    disasters.outbreak(rome, city.tile(), game.ticks());
    disasters.strike(DisasterKind.Tornado, game.ref(4, 10));
    executeTicks(game, 3);
    await expectSnapshotRoundTrip(game, MAP);
  });
});
