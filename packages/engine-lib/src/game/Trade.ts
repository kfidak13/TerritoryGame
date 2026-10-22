import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { GOODS } from "@openfront/engine-api/game/GameTypes";
import { TradeLandShape, TradeTerms } from "@openfront/engine-api/Schemas";

/*
 * Borderfall trading.
 *
 * A player offers another any mix of gold, troops, goods and painted land,
 * asks for the same in return, and may add a ceasefire (a short alliance) or
 * a standing trade pact. The recipient accepts or rejects (a counter-offer is
 * a reject plus a new offer back). Everything is checked again on accept, so
 * a deal that can no longer be paid fails instead of half-happening. Players
 * with an embargo either way cannot trade.
 */

/** Ticks an offer stays open: one minute. */
export const TRADE_OFFER_DURATION = 600;
/** Goods production bonus each active trade pact gives both partners. */
export const TRADE_PACT_BONUS = 0.15;
/** Trade pacts a player can hold at once. */
export const MAX_TRADE_PACTS = 3;

/** Goods production multiplier for a player with `pacts` trade pacts. */
export function tradePactMultiplier(pacts: number): number {
  return 1 + TRADE_PACT_BONUS * Math.min(pacts, MAX_TRADE_PACTS);
}

export function emptyTerms(): TradeTerms {
  return { gold: 0, troops: 0, goods: [0, 0, 0], land: [] };
}

export function isEmptyTerms(terms: TradeTerms): boolean {
  return (
    terms.gold <= 0 &&
    terms.troops <= 0 &&
    GOODS.every((g) => terms.goods[g] <= 0) &&
    terms.land.length === 0
  );
}

/**
 * Unique per tick, sender and recipient (a newer offer between the same pair
 * replaces the older one, so a same-tick repeat sharing the ID is moot).
 */
export function tradeOfferID(
  tick: number,
  senderSmallID: number,
  recipientSmallID: number,
): number {
  return tick * 4_194_304 + senderSmallID * 2048 + recipientSmallID;
}

/**
 * The tiles inside painted land shapes that `include` accepts, each once,
 * in a fixed order (shape by shape, row by row) so every client agrees.
 */
export function landTiles(
  map: GameMap,
  shapes: readonly TradeLandShape[],
  include: (tile: TileRef) => boolean,
): TileRef[] {
  const seen = new Set<TileRef>();
  const tiles: TileRef[] = [];
  for (const { tile, radius } of shapes) {
    if (!map.isValidRef(tile)) continue;
    const cx = map.x(tile);
    const cy = map.y(tile);
    for (let y = Math.max(0, cy - radius); y <= cy + radius; y++) {
      if (y >= map.height()) break;
      for (let x = Math.max(0, cx - radius); x <= cx + radius; x++) {
        if (x >= map.width()) break;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const ref = map.ref(x, y);
        if (seen.has(ref) || !include(ref)) continue;
        seen.add(ref);
        tiles.push(ref);
      }
    }
  }
  return tiles;
}
