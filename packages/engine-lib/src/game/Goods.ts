import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Good,
  GOODS,
  GoodsAmounts,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PlayerLike } from "@openfront/engine-api/game/ReadViews";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

/*
 * Borderfall regional goods.
 *
 * Every map is split into square regions. About half the regions hold one
 * deposit field: an irregular patch of land, from poor to rich, around a tile
 * of fitting terrain,
 *
 *   Metal  around a mountain (or highland) tile, in hilly regions
 *   Oil    around a shoreline tile in coastal regions, or on a highland
 *          plateau
 *   Food   around a plains tile, in lowland regions
 *
 * Each region takes, among the goods its terrain suits, the one the map has
 * fewest fields of so far, so the three goods come out roughly even on any
 * terrain. A good few regions suit (say, on a map without coast or hills)
 * may go anywhere, so every map has plenty of all three. Deposits are seeded from the map
 * name: the same in every game on a map, and computed identically by the
 * engine and the client.
 *
 * Fields yield the same per second on every map scale. Food is a soft rule
 * (land feeds half a player's city-free troop cap; troops beyond that eat,
 * and hungry troops slow troop growth), Oil moves (warships, missiles) and
 * Metal stands (defense posts, SAMs, silos, structure upgrades).
 */

/** Goods a whole deposit field yields per tick (10 ticks per second). */
export const FIELD_YIELD_PER_TICK = 0.1;
/** Food one troop beyond the land-fed share eats per tick: a field feeds 300k. */
export const FOOD_PER_TROOP = FIELD_YIELD_PER_TICK / 300_000;
/** Share of the city-free troop cap that land feeds for free. */
export const FOOD_LAND_FED_FRACTION = 0.5;
/** Stockpiles stop growing here. */
export const GOODS_STOCK_CAP = 2000;
/** Troop growth multiplier at the worst of a food shortage. */
export const FOOD_SHORTAGE_GROWTH = 0.6;
/** Troop growth multiplier with a well-stocked granary. */
export const FOOD_SURPLUS_GROWTH = 1.1;
/** Stock, as a fraction of the cap, that counts as a surplus. */
export const FOOD_SURPLUS_FRACTION = 0.5;

export type FoodState = "shortage" | "normal" | "surplus";

/** No deposit on a tile, in the array computeDeposits returns. */
export const NO_DEPOSIT = 0;

/** The good a deposit byte stands for (`NO_DEPOSIT` for none). */
export function depositGood(deposit: number): Good | null {
  return deposit === NO_DEPOSIT ? null : ((deposit - 1) as Good);
}

export function depositByte(good: Good): number {
  return good + 1;
}

// Region grid: roughly 24 regions along the longer map edge, each at least
// 24 tiles wide so even compact maps get a handful of real deposits.
const REGIONS_ALONG_LONG_EDGE = 24;
const MIN_REGION_SIZE = 24;
// Regions need some land to count at all.
const MIN_LAND_FRACTION = 0.15;
// Chance a region holds a field at all.
const FIELD_CHANCE = 0.5;
// Field radius, as a fraction of the region size: the size of an average
// field, which yields FIELD_YIELD_PER_TICK (depositYield).
const FIELD_RADIUS = 0.3;
// Field shapes: a core disc plus a few lobes, all relative to the field's
// own scale, which varies so fields range from poor to rich.
const FIELD_SCALE_MIN = 0.7;
const FIELD_SCALE_MAX = 1.6;
const FIELD_CORE = 0.6;
const FIELD_LOBES_MIN = 3;
const FIELD_LOBES_MAX = 6;
const FIELD_LOBE_REACH = 0.7;
const FIELD_LOBE_MIN = 0.3;
const FIELD_LOBE_MAX = 0.6;
// Terrain shares (of a region's land) that make a region suit a good.
const METAL_MIN_HIGHGROUND = 0.25;
const OIL_MIN_SHORELINE = 0.03;
const OIL_PLATEAU_MIN_HIGHLAND = 0.5;
const OIL_PLATEAU_MAX_MOUNTAIN = 0.1;
const FOOD_MIN_PLAINS = 0.4;
// A good fewer than this share of regions suit may go anywhere.
const MIN_SUITED_SHARE = 0.2;

