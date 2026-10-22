import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";

vi.mock("lit", () => ({
  html: () => {},
  LitElement: class {},
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: any) => clazz,
  query: () => () => {},
  state: () => () => {},
  property: () => () => {},
}));

import { emptyTerms } from "@openfront/engine-lib/game/Trade";
import { ActionableEvents } from "../../../../src/client/hud/layers/ActionableEvents";
import { OpenTradePanelEvent } from "../../../../src/client/hud/layers/TradePanel";
import { SendTradeReplyIntentEvent } from "../../../../src/client/Transport";

// Borderfall: an incoming trade offer becomes a card with Accept / Reject /
// Counter (and Show land when land is involved), gone once settled.
describe("ActionableEvents - trade offers", () => {
  const me = { smallID: () => 1, isAlive: () => true };
  const sender = { smallID: () => 2, displayName: () => "Rome" };

  function setup() {
    const display = new ActionableEvents();
    (display as any).requestUpdate = () => {};
    const emitted: unknown[] = [];
    display.eventBus = { emit: (e: unknown) => emitted.push(e) } as any;
    display.game = {
      myPlayer: () => me,
      playerBySmallID: (id: number) => (id === 1 ? me : sender),
      ticks: () => 100,
      ownerID: () => 2,
      isValidRef: () => true,
      x: () => 5,
      y: () => 5,
      width: () => 10,
      height: () => 10,
      ref: (x: number, y: number) => y * 10 + x,
    } as any;
    return { display, emitted };
  }

  const update = {
    type: GameUpdateType.TradeOffer,
    offerID: 77,
    senderID: 2,
    recipientID: 1,
    give: { ...emptyTerms(), land: [{ tile: 55, radius: 1 }] },
    ask: { ...emptyTerms(), gold: 500 },
    ceasefire: false,
    pact: true,
    createdAt: 100,
    expiresAt: 700,
  } as const;

  test("offers accept, reject, counter and show land", () => {
    const { display, emitted } = setup();
    (display as any).onTradeOfferEvent(update);

    const [card] = (display as any).events;
    expect(card.offerID).toBe(77);
    expect(card.duration).toBe(600);
    expect(card.buttons.map((b: any) => b.text)).toEqual([
      "trade.show_land",
      "trade.accept",
      "trade.reject",
      "trade.counter",
    ]);

    card.buttons[1].action();
    expect(emitted[emitted.length - 1]).toEqual(
      new SendTradeReplyIntentEvent(77, true),
    );

    card.buttons[3].action();
    const counter = emitted[emitted.length - 1] as OpenTradePanelEvent;
    expect(counter).toBeInstanceOf(OpenTradePanelEvent);
    // Swapped: we'd now give what they asked for.
    expect(counter.prefill?.give.gold).toBe(500);
    expect(counter.prefill?.ask.land).toHaveLength(1);
    expect(counter.prefill?.counterOf).toBe(77);
  });

  test("ignores offers to others and drops the card once settled", () => {
    const { display } = setup();
    (display as any).onTradeOfferEvent({ ...update, recipientID: 3 });
    expect((display as any).events).toHaveLength(0);

    (display as any).onTradeOfferEvent(update);
    (display as any).onTradeOfferReplyEvent({
      type: GameUpdateType.TradeOfferReply,
      offerID: 77,
      senderID: 2,
      recipientID: 1,
      status: "expired",
    });
    expect((display as any).events).toHaveLength(0);
  });
});
