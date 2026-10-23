import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  DisasterKind,
  GOODS,
  GoodsAmounts,
  MessageType,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { AdminAction } from "@openfront/engine-api/Schemas";
import {
  ZOMBIE_MIN_PATCH_RADIUS,
  ZOMBIE_NAME,
  ZOMBIE_PATCH_RADIUS,
  ZOMBIE_ROT_AFTER_TICKS,
  ZOMBIE_SHIELD_TICKS,
  ZOMBIE_START_TROOPS,
  ZOMBIE_TROOPS_PER_TILE,
  ZOMBIE_VICTIM_LOSS,
} from "@openfront/engine-lib/game/Zombies";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { structureExecution } from "../ConstructionExecution";
import { DisasterExecution } from "../DisasterExecution";
import { NukeExecution } from "../NukeExecution";
import { PlayerExecution } from "../PlayerExecution";
import { WarshipExecution } from "../WarshipExecution";
import { HeavenlyNukeExecution } from "./HeavenlyNukeExecution";
import { ZombieExecution } from "./ZombieExecution";

const DIPLOMACY_MESSAGES = {
  ally: "events_display.divine_ally",
  break: "events_display.divine_break",
  embargo: "events_display.divine_embargo",
  unembargo: "events_display.divine_unembargo",
  pact: "events_display.divine_pact",
  end_pact: "events_display.divine_end_pact",
} as const;

/** Land a revived player comes back with: a disc this wide. */
const REVIVE_RADIUS = 8;

/**
 * Borderfall admin powers. The server only relays an "admin" intent from a
 * client that proved the admin key, so this trusts it. Runs once, on the
 * tick after it arrives. Victims hear of it as acts of the gods, never by
 * the admin's name.
 */
