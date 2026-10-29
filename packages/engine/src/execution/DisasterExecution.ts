import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  DisasterKind,
  MessageType,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { renderTroops } from "@openfront/engine-lib/Format";
import {
  BUILDING_DAMAGE_CHANCE,
  DISASTER_GRACE_TICKS,
  DISASTER_MEAN_TICKS,
  DROUGHT_RADIUS,
  DROUGHT_TICKS,
  EARTHQUAKE_RADIUS,
  EARTHQUAKE_TROOP_LOSS,
  HUMAN_DISASTER_SHARE,
  HURRICANE_RADIUS,
  HURRICANE_RIG_DAMAGE,
  HURRICANE_SHIP_DAMAGE,
  HURRICANE_TROOP_LOSS,
  OUTBREAK_CHECK_TICKS,
  OUTBREAK_TICKS,
  OUTBREAK_TROOP_DRAIN_PER_TICK,
  outbreakChance,
  POLLUTION_RADIUS,
  pollutionLevels,
  TORNADO_RADIUS,
  TORNADO_SPEED,
  TORNADO_TICKS,
  TORNADO_TROOP_LOSS,
  ZOMBIE_DISASTER_CHANCE,
} from "@openfront/engine-lib/game/Disasters";
import { regionSize } from "@openfront/engine-lib/game/Goods";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRandom,
  zRef,
  zTiles,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { raiseZombies } from "./admin/ZombieExecution";

const DISASTERS = [
  DisasterKind.Earthquake,
  DisasterKind.Hurricane,
  DisasterKind.Drought,
  DisasterKind.Tornado,
] as const;
type Disaster = (typeof DISASTERS)[number];

interface Tornado {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ticksLeft: number;
  hitTiles: Set<TileRef>;
  hitUnits: Set<Unit>;
  /** Troops killed and buildings wrecked, per player, in first-hit order. */
  losses: Map<Player, { troops: number; buildings: number }>;
}

interface Outbreak {
  player: Player;
  tile: TileRef;
  until: number;
}

/**
 * Borderfall disasters and disease (engine-lib/game/Disasters.ts). One per
 * game, added by GameRunner when the lobby turns disasters on.
 */