export function regionSize(map: GameMap): number {
  const longEdge = Math.max(map.width(), map.height());
  return Math.max(
    MIN_REGION_SIZE,
    Math.ceil(longEdge / REGIONS_ALONG_LONG_EDGE),
  );
}

function fieldRadius(map: GameMap): number {
  return Math.max(2, Math.round(regionSize(map) * FIELD_RADIUS));
}

/**
 * Goods one deposit tile yields per tick on this map: a full field yields
 * FIELD_YIELD_PER_TICK whatever the map's scale.
 */
export function depositYield(map: GameMap): number {
  const r = fieldRadius(map);
  return FIELD_YIELD_PER_TICK / (Math.PI * r * r);
}

/** Deterministic seed for a map's deposits. */
export function depositSeed(mapName: string): number {
  return simpleHash(`goods:${mapName}`);
}

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Goods the region's terrain suits, indexed by Good. */
  suits: boolean[];
}

/** Tiles a field of `good` centers on; `anywhere` for goods without terrain. */
function centerFits(
  map: GameMap,
  ref: TileRef,
  good: Good,
  anywhere: boolean,
): boolean {
  if (anywhere) return true;
  const terrain = map.terrainType(ref);
  switch (good) {
    case Good.Metal:
      return (
        terrain === TerrainType.Mountain || terrain === TerrainType.Highland
      );
    case Good.Oil:
      return map.isShoreline(ref) || terrain === TerrainType.Highland;
    case Good.Food:
      return terrain === TerrainType.Plains;
  }
}

/**
 * One byte per tile: `NO_DEPOSIT`, or `depositByte(good)`. Pure arithmetic
 * and a seeded PRNG, so every client gets the same bytes.
 */
