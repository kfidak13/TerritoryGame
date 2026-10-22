import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { TradeOfferExecution } from "./TradeOfferExecution";

/** A recipient's answer to an open trade offer. */
export class TradeReplyExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private offerID: number,
    private accept: boolean,
  ) {}

  init(mg: Game, _: number): void {
    for (const e of mg.executions()) {
      if (e instanceof TradeOfferExecution && e.id() === this.offerID) {
        e.respond(this.player, this.accept);
      }
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
    return TradeReplyExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      offerID: this.offerID,
      accept: this.accept,
    });
  }

  restoreSnapshot(s: TradeReplyState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.offerID = s.offerID;
    this.accept = s.accept;
  }
}

const TradeReplyStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  offerID: zInt(),
  accept: z.boolean(),
});
type TradeReplyState = z.infer<typeof TradeReplyStateSchema>;

export const TradeReplyExecutionSnapshot = execSnapshotType({
  name: "TradeReply",
  version: 1,
  schema: TradeReplyStateSchema,
  cls: () => TradeReplyExecution,
});
