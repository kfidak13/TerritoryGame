import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  RIG_PATH_PLATFORM,
  RIG_PLATFORM_INTERVAL,
  RIG_PLATFORM_RANGE,
  RIG_PLATFORM_WARSHIP_TIER,
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

/**
 * Borderfall Oil Rig Platform path (engine-lib/game/Upgrades): the rig's
 * guns shell the nearest enemy invasion boat in reach every few seconds,
 * and from RIG_PLATFORM_WARSHIP_TIER warships too.
 */
export class OilRigExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private lastShot = 0;

  constructor(private rig: Unit) {}

  init(mg: Game): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const rig = this.rig;
    if (!rig.isActive()) {
      this.active = false;
      return;
    }
    if (rig.isUnderConstruction()) return;
    const tier = rig.tiers()[RIG_PATH_PLATFORM];
    const interval = RIG_PLATFORM_INTERVAL[tier];
    if (interval === 0 || ticks - this.lastShot < interval) return;
    const owner = rig.owner();
    const types =
      tier >= RIG_PLATFORM_WARSHIP_TIER
        ? [UnitType.TransportShip, UnitType.Warship]
        : [UnitType.TransportShip];
    let target: Unit | null = null;
    let best = Infinity;
    for (const { unit, distSquared } of this.mg!.nearbyUnits(
      rig.tile(),
      RIG_PLATFORM_RANGE[tier],
      types,
    )) {
      if (unit.owner() === owner || owner.isFriendly(unit.owner())) continue;
      if (distSquared < best) {
        target = unit;
        best = distSquared;
      }
    }
    if (target === null) return;
    this.lastShot = ticks;
    this.mg!.addExecution(new ShellExecution(rig.tile(), owner, rig, target));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return OilRigExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      rig: w.unit(this.rig),
      lastShot: this.lastShot,
    });
  }

  restoreSnapshot(s: OilRigState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.rig = r.unit(s.rig);
    this.lastShot = s.lastShot;
  }
}

const OilRigStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  rig: zRef(),
  lastShot: zInt(),
});
type OilRigState = z.infer<typeof OilRigStateSchema>;

export const OilRigExecutionSnapshot = execSnapshotType({
  name: "OilRig",
  version: 1,
  schema: OilRigStateSchema,
  cls: () => OilRigExecution,
});
