#version 300 es
precision highp float;
precision highp usampler2D;

// Per-tile mask (R8UI): 0 = clear, else an index into uColors (1-based).
uniform usampler2D uMask;
uniform vec3 uColors[2];
uniform float uAlpha;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec2 tilePos = vUV * vec2(float(MAP_W), float(MAP_H));
  ivec2 tc = clamp(ivec2(tilePos), ivec2(0), ivec2(MAP_W - 1, MAP_H - 1));
  uint value = texelFetch(uMask, tc, 0).r;
  if (value == 0u) discard;
  fragColor = vec4(uColors[min(int(value), 2) - 1], uAlpha);
}
