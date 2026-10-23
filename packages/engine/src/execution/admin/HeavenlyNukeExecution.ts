import { zInt } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";

/** The wave crosses the map in this many ticks (4 seconds). */
export const HEAVENLY_TICKS = 40;

/**
 * Borderfall admin heavenly nuke: a wave sweeps the map from top to bottom,
 * a band of rows each tick, leaving no territory, no buildings, ships or
 * armies, and fallout over all the land. Spread over ticks so no single
 * update carries the whole map.
 */
export class HeavenlyNukeExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private nextRow = 0;

  init(mg: Game): void {
    this.mg = mg;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(): void {
    const mg = this.mg!;
    const rows = Math.ceil(mg.height() / HEAVENLY_TICKS);
    const end = Math.min(mg.height(), this.nextRow + rows);
    for (let y = this.nextRow; y < end; y++) {
      for (let x = 0; x < mg.width(); x++) {
        const t = mg.ref(x, y);
        const owner = mg.owner(t);
        if (owner.isPlayer()) (owner as Player).relinquish(t);
        if (mg.isLand(t) && !mg.isImpassable(t)) mg.setFallout(t, true);
      }
    }
    for (const unit of mg.units()) {
      const y = mg.y(unit.tile());
      if (unit.isActive() && y >= this.nextRow && y < end) unit.delete(false);
    }
    this.nextRow = end;
    if (this.nextRow >= mg.height()) this.active = false;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return HeavenlyNukeExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      nextRow: this.nextRow,
    });
  }

  restoreSnapshot(s: HeavenlyState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.nextRow = s.nextRow;
  }
}

const HeavenlyStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  nextRow: zInt(),
});
type HeavenlyState = z.infer<typeof HeavenlyStateSchema>;

export const HeavenlyNukeExecutionSnapshot = execSnapshotType({
  name: "HeavenlyNuke",
  version: 1,
  schema: HeavenlyStateSchema,
  cls: () => HeavenlyNukeExecution,
});
