import { GOODS } from "@openfront/engine-api/game/GameTypes";
import { TradeTerms } from "@openfront/engine-api/Schemas";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { landTiles } from "@openfront/engine-lib/game/Trade";
import { translateText } from "../Utils";
import { GameView, PlayerView } from "../view";
import { GOOD_ICONS } from "./GoodsText";

/** The painted tiles `payer` still owns, i.e. what would change hands. */
export function payerLand(
  game: GameView,
  terms: TradeTerms,
  payer: PlayerView,
): number[] {
  const id = payer.smallID();
  return landTiles(game, terms.land, (t) => game.ownerID(t) === id);
}

/** One side of a deal in a line, e.g. "💰 600K · 🛢️ 40 · 120 tiles". */
export function termsSummary(terms: TradeTerms, tiles: number): string {
  const parts: string[] = [];
  if (terms.gold > 0) parts.push(`💰 ${renderNumber(terms.gold)}`);
  if (terms.troops > 0) parts.push(`🪖 ${renderTroops(terms.troops)}`);
  for (const g of GOODS) {
    if (terms.goods[g] > 0) parts.push(`${GOOD_ICONS[g]} ${terms.goods[g]}`);
  }
  if (tiles > 0) parts.push(translateText("trade.tiles", { count: tiles }));
  return parts.length > 0 ? parts.join(" · ") : translateText("trade.nothing");
}

/**
 * A map mask of the land in a deal (TileMaskPass): 1 where `giver` gives,
 * 2 where `asked` is asked to give.
 */
export function tradeLandMask(
  game: GameView,
  give: TradeTerms,
  giver: PlayerView,
  ask: TradeTerms,
  asked: PlayerView,
): Uint8Array | null {
  const given = payerLand(game, give, giver);
  const asks = payerLand(game, ask, asked);
  if (given.length === 0 && asks.length === 0) return null;
  const mask = new Uint8Array(game.width() * game.height());
  for (const t of given) mask[t] = 1;
  for (const t of asks) mask[t] = 2;
  return mask;
}
