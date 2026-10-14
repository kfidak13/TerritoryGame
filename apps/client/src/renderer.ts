import { Terrain, type Game } from "@borderfall/engine";
import { Application, CanvasSource, Container, Graphics, Sprite, Texture } from "pixi.js";

const TERRAIN_RGB: Record<number, readonly [number, number, number]> = {
  [Terrain.Ocean]: [22, 46, 77],
  [Terrain.Shallows]: [38, 78, 112],
  [Terrain.Plains]: [126, 160, 92],
  [Terrain.Highlands]: [150, 145, 100],
  [Terrain.Mountains]: [170, 162, 152],
};

const DRAG_THRESHOLD_PX = 4;
const MAX_SCALE = 48;

export interface RendererHandlers {
  onTileClick(tile: number): void;
  onTileHover(tile: number | null): void;
}

/** Draws the tile map into a canvas-backed texture and handles camera pan/zoom. */
export class MapRenderer {
  private readonly world = new Container();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly source: CanvasSource;
  private readonly base: Uint8ClampedArray;
  private readonly hover = new Graphics().rect(0, 0, 1, 1).stroke({ width: 0.15, color: 0xffffff });
  private readonly abort = new AbortController();
  private minScale = 0.1;

  static async create(host: HTMLElement, game: Game, handlers: RendererHandlers) {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: 0x0b1320,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    host.appendChild(app.canvas);
    return new MapRenderer(app, game, handlers);
  }

  private constructor(
    private readonly app: Application,
    private readonly game: Game,
    private readonly handlers: RendererHandlers,
  ) {
    const { width, height } = game.map;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    this.ctx = canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(width, height);
    this.base = this.buildTerrainColors();
    this.source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });

    this.world.addChild(new Sprite(new Texture({ source: this.source })));
    this.hover.visible = false;
    this.world.addChild(this.hover);
    app.stage.addChild(this.world);

    for (let i = 0; i < game.map.size; i++) this.paintTile(i);
    game.takeChangedTiles();
    this.flush();
    this.fit();
    this.bindInput();
  }

  /** Repaints tiles changed by the simulation since the last call. */
  update(): void {
    const changed = this.game.takeChangedTiles();
    if (changed.length === 0) return;
    const { map } = this.game;
    for (const tile of changed) {
      this.paintTile(tile);
      map.forEachNeighbor(tile, (n) => this.paintTile(n));
    }
    this.flush();
  }

  /** Screen-space (CSS px) center of a tile. */
  tileToScreen(tile: number): { x: number; y: number } {
    const s = this.world.scale.x;
    return {
      x: this.world.x + (this.game.map.x(tile) + 0.5) * s,
      y: this.world.y + (this.game.map.y(tile) + 0.5) * s,
    };
  }

  destroy(): void {
    this.abort.abort();
    this.app.destroy(true, { children: true, texture: true });
  }

  private buildTerrainColors(): Uint8ClampedArray {
    const { terrain } = this.game.map;
    const out = new Uint8ClampedArray(terrain.length * 3);
    for (let i = 0; i < terrain.length; i++) {
      const [r, g, b] = TERRAIN_RGB[terrain[i]!]!;
      // Cheap per-tile hash for a subtle grain so flat terrain doesn't look like a solid fill.
      const h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) >>> 24;
      const shade = 0.94 + (h / 255) * 0.12;
      out[i * 3] = r * shade;
      out[i * 3 + 1] = g * shade;
      out[i * 3 + 2] = b * shade;
    }
    return out;
  }

  private paintTile(tile: number): void {
    const { owner, map } = this.game;
    const o = owner[tile]!;
    const px = this.image.data;
    let r = this.base[tile * 3]!;
    let g = this.base[tile * 3 + 1]!;
    let b = this.base[tile * 3 + 2]!;
    if (o !== 0) {
      const color = this.game.player(o)!.color;
      const pr = (color >> 16) & 0xff;
      const pg = (color >> 8) & 0xff;
      const pb = color & 0xff;
      let border = false;
      map.forEachNeighbor(tile, (n) => {
        if (owner[n] !== o) border = true;
      });
      if (border) {
        r = pr * 0.7;
        g = pg * 0.7;
        b = pb * 0.7;
      } else {
        r = r * 0.45 + pr * 0.55;
        g = g * 0.45 + pg * 0.55;
        b = b * 0.45 + pb * 0.55;
      }
    }
    const p = tile * 4;
    px[p] = r;
    px[p + 1] = g;
    px[p + 2] = b;
    px[p + 3] = 255;
  }

  private flush(): void {
    this.ctx.putImageData(this.image, 0, 0);
    this.source.update();
  }

  private fit(): void {
    const { width, height } = this.game.map;
    const { width: sw, height: sh } = this.app.screen;
    const scale = Math.min(sw / width, sh / height) * 0.95;
    this.minScale = scale * 0.5;
    this.world.scale.set(scale);
    this.world.position.set((sw - width * scale) / 2, (sh - height * scale) / 2);
  }

  private tileAt(sx: number, sy: number): number | null {
    const x = Math.floor((sx - this.world.x) / this.world.scale.x);
    const y = Math.floor((sy - this.world.y) / this.world.scale.y);
    return this.game.map.inBounds(x, y) ? this.game.map.tile(x, y) : null;
  }

  private bindInput(): void {
    const el = this.app.canvas;
    const signal = this.abort.signal;
    let down: { x: number; y: number; wx: number; wy: number } | null = null;
    let dragging = false;

    el.addEventListener(
      "pointerdown",
      (e) => {
        el.setPointerCapture(e.pointerId);
        down = { x: e.offsetX, y: e.offsetY, wx: this.world.x, wy: this.world.y };
        dragging = false;
      },
      { signal },
    );

    el.addEventListener(
      "pointermove",
      (e) => {
        if (down) {
          const dx = e.offsetX - down.x;
          const dy = e.offsetY - down.y;
          if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragging = true;
          if (dragging) this.world.position.set(down.wx + dx, down.wy + dy);
        }
        this.setHover(this.tileAt(e.offsetX, e.offsetY));
      },
      { signal },
    );

    el.addEventListener(
      "pointerup",
      (e) => {
        if (down && !dragging) {
          const tile = this.tileAt(e.offsetX, e.offsetY);
          if (tile !== null) this.handlers.onTileClick(tile);
        }
        down = null;
      },
      { signal },
    );

    el.addEventListener("pointerleave", () => this.setHover(null), { signal });

    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const old = this.world.scale.x;
        const next = Math.min(
          MAX_SCALE,
          Math.max(this.minScale, old * Math.pow(1.0015, -e.deltaY)),
        );
        const k = next / old;
        this.world.scale.set(next);
        this.world.position.set(
          e.offsetX - (e.offsetX - this.world.x) * k,
          e.offsetY - (e.offsetY - this.world.y) * k,
        );
      },
      { signal, passive: false },
    );
  }

  private setHover(tile: number | null): void {
    this.hover.visible = tile !== null;
    if (tile !== null) this.hover.position.set(this.game.map.x(tile), this.game.map.y(tile));
    this.handlers.onTileHover(tile);
  }
}
