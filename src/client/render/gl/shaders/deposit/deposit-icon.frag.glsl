#version 300 es
precision highp float;

// Badge atlas: one cell per Good, side by side; map y and canvas y both
// run down, so no flip.
uniform sampler2D uIcons;
uniform float uAlpha;

in vec2 vUV;
flat in float vGood;
out vec4 fragColor;

void main() {
  vec4 c = texture(uIcons, vec2((vGood + vUV.x) / 3.0, vUV.y));
  if (c.a <= 0.0) discard;
  fragColor = vec4(c.rgb, c.a * uAlpha);
}
