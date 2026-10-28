import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  gridPlanStep,
  gridPlanStepsAt,
  unpackMotionPlans,
  type GridPathPlan,
} from "@openfront/engine-lib/game/MotionPlans";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { setup } from "./util/Setup";

describe("Ship speed", () => {
  test("a 130% plan takes 13 steps in 10 ticks, never two in a row of three", () => {
    expect(gridPlanStep(10, 1, 130)).toBe(13);
    expect(gridPlanStep(10, 1)).toBe(10);
    const steps = Array.from({ length: 10 }, (_, k) =>
      gridPlanStepsAt(100 + k, 100, 130),
    );
    expect(steps.reduce((a, b) => a + b, 0)).toBe(13);
    expect(Math.max(...steps)).toBe(2);
  });

  test("a fast invasion boat stands where the client draws it, every tick", async () => {
    // 16x16: land at x <= 7, ocean beyond.
    const game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Human, null, "carthage"),
    ]);
    const rome = game.player("rome");
    const carthage = game.player("carthage");
    for (let x = 0; x <= 7; x++) {
      rome.conquer(game.ref(x, 0));
      carthage.conquer(game.ref(x, 15));
    }
    rome.addTroops(10_000);
    const port = rome.buildUnit(UnitType.Port, game.ref(7, 0), {});
    for (let i = 0; i < 4; i++) port.raiseTier(2); // Invasion 4: 130%
    game.endSpawnPhase();
    game.drainPackedMotionPlans();

    const exec = new TransportShipExecution(rome, game.ref(7, 15), 1_000);
    game.addExecution(exec);
    game.executeNextTick();
    const plan = unpackMotionPlans(game.drainPackedMotionPlans()!).find(
      (p): p is GridPathPlan => p.kind === "grid",
    )!;
    expect(plan.speedPercent).toBe(130);

    const boat = rome.units(UnitType.TransportShip)[0];
    let ticks = 0;
    while (boat.isActive() && ticks++ < 100) {
      game.executeNextTick();
      if (!boat.isActive()) break;
      // Where MotionPlanResolver draws it for the tick just done.
      const index = gridPlanStep(
        game.ticks() - plan.startTick,
        plan.ticksPerStep,
        plan.speedPercent,
      );
      expect(boat.tile()).toBe(
        plan.path[Math.min(index, plan.path.length - 1)],
      );
    }
    // 30% faster than a tile a tick: fewer ticks than tiles.
    expect(ticks).toBeLessThan(plan.path.length);
  });
});
