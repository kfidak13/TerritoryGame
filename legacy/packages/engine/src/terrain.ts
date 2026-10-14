export const Terrain = {
  Ocean: 0,
  Shallows: 1,
  Plains: 2,
  Highlands: 3,
  Mountains: 4,
} as const;

export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.Ocean]: "Ocean",
  [Terrain.Shallows]: "Shallows",
  [Terrain.Plains]: "Plains",
  [Terrain.Highlands]: "Highlands",
  [Terrain.Mountains]: "Mountains",
};

export const isLand = (t: number): boolean => t >= Terrain.Plains;
