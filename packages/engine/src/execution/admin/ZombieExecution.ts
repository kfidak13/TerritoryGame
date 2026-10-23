import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  ZOMBIE_ATTACK_SHARE,
  ZOMBIE_ATTACK_TICKS,
  ZOMBIE_ROT_SHARE,
  ZOMBIE_TROOP_CAP,
  isZombieHorde,
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

/**
 * Drives a zombie horde (engine-lib/game/Zombies.ts): attacks its victim,
 * then its other neighbors, gains troops for the land it takes, and rots.
 * The horde has no PlayerExecution: its troops grow here, by feeding and
 * regrowing like a nation, until it rots.
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
