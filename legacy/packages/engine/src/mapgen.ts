import { GameMap } from "./map.ts";
import { Rng } from "./rng.ts";
import { Terrain } from "./terrain.ts";

export interface MapGenOptions {
  width: number;
  height: number;
  seed: number;
  /** Fraction of tiles that end up as water. */
  waterFraction?: number;
}

const HISTOGRAM_BINS = 1024;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * One octave of value noise: random values on a lattice, smoothly interpolated.
 * Only + - * / are used so results are bit-identical across JS engines.
 */
function valueNoise(
  width: number,
  height: number,
  cell: number,
  rng: Rng,
  out: Float64Array,
  amp: number,
) {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Float64Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();

  for (let y = 0; y < height; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy);
    const ty = smoothstep(gy - y0);
    for (let x = 0; x < width; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx);
      const tx = smoothstep(gx - x0);
      const a = grid[y0 * gw + x0]!;
      const b = grid[y0 * gw + x0 + 1]!;
      const c = grid[(y0 + 1) * gw + x0]!;
      const d = grid[(y0 + 1) * gw + x0 + 1]!;
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      out[y * width + x]! += (top + (bottom - top) * ty) * amp;
    }
  }
}

/** Returns the value below which `fraction` of the samples fall (values must be in [0, 1]). */
function quantile(values: Float64Array, mask: (i: number) => boolean, fraction: number): number {
  const bins = new Uint32Array(HISTOGRAM_BINS);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask(i)) continue;
    bins[Math.min(HISTOGRAM_BINS - 1, Math.floor(values[i]! * HISTOGRAM_BINS))]!++;
    count++;
  }
  const target = count * fraction;
  let acc = 0;
  for (let b = 0; b < HISTOGRAM_BINS; b++) {
    acc += bins[b]!;
    if (acc >= target) return (b + 1) / HISTOGRAM_BINS;
  }
  return 1;
}

/** Procedurally generates a continent-style map with ocean around the edges. */
export function generateMap({ width, height, seed, waterFraction = 0.45 }: MapGenOptions): GameMap {
  const rng = new Rng(seed);
  const elevation = new Float64Array(width * height);

  let amp = 1;
  let totalAmp = 0;
  for (let cell = Math.max(width, height) / 4; cell >= 4; cell /= 2) {
    valueNoise(width, height, cell, rng, elevation, amp);
    totalAmp += amp;
    amp *= 0.5;
  }

  // Blend the noise with an elliptical dome so land forms a continent instead of filling the
  // rectangle, then fade to zero at the edges so the border is always ocean.
  const edge = Math.min(width, height) * 0.08;
  for (let y = 0; y < height; y++) {
    const ny = (2 * y) / (height - 1) - 1;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = (2 * x) / (width - 1) - 1;
      const dome = Math.max(0, 1 - (nx * nx + ny * ny) * 0.75);
      const d = Math.min(x, y, width - 1 - x, height - 1 - y) / edge;
      const falloff = d >= 1 ? 1 : smoothstep(d);
      elevation[i] = ((elevation[i]! / totalAmp) * 0.6 + dome * 0.4) * falloff;
    }
  }

  const all = () => true;
  const seaLevel = quantile(elevation, all, waterFraction);
  const shallowLevel = quantile(elevation, (i) => elevation[i]! < seaLevel, 0.8);
  const aboveSea = (i: number) => elevation[i]! >= seaLevel;
  const highlandLevel = quantile(elevation, aboveSea, 0.62);
  const mountainLevel = quantile(elevation, aboveSea, 0.9);

  const terrain = new Uint8Array(width * height);
  for (let i = 0; i < terrain.length; i++) {
    const e = elevation[i]!;
    terrain[i] =
      e < shallowLevel
        ? Terrain.Ocean
        : e < seaLevel
          ? Terrain.Shallows
          : e < highlandLevel
            ? Terrain.Plains
            : e < mountainLevel
              ? Terrain.Highlands
              : Terrain.Mountains;
  }
  return new GameMap(width, height, terrain);
}
