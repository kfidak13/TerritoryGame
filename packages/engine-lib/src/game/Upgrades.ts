import { GoodsAmounts, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { UnitLike } from "@openfront/engine-api/game/ReadViews";

/*
 * Borderfall building upgrades, Bloons TD 6 style. Every upgradable building
 * has up to three paths of five tiers. One path may reach tier 5, a second
 * tier 2, and the third stays shut. A building's level is its highest tier;
 * a player can own at most two level-5 buildings of each type.
 *
 * Each tier costs the building's base gold and its path's goods, times 1, 2,
 * 4, 8 and 16 at tiers 1 to 5, and shuts the building down while it works.
 * Selling refunds half of what the building cost; capture costs it a tier,
 * and a nuke as many tiers as it is strong.
 */

export const MAX_TIER = 5;
/** The second path stops here; the third stays at 0. */
export const SECOND_PATH_MAX_TIER = 2;
/** Level-5 buildings each player may own, per type. */
export const MAX_TIER5_PER_TYPE = 2;
/** Share of a building's cost that selling it gives back. */
export const SELL_REFUND_SHARE = 0.5;

/** Tier per path: [path 0, path 1, path 2]. */
export type Tiers = readonly number[];
export const NO_TIERS: Tiers = [0, 0, 0];

export interface UpgradePath {
  /** Translation key under build_paths. */
  key: string;
  /** Goods each tier costs, before the tier multiplier. */
  goods: GoodsAmounts;
}

const g = (food: number, oil: number, metal: number): GoodsAmounts => [
  food,
  oil,
  metal,
];

/** Gold each tier costs, before the tier multiplier. */
const BASE_GOLD: Partial<Record<UnitType, number>> = {
  [UnitType.City]: 125_000,
  [UnitType.Port]: 125_000,
  [UnitType.Factory]: 125_000,
  [UnitType.SAMLauncher]: 1_500_000,
  [UnitType.MissileSilo]: 1_000_000,
  [UnitType.Farm]: 100_000,
  [UnitType.Mineshaft]: 100_000,
  [UnitType.OilExtractor]: 150_000,
  // No paths yet: only for the sell refund.
  [UnitType.DefensePost]: 50_000,
  [UnitType.OilRig]: 200_000,
};

const PATHS: Partial<Record<UnitType, readonly UpgradePath[]>> = {
  [UnitType.City]: [
    { key: "city_metropolis", goods: g(25, 0, 0) },
    { key: "city_market", goods: g(0, 25, 0) },
    { key: "city_capital", goods: g(15, 0, 15) },
  ],
  [UnitType.Port]: [
    { key: "port_trade", goods: g(25, 0, 0) },
    { key: "port_navy", goods: g(0, 15, 15) },
    { key: "port_invasion", goods: g(15, 0, 15) },
  ],
  [UnitType.Factory]: [
    { key: "factory_freight", goods: g(0, 0, 25) },
    { key: "factory_express", goods: g(0, 25, 0) },
    { key: "factory_bandit", goods: g(15, 15, 0) },
  ],
  [UnitType.SAMLauncher]: [
    { key: "sam_range", goods: g(0, 0, 25) },
    { key: "sam_battery", goods: g(0, 15, 15) },
    { key: "sam_aegis", goods: g(0, 25, 0) },
  ],
  [UnitType.MissileSilo]: [
    { key: "silo_warhead", goods: g(0, 25, 0) },
    { key: "silo_arsenal", goods: g(0, 0, 25) },
    { key: "silo_plague", goods: g(15, 15, 0) },
  ],
  // Goods buildings only grow their output: one path.
  [UnitType.Farm]: [{ key: "output", goods: g(0, 0, 20) }],
  [UnitType.Mineshaft]: [{ key: "output", goods: g(20, 0, 0) }],
  [UnitType.OilExtractor]: [{ key: "output", goods: g(0, 0, 20) }],
};

export function upgradePaths(type: UnitType): readonly UpgradePath[] {
  return PATHS[type] ?? [];
}

const tierFactor = (tier: number): number => 1 << (tier - 1);

/** Gold for raising a path to `tier` (1-5). */
export function upgradeGold(type: UnitType, tier: number): bigint {
  return BigInt((BASE_GOLD[type] ?? 0) * tierFactor(tier));
}

/** Goods for raising `path` to `tier` (1-5). */
export function upgradeGoods(
  type: UnitType,
  path: number,
  tier: number,
): GoodsAmounts {
  const goods = upgradePaths(type)[path]?.goods ?? g(0, 0, 0);
  return goods.map((n) => n * tierFactor(tier)) as GoodsAmounts;
}

/** Ticks the building sits idle while it works on `tier`. */
export function upgradeTicks(tier: number): number {
  return [0, 30, 60, 100, 150, 200][tier] ?? 0;
}

/**
 * Whether `path` may go up a tier: at most two paths started, only one past
 * SECOND_PATH_MAX_TIER, none past MAX_TIER.
 */
export function canRaiseTier(
  type: UnitType,
  tiers: Tiers,
  path: number,
): boolean {
  if (path < 0 || path >= upgradePaths(type).length) return false;
  const next = tiers.map((t, i) => (i === path ? t + 1 : t));
  if (next[path] > MAX_TIER) return false;
  const started = next.filter((t) => t > 0);
  if (started.length > 2) return false;
  return started.filter((t) => t > SECOND_PATH_MAX_TIER).length <= 1;
}

export function topTier(tiers: Tiers): number {
  return Math.max(...tiers);
}

/** The path that is furthest along, or 0 for an unbuilt-on building. */
export function mainPath(tiers: Tiers): number {
  return tiers.indexOf(topTier(tiers));
}

/** Gold and goods a building's tiers cost in all, plus its base build. */
export function buildingWorth(
  type: UnitType,
  tiers: Tiers,
): { gold: bigint; goods: GoodsAmounts } {
  let gold = BigInt(BASE_GOLD[type] ?? 0);
  const goods = g(0, 0, 0);
  tiers.forEach((top, path) => {
    for (let tier = 1; tier <= top; tier++) {
      gold += upgradeGold(type, tier);
      upgradeGoods(type, path, tier).forEach((n, i) => (goods[i] += n));
    }
  });
  return { gold, goods };
}

/** What selling a building gives back. */
export function sellRefund(
  type: UnitType,
  tiers: Tiers,
): { gold: bigint; goods: GoodsAmounts } {
  const { gold, goods } = buildingWorth(type, tiers);
  return {
    gold: (gold * BigInt(SELL_REFUND_SHARE * 100)) / 100n,
    goods: goods.map((n) => Math.floor(n * SELL_REFUND_SHARE)) as GoodsAmounts,
  };
}

/** Tiers a nuke of `strength` takes off a building, by where it lands. */
export function nukeTierDamage(strength: number, inner: boolean): number {
  return inner ? strength : Math.floor(strength / 2);
}

export const NUKE_STRENGTH: Partial<Record<UnitType, number>> = {
  [UnitType.AtomBomb]: 1,
  [UnitType.MIRVWarhead]: 1,
  [UnitType.HydrogenBomb]: 3,
};

// ---------------------------------------------------------------- city

export const CITY_PATH_METROPOLIS = 0;
export const CITY_PATH_MARKET = 1;
export const CITY_PATH_CAPITAL = 2;

/** Population (in displayed troops) each city path adds, by tier. */
const CITY_POP: readonly (readonly number[])[] = [
  [0, 500_000, 1_500_000, 3_000_000, 6_000_000, 10_000_000],
  [0, 200_000, 500_000, 1_000_000, 2_000_000, 3_000_000],
  [0, 300_000, 1_000_000, 2_000_000, 4_000_000, 6_000_000],
];
/** Gold per tick each city path makes, by tier. */
const CITY_GOLD: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0],
  [0, 50, 150, 400, 1_000, 2_500],
  [0, 20, 60, 150, 400, 1_000],
];
/** Displayed troops are internal troops / 10 (Format.renderTroops). */
const TROOP_SCALE = 10;

