import { Structures } from "@openfront/engine-api/game/GameTypes";
import { MAX_TIER, upgradePaths } from "@openfront/engine-lib/game/Upgrades";
import { describe, expect, it, vi } from "vitest";
import { levelEffects } from "../../src/client/hud/layers/UpgradeEffects";

// Keys plus their numbers, so levels can be told apart without the bundle.
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: object) =>
    `${key}${params ? JSON.stringify(params) : ""}`,
}));

describe("levelEffects", () => {
  it("describes every level of every building's paths", () => {
    for (const type of Structures.types) {
      upgradePaths(type).forEach((_, path) => {
        const lines = levelEffects(type, path);
        expect(lines, `${type} path ${path}`).toHaveLength(MAX_TIER);
        for (const line of lines) {
          expect(line, `${type} path ${path}`).not.toBe("");
          expect(line).not.toMatch(/undefined|NaN/);
        }
        // Every level has to add something.
        for (let i = 1; i < lines.length; i++) {
          expect(lines[i], `${type} path ${path} level ${i + 1}`).not.toBe(
            lines[i - 1],
          );
        }
      });
    }
  });
});