export function computeDeposits(map: GameMap, seed: number): Uint8Array {
  const width = map.width();
  const height = map.height();
  const size = regionSize(map);
  const radius = fieldRadius(map);
  const deposits = new Uint8Array(width * height);
  const usable = (ref: TileRef) => map.isLand(ref) && !map.isImpassable(ref);

  // Survey: which goods each land region's terrain suits.
  const regions: Region[] = [];
  for (let y0 = 0; y0 < height; y0 += size) {
    for (let x0 = 0; x0 < width; x0 += size) {
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);
      let land = 0;
      let plains = 0;
      let highland = 0;
      let mountain = 0;
      let shoreline = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const ref = map.ref(x, y);
          if (!usable(ref)) continue;
          land++;
          const terrain = map.terrainType(ref);
          if (terrain === TerrainType.Plains) plains++;
          else if (terrain === TerrainType.Highland) highland++;
          else if (terrain === TerrainType.Mountain) mountain++;
          if (map.isShoreline(ref)) shoreline++;
        }
      }
      if (land < MIN_LAND_FRACTION * (x1 - x0) * (y1 - y0)) continue;
      const suits = [false, false, false];
      suits[Good.Metal] = (highland + mountain) / land >= METAL_MIN_HIGHGROUND;
      suits[Good.Oil] =
        shoreline / land >= OIL_MIN_SHORELINE ||
        (highland / land >= OIL_PLATEAU_MIN_HIGHLAND &&
          mountain / land < OIL_PLATEAU_MAX_MOUNTAIN);
      suits[Good.Food] = plains / land >= FOOD_MIN_PLAINS;
      regions.push({ x0, y0, x1, y1, suits });
    }
  }

  // Every map gets plenty of every good: one few regions suit may go
  // anywhere.
  const anywhere = GOODS.map(
    (g) =>
      regions.filter((r) => r.suits[g]).length <
      MIN_SUITED_SHARE * regions.length,
  );
  for (const r of regions) {
    for (const g of GOODS) if (anywhere[g]) r.suits[g] = true;
  }

  // Visit regions in seeded order; a region with a field takes the suitable
  // good the map has fewest fields of so far.
  const random = new PseudoRandom(seed);
  for (let i = regions.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i + 1);
    [regions[i], regions[j]] = [regions[j], regions[i]];
  }
  const fields: GoodsAmounts = [0, 0, 0];
  for (const region of regions) {
    if (random.next() >= FIELD_CHANCE) continue;
    const candidates = GOODS.filter((g) => region.suits[g]);
    if (candidates.length === 0) continue;
    const fewest = Math.min(...candidates.map((g) => fields[g]));
    const tied = candidates.filter((g) => fields[g] === fewest);
    const good = tied[random.nextInt(0, tied.length)];

    const center = pickCenter(map, region, radius, random, (ref) =>
      centerFits(map, ref, good, anywhere[good]),
    );
    if (center === null) continue;
    fields[good]++;

    // An irregular blob: a core disc plus a few offset lobes, each field
    // scaled on its own so some are rich and some poor (yield follows area).
    // It may spill into neighboring regions, but never onto another field.
    const scale = radius * random.nextFloat(FIELD_SCALE_MIN, FIELD_SCALE_MAX);
    const lobes = [
      { x: map.x(center), y: map.y(center), r: scale * FIELD_CORE },
    ];
    const lobeCount = random.nextInt(FIELD_LOBES_MIN, FIELD_LOBES_MAX + 1);
    for (let i = 0; i < lobeCount; i++) {
      const reach = scale * FIELD_LOBE_REACH;
      lobes.push({
        x: lobes[0].x + Math.round(random.nextFloat(-reach, reach)),
        y: lobes[0].y + Math.round(random.nextFloat(-reach, reach)),
        r: scale * random.nextFloat(FIELD_LOBE_MIN, FIELD_LOBE_MAX),
      });
    }
    const byte = depositByte(good);
    for (const lobe of lobes) {
      const r = Math.ceil(lobe.r);
      const yEnd = Math.min(height - 1, lobe.y + r);
      const xEnd = Math.min(width - 1, lobe.x + r);
      for (let y = Math.max(0, lobe.y - r); y <= yEnd; y++) {
        for (let x = Math.max(0, lobe.x - r); x <= xEnd; x++) {
          const dx = x - lobe.x;
          const dy = y - lobe.y;
          if (dx * dx + dy * dy > lobe.r * lobe.r) continue;
          const ref = map.ref(x, y);
          const free = deposits[ref] === NO_DEPOSIT || deposits[ref] === byte;
          if (usable(ref) && free) deposits[ref] = byte;
        }
      }
    }
  }
  return deposits;
}

/**
 * A random fitting land tile, preferring ones a radius away from the region
 * edges so the field is round; null when the region has none.
 */
function pickCenter(
  map: GameMap,
  region: Region,
  radius: number,
  random: PseudoRandom,
  fits: (ref: TileRef) => boolean,
): TileRef | null {
  const pick = (inset: number): TileRef | null => {
    // Reservoir sampling: one pass, uniform over fitting tiles.
    let chosen: TileRef | null = null;
    let seen = 0;
    for (let y = region.y0 + inset; y < region.y1 - inset; y++) {
      for (let x = region.x0 + inset; x < region.x1 - inset; x++) {
        const ref = map.ref(x, y);
        if (!map.isLand(ref) || map.isImpassable(ref) || !fits(ref)) continue;
        seen++;
        if (random.nextInt(0, seen) === 0) chosen = ref;
      }
    }
    return chosen;
  };
  return pick(radius) ?? pick(0);
}

