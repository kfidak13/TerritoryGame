import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { setup } from "./util/Setup";

describe("Building placement", () => {
  test("a person's building goes on the tile they pick, a nation's snaps", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("rome", PlayerType.Human, null, "rome"),
      new PlayerInfo("carthage", PlayerType.Nation, null, "carthage"),
    ]);
    const rome = game.player("rome");
    const carthage = game.player("carthage");
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        (y < 10 ? rome : carthage).conquer(game.ref(x, y));
      }
    }
    rome.addGold(10_000_000n);
    carthage.addGold(10_000_000n);
    rome.buildUnit(UnitType.City, game.ref(30, 5), {});
    carthage.buildUnit(UnitType.City, game.ref(30, 15), {});

    // Too close to a city, and nothing moves it elsewhere.
    expect(rome.canBuild(UnitType.City, game.ref(20, 5))).toBe(false);
    const free = game.ref(5, 5);
    expect(rome.canBuild(UnitType.City, free)).toBe(free);

    const snapped = carthage.canBuild(UnitType.City, game.ref(20, 15));
    expect(snapped).not.toBe(false);
    expect(snapped).not.toBe(game.ref(20, 15));
  });
});
