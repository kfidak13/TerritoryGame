import { describe, expect, it } from "vitest";
import { generateMap, Rng, Terrain } from "../src/index.ts";

describe("Rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.nextU32())).not.toEqual(seqA);
  });
});

describe("generateMap", () => {
  const opts = { width: 200, height: 120, seed: 1234 };

  it("is deterministic per seed", () => {
    expect(generateMap(opts).terrain).toEqual(generateMap(opts).terrain);
    expect(generateMap({ ...opts, seed: 99 }).terrain).not.toEqual(generateMap(opts).terrain);
  });

  it("produces every terrain type at roughly the requested water fraction", () => {
    const map = generateMap(opts);
    const counts = new Map<number, number>();
    for (const t of map.terrain) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of Object.values(Terrain)) expect(counts.get(t) ?? 0).toBeGreaterThan(0);
    const water = (counts.get(Terrain.Ocean) ?? 0) + (counts.get(Terrain.Shallows) ?? 0);
    expect(water / map.size).toBeGreaterThan(0.4);
    expect(water / map.size).toBeLessThan(0.5);
  });

  it("keeps the map border as water", () => {
    const map = generateMap(opts);
    for (let x = 0; x < map.width; x++) {
      expect(map.isLand(map.tile(x, 0))).toBe(false);
      expect(map.isLand(map.tile(x, map.height - 1))).toBe(false);
    }
  });
});
