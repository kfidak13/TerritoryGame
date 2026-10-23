import { PlayerType } from "@openfront/engine-api/game/GameTypes";

/*
 * Borderfall admin zombie apocalypse (engine/execution/admin).
 *
 * A horde rises in the middle of a nation: a small patch of its land, but
 * with enough troops to survive the first counterattack. It eats its victim
 * first, then whoever borders it, gaining troops for every tile it takes,
 * never allies or trades, and rots away after a few minutes.
 */

/** Patch radius, as a fraction of the square root of the victim's land. */
export const ZOMBIE_PATCH_RADIUS = 0.12;
export const ZOMBIE_MIN_PATCH_RADIUS = 3;
/** The horde starts with this share of the victim's troops... */
export const ZOMBIE_START_TROOPS = 1;
/** ...and the victim loses this share to the infection. */
export const ZOMBIE_VICTIM_LOSS = 0.3;
/**
 * Troops gained per tile taken, as a share of the victim's troops per tile
 * when the horde rose: it snowballs as it spreads.
 */
export const ZOMBIE_TROOPS_PER_TILE = 0.5;
/**
 * Feeding and regrowing (at a nation's pace) stop at this many times a
 * nation's troop cap for the horde's land: it snowballs as it spreads, but
 * never outgrows its land.
 */
export const ZOMBIE_TROOP_CAP = 1.5;
/** Share of its troops the horde sends in each attack. */
export const ZOMBIE_ATTACK_SHARE = 0.25;
/**
 * For this long after rising (45 seconds) nobody can take the horde's land,
 * so it gets going before the victim's whole army falls on it.
 */
export const ZOMBIE_SHIELD_TICKS = 450;
/** Ticks between the horde's attack decisions (5 seconds). */
export const ZOMBIE_ATTACK_TICKS = 50;
/** The horde starts to rot after 3 minutes... */
export const ZOMBIE_ROT_AFTER_TICKS = 3 * 60 * 10;
/** ...then loses this share of its land and troops every second. */
export const ZOMBIE_ROT_SHARE = 0.04;

/**
 * The horde is a nation (tribes fold too easily in battle) with no nation
 * AI, known by its name: real nations take theirs from the map.
 */
export const ZOMBIE_NAME = "Zombie Horde";

export function isZombieHorde(p: {
  type(): PlayerType;
  name(): string;
}): boolean {
  return p.type() === PlayerType.Nation && p.name() === ZOMBIE_NAME;
}
