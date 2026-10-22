import {
  Difficulty,
  Good,
  GOODS,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { TradeTerms } from "@openfront/engine-api/Schemas";
import { GOODS_STOCK_CAP } from "@openfront/engine-lib/game/Goods";
import { emptyTerms, landTiles } from "@openfront/engine-lib/game/Trade";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { Game, Player } from "../../game/Game";
import { TradeOfferExecution } from "../trade/TradeOfferExecution";
import { neededGoods } from "./NationUtils";

// Rough gold-equivalent prices a nation weighs a deal with. A unit of goods
// is worth what it takes to replace (a warship's 40 Oil ~ its gold cost).
const TROOP_PRICE = 1;
const GOOD_PRICE = 1000;
const TILE_PRICE = 300;
// Nations part with land reluctantly.
const OWN_LAND_PREMIUM = 2;
// A good the nation is short of is worth more to it, either way.
const NEED_PREMIUM = 2;
// A good piling up near the cap is cheap to part with.
const GLUT_DISCOUNT = 0.6;

export interface TradeOffer {
  give: TradeTerms;
  ask: TradeTerms;
  ceasefire: boolean;
  pact: boolean;
}

/**
 * Whether a nation takes an offer from `sender`: what it gets must outweigh
 * what it gives by a margin that grows with difficulty and shrinks with
 * goodwill, pricing goods by what the nation needs. It will not deal with
 * players it is hostile to, and agrees to a ceasefire or pact only with
 * players it doesn't distrust (or, for a ceasefire, ones stronger than
 * itself). Pure and deterministic.
 */
export function nationAcceptsTrade(
  mg: Game,
  nation: Player,
  sender: Player,
  offer: TradeOffer,
): boolean {
  const relation = nation.relation(sender);
  if (relation === Relation.Hostile) return false;
  const trusting = relation >= Relation.Neutral;
  if (offer.pact && !trusting) return false;
  if (offer.ceasefire && !trusting && sender.troops() <= nation.troops()) {
    return false;
  }

  const needs = neededGoods(mg, nation);
  const received = termsValue(mg, offer.give, sender, nation, needs, false);
  const given = termsValue(mg, offer.ask, nation, nation, needs, true);
  return received >= given * greed(mg, relation);
}

function greed(mg: Game, relation: Relation): number {
  let margin = DIFFICULTY_MARGIN[mg.config().gameConfig().difficulty];
  if (relation === Relation.Friendly) margin *= 0.85;
  if (relation === Relation.Distrustful) margin *= 1.3;
  return margin;
}

const DIFFICULTY_MARGIN: Record<Difficulty, number> = {
  [Difficulty.Easy]: 1,
  [Difficulty.Medium]: 1.15,
  [Difficulty.Hard]: 1.3,
  [Difficulty.Impossible]: 1.5,
};

/** What `terms`, paid by `payer`, are worth in gold to `valuer`. */
function termsValue(
  mg: Game,
  terms: TradeTerms,
  payer: Player,
  valuer: Player,
  needs: readonly Good[],
  valuerPays: boolean,
): number {
  let value = terms.gold + terms.troops * TROOP_PRICE;
  for (const g of GOODS) {
    let price = GOOD_PRICE;
    if (needs.includes(g)) price *= NEED_PREMIUM;
    else if (valuerPays && valuer.goods()[g] >= GOODS_STOCK_CAP / 2) {
      price *= GLUT_DISCOUNT;
    }
    value += terms.goods[g] * price;
  }
  const tiles = landTiles(mg, terms.land, (t) => mg.owner(t) === payer);
  return (
    value + tiles.length * TILE_PRICE * (valuerPays ? OWN_LAND_PREMIUM : 1)
  );
}

// Chance per attack tick that a nation proposes a deal (1 in N); Easy
// nations never think of it.
const PROPOSAL_ODDS: Record<Difficulty, number> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 40,
  [Difficulty.Hard]: 25,
  [Difficulty.Impossible]: 15,
};
/** Units of a needed good a nation asks for in a swap. */
const SWAP_AMOUNT = 40;
/** What it hands over per unit asked, so the deal tempts the other side. */
const SWAP_SWEETENER = 1.3;
/** An attacker this much stronger is worth buying a ceasefire from. */
const CEASEFIRE_THREAT = 1.5;
/** Share of the treasury a nation pays for that ceasefire. */
const CEASEFIRE_GOLD_SHARE = 5n;

