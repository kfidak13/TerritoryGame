import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import {
  BuildingPanel,
  SelectBuildingEvent,
} from "../../src/client/hud/layers/BuildingPanel";
import { SendUpgradeStructureIntentEvent } from "../../src/client/Transport";

function panel(tiers: number[], level5s = 0) {
  const me = {
    gold: () => 1_000_000_000n,
    goods: () => [10_000, 10_000, 10_000],
    units: () =>
      Array.from({ length: level5s }, () => ({ tiers: () => [5, 0, 0] })),
  };
  const unit = {
    id: () => 123,
    type: () => UnitType.City,
    tiers: () => tiers,
    level: () => 1 + tiers.reduce((a, b) => a + b, 0),
    isUnderConstruction: () => false,
    isActive: () => true,
    owner: () => me,
  };
  const p = new BuildingPanel();
  p.game = {
    myPlayer: () => me,
    config: () => ({ goodsEnabled: () => true }),
  } as any;
  p.eventBus = new EventBus();
  p.init();
  p.eventBus.emit(new SelectBuildingEvent(unit as any));
  return p;
}

const blocked = (p: BuildingPanel, path: number) =>
  (p as any).blocked((p as any).unit, path);

describe("BuildingPanel", () => {
  it("lets any path go up from a fresh building", () => {
    const p = panel([2, 0, 0]);
    expect([0, 1, 2].map((path) => blocked(p, path))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("shuts the third path, stops the second at 2, and allows two level 5s", () => {
    const p = panel([3, 2, 0]);
    expect(blocked(p, 0)).toBeNull();
    expect(blocked(p, 1)).not.toBeNull();
    expect(blocked(p, 2)).not.toBeNull();
    expect(blocked(panel([4, 0, 0], 2), 0)).not.toBeNull();
    expect(blocked(panel([4, 0, 0], 1), 0)).toBeNull();
  });

  it("sends an upgrade up the chosen path", () => {
    const p = panel([2, 0, 0]);
    const emit = vi.spyOn(p.eventBus, "emit");
    (p as any).upgrade((p as any).unit, 1, 1);
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ unitId: 123, path: 1, amount: 1 }),
    );
    expect(emit.mock.lastCall![0]).toBeInstanceOf(
      SendUpgradeStructureIntentEvent,
    );
  });

  it("closes when the building is gone", () => {
    const p = panel([0, 0, 0]);
    (p as any).unit.isActive = () => false;
    p.tick();
    expect((p as any).unit).toBeNull();
  });
});
