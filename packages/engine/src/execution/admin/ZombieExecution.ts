import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  DisasterKind,
  MessageType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  isZombieHorde,
  ZOMBIE_ATTACK_SHARE,
  ZOMBIE_ATTACK_TICKS,
  ZOMBIE_MIN_PATCH_RADIUS,
  ZOMBIE_NAME,
  ZOMBIE_PATCH_RADIUS,
  ZOMBIE_ROT_AFTER_TICKS,
  ZOMBIE_ROT_SHARE,
  ZOMBIE_SHIELD_TICKS,
  ZOMBIE_START_TROOPS,
  ZOMBIE_TROOP_CAP,
  ZOMBIE_TROOPS_PER_TILE,
  ZOMBIE_VICTIM_LOSS,
} from "@openfront/engine-lib/game/Zombies";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRandom,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { PlayerExecution } from "../PlayerExecution";

/**
 * A zombie apocalypse: a horde rises inside `victim`, shielded at first, and
 * everyone is told. Raised by an admin or by the disaster cycle.
 */
export function raiseZombies(mg: Game, victim: Player, ticks: number): void {
  if (!victim.isAlive() || victim.isGod() || isZombieHorde(victim)) return;
  const center = centralTile(mg, victim);
  const radius = Math.max(
    ZOMBIE_MIN_PATCH_RADIUS,
    Math.round(Math.sqrt(victim.numTilesOwned()) * ZOMBIE_PATCH_RADIUS),
  );
  const density = victim.troops() / Math.max(1, victim.numTilesOwned());
  const id = new PseudoRandom(ticks * 1009 + victim.smallID()).nextID();
  const horde = mg.addPlayer(
    new PlayerInfo(ZOMBIE_NAME, PlayerType.Nation, null, id),
  );
  forEachInDisc(mg, center, radius, (t) => {
    if (mg.owner(t) === victim) horde.conquer(t);
  });
  if (!horde.isAlive()) horde.conquer(center);
  horde.setTroops(victim.troops() * ZOMBIE_START_TROOPS);
  // It rises shielded; ZombieExecution lifts the shield.
  horde.setGod(true);
  victim.removeTroops(victim.troops() * ZOMBIE_VICTIM_LOSS);
  // Upkeep only (PlayerExecution skips the horde's economy): it hands
  // over buildings on land it loses, and its cut-off pieces fall.
  mg.addExecution(
    new PlayerExecution(horde),
    new ZombieExecution(
      horde,
      victim,
      density * ZOMBIE_TROOPS_PER_TILE,
      ticks + ZOMBIE_SHIELD_TICKS,
      ticks + ZOMBIE_ROT_AFTER_TICKS,
    ),
  );
  mg.addUpdate({
    type: GameUpdateType.Disaster,
    kind: DisasterKind.Zombies,
    tile: center,
    radius,
    victim: victim.id(),
  });
  mg.displayMessage(
    "events_display.zombie_apocalypse",
    MessageType.DISASTER,
    null,
    undefined,
    { name: victim.displayName() },
  );
}

/** The player's tile nearest the middle of their land. */
function centralTile(mg: Game, p: Player): TileRef {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const t of p.tiles()) {
    sx += mg.x(t);
    sy += mg.y(t);
    n++;
  }
  const cx = sx / n;
  const cy = sy / n;
  let best: TileRef | null = null;
  let bestD = Infinity;
  for (const t of p.tiles()) {
    const d = (mg.x(t) - cx) ** 2 + (mg.y(t) - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best!;
}

export function forEachInDisc(
  mg: Game,
  center: TileRef,
  radius: number,
  fn: (t: TileRef) => void,
): void {
  const cx = mg.x(center);
  const cy = mg.y(center);
  for (let y = Math.max(0, cy - radius); y <= cy + radius; y++) {
    if (y >= mg.height()) break;
    for (let x = Math.max(0, cx - radius); x <= cx + radius; x++) {
      if (x >= mg.width()) break;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) fn(mg.ref(x, y));
    }
  }
}

/**
 * Drives a zombie horde (engine-lib/game/Zombies.ts): attacks its victim,
 * then its other neighbors, gains troops for the land it takes, and rots.
 * Its PlayerExecution does upkeep only: its troops grow here, by feeding
 * and regrowing like a nation, until it rots.
 */
