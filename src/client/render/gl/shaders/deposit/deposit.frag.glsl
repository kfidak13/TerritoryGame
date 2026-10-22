#version 300 es
precision highp float;
precision highp usampler2D;

// Borderfall goods deposits (R8UI): 0 = none, else Good + 1
// (engine-lib/game/Goods.ts depositByte).
uniform usampler2D uDeposits;

// Colors indexed by Good: Food, Oil, Metal.
uniform vec3 uColors[3];
// Faint tint over every deposit tile, readable at any zoom.
uniform float uTintAlpha;
// Dots on a sparse lattice (every uDotSpacing tiles) mark deposits once
// zoomed in; one dot per tile would read as noise.
uniform float uDotAlpha;
uniform float uDotRadius;  // in tiles
uniform float uDotSpacing; // in tiles
uniform float uZoom;       // screen pixels per tile
uniform float uDotMinZoom;
uniform float uDotFullZoom;

in vec2 vUV;
out vec4 fragColor;

uint depositAt(vec2 tilePos) {
  ivec2 tc = clamp(ivec2(tilePos), ivec2(0), ivec2(MAP_W - 1, MAP_H - 1));
  return texelFetch(uDeposits, tc, 0).r;
}

void main() {
  vec2 tilePos = vUV * vec2(float(MAP_W), float(MAP_H));
  uint here = depositAt(tilePos);

  // Nearest lattice point, and the deposit under it.
  vec2 center = (floor(tilePos / uDotSpacing) + 0.5) * uDotSpacing;
  uint dotDeposit = depositAt(center);
  float aa = 1.0 / uZoom;
  float spot = dotDeposit == 0u
    ? 0.0
    : 1.0 - smoothstep(uDotRadius - aa, uDotRadius + aa, length(tilePos - center));
  spot *= smoothstep(uDotMinZoom, uDotFullZoom, uZoom) * uDotAlpha;

  float tint = here == 0u ? 0.0 : uTintAlpha;
  if (spot <= 0.0 && tint <= 0.0) discard;
  uint shown = spot > tint ? dotDeposit : here;
  fragColor = vec4(uColors[int(shown) - 1], max(spot, tint));
}