/** Troops a city adds to its owner's cap past its base. */
export function cityPathTroops(tiers: Tiers): number {
  return (
    tiers.reduce((sum, t, path) => sum + CITY_POP[path][t], 0) * TROOP_SCALE
  );
}

/** Gold per tick a city's Market and Capital paths make. */
export function cityGold(tiers: Tiers): number {
  return (
    CITY_GOLD[CITY_PATH_MARKET][tiers[CITY_PATH_MARKET]] +
    CITY_GOLD[CITY_PATH_CAPITAL][tiers[CITY_PATH_CAPITAL]]
  );
}

/** A level-5 Capital speeds all its owner's troop regrowth. */
export const CAPITAL_REGROWTH_BONUS = 0.1;
export function isCapital(tiers: Tiers): boolean {
  return tiers[CITY_PATH_CAPITAL] >= MAX_TIER;
}

// ---------------------------------------------------------------- port

export const PORT_PATH_TRADE = 0;
export const PORT_PATH_NAVY = 1;
export const PORT_PATH_INVASION = 2;

// Ship speed bonuses wait on motion plans that can run faster than a tile
// a tick; until then the paths grow everything else.
/** Extra gold per trade ship from its home port's Trade path, % by tier. */
export const PORT_TRADE_GOLD_PERCENT = [0, 10, 25, 50, 100, 200];
/** Spawn rolls a port makes for trade ships, by Trade tier. */
export const PORT_TRADE_ROLLS = [1, 1, 2, 2, 3, 4];
/** Extra health and shell damage for warships from here, % by Navy tier. */
export const PORT_NAVY_POWER_PERCENT = [0, 15, 35, 60, 100, 150];
/** Extra troops when invasion boats land, % by the best Invasion tier. */
export const PORT_INVASION_TROOPS_PERCENT = [0, 10, 25, 45, 70, 100];
/** At this Invasion tier each boat order sends two boats. */
export const PORT_INVASION_TWIN_TIER = 5;

/** A warship's health and shell damage, scaled by its Navy tier. */
export function navyScaled(base: number, tiers: Tiers): number {
  return Math.floor(
    (base * (100 + PORT_NAVY_POWER_PERCENT[tiers[PORT_PATH_NAVY]])) / 100,
  );
}

/** The owner's best finished tier on `path` among buildings of `type`. */
export function bestTier(units: readonly UnitLike[], path: number): number {
  let best = 0;
  for (const u of units) {
    if (u.isUnderConstruction() || u.isDisrupted()) continue;
    best = Math.max(best, u.tiers()[path]);
  }
  return best;
}
