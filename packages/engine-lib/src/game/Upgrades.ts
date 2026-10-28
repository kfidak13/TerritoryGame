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
  [UnitType.DefensePost]: [
    { key: "post_fortress", goods: g(0, 0, 20) },
    { key: "post_watchtower", goods: g(0, 20, 0) },
    { key: "post_barracks", goods: g(20, 0, 0) },
  ],
  [UnitType.OilRig]: [
    { key: "rig_drill", goods: g(0, 0, 20) },
    { key: "rig_hull", goods: g(0, 0, 20) },
    { key: "rig_platform", goods: g(0, 20, 0) },
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

/** Extra gold per trade ship from its home port's Trade path, % by tier. */
export const PORT_TRADE_GOLD_PERCENT = [0, 10, 25, 50, 100, 200];
/** Spawn rolls a port makes for trade ships, by Trade tier. */
export const PORT_TRADE_ROLLS = [1, 1, 2, 2, 3, 4];
/** Extra health and shell damage for warships from here, % by Navy tier. */
export const PORT_NAVY_POWER_PERCENT = [0, 15, 35, 60, 100, 150];
/** Extra trade ship speed, % by its home port's Trade tier. */
export const PORT_TRADE_SPEED_PERCENT = [0, 0, 10, 10, 30, 30];
/** Extra speed for warships from here, % by Navy tier. */
export const PORT_NAVY_SPEED_PERCENT = [0, 0, 0, 25, 25, 25];
/** Extra invasion boat speed, % by the best Invasion tier. */
export const PORT_INVASION_SPEED_PERCENT = [0, 10, 10, 10, 30, 30];
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

// ---------------------------------------------------------------- factory

export const FACTORY_PATH_FREIGHT = 0;
export const FACTORY_PATH_EXPRESS = 1;
export const FACTORY_PATH_BANDIT = 2;

/** Extra gold per stop for trains from here, % by Freight tier. */
export const FACTORY_FREIGHT_GOLD_PERCENT = [0, 15, 35, 70, 120, 200];
/** Spawn rolls a factory makes for trains, by Express tier. */
export const FACTORY_EXPRESS_ROLLS = [1, 2, 2, 3, 4, 5];
/** Rail tiles a train from here covers a tick, by Express tier. */
export const FACTORY_EXPRESS_SPEED = [2, 2, 2, 3, 3, 4];
/** Extra gold at other nations' stations, % by Bandit tier. */
export const FACTORY_BANDIT_GOLD_PERCENT = [0, 0, 10, 10, 10, 10];
/** Share of a foreign station owner's cut a train takes, % by Bandit tier. */
export const FACTORY_BANDIT_STEAL_PERCENT = [0, 0, 0, 10, 25, 50];
/**
 * A level-5 Bandit factory's owner takes this share of what foreign trains
 * earn at their stations, unless those trains run from a Bandit factory too.
 */
export const FACTORY_BANDIT_TOLL_PERCENT = 25;

/**
 * How a stop's `base` gold splits between the train's owner and a foreign
 * station's owner (who both get `base` without upgrades), given the tiers
 * of the train's factory and the station owner's best Bandit tier.
 */
export function trainStopGold(
  base: bigint,
  foreign: boolean,
  home: Tiers,
  stationBandit: number,
): { trainCut: bigint; stationCut: bigint } {
  const pct = (gold: bigint, percent: number) =>
    (gold * BigInt(percent)) / 100n;
  const bandit = home[FACTORY_PATH_BANDIT];
  let trainCut =
    base +
    pct(base, FACTORY_FREIGHT_GOLD_PERCENT[home[FACTORY_PATH_FREIGHT]]) +
    (foreign ? pct(base, FACTORY_BANDIT_GOLD_PERCENT[bandit]) : 0n);
  let stationCut = foreign ? base : 0n;
  if (foreign) {
    const stolen = pct(stationCut, FACTORY_BANDIT_STEAL_PERCENT[bandit]);
    stationCut -= stolen;
    trainCut += stolen;
    // A Bandit factory's trains are never tolled.
    if (bandit === 0 && stationBandit >= MAX_TIER) {
      const toll = pct(trainCut, FACTORY_BANDIT_TOLL_PERCENT);
      trainCut -= toll;
      stationCut += toll;
    }
  }
  return { trainCut, stationCut };
}

// ---------------------------------------------------------------- SAM

export const SAM_PATH_RANGE = 0;
export const SAM_PATH_BATTERY = 1;
export const SAM_PATH_AEGIS = 2;

/** Extra reach over a plain SAM's, % by Range tier. */
export const SAM_RANGE_PERCENT = [0, 15, 30, 50, 75, 100];
/** A plain SAM's reach: Config.samRange(1). */
const SAM_BASE_RANGE = 70;

/**
 * The level Config.samRange (150 - 480 / (level + 5)) takes to give a SAM
 * its Range path's reach, so every range check stays on that one formula.
 */
export function samRangeLevel(tiers: Tiers): number {
  const reach =
    (SAM_BASE_RANGE * (100 + SAM_RANGE_PERCENT[tiers[SAM_PATH_RANGE]])) / 100;
  return 480 / (150 - reach) - 5;
}

/** Missiles a SAM holds, by Battery tier. */
export const SAM_BATTERY_TUBES = [1, 1, 1, 2, 3, 4];

/** Missiles a SAM (Battery) or silo (Arsenal) holds. */
export function missileTubes(type: UnitType, tiers: Tiers): number {
  return type === UnitType.SAMLauncher
    ? SAM_BATTERY_TUBES[tiers[SAM_PATH_BATTERY]]
    : SILO_ARSENAL_TUBES[tiers[SILO_PATH_ARSENAL]];
}
/** Reload time as a % of Config.SAMCooldown, by Battery tier. */
const SAM_BATTERY_RELOAD_PERCENT = [100, 85, 70, 70, 70, 50];

export function samReloadTicks(cooldown: number, tiers: Tiers): number {
  return Math.floor(
    (cooldown * SAM_BATTERY_RELOAD_PERCENT[tiers[SAM_PATH_BATTERY]]) / 100,
  );
}

/** Ticks between an Aegis SAM's shots at ships, by tier (0: none). */
export const SAM_AEGIS_INTERVAL = [0, 80, 50, 50, 30, 20];
/** From this Aegis tier the SAM shells warships, not just boats. */
export const SAM_AEGIS_WARSHIP_TIER = 3;
/** Shell damage against warships, % by Aegis tier. */
export const SAM_AEGIS_DAMAGE_PERCENT = [100, 100, 100, 100, 200, 300];

// ---------------------------------------------------------------- silo

export const SILO_PATH_WARHEAD = 0;
export const SILO_PATH_ARSENAL = 1;
export const SILO_PATH_PLAGUE = 2;

/** Extra blast radius for every nuke from here, % by Warhead tier. */
export const SILO_WARHEAD_BLAST_PERCENT = [0, 10, 20, 35, 55, 100];
/** Extra levels a nuke from here takes off buildings, by Warhead tier. */
export const SILO_WARHEAD_STRENGTH = [0, 0, 0, 1, 1, 2];

/** A nuke's blast, grown by the Warhead tier it was launched with. */
export function warheadMagnitude<M extends { inner: number; outer: number }>(
  base: M,
  tiers: Tiers,
): M {
  const percent = 100 + SILO_WARHEAD_BLAST_PERCENT[tiers[SILO_PATH_WARHEAD]];
  return {
    ...base,
    inner: Math.floor((base.inner * percent) / 100),
    outer: Math.floor((base.outer * percent) / 100),
  };
}

/** Levels a nuke takes off a building it lands on. */
export function nukeStrength(type: UnitType, tiers: Tiers): number {
  return (
    (NUKE_STRENGTH[type] ?? 1) + SILO_WARHEAD_STRENGTH[tiers[SILO_PATH_WARHEAD]]
  );
}

/** Nukes a silo holds, by Arsenal tier. */
export const SILO_ARSENAL_TUBES = [1, 1, 2, 3, 4, 5];
/** Reload time as a % of Config.SiloCooldown, by Arsenal tier. */
const SILO_ARSENAL_RELOAD_PERCENT = [100, 80, 80, 80, 80, 50];

export function siloReloadTicks(cooldown: number, tiers: Tiers): number {
  return Math.floor(
    (cooldown * SILO_ARSENAL_RELOAD_PERCENT[tiers[SILO_PATH_ARSENAL]]) / 100,
  );
}

/** Ticks a Plague nuke's land can't be taken, by tier (300 = 30 seconds). */
export const SILO_PLAGUE_TICKS = [0, 300, 600, 1200, 2100, 3000];
/** The poisoned area's radius as a % of the blast's, by Plague tier. */
export const SILO_PLAGUE_AREA_PERCENT = [0, 100, 100, 125, 125, 150];

// ---------------------------------------------------------------- defense post

export const POST_PATH_FORTRESS = 0;
export const POST_PATH_WATCHTOWER = 1;
export const POST_PATH_BARRACKS = 2;

/** The post's defense bonus, % of a plain post's, by Fortress tier. */
export const POST_FORTRESS_DEFENSE_PERCENT = [100, 120, 150, 200, 300, 500];
/** How much it slows attacks, % of a plain post's, by Fortress tier. */
export const POST_FORTRESS_SLOW_PERCENT = [100, 100, 100, 100, 100, 150];
/** Extra reach over a plain post's, % by Watchtower tier. */
export const POST_WATCHTOWER_RANGE_PERCENT = [0, 20, 40, 60, 80, 100];
/** From this Watchtower tier the post shells enemy boats in reach... */
export const POST_WATCHTOWER_BOAT_TIER = 2;
/** ...and from this one warships too. */
export const POST_WATCHTOWER_WARSHIP_TIER = 4;
/** Extra troop regrowth from the owner's best Barracks, % by tier. */
export const POST_BARRACKS_REGROWTH_PERCENT = [0, 5, 10, 20, 35, 50];
/** Troops (shown) each Barracks post adds to its owner's cap, by tier. */
const POST_BARRACKS_TROOPS = [0, 0, 0, 100_000, 250_000, 500_000];

/** A post's reach, grown by its Watchtower tier. */
export function postReach(base: number, tiers: Tiers): number {
  return (
    (base *
      (100 + POST_WATCHTOWER_RANGE_PERCENT[tiers[POST_PATH_WATCHTOWER]])) /
    100
  );
}

/** The farthest any post reaches. */
export function maxPostReach(base: number): number {
  return (base * (100 + POST_WATCHTOWER_RANGE_PERCENT[MAX_TIER])) / 100;
}

/** Troops a Barracks post adds to its owner's cap. */
export function barracksTroops(tiers: Tiers): number {
  return POST_BARRACKS_TROOPS[tiers[POST_PATH_BARRACKS]] * TROOP_SCALE;
}

// ---------------------------------------------------------------- goods

/** What a goods building's worked field yields, % by its Output tier. */
export const GOODS_OUTPUT_PERCENT = [100, 150, 225, 350, 425, 500];

// ---------------------------------------------------------------- oil rig

export const RIG_PATH_DRILL = 0;
export const RIG_PATH_HULL = 1;
export const RIG_PATH_PLATFORM = 2;

/** The rig's oil, % of a plain rig's, by Drill tier. */
export const RIG_DRILL_YIELD_PERCENT = [100, 120, 150, 200, 300, 400];
/** The rig's health, % of a plain rig's, by Hull tier. */
export const RIG_HULL_HEALTH_PERCENT = [100, 125, 125, 200, 300, 400];
/** How fast it repairs, times a plain rig, by Hull tier. */
export const RIG_HULL_REPAIR = [1, 1, 2, 2, 2, 4];
/** Ticks between the rig's shots at enemy boats, by Platform tier (0: none). */
export const RIG_PLATFORM_INTERVAL = [0, 150, 80, 80, 80, 80];
/** How far its guns reach, in tiles, by Platform tier. */
export const RIG_PLATFORM_RANGE = [0, 12, 12, 20, 20, 20];
/** Its shell damage, % by Platform tier. */
export const RIG_PLATFORM_DAMAGE_PERCENT = [100, 100, 100, 100, 200, 200];
/** From this Platform tier it shells warships, not just boats. */
export const RIG_PLATFORM_WARSHIP_TIER = 5;
