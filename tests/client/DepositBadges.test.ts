import { describe, expect, it } from "vitest";
import { fieldBadges } from "../../src/client/render/gl/passes/DepositPass";

describe("fieldBadges", () => {
  it("puts one badge in the middle of each big enough field", () => {
    // 6x3: a 3x3 Food field (byte 1) on the left, a lone Oil tile (2).
    const w = 6;
    const d = new Uint8Array(w * 3);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) d[y * w + x] = 1;
    d[1 * w + 5] = 2;
    expect([...fieldBadges(d, w, 3, 4)]).toEqual([1.5, 1.5, 0]);
    expect(fieldBadges(d, w, 3, 1)).toHaveLength(6);
  });

  it("keeps the badge on a crescent's own land", () => {
    // A U shape: its centroid falls in the gap.
    const w = 5;
    const d = new Uint8Array(w * 3);
    for (const [x, y] of [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [4, 1],
      [4, 0],
    ]) {
      d[y * w + x] = 3;
    }
    const [bx, by] = fieldBadges(d, w, 3, 1);
    expect(d[Math.floor(by) * w + Math.floor(bx)]).toBe(3);
  });
});