export class DisasterExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private random: PseudoRandom;
  /** When the post-spawn grace ends; set on the first tick after spawn. */
  private quietUntil: number | null = null;
  /** Disrupted buildings and the tick each recovers, in insertion order. */
  private disrupted = new Map<Unit, number>();
  private outbreaks: Outbreak[] = [];
  private tornadoes: Tornado[] = [];
  /** Admin-summoned strikes waiting for the next tick. */
  private queued: { kind: DisasterKind; tile: TileRef }[] = [];

  /**
   * `scheduled`: strike at random and check for disease (the lobby option).
   * Off for an admin's summons: it strikes only what is queued, and stops
   * once nothing it started is still running.
   */
  constructor(
    seed: number,
    private scheduled = true,
  ) {
    this.random = new PseudoRandom(seed);
  }

  /** Sets a disaster (or an outbreak among the tile owner's cities) off next tick. */
  queue(kind: DisasterKind, tile: TileRef): void {
    this.queued.push({ kind, tile });
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    this.quietUntil ??= ticks + DISASTER_GRACE_TICKS;

    for (const [unit, until] of this.disrupted) {
      if (!unit.isActive()) {
        this.disrupted.delete(unit);
      } else if (until <= ticks) {
        unit.setDisrupted(false);
        this.disrupted.delete(unit);
      }
    }

    this.outbreaks = this.outbreaks.filter(
      (o) => o.until > ticks && o.player.isAlive(),
    );
    for (const o of this.outbreaks) {
      o.player.removeTroops(o.player.troops() * OUTBREAK_TROOP_DRAIN_PER_TICK);
    }

    for (const t of this.tornadoes) this.moveTornado(t);
    this.tornadoes = this.tornadoes.filter((t) => {
      if (t.ticksLeft > 0) return true;
      this.reportTornado(t);
      return false;
    });

    for (const { kind, tile } of this.queued.splice(0)) {
      const owner = mg.owner(tile);
      if (kind === DisasterKind.Outbreak) {
        if (owner.isPlayer()) this.outbreak(owner as Player, tile, ticks);
      } else if ((DISASTERS as readonly DisasterKind[]).includes(kind)) {
        this.strike(kind as Disaster, tile);
      }
    }

    if (!this.scheduled) {
      if (
        this.disrupted.size === 0 &&
        this.outbreaks.length === 0 &&
        this.tornadoes.length === 0
      ) {
        this.active = false;
      }
      return;
    }

    if (ticks % OUTBREAK_CHECK_TICKS === 0) {
      for (const player of mg.players()) this.checkOutbreak(player, ticks);
    }

    if (
      ticks >= this.quietUntil &&
      this.random.next() < 1 / DISASTER_MEAN_TICKS
    ) {
      if (this.random.next() < ZOMBIE_DISASTER_CHANCE) {
        const tile = this.pickTile(DisasterKind.Earthquake);
        if (tile !== null) raiseZombies(mg, mg.owner(tile) as Player, ticks);
        return;
      }
      const kind = this.random.randElement([...DISASTERS]);
      const tile = this.pickTile(kind);
      if (tile !== null) this.strike(kind, tile);
    }
  }

  /** A random tile the disaster can hit; null if none turns up. */
  private pickTile(kind: Disaster): TileRef | null {
    const mg = this.mg!;
    // Borderfall: most disasters go for a person, so players meet them.
    const humans = mg
      .players()
      .filter((p) => p.type() === PlayerType.Human && p.isAlive());
    if (humans.length > 0 && this.random.next() < HUMAN_DISASTER_SHARE) {
      const p = this.random.randElement(humans);
      const tiles =
        kind === DisasterKind.Hurricane
          ? [...p.borderTiles()].filter((t) => mg.isOceanShore(t))
          : [...p.tiles()];
      if (tiles.length > 0) return this.random.randElement(tiles);
    }
    const fits =
      kind === DisasterKind.Hurricane
        ? (t: TileRef) => mg.isOceanShore(t)
        : (t: TileRef) => mg.isLand(t) && mg.owner(t).isPlayer();
    for (let i = 0; i < 200; i++) {
      const t = this.random.nextInt(0, mg.width() * mg.height()) as TileRef;
      if (fits(t)) return t;
    }
    return null;
  }

  /** Sets a disaster off at `tile` now. */
  strike(kind: Disaster, tile: TileRef): void {
    switch (kind) {
      case DisasterKind.Earthquake:
        return this.earthquake(tile);
      case DisasterKind.Hurricane:
        return this.hurricane(tile);
      case DisasterKind.Drought:
        return this.drought(tile);
      case DisasterKind.Tornado:
        return this.startTornado(tile);
    }
  }

  private radius(fraction: number): number {
    return Math.max(3, Math.round(regionSize(this.mg!.map()) * fraction));
  }

  private announce(kind: DisasterKind, tile: TileRef, radius: number): void {
    this.mg!.addUpdate({ type: GameUpdateType.Disaster, kind, tile, radius });
  }

  private earthquake(tile: TileRef): void {
    const mg = this.mg!;
    const radius = this.radius(EARTHQUAKE_RADIUS);
    this.announce(DisasterKind.Earthquake, tile, radius);
    const killed = this.killTroops(tile, radius, EARTHQUAKE_TROOP_LOSS);
    const damaged = this.damageBuildings(tile, radius, (u) =>
      mg.isLand(u.tile()),
    );
    for (const p of this.affected(killed, damaged)) {
      this.tell(p, "events_display.disaster_earthquake", {
        troops: renderTroops(killed.get(p) ?? 0),
        buildings: damaged.get(p) ?? 0,
      });
    }
  }

  private hurricane(tile: TileRef): void {
    const mg = this.mg!;
    const radius = this.radius(HURRICANE_RADIUS);
    this.announce(DisasterKind.Hurricane, tile, radius);
    const killed = this.killTroops(tile, radius, HURRICANE_TROOP_LOSS);
    const damaged = this.damageBuildings(
      tile,
      radius,
      (u) => u.type() === UnitType.Port,
    );
    const ships = new Map<Player, number>();
    for (const { unit } of mg.nearbyUnits(tile, radius, [
      UnitType.TransportShip,
      UnitType.TradeShip,
      UnitType.Warship,
      UnitType.OilRig,
    ])) {
      const owner = unit.owner();
      ships.set(owner, (ships.get(owner) ?? 0) + 1);
      if (unit.type() === UnitType.Warship) {
        unit.modifyHealth(-HURRICANE_SHIP_DAMAGE);
      } else if (unit.type() === UnitType.OilRig) {
        unit.modifyHealth(-HURRICANE_RIG_DAMAGE);
      } else {
        unit.delete(true);
      }
    }
    for (const p of this.affected(killed, damaged, ships)) {
      this.tell(p, "events_display.disaster_hurricane", {
        troops: renderTroops(killed.get(p) ?? 0),
        ships: ships.get(p) ?? 0,
        buildings: damaged.get(p) ?? 0,
      });
    }
  }

  private drought(tile: TileRef): void {
    const mg = this.mg!;
    const radius = this.radius(DROUGHT_RADIUS);
    this.announce(DisasterKind.Drought, tile, radius);
    const farms = new Map<Player, number>();
    for (const { unit } of mg.nearbyUnits(tile, radius, UnitType.Farm)) {
      this.disrupt(unit, mg.ticks() + DROUGHT_TICKS);
      farms.set(unit.owner(), (farms.get(unit.owner()) ?? 0) + 1);
    }
    for (const [p, n] of farms) {
      this.tell(p, "events_display.disaster_drought", { farms: n });
    }
  }

  private startTornado(tile: TileRef): void {
    const mg = this.mg!;
    let dx = this.random.nextFloat(-1, 1);
    let dy = this.random.nextFloat(-1, 1);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    this.tornadoes.push({
      x: mg.x(tile),
      y: mg.y(tile),
      dx,
      dy,
      ticksLeft: TORNADO_TICKS,
      hitTiles: new Set(),
      hitUnits: new Set(),
      losses: new Map(),
    });
  }

  private moveTornado(t: Tornado): void {
    const mg = this.mg!;
    t.ticksLeft--;
    // Wander: nudge the heading a little each tick.
    t.dx += this.random.nextFloat(-0.15, 0.15);
    t.dy += this.random.nextFloat(-0.15, 0.15);
    const len = Math.sqrt(t.dx * t.dx + t.dy * t.dy) || 1;
    t.dx /= len;
    t.dy /= len;
    t.x += t.dx * TORNADO_SPEED;
    t.y += t.dy * TORNADO_SPEED;
    const cx = Math.round(t.x);
    const cy = Math.round(t.y);
    if (!mg.isValidCoord(cx, cy)) {
      t.ticksLeft = 0;
      return;
    }
    const center = mg.ref(cx, cy);
    const radius = this.radius(TORNADO_RADIUS);
    if (t.ticksLeft % 5 === 0) {
      this.announce(DisasterKind.Tornado, center, radius);
    }
    const loss = (p: Player) => {
      let l = t.losses.get(p);
      if (l === undefined) {
        l = { troops: 0, buildings: 0 };
        t.losses.set(p, l);
      }
      return l;
    };
    this.forEachInDisc(center, radius, (tile) => {
      if (t.hitTiles.has(tile)) return;
      t.hitTiles.add(tile);
      const owner = mg.owner(tile);
      if (!owner.isPlayer() || !mg.isLand(tile)) return;
      const p = owner as Player;
      loss(p).troops += p.removeTroops(
        (p.troops() * TORNADO_TROOP_LOSS) / Math.max(1, p.numTilesOwned()),
      );
    });
    for (const { unit } of mg.nearbyUnits(center, radius, Structures.types)) {
      if (t.hitUnits.has(unit) || !mg.isLand(unit.tile())) continue;
      t.hitUnits.add(unit);
      loss(unit.owner()).buildings++;
      unit.decreaseLevel();
    }
  }

  private reportTornado(t: Tornado): void {
    for (const [p, l] of t.losses) {
      if (!p.isAlive()) continue;
      this.tell(p, "events_display.disaster_tornado", {
        troops: renderTroops(l.troops),
        buildings: l.buildings,
      });
    }
  }

  /**
   * Disease: roll once for the player's city with the most of their
   * industry nearby; an outbreak stops the cities around it and drains
   * troops.
   */
  private checkOutbreak(player: Player, ticks: number): void {
    const mg = this.mg!;
    if (player.type() === PlayerType.Bot) return;
    let worst: Unit | null = null;
    let worstLevels = 0;
    for (const city of player.units(UnitType.City)) {
      if (city.isUnderConstruction() || city.isDisrupted()) continue;
      const levels = pollutionLevels(mg, player, city.tile());
      if (levels > worstLevels) {
        worst = city;
        worstLevels = levels;
      }
    }
    if (worst === null) return;
    if (this.random.next() >= outbreakChance(worstLevels)) return;
    this.outbreak(player, worst.tile(), ticks);
  }

  /** Starts an outbreak in the player's cities around `tile`. */
  outbreak(player: Player, tile: TileRef, ticks: number): void {
    const mg = this.mg!;
    const until = ticks + OUTBREAK_TICKS;
    let sick = 0;
    for (const { unit } of mg.nearbyUnits(
      tile,
      POLLUTION_RADIUS,
      UnitType.City,
    )) {
      if (unit.owner() !== player) continue;
      this.disrupt(unit, until);
      sick++;
    }
    this.outbreaks.push({ player, tile, until });
    this.announce(DisasterKind.Outbreak, tile, POLLUTION_RADIUS);
    this.tell(player, "events_display.disease_outbreak", { cities: sick });
  }

  private disrupt(unit: Unit, until: number): void {
    unit.setDisrupted(true);
    this.disrupted.set(unit, Math.max(until, this.disrupted.get(unit) ?? 0));
  }

  /** Kills each owner's troops in the disc, by the share of land it covers. */
  private killTroops(
    center: TileRef,
    radius: number,
    share: number,
  ): Map<Player, number> {
    const mg = this.mg!;
    const tiles = new Map<Player, number>();
    this.forEachInDisc(center, radius, (t) => {
      const owner = mg.owner(t);
      if (owner.isPlayer() && mg.isLand(t)) {
        tiles.set(owner as Player, (tiles.get(owner as Player) ?? 0) + 1);
      }
    });
    const killed = new Map<Player, number>();
    for (const [p, n] of tiles) {
      const covered = Math.min(1, n / Math.max(1, p.numTilesOwned()));
      killed.set(p, p.removeTroops(p.troops() * share * covered));
    }
    return killed;
  }

  /** Knocks a level off (or flattens) each fitting building, by chance. */
  private damageBuildings(
    center: TileRef,
    radius: number,
    fits: (u: Unit) => boolean,
  ): Map<Player, number> {
    const damaged = new Map<Player, number>();
    for (const { unit } of this.mg!.nearbyUnits(
      center,
      radius,
      Structures.types,
    )) {
      if (!fits(unit) || this.random.next() >= BUILDING_DAMAGE_CHANCE) {
        continue;
      }
      damaged.set(unit.owner(), (damaged.get(unit.owner()) ?? 0) + 1);
      unit.decreaseLevel();
    }
    return damaged;
  }

  /** Living players in any of the maps, each once, in first-seen order. */
  private affected(...maps: Map<Player, number>[]): Player[] {
    const seen = new Set<Player>();
    for (const m of maps) for (const p of m.keys()) seen.add(p);
    return [...seen].filter((p) => p.isAlive());
  }

  private tell(
    player: Player,
    key: string,
    params: Record<string, string | number>,
  ): void {
    this.mg!.displayMessage(
      key,
      MessageType.DISASTER,
      player.id(),
      undefined,
      params,
    );
  }

  private forEachInDisc(
    center: TileRef,
    radius: number,
    fn: (t: TileRef) => void,
  ): void {
    const mg = this.mg!;
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

  snapshot(w: SnapshotWriter): ExecRecord {
    const live = [...this.disrupted].filter(([u]) => u.isActive());
    return DisasterExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      random: w.random(this.random),
      scheduled: this.scheduled,
      queued: this.queued.map((q) => ({ kind: q.kind, tile: q.tile })),
      quietUntil: this.quietUntil,
      disruptedUnits: live.map(([u]) => w.unit(u)),
      disruptedUntil: live.map(([, until]) => until),
      outbreaks: this.outbreaks.map((o) => ({
        player: w.player(o.player),
        tile: o.tile,
        until: o.until,
      })),
      tornadoes: this.tornadoes.map((t) => ({
        x: t.x,
        y: t.y,
        dx: t.dx,
        dy: t.dy,
        ticksLeft: t.ticksLeft,
        hitTiles: w.tiles(t.hitTiles),
        hitUnits: [...t.hitUnits]
          .filter((u) => u.isActive())
          .map((u) => w.unit(u)),
        lossPlayers: [...t.losses.keys()].map((p) => w.player(p)),
        lossTroops: [...t.losses.values()].map((l) => l.troops),
        lossBuildings: [...t.losses.values()].map((l) => l.buildings),
      })),
    });
  }

  restoreSnapshot(s: DisasterState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.random = r.random(s.random);
    this.scheduled = s.scheduled ?? true;
    this.queued = (s.queued ?? []).map((q) => ({
      kind: q.kind as DisasterKind,
      tile: q.tile,
    }));
    this.quietUntil = s.quietUntil;
    this.disrupted = new Map(
      s.disruptedUnits.map((u, i) => [r.unit(u), s.disruptedUntil[i]]),
    );
    this.outbreaks = s.outbreaks.map((o) => ({
      player: r.player(o.player),
      tile: o.tile,
      until: o.until,
    }));
    this.tornadoes = s.tornadoes.map((t) => ({
      x: t.x,
      y: t.y,
      dx: t.dx,
      dy: t.dy,
      ticksLeft: t.ticksLeft,
      hitTiles: new Set(t.hitTiles),
      hitUnits: new Set(t.hitUnits.map((u) => r.unit(u))),
      losses: new Map(
        t.lossPlayers.map((p, i) => [
          r.player(p),
          { troops: t.lossTroops[i], buildings: t.lossBuildings[i] },
        ]),
      ),
    }));
  }
}

const DisasterStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  random: zRandom(),
  scheduled: z.boolean().optional(),
  queued: z.array(z.object({ kind: z.string(), tile: zInt() })).optional(),
  quietUntil: zInt().nullable(),
  disruptedUnits: z.array(zRef()),
  disruptedUntil: z.array(zInt()),
  outbreaks: z.array(
    z.object({ player: zPlayerRef(), tile: zInt(), until: zInt() }),
  ),
  tornadoes: z.array(
    z.object({
      x: zNum(),
      y: zNum(),
      dx: zNum(),
      dy: zNum(),
      ticksLeft: zInt(),
      hitTiles: zTiles(),
      hitUnits: z.array(zRef()),
      lossPlayers: z.array(zPlayerRef()),
      lossTroops: z.array(zNum()),
      lossBuildings: z.array(zInt()),
    }),
  ),
});
type DisasterState = z.infer<typeof DisasterStateSchema>;

export const DisasterExecutionSnapshot = execSnapshotType({
  name: "Disaster",
  version: 1,
  schema: DisasterStateSchema,
  cls: () => DisasterExecution,
});
