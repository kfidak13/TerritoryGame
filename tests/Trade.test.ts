import {
  Good,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { TradeTerms } from "@openfront/engine-api/Schemas";
import { goodsIncome } from "@openfront/engine-lib/game/Goods";
import {
  emptyTerms,
  MAX_TRADE_PACTS,
  TRADE_OFFER_DURATION,
  TRADE_PACT_BONUS,
} from "@openfront/engine-lib/game/Trade";
import { EmbargoExecution } from "@openfront/engine/execution/EmbargoExecution";
import { EndTradePactExecution } from "@openfront/engine/execution/trade/EndTradePactExecution";
import { TradeOfferExecution } from "@openfront/engine/execution/trade/TradeOfferExecution";
import { TradeReplyExecution } from "@openfront/engine/execution/trade/TradeReplyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

const MAP = "plains";

/** Two humans owning side-by-side 10x10 blocks (alice west, bob east). */
async function tradeGame(
  extra: PlayerInfo[] = [],
): Promise<{ game: Game; alice: Player; bob: Player }> {
  const game = await setup(MAP, { goods: true }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
    ...extra,
  ]);
  const alice = game.player("alice");
  const bob = game.player("bob");
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) alice.conquer(game.ref(x, y));
    for (let x = 10; x < 20; x++) bob.conquer(game.ref(x, y));
  }
  return { game, alice, bob };
}

const terms = (t: Partial<TradeTerms>): TradeTerms => ({
  ...emptyTerms(),
  ...t,
});

function offer(
  game: Game,
  from: Player,
  to: Player,
  give: Partial<TradeTerms>,
  ask: Partial<TradeTerms>,
  opts: { ceasefire?: boolean; pact?: boolean } = {},
): TradeOfferExecution {
  const exec = new TradeOfferExecution(
    from,
    to.id(),
    terms(give),
    terms(ask),
    opts.ceasefire ?? false,
    opts.pact ?? false,
  );
  game.addExecution(exec);
  game.executeNextTick();
  return exec;
}

function reply(game: Game, by: Player, exec: TradeOfferExecution, ok = true) {
  game.addExecution(new TradeReplyExecution(by, exec.id(), ok));
  game.executeNextTick();
  game.executeNextTick();
}

describe("trade offers", () => {
  test("swap gold, troops and goods when accepted", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGold(1000n);
    alice.addGoods([0, 50, 0]);
    bob.addGoods([0, 0, 30]);
    const aliceTroops = alice.troops();
    const bobGold = bob.gold();

    const exec = offer(
      game,
      alice,
      bob,
      { gold: 600, goods: [0, 40, 0] },
      { goods: [0, 0, 30] },
    );
    expect(exec.isActive()).toBe(true);
    reply(game, bob, exec);

    expect(exec.isActive()).toBe(false);
    expect(bob.gold() - bobGold).toBe(600n);
    expect(bob.goods()[Good.Oil]).toBe(40);
    expect(bob.goods()[Good.Metal]).toBe(0);
    expect(alice.goods()[Good.Oil]).toBe(10);
    expect(alice.goods()[Good.Metal]).toBe(30);
    expect(alice.troops()).toBe(aliceTroops);
  });

  test("move nothing when rejected, and expire unanswered", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    const rejected = offer(game, alice, bob, { goods: [0, 50, 0] }, {});
    reply(game, bob, rejected, false);
    expect(rejected.isActive()).toBe(false);
    expect(bob.goods()[Good.Oil]).toBe(0);

    const ignored = offer(game, alice, bob, { goods: [0, 50, 0] }, {});
    for (let i = 0; i <= TRADE_OFFER_DURATION; i++) game.executeNextTick();
    expect(ignored.isActive()).toBe(false);
    reply(game, bob, ignored);
    expect(bob.goods()[Good.Oil]).toBe(0);
  });

  test("only the recipient can accept", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    const exec = offer(game, alice, bob, { goods: [0, 50, 0] }, {});
    reply(game, alice, exec);
    expect(exec.isActive()).toBe(true);
    expect(bob.goods()[Good.Oil]).toBe(0);
  });

  test("fail whole if a side can no longer pay", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    bob.addGoods([0, 0, 30]);
    const exec = offer(
      game,
      alice,
      bob,
      { goods: [0, 50, 0] },
      { goods: [0, 0, 30] },
    );
    bob.removeGoods([0, 0, 10]);
    reply(game, bob, exec);
    expect(exec.isActive()).toBe(false);
    expect(alice.goods()).toEqual([0, 50, 0]);
    expect(bob.goods()).toEqual([0, 0, 20]);
  });

  test("hand over only the payer's tiles inside painted land", async () => {
    const { game, alice, bob } = await tradeGame();
    // A disc on the border: half alice's, half bob's.
    const land = [{ tile: game.ref(10, 5), radius: 3 }];
    const aliceTiles = alice.numTilesOwned();
    const exec = offer(game, alice, bob, { land }, {});
    reply(game, bob, exec);

    const moved = aliceTiles - alice.numTilesOwned();
    expect(moved).toBeGreaterThan(0);
    expect(bob.numTilesOwned()).toBe(100 + moved);
    expect(game.owner(game.ref(8, 5))).toBe(bob);
    expect(game.owner(game.ref(2, 5))).toBe(alice);
  });

  test("a ceasefire allies the two", async () => {
    const { game, alice, bob } = await tradeGame();
    const exec = offer(game, alice, bob, {}, {}, { ceasefire: true });
    reply(game, bob, exec);
    expect(alice.isAlliedWith(bob)).toBe(true);
  });

  test("a newer offer replaces an open one", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    const first = offer(game, alice, bob, { goods: [0, 10, 0] }, {});
    const second = offer(game, alice, bob, { goods: [0, 20, 0] }, {});
    expect(first.isActive()).toBe(false);
    reply(game, bob, second);
    expect(bob.goods()[Good.Oil]).toBe(20);
  });

  test("embargoes block offers and cancel open ones", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    const open = offer(game, alice, bob, { goods: [0, 50, 0] }, {});
    game.addExecution(new EmbargoExecution(bob, alice.id(), "start"));
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(open.isActive()).toBe(false);

    const blocked = offer(game, alice, bob, { goods: [0, 50, 0] }, {});
    expect(blocked.isActive()).toBe(false);
  });

  test("survive a snapshot round trip while open", async () => {
    const { game, alice, bob } = await tradeGame();
    alice.addGoods([0, 50, 0]);
    const exec = offer(game, alice, bob, { goods: [0, 50, 0] }, {});

    const { restored } = await roundTrip(game, MAP);
    const twinBob = restored.player("bob");
    restored.addExecution(new TradeReplyExecution(twinBob, exec.id(), true));
    restored.executeNextTick();
    restored.executeNextTick();
    expect(twinBob.goods()[Good.Oil]).toBe(50);
  });
});

