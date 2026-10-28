import { GameMap, TileRef } from "./GameMap";
import {
  Gold,
  GoodsAmounts,
  PlayerID,
  PlayerType,
  TerraNullius,
  UnitType,
} from "./GameTypes";

/*
 * Read-only views of game state that rules code (Config, UnitGrid,
 * execution/NukeAlliance) runs on. The engine's Player/Unit/Game and the client's
 * PlayerView/UnitView/GameView both satisfy them, so the same rules run on
 * either side without the rules importing the engine or the client.
 *
 * Each interface lists exactly the members rules code calls. Add a member
 * only when a rule needs it, and implement it on both sides.
 */

export interface PlayerLike {
  /** Borderfall admin: troops granted on top of the usual cap (Config.maxTroops). */
  troopBonus?(): number;
  id(): PlayerID;
  smallID(): number;
  isPlayer(): boolean;
  type(): PlayerType;
  isLobbyCreator(): boolean;
  numTilesOwned(): number;
  troops(): number;
  gold(): Gold;
  units(type: UnitType): readonly UnitLike[];
  /** Borderfall: stockpiled goods, indexed by Good. */
  goods(): Readonly<GoodsAmounts>;
  /** Borderfall: owned deposit tiles per good, indexed by Good. */
  deposits(): Readonly<GoodsAmounts>;
  /** Borderfall: goods the owned deposits produce per tick, by Good. */
  goodsIncome(): GoodsAmounts;
}

export interface UnitLike {
  type(): UnitType;
  owner(): PlayerLike;
  tile(): TileRef;
  lastTile(): TileRef;
  isActive(): boolean;
  isUnderConstruction(): boolean;
  /** Borderfall: struck by disease or drought, so it produces nothing. */
  isDisrupted(): boolean;
  level(): number;
  /** Borderfall: upgrade tier on each path (engine-lib/game/Upgrades). */
  tiers(): readonly number[];
}

export interface GameLike extends GameMap {
  owner(ref: TileRef): PlayerLike | TerraNullius;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: UnitLike) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitLike; distSquared: number }>;
}

/**
 * The read surface of TileSet, mirroring the parts of ReadonlySet that
 * simulation code uses. A native Set<TileRef> also satisfies this interface.
 */
export interface ReadonlyTileSet {
  readonly size: number;
  has(tile: TileRef): boolean;
  forEach(
    callback: (tile: TileRef, tile2: TileRef, set: ReadonlyTileSet) => void,
  ): void;
  values(): IterableIterator<TileRef>;
  [Symbol.iterator](): IterableIterator<TileRef>;
}

export type UnitPredicate = (value: {
  unit: UnitLike;
  distSquared: number;
}) => boolean;
