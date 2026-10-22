import { describe, expect, it } from "vitest";

// Side-effect import: the @customElement decorator registers <build-menu>
// when the module is evaluated, and a type-only reference would not evaluate it.
import { BuildableUnit, UnitType } from "@openfront/engine-api/game/GameTypes";
import { goodsCostText } from "../../../../src/client/hud/GoodsText";
import "../../../../src/client/hud/layers/BuildMenu";
import type { BuildMenu } from "../../../../src/client/hud/layers/BuildMenu";

function makeMenu(): BuildMenu {
  return document.createElement("build-menu") as BuildMenu;
}

const item = (unitType: UnitType) => ({ unitType, icon: "" }) as any;

describe("BuildMenu.cost", () => {
  it("returns the buildable's cost for a matching unit type", () => {
    const menu = makeMenu();
    menu.playerBuildables = [
      { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 125n },
      { type: UnitType.Port, canBuild: false, canUpgrade: false, cost: 5n },
    ] as unknown as BuildableUnit[];

    // Skips non-matching entries before finding the match.
    expect(menu.cost(item(UnitType.Port))).toBe(5n);
    expect(menu.cost(item(UnitType.City))).toBe(125n);
  });

  it("falls back to 0 when the unit type is not buildable here", () => {
    const menu = makeMenu();
    menu.playerBuildables = [
      { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 125n },
    ] as unknown as BuildableUnit[];

    expect(menu.cost(item(UnitType.Factory))).toBe(0n);
  });

  it("falls back to 0 before the buildables have arrived", () => {
    const menu = makeMenu();
    menu.playerBuildables = null;

    expect(menu.cost(item(UnitType.City))).toBe(0n);
  });
});

// Borderfall goods: the cost line and the shortage reason on blocked builds.
describe("BuildMenu goods", () => {
  const warship = (goodsShort: boolean) =>
    ({
      type: UnitType.Warship,
      canBuild: goodsShort ? false : 7,
      canUpgrade: false,
      cost: 100n,
      goodsCost: [0, 40, 0],
      goodsShort,
    }) as unknown as BuildableUnit;

  function menuWith(bu: BuildableUnit, oil: number): BuildMenu {
    const menu = makeMenu();
    menu.playerBuildables = [bu];
    menu.game = {
      myPlayer: () => ({ goods: () => [0, oil, 0] }),
    } as any;
    return menu;
  }

  it("formats a build's goods cost", () => {
    expect(goodsCostText([0, 40, 20])).toBe("🛢️ 40 ⚙️ 20");
  });

  it("exposes the goods cost of a buildable", () => {
    const menu = menuWith(warship(false), 50);
    expect(menu.goodsCost(item(UnitType.Warship))).toEqual([0, 40, 0]);
    expect(menu.goodsCost(item(UnitType.City))).toBeUndefined();
  });

  it("explains a goods shortage only when the engine reports one", () => {
    expect(
      menuWith(warship(true), 10).goodsShortReason(item(UnitType.Warship)),
    ).toContain("build_menu.not_enough_goods");
    expect(
      menuWith(warship(false), 50).goodsShortReason(item(UnitType.Warship)),
    ).toBeNull();
  });
});