describe("nations and tribes", () => {
  const nation = new PlayerInfo("rome", PlayerType.Nation, null, "rome");
  const tribe = new PlayerInfo("goths", PlayerType.Bot, null, "goths");

  async function withAI() {
    const g = await tradeGame([nation, tribe]);
    const rome = g.game.player("rome");
    const goths = g.game.player("goths");
    for (let y = 10; y < 20; y++) {
      for (let x = 0; x < 10; x++) rome.conquer(g.game.ref(x, y));
      for (let x = 10; x < 20; x++) goths.conquer(g.game.ref(x, y));
    }
    rome.addGoods([0, 100, 0]);
    goths.addGoods([0, 100, 0]);
    g.alice.addGold(1_000_000n);
    return { ...g, rome, goths };
  }

  test("a nation takes a generous deal and refuses a stingy one", async () => {
    const { game, alice, rome } = await withAI();
    const stingy = offer(
      game,
      alice,
      rome,
      { gold: 1000 },
      {
        goods: [0, 50, 0],
      },
    );
    game.executeNextTick();
    expect(stingy.isActive()).toBe(false);
    expect(alice.goods()[Good.Oil]).toBe(0);

    offer(game, alice, rome, { gold: 200_000 }, { goods: [0, 50, 0] });
    game.executeNextTick();
    expect(alice.goods()[Good.Oil]).toBe(50);
  });

  test("tribes never trade", async () => {
    const { game, alice, goths } = await withAI();
    offer(game, alice, goths, { gold: 900_000 }, { goods: [0, 1, 0] });
    game.executeNextTick();
    expect(alice.goods()[Good.Oil]).toBe(0);
  });
});

describe("trade pacts", () => {
  test("boost both partners' goods and end on request", async () => {
    const { game, alice, bob } = await tradeGame();
    const exec = offer(game, alice, bob, {}, {}, { pact: true });
    reply(game, bob, exec);
    expect(alice.hasTradePactWith(bob)).toBe(true);
    expect(bob.tradePacts()).toEqual([alice]);

    (alice as unknown as { _deposits: number[] })._deposits[Good.Oil] = 100;
    const base = goodsIncome(alice, game.map(), 1);
    expect(alice.goodsIncome()[Good.Oil]).toBeCloseTo(
      base[Good.Oil] * (1 + TRADE_PACT_BONUS),
    );

    game.addExecution(new EndTradePactExecution(bob, alice.id()));
    game.executeNextTick();
    expect(alice.hasTradePactWith(bob)).toBe(false);
  });

  test("end under an embargo, and cap at MAX_TRADE_PACTS", async () => {
    const others = ["c", "d", "e"].map(
      (n) => new PlayerInfo(n, PlayerType.Human, `client_${n}`, n),
    );
    const { game, alice, bob } = await tradeGame(others);
    alice.addTradePact(bob);
    bob.addEmbargo(alice, true);
    expect(alice.hasTradePactWith(bob)).toBe(false);
    bob.stopEmbargo(alice);

    others.forEach((info, i) => {
      const p = game.player(info.id);
      p.conquer(game.ref(30 + i, 30));
      alice.addTradePact(p);
    });
    expect(alice.tradePacts()).toHaveLength(MAX_TRADE_PACTS);
    expect(alice.canMakeTradePact(bob)).toBe(false);
  });
});