export class AdminExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private admin: Player,
    private action: AdminAction,
  ) {}

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
    this.active = false;
    const a = this.action;
    switch (a.kind) {
      case "resources":
        return this.resources(a.target, a.gold, a.troops, a.goods);
      case "god":
        this.admin.setGod(a.enabled);
        return;
      case "spawn":
        return this.spawn(a.unit, a.tile, a.owner, a.level);
      case "paint":
        return this.paint(a.tile, a.radius, a.owner);
      case "smite":
        return this.smite(a.nuke, a.tile);
      case "disaster":
        return this.disaster(a.disaster, a.tile, ticks);
      case "puppet":
        return this.puppet(a.nation, a.target);
      case "diplomacy":
        return this.diplomacy(a.a, a.b, a.op);
      case "eliminate":
        return this.eliminate(a.target);
      case "revive":
        return this.revive(a.target, a.tile);
      case "zombies":
        return this.zombies(a.target, ticks);
      case "heavenly":
        return this.heavenly();
    }
  }

  private player(id: string): Player | null {
    const mg = this.mg!;
    return mg.hasPlayer(id) ? mg.player(id) : null;
  }

  private tell(
    player: Player | null,
    key: string,
    params: Record<string, string | number> = {},
  ): void {
    this.mg!.displayMessage(
      key,
      MessageType.DIVINE,
      player?.id() ?? null,
      undefined,
      params,
    );
  }

  private resources(
    id: string,
    gold: number,
    troops: number,
    goods: GoodsAmounts,
  ): void {
    const p = this.player(id);
    if (p === null) return;
    if (gold > 0) p.addGold(BigInt(Math.round(gold)));
    if (gold < 0) p.removeGold(BigInt(Math.round(-gold)));
    // Granted troops raise the cap too, or the next tick would trim them.
    if (troops > 0) {
      p.setTroopBonus(p.troopBonus() + troops);
      p.addTroops(troops);
    }
    if (troops < 0) {
      const taken = p.removeTroops(-troops);
      p.setTroopBonus(p.troopBonus() - taken);
    }
    const add = goods.map((g) => Math.max(0, g)) as GoodsAmounts;
    const take = GOODS.map((g) =>
      Math.min(p.goods()[g], Math.max(0, -goods[g])),
    ) as GoodsAmounts;
    p.grantGoods(add);
    p.removeGoods(take);
    const taking = gold < 0 || troops < 0 || goods.some((g) => g < 0);
    this.tell(
      p,
      taking ? "events_display.divine_taken" : "events_display.divine_blessed",
    );
  }

  private spawn(type: UnitType, tile: TileRef, ownerID: string, level: number) {
    const mg = this.mg!;
    const owner = this.player(ownerID);
    if (owner === null || !mg.isValidRef(tile)) return;
    if (type === UnitType.Warship) {
      if (!mg.isWater(tile)) return;
      const ship = owner.buildUnit(UnitType.Warship, tile, {
        patrolTile: tile,
      });
      mg.addExecution(new WarshipExecution(ship));
      return;
    }
    if (!Structures.has(type)) return;
    // Rigs stand at sea; everything else on the owner's land, which the
    // gods hand over first if need be.
    if (type === UnitType.OilRig) {
      if (!mg.isOcean(tile)) return;
    } else {
      if (!mg.isLand(tile) || mg.isImpassable(tile)) return;
      if (mg.owner(tile) !== owner) owner.conquer(tile);
      if (mg.owner(tile) !== owner) return;
    }
    const unit = owner.buildUnit(type, tile, {});
    if (mg.config().unitInfo(type).upgradable === true) {
      for (let i = 1; i < level; i++) unit.increaseLevel();
    }
    const exec = structureExecution(unit, owner);
    if (exec !== null) mg.addExecution(exec);
  }

  private paint(center: TileRef, radius: number, ownerID: string | null) {
    const mg = this.mg!;
    const owner = ownerID === null ? null : this.player(ownerID);
    if (ownerID !== null && owner === null) return;
    const touched = new Set<Player>();
    forEachInDisc(mg, center, radius, (t) => {
      if (!mg.isLand(t) || mg.isImpassable(t)) return;
      const prev = mg.owner(t);
      if (prev === owner) return;
      if (prev.isPlayer()) touched.add(prev as Player);
      if (owner !== null) owner.conquer(t);
      else if (prev.isPlayer()) (prev as Player).relinquish(t);
    });
    for (const p of touched) this.tell(p, "events_display.divine_borders");
  }

  private smite(
    nuke: UnitType.AtomBomb | UnitType.HydrogenBomb,
    tile: TileRef,
  ) {
    const mg = this.mg!;
    if (!mg.isValidRef(tile)) return;
    mg.addExecution(
      new NukeExecution(nuke, this.admin, tile, null, -1, 0, true, true),
    );
    const victim = mg.owner(tile);
    if (victim.isPlayer())
      this.tell(victim as Player, "events_display.divine_smite");
  }

  private disaster(kind: DisasterKind, tile: TileRef, ticks: number): void {
    const mg = this.mg!;
    if (!mg.isValidRef(tile)) return;
    if (kind === DisasterKind.Heavenly) return this.heavenly();
    if (kind === DisasterKind.Zombies) {
      const owner = mg.owner(tile);
      if (owner.isPlayer()) this.zombies((owner as Player).id(), ticks);
      return;
    }
    const exec = new DisasterExecution(
      simpleHash(`admin:${ticks}:${tile}`),
      false,
    );
    exec.queue(kind, tile);
    mg.addExecution(exec);
  }

  private puppet(nationID: string, targetID: string): void {
    const nation = this.player(nationID);
    const target = this.player(targetID);
    if (nation === null || target === null || nation === target) return;
    nation.allianceWith(target)?.expire();
    this.mg!.addExecution(
      new AttackExecution(nation.troops() / 2, nation, target.id()),
    );
    this.tell(target, "events_display.divine_puppet", {
      name: nation.displayName(),
    });
  }

  private diplomacy(
    aID: string,
    bID: string,
    op: "ally" | "break" | "embargo" | "unembargo" | "pact" | "end_pact",
  ): void {
    const mg = this.mg!;
    const a = this.player(aID);
    const b = this.player(bID);
    if (a === null || b === null || a === b) return;
    switch (op) {
      case "ally":
        if (a.allianceWith(b) === null) mg.createAlliance(a, b);
        break;
      case "break":
        a.allianceWith(b)?.expire();
        break;
      case "embargo":
        a.addEmbargo(b, false);
        b.addEmbargo(a, false);
        break;
      case "unembargo":
        a.stopEmbargo(b);
        b.stopEmbargo(a);
        break;
      case "pact":
        if (!a.hasTradePactWith(b)) a.addTradePact(b);
        break;
      case "end_pact":
        a.endTradePact(b);
        break;
    }
    this.tell(a, DIPLOMACY_MESSAGES[op], { name: b.displayName() });
    this.tell(b, DIPLOMACY_MESSAGES[op], { name: a.displayName() });
  }

  private eliminate(id: string): void {
    const p = this.player(id);
    if (p === null || !p.isAlive()) return;
    for (const t of [...p.tiles()]) p.relinquish(t);
    for (const u of p.units()) u.delete(false);
    this.tell(null, "events_display.divine_eliminated", {
      name: p.displayName(),
    });
  }

  private revive(id: string, tile: TileRef): void {
    const mg = this.mg!;
    const p = this.player(id);
    if (p === null || !mg.isValidRef(tile)) return;
    const wasAlive = p.isAlive();
    forEachInDisc(mg, tile, REVIVE_RADIUS, (t) => {
      if (mg.isLand(t) && !mg.isImpassable(t)) p.conquer(t);
    });
    if (!p.isAlive()) return;
    p.setTroops(Math.max(p.troops(), mg.config().maxTroops(p) / 2));
    if (!wasAlive) {
      // Its PlayerExecution ended when it died.
      mg.addExecution(new PlayerExecution(p));
      this.tell(null, "events_display.divine_revived", {
        name: p.displayName(),
      });
    }
  }

  /** The whole map is wiped (HeavenlyNukeExecution). */
  private heavenly(): void {
    const mg = this.mg!;
    mg.addExecution(new HeavenlyNukeExecution());
    mg.addUpdate({
      type: GameUpdateType.Disaster,
      kind: DisasterKind.Heavenly,
      tile: mg.ref(Math.floor(mg.width() / 2), Math.floor(mg.height() / 2)),
      radius: Math.max(mg.width(), mg.height()),
    });
    this.tell(null, "events_display.divine_heavenly");
  }

  /** A zombie horde rises in the middle of the victim's land. */
  private zombies(victimID: string, ticks: number): void {
    const mg = this.mg!;
    const victim = this.player(victimID);
    if (victim === null || !victim.isAlive() || victim.isGod()) return;
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
    mg.addExecution(
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
    this.tell(null, "events_display.zombie_apocalypse", {
      name: victim.displayName(),
    });
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AdminExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      admin: w.player(this.admin),
      action: JSON.stringify(this.action),
    });
  }

  restoreSnapshot(s: AdminState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.admin = r.player(s.admin);
    this.action = JSON.parse(s.action) as AdminAction;
  }
}

/** The victim's tile nearest the middle of its land. */
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

function forEachInDisc(
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

const AdminStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  admin: zPlayerRef(),
  // The intent's action as given, already validated on the way in.
  action: z.string(),
});
type AdminState = z.infer<typeof AdminStateSchema>;

export const AdminExecutionSnapshot = execSnapshotType({
  name: "Admin",
  version: 1,
  schema: AdminStateSchema,
  cls: () => AdminExecution,
});
