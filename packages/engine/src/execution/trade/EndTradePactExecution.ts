import { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";

/** Either partner ends a Borderfall trade pact. */
export class EndTradePactExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private partnerID: PlayerID,
  ) {}

  init(mg: Game, _: number): void {
    if (mg.hasPlayer(this.partnerID)) {
      this.player.endTradePact(mg.player(this.partnerID));
    }
    this.active = false;
  }

  tick(_: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return EndTradePactExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      partnerID: this.partnerID,
    });
  }

  restoreSnapshot(s: EndTradePactState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.partnerID = s.partnerID;
  }
}

const EndTradePactStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  partnerID: z.string(),
});
type EndTradePactState = z.infer<typeof EndTradePactStateSchema>;

export const EndTradePactExecutionSnapshot = execSnapshotType({
  name: "EndTradePact",
  version: 1,
  schema: EndTradePactStateSchema,
  cls: () => EndTradePactExecution,
});
