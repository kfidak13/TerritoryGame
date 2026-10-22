import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  Good,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { emptyTerms } from "@openfront/engine-lib/game/Trade";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  NationTradeBehavior,
  nationAcceptsTrade,
} from "@openfront/engine/execution/nation/NationTradeBehavior";
import {
  goodsWithinReach,
  hasGoodsFor,
  neededGoods,
} from "@openfront/engine/execution/nation/NationUtils";
import { TradeOfferExecution } from "@openfront/engine/execution/trade/TradeOfferExecution";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, test, vi } from "vitest";
import { setup } from "./util/Setup";

// Borderfall phase 7: nations that know what goods they lack and trade or
// fight for them.

const MAP = "world";

function depositTiles(game: Game, good: Good, n: number): TileRef[] {
  const tiles: TileRef[] = [];
  game.map().forEachTile((t) => {
    if (tiles.length < n && game.isLand(t) && game.depositAt(t) === good) {
      tiles.push(t);
    }
  });
  return tiles;
}

async function nationGame(difficulty = Difficulty.Medium) {
  const game = await setup(MAP, { goods: true, difficulty }, [
    new PlayerInfo("rome", PlayerType.Nation, null, "rome"),
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  const rome = game.player("rome");
  const alice = game.player("alice");
  const bob = game.player("bob");
  // Rome produces Metal; nobody produces Oil.
  for (const t of depositTiles(game, Good.Metal, 20)) rome.conquer(t);
  for (const t of depositTiles(game, Good.Food, 20)) alice.conquer(t);
  for (const t of depositTiles(game, Good.Food, 40).slice(20)) bob.conquer(t);
  return { game, rome, alice, bob };
}

const offer = (
  give: Partial<ReturnType<typeof emptyTerms>>,
  ask: Partial<ReturnType<typeof emptyTerms>>,
) => ({
  give: { ...emptyTerms(), ...give },
  ask: { ...emptyTerms(), ...ask },
  ceasefire: false,
  pact: false,
});

describe("what a nation needs", () => {
  test("goods it has no income of, emptiest first, Food once troops eat", async () => {
    const { game, rome } = await nationGame();
    rome.setTroops(1);
    expect(neededGoods(game, rome)).toEqual([Good.Oil]);

    // Troops beyond what the land feeds, and an empty granary: Food first.
    rome.setTroops(game.config().foodLandFed(rome) * 2);
    expect(neededGoods(game, rome)[0]).toBe(Good.Food);
  });

  test("nothing with goods off", async () => {
    const game = await setup(MAP, {}, [
      new PlayerInfo("rome", PlayerType.Nation, null, "rome"),
    ]);
    const rome = game.player("rome");
    rome.conquer(game.ref(1000, 400));
    expect(neededGoods(game, rome)).toEqual([]);
    expect(hasGoodsFor(game, rome, UnitType.MIRV)).toBe(true);
  });

  test("a MIRV is only worth saving for with the Oil in reach", async () => {
    const { game, rome } = await nationGame();
    expect(hasGoodsFor(game, rome, UnitType.AtomBomb)).toBe(false);
    expect(goodsWithinReach(game, rome, UnitType.MIRV)).toBe(false);
    rome.addGoods([0, 900, 0]);
    expect(hasGoodsFor(game, rome, UnitType.MIRV)).toBe(true);
    expect(goodsWithinReach(game, rome, UnitType.MIRV)).toBe(true);
  });
});

describe("nations weighing offers", () => {
  test("pay more for a good they need", async () => {
    const { game, rome, alice } = await nationGame();
    rome.addGoods([0, 0, 100]);
    // 40 Oil for 50 Metal: a bad deal at face value, a good one for a
    // nation with no Oil at all.
    const deal = offer({ goods: [0, 40, 0] }, { goods: [0, 0, 50] });
    expect(nationAcceptsTrade(game, rome, alice, deal)).toBe(true);

    for (const t of depositTiles(game, Good.Oil, 5)) rome.conquer(t);
    expect(nationAcceptsTrade(game, rome, alice, deal)).toBe(false);
  });

  test("harder nations drive harder bargains", async () => {
    const deal = offer({ gold: 52_000 }, { goods: [0, 0, 40] });
    const medium = await nationGame(Difficulty.Medium);
    medium.rome.addGoods([0, 0, 100]);
    expect(
      nationAcceptsTrade(medium.game, medium.rome, medium.alice, deal),
    ).toBe(true);
    const impossible = await nationGame(Difficulty.Impossible);
    impossible.rome.addGoods([0, 0, 100]);
    expect(
      nationAcceptsTrade(
        impossible.game,
        impossible.rome,
        impossible.alice,
        deal,
      ),
    ).toBe(false);
  });
});

describe("nations proposing deals", () => {
  function offersMade(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls
      .map((c) => c[0])
      .filter(
        (e): e is TradeOfferExecution => e instanceof TradeOfferExecution,
      );
  }

  test("swap a surplus for a needed good with whoever has most of it", async () => {
    const { game, rome, alice, bob } = await nationGame();
    rome.addGoods([0, 0, 500]);
    alice.addGoods([0, 60, 0]);
    bob.addGoods([0, 200, 0]);

    const spy = vi.spyOn(game, "addExecution");
    expect((new NationTradeBehavior(game, rome) as any).swapForNeeds()).toBe(
      true,
    );
    const [made] = offersMade(spy);
    game.executeNextTick();
    expect(made.id()).toBeGreaterThan(0);
    // Bob got the offer: 52 Metal for 40 Oil.
    expect((made as any).recipient).toBe(bob);
    expect((made as any).give.goods).toEqual([0, 0, 52]);
    expect((made as any).ask.goods).toEqual([0, 40, 0]);
  });

  test("offer pacts to trusted players, and drop pacts with players turned sour", async () => {
    const { game, rome, alice, bob } = await nationGame();
    rome.updateRelation(bob, -100);
    const spy = vi.spyOn(game, "addExecution");
    (new NationTradeBehavior(game, rome) as any).offerPact(new PseudoRandom(1));
    const [made] = offersMade(spy);
    expect((made as any).recipientID).toBe(alice.id());
    expect((made as any).pact).toBe(true);

    rome.updateRelation(bob, 200);
    rome.addTradePact(bob);
    rome.updateRelation(bob, -200);
    (new NationTradeBehavior(game, rome) as any).endSourPacts();
    expect(rome.hasTradePactWith(bob)).toBe(false);
  });

  test("buy a ceasefire from a much stronger attacker", async () => {
    const { game, rome, alice } = await nationGame(Difficulty.Hard);
    rome.addGold(100_000n);
    rome.setTroops(10_000);
    alice.setTroops(500_000);
    rome.addEmbargo(alice, true); // what being attacked does
    const spy = vi.spyOn(game, "addExecution");
    expect(
      (new NationTradeBehavior(game, rome) as any).seekCeasefire(alice),
    ).toBe(true);
    const [made] = offersMade(spy);
    expect((made as any).ceasefire).toBe(true);
    expect((made as any).give.gold).toBeGreaterThan(0);
    expect(rome.hasEmbargoAgainst(alice)).toBe(false);
  });

  test("never with goods off or on Easy", async () => {
    const easy = await nationGame(Difficulty.Easy);
    easy.rome.addGoods([0, 0, 500]);
    easy.bob.addGoods([0, 200, 0]);
    const spy = vi.spyOn(easy.game, "addExecution");
    for (let i = 0; i < 50; i++) {
      new NationTradeBehavior(easy.game, easy.rome).maybeProposeTrade(
        () => null,
      );
      easy.game.executeNextTick();
    }
    expect(offersMade(spy)).toHaveLength(0);
  });
});

describe("nations fighting for deposits", () => {
  test("go after the weaker neighbor holding what they lack", async () => {
    const { game, rome, alice, bob } = await nationGame(Difficulty.Hard);
    for (const t of depositTiles(game, Good.Oil, 10)) alice.conquer(t);
    const oil = depositTiles(game, Good.Oil, 40).slice(10);
    for (const t of oil) bob.conquer(t);
    // Under what its land feeds, so Oil (not Food) is the need.
    rome.setTroops(40_000);
    alice.setTroops(5_000);
    bob.setTroops(5_000);

    const behavior = new AiAttackBehavior(
      new PseudoRandom(1),
      game,
      rome,
      0.5,
      0.3,
      0.2,
      { maybeBetray: vi.fn() } as any,
      { maybeSendAttackEmoji: vi.fn(), sendEmoji: vi.fn() } as any,
    );
    const find = (enemies: Player[]) =>
      (behavior as any).findDepositHolder(enemies);
    // Bob has more Oil deposits.
    expect(find([alice, bob])).toBe(bob);
    // Too strong to take on: skip him.
    bob.setTroops(35_000);
    expect(find([alice, bob])).toBe(alice);
    // Nothing needed: no target.
    for (const t of depositTiles(game, Good.Oil, 50).slice(40)) rome.conquer(t);
    expect(find([alice, bob])).toBeNull();
  });
});
