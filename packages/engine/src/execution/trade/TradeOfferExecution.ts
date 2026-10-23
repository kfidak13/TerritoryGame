import {
  GOODS,
  GoodsAmounts,
  PlayerID,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  TradeOfferStatus,
} from "@openfront/engine-api/game/GameUpdates";
import { TradeTerms } from "@openfront/engine-api/Schemas";
import { canAffordGoods } from "@openfront/engine-lib/game/Goods";
import {
  isEmptyTerms,
  landTiles,
  TRADE_OFFER_DURATION,
  tradeOfferID,
} from "@openfront/engine-lib/game/Trade";
import { isZombieHorde } from "@openfront/engine-lib/game/Zombies";
import {
  zInt,
  zNum,
  zPlayerRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { toInt } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { cancelNukesBetween } from "../alliance/AllianceRequestExecution";
import { nationAcceptsTrade } from "../nation/NationTradeBehavior";

/** Relation both sides gain from a deal that goes through. */
const ACCEPTED_TRADE_RELATION = 25;

/**
 * One Borderfall trade offer (engine-lib/game/Trade.ts), open until the
 * recipient replies (TradeReplyExecution), it expires, or trading between
 * the two stops. Nations answer at once; tribes never trade.
 */
export class TradeOfferExecution implements Execution {
  private active = true;
  private mg: Game | undefined;
  private recipient: Player | undefined;
  private offerID = 0;
  private expiresAt = 0;
  private reply: "accept" | "reject" | null = null;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private give: TradeTerms,
    private ask: TradeTerms,
    private ceasefire: boolean,
    private pact: boolean,
  ) {}

  id(): number {
    return this.offerID;
  }

  /** Called by TradeReplyExecution; only the recipient's answer counts. */
  respond(player: Player, accept: boolean): void {
    if (this.active && player === this.recipient) {
      this.reply = accept ? "accept" : "reject";
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(`TradeOfferExecution recipient ${this.recipientID} gone`);
      this.active = false;
      return;
    }
    this.recipient = mg.player(this.recipientID);
    const nothingOffered =
      isEmptyTerms(this.give) &&
      isEmptyTerms(this.ask) &&
      !this.ceasefire &&
      !this.pact;
    if (
      nothingOffered ||
      !this.canStillTrade() ||
      !canPay(this.sender, this.give)
    ) {
      console.warn("cannot send trade offer");
      this.active = false;
      return;
    }

    this.offerID = tradeOfferID(
      ticks,
      this.sender.smallID(),
      this.recipient.smallID(),
    );
    this.expiresAt = ticks + TRADE_OFFER_DURATION;

    // One open offer per pair: a newer one replaces the older.
    for (const e of mg.executions()) {
      if (
        e !== this &&
        e instanceof TradeOfferExecution &&
        e.active &&
        e.sender === this.sender &&
        e.recipient === this.recipient
      ) {
        e.settle("cancelled");
      }
    }

    mg.addUpdate({
      type: GameUpdateType.TradeOffer,
      offerID: this.offerID,
      senderID: this.sender.smallID(),
      recipientID: this.recipient.smallID(),
      give: this.give,
      ask: this.ask,
      ceasefire: this.ceasefire,
      pact: this.pact,
      createdAt: ticks,
      expiresAt: this.expiresAt,
    });
  }

  tick(ticks: number): void {
    if (!this.active) return;
    const mg = this.mg!;
    const recipient = this.recipient!;
    if (!this.canStillTrade()) {
      this.settle("cancelled");
      return;
    }
    if (recipient.type() === PlayerType.Bot || isZombieHorde(recipient)) {
      this.reply = "reject";
    } else if (recipient.type() === PlayerType.Nation) {
      const offer = {
        give: this.give,
        ask: this.ask,
        ceasefire: this.ceasefire,
        pact: this.pact,
      };
      this.reply = nationAcceptsTrade(mg, recipient, this.sender, offer)
        ? "accept"
        : "reject";
    }

    if (this.reply === "reject") this.settle("rejected");
    else if (this.reply === "accept") {
      this.settle(this.carryOut() ? "accepted" : "failed");
    } else if (ticks >= this.expiresAt) this.settle("expired");
  }

  private canStillTrade(): boolean {
    const r = this.recipient;
    return (
      r !== undefined &&
      this.sender.isAlive() &&
      r.isAlive() &&
      this.sender.canTrade(r)
    );
  }

  /** Swap everything at once, or nothing if either side can't pay. */
  private carryOut(): boolean {
    const mg = this.mg!;
    const sender = this.sender;
    const recipient = this.recipient!;
    if (!canPay(sender, this.give) || !canPay(recipient, this.ask)) {
      return false;
    }
    const ownedLand = (terms: TradeTerms, owner: Player) =>
      landTiles(mg, terms.land, (t) => mg.owner(t) === owner);
    const giveLand = ownedLand(this.give, sender);
    const askLand = ownedLand(this.ask, recipient);
    // Painted land that no longer holds any of the payer's tiles voids the deal.
    if (
      (this.give.land.length > 0 && giveLand.length === 0) ||
      (this.ask.land.length > 0 && askLand.length === 0)
    ) {
      return false;
    }
    const ceasefire = this.ceasefire && !sender.isAlliedWith(recipient);
    if (ceasefire && mg.config().disableAlliances()) return false;
    if (this.pact && !sender.canMakeTradePact(recipient)) return false;

    pay(sender, recipient, this.give, giveLand);
    pay(recipient, sender, this.ask, askLand);
    if (ceasefire) {
      mg.createAlliance(sender, recipient);
      cancelNukesBetween(mg, sender, recipient);
    }
    if (this.pact) sender.addTradePact(recipient);
    sender.updateRelation(recipient, ACCEPTED_TRADE_RELATION);
    recipient.updateRelation(sender, ACCEPTED_TRADE_RELATION);
    return true;
  }

  private settle(status: TradeOfferStatus): void {
    this.active = false;
    this.mg!.addUpdate({
      type: GameUpdateType.TradeOfferReply,
      offerID: this.offerID,
      senderID: this.sender.smallID(),
      recipientID: this.recipient!.smallID(),
      status,
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TradeOfferExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      sender: w.player(this.sender),
      recipientID: this.recipientID,
      recipient: this.recipient === undefined ? null : w.player(this.recipient),
      give: this.give,
      ask: this.ask,
      ceasefire: this.ceasefire,
      pact: this.pact,
      offerID: this.offerID,
      expiresAt: this.expiresAt,
      reply: this.reply,
    });
  }

  restoreSnapshot(s: TradeOfferState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.sender = r.player(s.sender);
    this.recipientID = s.recipientID;
    if (s.recipient !== null) this.recipient = r.player(s.recipient);
    this.give = s.give as TradeTerms;
    this.ask = s.ask as TradeTerms;
    this.ceasefire = s.ceasefire;
    this.pact = s.pact;
    this.offerID = s.offerID;
    this.expiresAt = s.expiresAt;
    this.reply = s.reply;
  }
}

