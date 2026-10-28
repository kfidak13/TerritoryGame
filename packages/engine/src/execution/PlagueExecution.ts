import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Tick } from "@openfront/engine-api/game/GameTypes";
import { zInt, zTile } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Borderfall Plague nukes (engine-lib/game/Upgrades): the land in `radius`
 * of the blast is cleared, left in fallout, and can't be taken by anyone
 * until `until`.
 */
export class PlagueExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private tiles: TileRef[] = [];

  constructor(
    private center: TileRef,
    private radius: number,
    private until: Tick,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
    this.tiles = this.area(mg);
    for (const t of this.tiles) {
      const owner = mg.owner(t);
      if (owner.isPlayer()) owner.relinquish(t);
      mg.setFallout(t, true);
      mg.poison(t, this.until);
    }
  }

  /** The land tiles in the poisoned disc. */
  private area(mg: Game): TileRef[] {
    const cx = mg.x(this.center);
    const cy = mg.y(this.center);
    const r = this.radius;
    const tiles: TileRef[] = [];
    for (
      let y = Math.max(0, cy - r);
      y <= Math.min(mg.height() - 1, cy + r);
      y++
    ) {
      for (
        let x = Math.max(0, cx - r);
        x <= Math.min(mg.width() - 1, cx + r);
        x++
      ) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const t = mg.ref(x, y);
        if (mg.isLand(t) && !mg.isImpassable(t)) tiles.push(t);
      }
    }
    return tiles;
  }

  tick(ticks: number): void {
    if (ticks < this.until) return;
    for (const t of this.tiles) this.mg!.unpoison(t, this.until);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(_w: SnapshotWriter): ExecRecord {
    return PlagueExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      center: this.center,
      radius: this.radius,
      until: this.until,
    });
  }

  restoreSnapshot(s: PlagueState, r: SnapshotReader): void {
    this.active = s.active;
    this.center = s.center;
    this.radius = s.radius;
    this.until = s.until;
    this.mg = s.initialized ? r.game : null;
    // The poison lives on the game, outside its snapshot: put it back.
    if (this.mg !== null && this.active) {
      this.tiles = this.area(this.mg);
      for (const t of this.tiles) this.mg.poison(t, this.until);
    }
  }
}

const PlagueStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  center: zTile(),
  radius: zInt(),
  until: zInt(),
});
type PlagueState = z.infer<typeof PlagueStateSchema>;

export const PlagueExecutionSnapshot = execSnapshotType({
  name: "Plague",
  version: 1,
  schema: PlagueStateSchema,
  cls: () => PlagueExecution,
});