export class ZombieExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private random: PseudoRandom;
  private lastTiles: number;
  private nextAttack = 0;

  constructor(
    private horde: Player,
    private victim: Player,
    /** Troops gained per tile taken. */
    private troopsPerTile: number,
    /** Until this tick the horde's land can't be taken (it rises shielded). */
    private shieldUntil: number,
    private rotAt: number,
  ) {
    this.random = new PseudoRandom(rotAt + horde.smallID());
    this.lastTiles = horde.numTilesOwned();
  }

  init(mg: Game): void {
    this.mg = mg;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    const horde = this.horde;
    if (!horde.isAlive()) {
      this.active = false;
      return;
    }
    if (ticks >= this.shieldUntil && horde.isGod()) horde.setGod(false);

    if (ticks >= this.rotAt) {
      if (ticks % 10 === 0) this.rot();
      return;
    }

    const config = this.mg!.config();
    const tiles = horde.numTilesOwned();
    let gain = Math.max(0, tiles - this.lastTiles) * this.troopsPerTile;
    this.lastTiles = tiles;
    gain += Math.max(0, config.troopIncreaseRate(horde));
    const room = config.maxTroops(horde) * ZOMBIE_TROOP_CAP - horde.troops();
    if (room > 0) horde.addTroops(Math.min(gain, room));

    if (ticks < this.nextAttack || horde.outgoingAttacks().length > 0) return;
    const target = this.target();
    if (target === null) return;
    this.nextAttack = ticks + ZOMBIE_ATTACK_TICKS;
    this.mg!.addExecution(
      new AttackExecution(
        horde.troops() * ZOMBIE_ATTACK_SHARE,
        horde,
        target.id(),
      ),
    );
  }

  /** The victim while it still borders the horde, else a random neighbor. */
  private target(): Player | null {
    const mg = this.mg!;
    const neighbors: Player[] = [];
    const seen = new Set<Player>();
    for (const t of this.horde.borderTiles()) {
      mg.forEachNeighbor(t, (n) => {
        const owner = mg.owner(n);
        if (!owner.isPlayer() || owner === this.horde) return;
        const p = owner as Player;
        if (!seen.has(p)) {
          seen.add(p);
          neighbors.push(p);
        }
      });
    }
    if (seen.has(this.victim)) return this.victim;
    const prey = neighbors.filter(
      (p) => p.type() !== PlayerType.Bot && !isZombieHorde(p),
    );
    const pool = prey.length > 0 ? prey : neighbors;
    return pool.length > 0 ? this.random.randElement(pool) : null;
  }

  /** Loses a share of its land (from the edges) and troops. */
  private rot(): void {
    const horde = this.horde;
    horde.removeTroops(horde.troops() * ZOMBIE_ROT_SHARE);
    const border = [...horde.borderTiles()];
    const count = Math.max(
      5,
      Math.ceil(horde.numTilesOwned() * ZOMBIE_ROT_SHARE),
    );
    const doomed = border.length >= count ? border : [...horde.tiles()];
    for (const t of doomed.slice(0, count)) horde.relinquish(t);
    this.lastTiles = horde.numTilesOwned();
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ZombieExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      random: w.random(this.random),
      horde: w.player(this.horde),
      victim: w.player(this.victim),
      troopsPerTile: this.troopsPerTile,
      shieldUntil: this.shieldUntil,
      rotAt: this.rotAt,
      lastTiles: this.lastTiles,
      nextAttack: this.nextAttack,
    });
  }

  restoreSnapshot(s: ZombieState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.random = r.random(s.random);
    this.horde = r.player(s.horde);
    this.victim = r.player(s.victim);
    this.troopsPerTile = s.troopsPerTile;
    this.shieldUntil = s.shieldUntil;
    this.rotAt = s.rotAt;
    this.lastTiles = s.lastTiles;
    this.nextAttack = s.nextAttack;
  }
}

const ZombieStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  random: zRandom(),
  horde: zPlayerRef(),
  victim: zPlayerRef(),
  troopsPerTile: zNum(),
  shieldUntil: zInt(),
  rotAt: zInt(),
  lastTiles: zInt(),
  nextAttack: zInt(),
});
type ZombieState = z.infer<typeof ZombieStateSchema>;

export const ZombieExecutionSnapshot = execSnapshotType({
  name: "Zombie",
  version: 1,
  schema: ZombieStateSchema,
  cls: () => ZombieExecution,
});