/** Whether `payer` holds the gold, troops and goods of `terms`. */
function canPay(payer: Player, terms: TradeTerms): boolean {
  return (
    payer.gold() >= toInt(terms.gold) &&
    payer.troops() >= terms.troops &&
    canAffordGoods(payer.goods(), terms.goods)
  );
}

function pay(
  from: Player,
  to: Player,
  terms: TradeTerms,
  land: readonly number[],
): void {
  if (terms.gold > 0) to.addGold(from.removeGold(toInt(terms.gold)));
  if (terms.troops > 0) to.addTroops(from.removeTroops(terms.troops));
  if (GOODS.some((g) => terms.goods[g] > 0)) {
    const goods = terms.goods.slice() as GoodsAmounts;
    from.removeGoods(goods);
    to.addGoods(goods);
  }
  for (const tile of land) to.conquer(tile);
}

const TermsStateSchema = z.object({
  gold: zNum(),
  troops: zNum(),
  goods: z.tuple([zNum(), zNum(), zNum()]),
  land: z.array(z.object({ tile: zInt(), radius: zInt() })),
});

const TradeOfferStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  sender: zPlayerRef(),
  recipientID: z.string(),
  recipient: zPlayerRef().nullable(),
  give: TermsStateSchema,
  ask: TermsStateSchema,
  ceasefire: z.boolean(),
  pact: z.boolean(),
  offerID: zInt(),
  expiresAt: zInt(),
  reply: z.enum(["accept", "reject"]).nullable(),
});
type TradeOfferState = z.infer<typeof TradeOfferStateSchema>;

export const TradeOfferExecutionSnapshot = execSnapshotType({
  name: "TradeOffer",
  version: 1,
  schema: TradeOfferStateSchema,
  cls: () => TradeOfferExecution,
});