/** Deposit tiles of each good on the whole map. */
export function countDeposits(deposits: Uint8Array): GoodsAmounts {
  const counts: GoodsAmounts = [0, 0, 0];
  for (let i = 0; i < deposits.length; i++) {
    const good = depositGood(deposits[i]);
    if (good !== null) counts[good]++;
  }
  return counts;
}

/**
 * Goods a build consumes, on top of its gold. Oil moves (ships, missiles),
 * Metal stands (land defenses, silos, and every structure upgrade). Null
 * when the build is free of goods. With one field (1 per second) of a good:
 * a warship every 40s, a hydrogen bomb every 5 minutes, a MIRV every 15.
 */
export function goodsCost(
  type: UnitType,
  upgrade: boolean,
): Readonly<GoodsAmounts> | null {
  const cost: GoodsAmounts = [0, 0, 0];
  switch (type) {
    case UnitType.Warship:
      cost[Good.Oil] = 40;
      break;
    case UnitType.AtomBomb:
      cost[Good.Oil] = 80;
      break;
    case UnitType.HydrogenBomb:
      cost[Good.Oil] = 300;
      break;
    case UnitType.MIRV:
      cost[Good.Oil] = 900;
      break;
    case UnitType.DefensePost:
      cost[Good.Metal] = 20;
      break;
    case UnitType.SAMLauncher:
      cost[Good.Metal] = 90;
      break;
    case UnitType.MissileSilo:
      cost[Good.Metal] = 100;
      break;
    case UnitType.City:
    case UnitType.Port:
    case UnitType.Factory:
      if (upgrade) cost[Good.Metal] = 40;
      break;
  }
  return cost.some((c) => c > 0) ? cost : null;
}

export function canAffordGoods(
  stock: Readonly<GoodsAmounts>,
  cost: Readonly<GoodsAmounts> | null,
): boolean {
  return cost === null || GOODS.every((g) => stock[g] >= cost[g]);
}

/** Goods `deposits` produce per tick, indexed by Good (PlayerLike.goodsIncome). */
export function goodsIncome(
  deposits: Readonly<GoodsAmounts>,
  yieldPerTile: number,
): GoodsAmounts {
  return [
    deposits[Good.Food] * yieldPerTile,
    deposits[Good.Oil] * yieldPerTile,
    deposits[Good.Metal] * yieldPerTile,
  ];
}

/**
 * Food a player's troops eat per tick: only troops beyond what their land
 * feeds (`landFed`, see Config.foodLandFed) eat.
 */
export function foodUpkeep(player: PlayerLike, landFed: number): number {
  return Math.max(0, player.troops() - landFed) * FOOD_PER_TROOP;
}

/**
 * Troops going hungry: with an empty granary, the eating troops that food
 * income can't feed. A stocked granary feeds everyone.
 */
export function hungryTroops(player: PlayerLike, landFed: number): number {
  if (player.goods()[Good.Food] > 0) return 0;
  const eating = Math.max(0, player.troops() - landFed);
  return Math.max(0, eating - player.goodsIncome()[Good.Food] / FOOD_PER_TROOP);
}

export function foodState(player: PlayerLike, landFed: number): FoodState {
  if (player.goods()[Good.Food] >= GOODS_STOCK_CAP * FOOD_SURPLUS_FRACTION) {
    return "surplus";
  }
  return hungryTroops(player, landFed) > 0 ? "shortage" : "normal";
}

/**
 * Troop growth multiplier from food: a full granary speeds growth; hungry
 * troops slow it by their share of what the land feeds, down to
 * FOOD_SHORTAGE_GROWTH (a city-free army at its cap with no food at all).
 */
export function foodGrowthModifier(
  player: PlayerLike,
  landFed: number,
): number {
  if (foodState(player, landFed) === "surplus") return FOOD_SURPLUS_GROWTH;
  const hunger = Math.min(
    1,
    hungryTroops(player, landFed) / Math.max(1, landFed),
  );
  return 1 - (1 - FOOD_SHORTAGE_GROWTH) * hunger;
}
