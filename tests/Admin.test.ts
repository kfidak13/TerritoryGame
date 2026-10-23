import {
  DisasterKind,
  Good,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AdminAction } from "@openfront/engine-api/Schemas";
import {
  isZombieHorde,
  ZOMBIE_ROT_AFTER_TICKS,
} from "@openfront/engine-lib/game/Zombies";
import { AdminExecution } from "@openfront/engine/execution/admin/AdminExecution";
import { HEAVENLY_TICKS } from "@openfront/engine/execution/admin/HeavenlyNukeExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { adminPasswordMatches } from "../src/server/accounts/AccountService";
import { authorizeIntent } from "../src/server/IntentAuthorization";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

// 16x16: land at x <= coastX, ocean beyond.
const MAP = "half_land_half_ocean";
const coastX = 7;
let game: Game;
let rome: Player;
let carthage: Player;

function admin(action: AdminAction) {
  game.addExecution(new AdminExecution(rome, action));
  executeTicks(game, 2);
}

describe("Admin powers", () => {
  beforeEach(async () => {
    game = await setup(MAP, { goods: true, instantBuild: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    rome = game.player("rome");
    carthage = game.player("carthage");
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x <= coastX; x++) {
        (y < 8 ? rome : carthage).conquer(game.ref(x, y));
      }
    }
    rome.setTroops(100_000);
    carthage.setTroops(100_000);
  });

  test("give and take resources, never below zero", () => {
    admin({
      kind: "resources",
      target: "carthage",
      gold: 5000,
      troops: 1000,
      goods: [10, 20, 30],
    });
    expect(carthage.gold()).toBeGreaterThanOrEqual(5000n);
    expect(carthage.goods()).toEqual([10, 20, 30]);

    admin({
      kind: "resources",
      target: "carthage",
      gold: 0,
      troops: -50_000,
      goods: [-100, -5, 0],
    });
    expect(carthage.troops()).toBeLessThan(60_000);
    expect(carthage.goods()).toEqual([0, 15, 30]);
  });

  test("god mode keeps a god's land and fills their coffers", () => {
    admin({ kind: "god", enabled: true });
    const tile = game.ref(2, 2);
    carthage.conquer(tile);
    expect(game.owner(tile)).toBe(rome);

    game.addExecution(new PlayerExecution(rome));
    executeTicks(game, 2);
    expect(rome.gold()).toBeGreaterThanOrEqual(1_000_000_000n);
    expect(rome.troops()).toBeGreaterThanOrEqual(
      Math.floor(game.config().maxTroops(rome)),
    );

    admin({ kind: "god", enabled: false });
    carthage.conquer(tile);
    expect(game.owner(tile)).toBe(carthage);
  });

  test("paint land to anyone, or back to neutral", () => {
    admin({
      kind: "paint",
      tile: game.ref(3, 3),
      radius: 2,
      owner: "carthage",
    });
    expect(game.owner(game.ref(3, 3))).toBe(carthage);
    admin({ kind: "paint", tile: game.ref(3, 3), radius: 2, owner: null });
    expect(game.hasOwner(game.ref(3, 3))).toBe(false);
  });

  test("spawn max-level buildings on anyone's land, and warships at sea", () => {
    admin({
      kind: "spawn",
      unit: UnitType.City,
      tile: game.ref(2, 2),
      owner: "carthage",
      level: 5,
    });
    const [city] = carthage.units(UnitType.City);
    expect(city.level()).toBe(5);
    expect(game.owner(city.tile())).toBe(carthage);

    admin({
      kind: "spawn",
      unit: UnitType.Warship,
      tile: game.ref(coastX + 3, 3),
      owner: "rome",
      level: 1,
    });
    expect(rome.units(UnitType.Warship)).toHaveLength(1);
  });

  test("smite lands at once, unannounced", () => {
    const before = carthage.numTilesOwned();
    admin({ kind: "smite", nuke: UnitType.AtomBomb, tile: game.ref(3, 12) });
    executeTicks(game, 10);
    expect(carthage.numTilesOwned()).toBeLessThan(before);
  });

  test("summon a disaster where clicked", () => {
    admin({
      kind: "disaster",
      disaster: DisasterKind.Earthquake,
      tile: game.ref(3, 12),
    });
    executeTicks(game, 3);
    expect(carthage.troops()).toBeLessThan(100_000);
  });

  test("puppets attack, and diplomacy bends to the admin", () => {
    admin({ kind: "puppet", nation: "carthage", target: "rome" });
    expect(carthage.outgoingAttacks()).toHaveLength(1);

    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "ally" });
    expect(rome.isAlliedWith(carthage)).toBe(true);
    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "break" });
    expect(rome.isAlliedWith(carthage)).toBe(false);
    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "embargo" });
    expect(carthage.hasEmbargoAgainst(rome)).toBe(true);
    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "pact" });
    expect(rome.hasTradePactWith(carthage)).toBe(false); // embargoed
    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "unembargo" });
    admin({ kind: "diplomacy", a: "rome", b: "carthage", op: "pact" });
    expect(rome.hasTradePactWith(carthage)).toBe(true);
  });

  test("eliminate a player, then revive them", () => {
    admin({ kind: "eliminate", target: "carthage" });
    expect(carthage.isAlive()).toBe(false);
    admin({ kind: "revive", target: "carthage", tile: game.ref(3, 12) });
    expect(carthage.isAlive()).toBe(true);
    expect(carthage.troops()).toBeGreaterThan(0);
  });

  test("zombies rise in the middle, feed on land, and rot away", async () => {
    for (let y = 8; y < 16; y++) {
      for (let x = 0; x <= coastX; x++) rome.conquer(game.ref(x, y));
    }
    carthage.conquer(game.ref(0, 15));
    rome.setTroops(100_000);
    admin({ kind: "zombies", target: "rome" });
    const horde = game.players().find((p) => p.name() === "Zombie Horde")!;
    expect(horde.isAlive()).toBe(true);
    expect(horde.troops()).toBeGreaterThan(0);
    // A nation in battle, but one that never trades.
    expect(isZombieHorde(horde)).toBe(true);
    expect(rome.troops()).toBeLessThan(100_000);

    await expectSnapshotRoundTrip(game, MAP, 10);

    executeTicks(game, ZOMBIE_ROT_AFTER_TICKS + 1200);
    expect(horde.isAlive()).toBe(false);
  });

  test("huge gifts stay past the usual caps", () => {
    admin({
      kind: "resources",
      target: "carthage",
      gold: 10_000_000_000,
      troops: 1_000_000_000,
      goods: [0, 0, 1_000_000],
    });
    game.addExecution(new PlayerExecution(carthage));
    executeTicks(game, 20);
    expect(carthage.gold()).toBeGreaterThanOrEqual(10_000_000_000n);
    expect(carthage.troops()).toBeGreaterThanOrEqual(1_000_000_000);
    expect(carthage.goods()[Good.Metal]).toBe(1_000_000);

    admin({
      kind: "resources",
      target: "carthage",
      gold: 0,
      troops: -1_000_000_000,
      goods: [0, 0, 0],
    });
    expect(carthage.troopBonus()).toBe(0);
  });

  test("a new building can go up at a level", () => {
    rome.addGold(100_000_000n);
    rome.grantGoods([10_000, 10_000, 10_000]);
    game.addExecution(
      new ConstructionExecution(
        rome,
        UnitType.City,
        game.ref(2, 2),
        undefined,
        5,
      ),
    );
    executeTicks(game, 5);
    const [city] = rome.units(UnitType.City);
    expect(city.level()).toBe(5);
  });

  test("the heavenly nuke wipes the whole map", async () => {
    rome.buildUnit(UnitType.City, game.ref(2, 2), {});
    admin({ kind: "heavenly" });
    await expectSnapshotRoundTrip(game, MAP, 3);
    executeTicks(game, HEAVENLY_TICKS);
    expect(rome.numTilesOwned()).toBe(0);
    expect(carthage.numTilesOwned()).toBe(0);
    expect(game.units().filter((u) => u.isActive())).toHaveLength(0);
    expect(game.hasFallout(game.ref(2, 2))).toBe(true);
  });

  test("leave goods alone that a player doesn't have", () => {
    carthage.addGoods([5, 0, 0]);
    admin({
      kind: "resources",
      target: "carthage",
      gold: 0,
      troops: 0,
      goods: [-50, 0, 0],
    });
    expect(carthage.goods()[Good.Food]).toBe(0);
  });
});

describe("Admin access", () => {
  const actor = {
    clientID: "client01",
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };
  const game = {
    isPublic: false,
    isListed: false,
    isQueued: false,
    hasStarted: true,
  };
  const intent = {
    type: "admin" as const,
    action: { kind: "god" as const, enabled: true },
  };

  test("only a client that proved the key may use admin powers", () => {
    expect(authorizeIntent(intent, actor, game)?.status).toBe(403);
    expect(
      authorizeIntent(intent, { ...actor, isBorderfallAdmin: true }, game),
    ).toBeNull();
  });

  test("the admin password must match the server's, and an unset one opens nothing", () => {
    vi.stubEnv("BORDERFALL_ADMIN_PASSWORD", "");
    expect(adminPasswordMatches("")).toBe(false);
    vi.stubEnv("BORDERFALL_ADMIN_PASSWORD", "hunter2");
    expect(adminPasswordMatches("hunter2")).toBe(true);
    expect(adminPasswordMatches("hunter3")).toBe(false);
    vi.unstubAllEnvs();
  });
});
