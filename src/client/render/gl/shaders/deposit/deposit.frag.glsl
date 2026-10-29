#version 300 es
precision highp float;
precision highp usampler2D;

// Borderfall goods deposits (R8UI): 0 = none, else Good + 1
// (engine-lib/game/Goods.ts depositByte).
uniform usampler2D uDeposits;

// Colors indexed by Good: Food, Oil, Metal.
uniform vec3 uColors[3];
// A soft fill over every deposit tile, and a crisp outline round each field.
uniform float uFillAlpha;
uniform float uEdgeAlpha;
uniform float uEdgeWidth; // in tiles
uniform float uZoom;      // CSS pixels per tile

in vec2 vUV;
out vec4 fragColor;

uint depositAt(ivec2 tc) {
  if (tc.x < 0 || tc.y < 0 || tc.x >= MAP_W || tc.y >= MAP_H) return 0u;
  return texelFetch(uDeposits, tc, 0).r;
}

void main() {
  vec2 tilePos = vUV * vec2(float(MAP_W), float(MAP_H));
  ivec2 tc = ivec2(floor(tilePos));
  uint here = depositAt(tc);
  if (here == 0u) discard;

  // Outline: the strip of this tile along any side whose neighbor is
  // another good or none.
  vec2 f = fract(tilePos);
  float w = min(uEdgeWidth, 0.5);
  bool edge =
    (f.x < w && depositAt(tc + ivec2(-1, 0)) != here) ||
    (f.x > 1.0 - w && depositAt(tc + ivec2(1, 0)) != here) ||
    (f.y < w && depositAt(tc + ivec2(0, -1)) != here) ||
    (f.y > 1.0 - w && depositAt(tc + ivec2(0, 1)) != here);
  // Far out a tile is under a pixel; there the outline would swamp the fill.
  float edgeAlpha = edge ? uEdgeAlpha * smoothstep(0.4, 1.5, uZoom) : 0.0;

  fragColor = vec4(uColors[int(here) - 1], max(uFillAlpha, edgeAlpha));
}
