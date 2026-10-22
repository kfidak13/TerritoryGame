import {
  Difficulty,
  GOODS,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { TradeTerms } from "@openfront/engine-api/Schemas";
import { landTiles } from "@openfront/engine-lib/game/Trade";
import { assertNever } from "@openfront/engine-lib/Util";
import { Game, Player } from "../../game/Game";

// Rough gold-equivalent prices a nation weighs a deal with. A unit of goods
// is worth what it takes to replace (a warship's 40 Oil ~ its gold cost).
const TROOP_PRICE = 1;
const GOOD_PRICE = 1000;
const TILE_PRICE = 300;
// Nations part with land reluctantly.
const OWN_LAND_PREMIUM = 2;

export interface TradeOffer {
  give: TradeTerms;
  ask: TradeTerms;
  ceasefire: boolean;
  pact: boolean;
}

/**
 * Whether a nation takes an offer from `sender`: what it gets must outweigh
 * what it gives by a margin that grows with difficulty and shrinks with
 * goodwill. It will not deal with players it is hostile to, and agrees to a
 * ceasefire or pact only with players it doesn't distrust (or, for a
 * ceasefire, ones stronger than itself). Pure and deterministic.
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

  const received = termsValue(mg, offer.give, sender, 1);
  const given = termsValue(mg, offer.ask, nation, OWN_LAND_PREMIUM);
  return received >= given * greed(mg, relation);
}

function greed(mg: Game, relation: Relation): number {
  const difficulty = mg.config().gameConfig().difficulty;
  let margin: number;
  switch (difficulty) {
    case Difficulty.Easy:
      margin = 1;
      break;
    case Difficulty.Medium:
      margin = 1.15;
      break;
    case Difficulty.Hard:
      margin = 1.3;
      break;
    case Difficulty.Impossible:
      margin = 1.5;
      break;
    default:
      assertNever(difficulty);
  }
  if (relation === Relation.Friendly) return margin * 0.85;
  if (relation === Relation.Distrustful) return margin * 1.3;
  return margin;
}

/** What `terms`, paid by `payer`, are worth in gold. */
function termsValue(
  mg: Game,
  terms: TradeTerms,
  payer: Player,
  landPremium: number,
): number {
  let value = terms.gold + terms.troops * TROOP_PRICE;
  for (const g of GOODS) value += terms.goods[g] * GOOD_PRICE;
  const tiles = landTiles(mg, terms.land, (t) => mg.owner(t) === payer);
  return value + tiles.length * TILE_PRICE * landPremium;
}
