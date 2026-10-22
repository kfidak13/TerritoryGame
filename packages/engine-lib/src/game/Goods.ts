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
 * Every map is split into square regions. A region produces at most one good,
 * decided by its terrain and a roll seeded from the map name, so deposits are
 * the same in every game on a map (players learn the geography) and are
 * computed identically by the engine and the client:
 *
 *   Metal  mountainous regions: deposits on their mountain and highland tiles
 *   Oil    coastal regions (shoreline deposits) or mountain-free plateaus
 *          (highland deposits)
 *   Food   lowland regions: deposits on their plains
 *
 * A region never has two goods and most regions have none, so no nation sits
 * on everything it needs. Rules of thumb: Food is a soft rule (a shortage
 * slows troop growth), Oil moves (warships, missiles) and Metal stands
 * (defense posts, SAMs, silos, structure upgrades).
 */

/** Goods a deposit tile yields per tick. */
export const GOODS_PRODUCTION_PER_TILE = 0.0005;
/** Food a troop eats per tick: one Food deposit feeds 2,000 troops. */
export const FOOD_PER_TROOP = GOODS_PRODUCTION_PER_TILE / 2000;
/** Stockpiles stop growing here. */
export const GOODS_STOCK_CAP = 2000;
/** Troop growth multiplier while starving. */
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
// Terrain shares (of a region's land) that make it a candidate.
const METAL_MIN_HIGHGROUND = 0.35;
const OIL_MIN_SHORELINE = 0.25;
const OIL_PLATEAU_MIN_HIGHLAND = 0.5;
const OIL_PLATEAU_MAX_MOUNTAIN = 0.1;
const FOOD_MIN_PLAINS = 0.7;
// A candidate region's chance of actually producing, per good. Checked in
// order Metal, Oil, Food: the first good that lands claims the region.
const ACTIVATION: Record<Good, number> = {
  [Good.Metal]: 0.6,
  [Good.Oil]: 0.45,
  [Good.Food]: 0.45,
};

export function regionSize(map: GameMap): number {
  const longEdge = Math.max(map.width(), map.height());
  return Math.max(
    MIN_REGION_SIZE,
    Math.ceil(longEdge / REGIONS_ALONG_LONG_EDGE),
  );
}

/** Deterministic seed for a map's deposits. */
export function depositSeed(mapName: string): number {
  return simpleHash(`goods:${mapName}`);
}

/**
 * One byte per tile: `NO_DEPOSIT`, or `depositByte(good)`. Pure arithmetic
 * and a seeded PRNG, so every client gets the same bytes.
 */
export function computeDeposits(map: GameMap, seed: number): Uint8Array {
  const width = map.width();
  const height = map.height();
  const size = regionSize(map);
  const deposits = new Uint8Array(width * height);

  for (let ry = 0; ry < height; ry += size) {
    for (let rx = 0; rx < width; rx += size) {
      const x1 = Math.min(width, rx + size);
      const y1 = Math.min(height, ry + size);
      let land = 0;
      let plains = 0;
      let highland = 0;
      let mountain = 0;
      let shoreline = 0;
      for (let y = ry; y < y1; y++) {
        for (let x = rx; x < x1; x++) {
          const ref = map.ref(x, y);
          if (!map.isLand(ref) || map.isImpassable(ref)) continue;
          land++;
          switch (map.terrainType(ref)) {
            case TerrainType.Plains:
              plains++;
              break;
            case TerrainType.Highland:
              highland++;
              break;
            case TerrainType.Mountain:
              mountain++;
              break;
          }
          if (map.isShoreline(ref)) shoreline++;
        }
      }
      if (land < MIN_LAND_FRACTION * (x1 - rx) * (y1 - ry)) continue;

      const good = pickRegionGood(
        new PseudoRandom(simpleHash(`${seed}:${rx}:${ry}`)),
        {
          plains: plains / land,
          highland: highland / land,
          mountain: mountain / land,
          shoreline: shoreline / land,
        },
      );
      if (good === null) continue;

      const byte = depositByte(good.good);
      for (let y = ry; y < y1; y++) {
        for (let x = rx; x < x1; x++) {
          const ref = map.ref(x, y);
          if (!map.isLand(ref) || map.isImpassable(ref)) continue;
          if (good.on(map, ref)) deposits[ref] = byte;
        }
      }
    }
  }
  return deposits;
}

interface RegionShares {
  plains: number;
  highland: number;
  mountain: number;
  shoreline: number;
}

interface RegionGood {
  good: Good;
  on: (map: GameMap, ref: TileRef) => boolean;
}

const onHighGround = (map: GameMap, ref: TileRef) =>
  map.terrainType(ref) !== TerrainType.Plains;
const onShoreline = (map: GameMap, ref: TileRef) => map.isShoreline(ref);
const onHighland = (map: GameMap, ref: TileRef) =>
  map.terrainType(ref) === TerrainType.Highland;
const onPlains = (map: GameMap, ref: TileRef) =>
  map.terrainType(ref) === TerrainType.Plains;

function pickRegionGood(
  random: PseudoRandom,
  s: RegionShares,
): RegionGood | null {
  // Every candidate rolls, in fixed order, so a region's outcome depends only
  // on its own terrain and seed.
  const metal = s.highland + s.mountain >= METAL_MIN_HIGHGROUND;
  const coastalOil = s.shoreline >= OIL_MIN_SHORELINE;
  const plateauOil =
    s.highland >= OIL_PLATEAU_MIN_HIGHLAND &&
    s.mountain < OIL_PLATEAU_MAX_MOUNTAIN;
  const food = s.plains >= FOOD_MIN_PLAINS;

  if (metal && random.next() < ACTIVATION[Good.Metal]) {
    return { good: Good.Metal, on: onHighGround };
  }
  if ((coastalOil || plateauOil) && random.next() < ACTIVATION[Good.Oil]) {
    return { good: Good.Oil, on: coastalOil ? onShoreline : onHighland };
  }
  if (food && random.next() < ACTIVATION[Good.Food]) {
    return { good: Good.Food, on: onPlains };
  }
  return null;
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
 * when the build is free of goods.
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
      cost[Good.Metal] = 120;
      break;
    case UnitType.MissileSilo:
      cost[Good.Metal] = 100;
      break;
    case UnitType.City:
    case UnitType.Port:
    case UnitType.Factory:
      if (upgrade) cost[Good.Metal] = 60;
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

/** Goods a player produces per tick, indexed by Good. */
export function goodsIncome(player: PlayerLike): GoodsAmounts {
  const deposits = player.deposits();
  return [
    deposits[Good.Food] * GOODS_PRODUCTION_PER_TILE,
    deposits[Good.Oil] * GOODS_PRODUCTION_PER_TILE,
    deposits[Good.Metal] * GOODS_PRODUCTION_PER_TILE,
  ];
}

/** Food a player's troops eat per tick. */
export function foodUpkeep(player: PlayerLike): number {
  return player.troops() * FOOD_PER_TROOP;
}

export function foodState(player: PlayerLike): FoodState {
  const stock = player.goods()[Good.Food];
  if (stock >= GOODS_STOCK_CAP * FOOD_SURPLUS_FRACTION) return "surplus";
  if (stock <= 0 && foodUpkeep(player) > goodsIncome(player)[Good.Food]) {
    return "shortage";
  }
  return "normal";
}

export function foodGrowthModifier(player: PlayerLike): number {
  switch (foodState(player)) {
    case "shortage":
      return FOOD_SHORTAGE_GROWTH;
    case "surplus":
      return FOOD_SURPLUS_GROWTH;
    default:
      return 1;
  }
}
