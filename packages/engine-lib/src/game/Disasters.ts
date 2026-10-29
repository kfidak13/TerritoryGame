import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameLike, PlayerLike } from "@openfront/engine-api/game/ReadViews";

/*
 * Borderfall disasters and disease (DisasterExecution).
 *
 * Disasters strike at random times and places, about every three minutes,
 * with no warning:
 *
 *   Earthquake  kills troops on the land it shakes and knocks levels off
 *               (or flattens) buildings there
 *   Hurricane   hits a coast: sinks boats, batters warships, ports and oil
 *               rigs, and kills troops on the shore it covers
 *   Drought     stops the Farms in a region for a few minutes
 *   Tornado     cuts a wandering path, killing troops and wrecking
 *               buildings along it
 *
 * One roll in twenty is a zombie apocalypse instead: a horde rises inside
 * the player whose land was picked (ZombieExecution.raiseZombies).
 *
 * Disease: industry (Factories and Ports) next to where people live makes
 * them sick. A city with too many levels of its owner's industry close by
 * may break out: the outbreak drains the player's troops and stops the
 * cities around it (they add no troops) until it burns out. Cities kept away
 * from factories and ports never get sick.
 *
 * Sizes are fractions of the goods region size (Goods.ts regionSize), so they
 * scale with the map.
 */

/** Average ticks between disasters (3 minutes). */
export const DISASTER_MEAN_TICKS = 3 * 60 * 10;
/**
 * Share of disasters (and zombie apocalypses) aimed at a random human
 * player's land; the rest land anywhere. Players should see them.
 */
export const HUMAN_DISASTER_SHARE = 0.6;
/** Chance a disaster roll is a zombie apocalypse instead. */
export const ZOMBIE_DISASTER_CHANCE = 0.05;
/** No disasters this long after the spawn phase (3 minutes). */
export const DISASTER_GRACE_TICKS = 3 * 60 * 10;

/** Disaster radii, as fractions of the region size. */
export const EARTHQUAKE_RADIUS = 0.35;
export const HURRICANE_RADIUS = 0.45;
export const DROUGHT_RADIUS = 0.5;
export const TORNADO_RADIUS = 0.05;

/**
 * Share of a player's troops a disaster kills if it covered all their land;
 * it kills that share of the troops times the share of their land it covers.
 */
export const EARTHQUAKE_TROOP_LOSS = 0.5;
export const HURRICANE_TROOP_LOSS = 0.35;
export const TORNADO_TROOP_LOSS = 0.6;
/** Chance each building an earthquake or hurricane hits loses a level. */
export const BUILDING_DAMAGE_CHANCE = 0.5;
/** Damage a hurricane does to warships and oil rigs. */
export const HURRICANE_SHIP_DAMAGE = 500;
export const HURRICANE_RIG_DAMAGE = 1000;
/** How long a drought stops Farms (3 minutes). */
export const DROUGHT_TICKS = 3 * 60 * 10;
/** How long a tornado runs (15 seconds) and how far it moves per tick. */
export const TORNADO_TICKS = 150;
export const TORNADO_SPEED = 0.5;

/** Buildings whose levels make nearby cities sick. */
export const INDUSTRY_TYPES = [UnitType.Factory, UnitType.Port] as const;
/** Radius (tiles) within which a player's industry makes their cities sick. */
export const POLLUTION_RADIUS = 25;
/** Industry levels a city tolerates nearby; each level beyond adds risk. */
export const POLLUTION_SAFE_LEVELS = 2;
/** Outbreak chance per check for each level beyond the safe count. */
export const OUTBREAK_CHANCE_PER_LEVEL = 0.1;
export const OUTBREAK_MAX_CHANCE = 0.5;
/** Ticks between disease checks (30 seconds). */
export const OUTBREAK_CHECK_TICKS = 300;
/** How long an outbreak lasts (90 seconds). */
export const OUTBREAK_TICKS = 900;
/** Share of a player's troops each outbreak kills per tick (0.3% a second). */
export const OUTBREAK_TROOP_DRAIN_PER_TICK = 0.0003;

/**
 * Levels of the player's own industry within POLLUTION_RADIUS of `tile`,
 * plus `extra` (industry about to go there).
 */
export function pollutionLevels(
  game: GameLike,
  player: PlayerLike,
  tile: TileRef,
  extra = 0,
): number {
  let levels = extra;
  for (const { unit } of game.nearbyUnits(
    tile,
    POLLUTION_RADIUS,
    INDUSTRY_TYPES,
  )) {
    if (unit.owner() === player && !unit.isUnderConstruction()) {
      levels += unit.level();
    }
  }
  return levels;
}

/**
 * Whether another level of `type` at `tile` (a new building or an upgrade)
 * leaves every one of the player's cities within what it tolerates.
 */
export function keepsCitiesHealthy(
  game: GameLike,
  player: PlayerLike,
  type: UnitType,
  tile: TileRef,
): boolean {
  if (type === UnitType.City) {
    return pollutionLevels(game, player, tile) <= POLLUTION_SAFE_LEVELS;
  }
  if (!(INDUSTRY_TYPES as readonly UnitType[]).includes(type)) return true;
  return game
    .nearbyUnits(tile, POLLUTION_RADIUS, UnitType.City)
    .every(
      ({ unit }) =>
        unit.owner() !== player ||
        pollutionLevels(game, player, unit.tile(), 1) <= POLLUTION_SAFE_LEVELS,
    );
}

/** Chance a city with this much industry nearby breaks out at a check. */
export function outbreakChance(levels: number): number {
  const excess = levels - POLLUTION_SAFE_LEVELS;
  return excess <= 0
    ? 0
    : Math.min(OUTBREAK_MAX_CHANCE, excess * OUTBREAK_CHANCE_PER_LEVEL);
}
