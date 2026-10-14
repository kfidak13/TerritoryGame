import { isLand } from "./terrain.ts";

/** Tiles are addressed by a flat index: tile = y * width + x. */
export class GameMap {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly terrain: Uint8Array,
  ) {
    if (terrain.length !== width * height) throw new Error("terrain size mismatch");
  }

  get size(): number {
    return this.terrain.length;
  }

  tile(x: number, y: number): number {
    return y * this.width + x;
  }

  x(tile: number): number {
    return tile % this.width;
  }

  y(tile: number): number {
    return Math.floor(tile / this.width);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isValidTile(tile: number): boolean {
    return Number.isInteger(tile) && tile >= 0 && tile < this.size;
  }

  isLand(tile: number): boolean {
    return isLand(this.terrain[tile]!);
  }

  /** Calls fn for each orthogonal neighbor of tile. */
  forEachNeighbor(tile: number, fn: (neighbor: number) => void): void {
    const x = this.x(tile);
    const y = this.y(tile);
    if (x > 0) fn(tile - 1);
    if (x < this.width - 1) fn(tile + 1);
    if (y > 0) fn(tile - this.width);
    if (y < this.height - 1) fn(tile + this.width);
  }
}