/**
 * Borderfall: nations trade for what they lack. On attack ticks a nation
 * may drop pacts with players it has turned against, buy a ceasefire from
 * a much stronger attacker (Hard and up), swap a surplus good (or gold) for
 * one it needs, or offer a pact to a player it doesn't distrust. Only with goods on. Stateless:
 * its rolls come from a per-tick seed, so it leaves the nation's own random
 * sequence (and every other behavior) untouched.
 */
export class NationTradeBehavior {
  constructor(
    private game: Game,
    private player: Player,
  ) {}

  maybeProposeTrade(incomingAttacker: () => Player | null): void {
    const config = this.game.config();
    if (!config.goodsEnabled()) return;
    const difficulty = config.gameConfig().difficulty;
    const odds = PROPOSAL_ODDS[difficulty];
    if (odds === 0) return;
    const random = new PseudoRandom(
      simpleHash(`trade:${this.game.ticks()}:${this.player.smallID()}`),
    );
    if (!random.chance(odds)) return;

    this.endSourPacts();
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.seekCeasefire(incomingAttacker())
    ) {
      return;
    }
    // Needs are near constant, so give friendship a turn too.
    if (random.chance(3) && this.offerPact(random)) return;
    if (this.swapForNeeds()) return;
    this.offerPact(random);
  }

  private endSourPacts(): void {
    for (const partner of this.player.tradePacts()) {
      if (this.player.relation(partner) < Relation.Neutral) {
        this.player.endTradePact(partner);
      }
    }
  }

  private seekCeasefire(attacker: Player | null): boolean {
    const me = this.player;
    if (
      attacker === null ||
      this.game.config().disableAlliances() ||
      me.isAlliedWith(attacker) ||
      attacker.troops() < me.troops() * CEASEFIRE_THREAT
    ) {
      return false;
    }
    // Being attacked embargoed them automatically; lift that to talk.
    if (
      me.hasEmbargoAgainst(attacker) &&
      !me.hasManualEmbargoAgainst(attacker)
    ) {
      me.endTemporaryEmbargo(attacker);
    }
    if (!me.canTrade(attacker)) return false;
    const give = emptyTerms();
    give.gold = Number(me.gold() / CEASEFIRE_GOLD_SHARE);
    this.propose(attacker, give, emptyTerms(), true, false);
    return true;
  }

  private swapForNeeds(): boolean {
    const me = this.player;
    const needs = neededGoods(this.game, me);
    for (const need of needs) {
      const partner = this.partners()
        .filter((p) => p.goods()[need] >= SWAP_AMOUNT)
        .reduce<Player | null>(
          (best, p) =>
            best === null || p.goods()[need] > best.goods()[need] ? p : best,
          null,
        );
      if (partner === null) continue;

      const ask = emptyTerms();
      ask.goods[need] = SWAP_AMOUNT;
      const give = emptyTerms();
      const pay = Math.ceil(SWAP_AMOUNT * SWAP_SWEETENER);
      const surplus = GOODS.find(
        (g) => !needs.includes(g) && me.goods()[g] >= pay * 2,
      );
      if (surplus !== undefined) {
        give.goods[surplus] = pay;
      } else if (me.gold() >= BigInt(pay * GOOD_PRICE)) {
        give.gold = pay * GOOD_PRICE;
      } else {
        continue;
      }
      this.propose(partner, give, ask, false, false);
      return true;
    }
    return false;
  }

  private offerPact(random: PseudoRandom): boolean {
    const friends = this.partners().filter((p) =>
      this.player.canMakeTradePact(p),
    );
    if (friends.length === 0) return false;
    const friend = random.randElement(friends);
    this.propose(friend, emptyTerms(), emptyTerms(), false, true);
    return true;
  }

  /** Players worth dealing with: alive, not tribes, not distrusted. */
  private partners(): Player[] {
    return this.game
      .players()
      .filter(
        (p) =>
          p !== this.player &&
          p.type() !== PlayerType.Bot &&
          this.player.canTrade(p) &&
          this.player.relation(p) >= Relation.Neutral,
      );
  }

  private propose(
    to: Player,
    give: TradeTerms,
    ask: TradeTerms,
    ceasefire: boolean,
    pact: boolean,
  ): void {
    this.game.addExecution(
      new TradeOfferExecution(this.player, to.id(), give, ask, ceasefire, pact),
    );
  }
}
