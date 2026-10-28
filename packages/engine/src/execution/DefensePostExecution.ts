import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  POST_PATH_WATCHTOWER,
  POST_WATCHTOWER_BOAT_TIER,
  POST_WATCHTOWER_WARSHIP_TIER,
  postReach,
} from "@openfront/engine-lib/game/Upgrades";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShellExecution } from "./ShellExecution";

export class DefensePostExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private target: Unit | null = null;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(private post: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private shoot() {
    if (this.target === null) return;
    const shellAttackRate = this.mg.config().defensePostShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.post.tile(),
          this.post.owner(),
          this.post,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  tick(ticks: number): void {
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    // Do nothing while the structure is under construction
    if (this.post.isUnderConstruction()) {
      return;
    }

    if (this.target !== null && !this.target.isActive()) {
      this.target = null;
    }

    // Borderfall Watchtower path: from POST_WATCHTOWER_BOAT_TIER the post
    // shells enemy boats in its reach, transports first, and from
    // POST_WATCHTOWER_WARSHIP_TIER warships too.
    const watch = this.post.tiers()[POST_PATH_WATCHTOWER];
    if (watch < POST_WATCHTOWER_BOAT_TIER) return;
    const owner = this.post.owner();
    const reach = postReach(
      this.mg.config().defensePostRange(),
      this.post.tiers(),
    );
    const types =
      watch >= POST_WATCHTOWER_WARSHIP_TIER
        ? [UnitType.TransportShip, UnitType.Warship]
        : [UnitType.TransportShip];
    this.target =
      this.mg
        .nearbyUnits(this.post.tile(), reach, types)
        .filter(
          ({ unit }) =>
            unit.owner() !== owner &&
            !unit.owner().isFriendly(owner) &&
            !this.alreadySentShell.has(unit),
        )
        .sort((a, b) => {
          const boatA = a.unit.type() === UnitType.TransportShip ? 0 : 1;
          const boatB = b.unit.type() === UnitType.TransportShip ? 0 : 1;
          return boatA - boatB || a.distSquared - b.distSquared;
        })[0]?.unit ?? null;
    this.shoot();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DefensePostExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      post: w.unit(this.post),
      target: w.unitOrNull(this.target),
      lastShellAttack: this.lastShellAttack,
      alreadySentShell: [...this.alreadySentShell].map((u) => w.unit(u)),
    });
  }

  restoreSnapshot(s: DefensePostState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.post = r.unit(s.post);
    this.target = r.unitOrNull(s.target);
    this.lastShellAttack = s.lastShellAttack;
    this.alreadySentShell = new Set(s.alreadySentShell.map((i) => r.unit(i)));
  }
}

const DefensePostStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  post: zRef(),
  target: zRef().nullable(),
  lastShellAttack: zInt(),
  alreadySentShell: z.array(zRef()),
});
type DefensePostState = z.infer<typeof DefensePostStateSchema>;

export const DefensePostExecutionSnapshot = execSnapshotType({
  name: "DefensePost",
  version: 1,
  schema: DefensePostStateSchema,
  cls: () => DefensePostExecution,
});
