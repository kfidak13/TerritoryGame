#version 300 es
precision highp float;

// One quad per deposit field, at the field's middle (DepositPass).
layout(location = 0) in vec2 aCorner; // [-1, 1]²
layout(location = 1) in vec2 aCenter; // tile coords
layout(location = 2) in float aGood;  // Good: Food, Oil, Metal

uniform mat3 uCamera;
uniform float uHalfSize; // in tiles: a fixed size on screen

out vec2 vUV;
flat out float vGood;

void main() {
  vec3 clip = uCamera * vec3(aCenter + aCorner * uHalfSize, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vUV = aCorner * 0.5 + 0.5;
  vGood = aGood;
}
