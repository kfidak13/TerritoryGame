import { mainPath, upgradeTicks } from "@openfront/engine-lib/game/Upgrades";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Raises a building `amount` tiers up one path (engine-lib/game/Upgrades),
 * a tier at a time: each is paid for up front, then the building idles as
 * under construction until the tier is done. It stops early when the next
 * tier can't be had, and a tier under way is lost if the building is.
 */
export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private active = true;
  private mg: Game | null = null;
  private ticksLeft = 0;
  private done = 0;

  constructor(
    private player: Player,
    private unitId: number,
    private amount: number = 1,
    private path?: number,
  ) {}

  init(mg: Game): void {
    this.mg = mg;
    const structure = mg.unit(this.unitId);
    if (structure === undefined || structure.owner() !== this.player) {
      console.warn(`structure ${this.unitId} not found or not owned`);
      this.active = false;
      return;
    }
    this.structure = structure;
    this.path ??= mainPath(structure.tiers());
    this.startNext();
  }

  /** Starts tiers until one has to wait, or none can be had. */
  private startNext(): void {
    const s = this.structure!;
    while (this.done < this.amount) {
      if (!this.player.canUpgradeUnit(s, this.path)) break;
      this.player.upgradeUnit(s, this.path);
      const tier = s.tiers()[this.path!] + 1;
      this.ticksLeft = this.mg!.config().instantBuild()
        ? 0
        : upgradeTicks(tier);
      if (this.ticksLeft > 0) {
        s.setUpgrading(this.ticksLeft);
        return;
      }
      s.raiseTier(this.path!);
      this.done++;
    }
    this.active = false;
  }

  tick(): void {
    const s = this.structure!;
    if (!s.isActive() || s.owner() !== this.player) {
      if (s.isActive()) s.setUpgrading(0);
      this.active = false;
      return;
    }
    if (--this.ticksLeft > 0) return;
    s.setUpgrading(0);
    s.raiseTier(this.path!);
    this.done++;
    this.startNext();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return UpgradeStructureExecutionSnapshot.write({
      structure: this.structure === undefined ? null : w.unit(this.structure),
      player: w.player(this.player),
      unitId: this.unitId,
      amount: this.amount,
      path: this.path ?? null,
      active: this.active,
      initialized: this.mg !== null,
      ticksLeft: this.ticksLeft,
      done: this.done,
    });
  }

  restoreSnapshot(s: UpgradeStructureState, r: SnapshotReader): void {
    if (s.structure !== null) this.structure = r.unit(s.structure);
    this.player = r.player(s.player);
    this.unitId = s.unitId;
    this.amount = s.amount;
    this.path = s.path ?? undefined;
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.ticksLeft = s.ticksLeft;
    this.done = s.done;
  }
}

const UpgradeStructureStateSchema = z.object({
  structure: zRef().nullable(),
  player: zPlayerRef(),
  unitId: zNum(),
  amount: zNum(),
  path: zInt().nullable(),
  active: z.boolean(),
  initialized: z.boolean(),
  ticksLeft: zInt(),
  done: zInt(),
});
type UpgradeStructureState = z.infer<typeof UpgradeStructureStateSchema>;

export const UpgradeStructureExecutionSnapshot = execSnapshotType({
  name: "UpgradeStructure",
  version: 2,
  schema: UpgradeStructureStateSchema,
  cls: () => UpgradeStructureExecution,
  migrations: {
    // v1 upgraded at once in init and never stayed alive.
    1: (d) => ({
      ...d,
      path: null,
      active: false,
      initialized: true,
      ticksLeft: 0,
      done: 0,
    }),
  },
});
