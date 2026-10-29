/**
 * DepositPass — Borderfall goods deposits (engine-lib/game/Goods.ts).
 *
 * Deposits are a pure function of the map, so the texture is uploaded once
 * per game. Each field is a soft patch in its good's color with a crisp
 * outline, and once zoomed in a small badge (wheat, oil drop, ingots) marks
 * the middle of every field big enough to work.
 */

import type { RenderSettings } from "../RenderSettings";
import iconFragSrc from "../shaders/deposit/deposit-icon.frag.glsl?raw";
import iconVertSrc from "../shaders/deposit/deposit-icon.vert.glsl?raw";
import depositFragSrc from "../shaders/deposit/deposit.frag.glsl?raw";
import depositVertSrc from "../shaders/deposit/deposit.vert.glsl?raw";
import { hexToRgb } from "../utils/ColorUtils";
import { renderDpr } from "../utils/Dpr";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

const BADGE_PX = 64;

export class DepositPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private depositTex: WebGLTexture | null = null;
  private uCamera: WebGLUniformLocation;
  private uDeposits: WebGLUniformLocation;
  private uColors: WebGLUniformLocation;
  private uFillAlpha: WebGLUniformLocation;
  private uEdgeAlpha: WebGLUniformLocation;
  private uEdgeWidth: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;

  private iconProgram: WebGLProgram;
  private iconVao: WebGLVertexArrayObject;
  private iconInstances: WebGLBuffer;
  private iconCount = 0;
  private iconTex: WebGLTexture | null = null;
  private uIconCamera: WebGLUniformLocation;
  private uIconHalfSize: WebGLUniformLocation;
  private uIconAlpha: WebGLUniformLocation;
  private uIcons: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    private settings: RenderSettings,
  ) {
    const defines = { MAP_W: mapW, MAP_H: mapH };
    this.program = createProgram(
      gl,
      shaderSrc(depositVertSrc, defines),
      shaderSrc(depositFragSrc, defines),
      "DepositPass",
    );
    const loc = (name: string) => gl.getUniformLocation(this.program, name)!;
    this.uCamera = loc("uCamera");
    this.uDeposits = loc("uDeposits");
    this.uColors = loc("uColors");
    this.uFillAlpha = loc("uFillAlpha");
    this.uEdgeAlpha = loc("uEdgeAlpha");
    this.uEdgeWidth = loc("uEdgeWidth");
    this.uZoom = loc("uZoom");
    this.vao = createMapQuad(gl, mapW, mapH);

    this.iconProgram = createProgram(
      gl,
      iconVertSrc,
      iconFragSrc,
      "DepositPass.icons",
    );
    const iloc = (name: string) =>
      gl.getUniformLocation(this.iconProgram, name)!;
    this.uIconCamera = iloc("uCamera");
    this.uIconHalfSize = iloc("uHalfSize");
    this.uIconAlpha = iloc("uAlpha");
    this.uIcons = iloc("uIcons");

    this.iconVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.iconVao);
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.iconInstances = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iconInstances);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 12, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  /** One byte per tile (Goods.ts computeDeposits), or null to draw nothing. */
  setDeposits(deposits: Uint8Array | null): void {
    const gl = this.gl;
    if (this.depositTex) gl.deleteTexture(this.depositTex);
    this.depositTex = null;
    this.iconCount = 0;
    if (deposits === null || deposits.length !== this.mapW * this.mapH) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.depositTex = createTexture2D(gl, {
      width: this.mapW,
      height: this.mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: deposits,
      filter: gl.NEAREST,
    });

    const badges = fieldBadges(
      deposits,
      this.mapW,
      this.mapH,
      this.settings.deposit.iconMinTiles,
    );
    this.iconCount = badges.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.iconInstances);
    gl.bufferData(gl.ARRAY_BUFFER, badges, gl.STATIC_DRAW);
    this.iconTex ??= this.createBadgeTexture();
  }

  /** `zoom`: device pixels per tile; the settings' sizes are CSS pixels. */
  draw(cam: Float32Array, zoom: number): void {
    if (this.depositTex === null) return;
    const gl = this.gl;
    const s = this.settings.deposit;
    const dpr = renderDpr();
    const cssZoom = zoom / dpr;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depositTex);
    gl.uniform1i(this.uDeposits, 0);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.uniform3fv(this.uColors, this.colors());
    gl.uniform1f(this.uFillAlpha, s.fillAlpha);
    gl.uniform1f(this.uEdgeAlpha, s.edgeAlpha);
    gl.uniform1f(this.uEdgeWidth, s.edgeWidthPx / cssZoom);
    gl.uniform1f(this.uZoom, cssZoom);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const iconAlpha =
      clamp01((cssZoom - s.iconMinZoom) / (s.iconFullZoom - s.iconMinZoom)) *
      s.iconAlpha;
    if (iconAlpha > 0 && this.iconCount > 0 && this.iconTex !== null) {
      gl.useProgram(this.iconProgram);
      gl.bindTexture(gl.TEXTURE_2D, this.iconTex);
      gl.uniform1i(this.uIcons, 0);
      gl.uniformMatrix3fv(this.uIconCamera, false, cam);
      gl.uniform1f(this.uIconHalfSize, s.iconSizePx / 2 / cssZoom);
      gl.uniform1f(this.uIconAlpha, iconAlpha);
      gl.bindVertexArray(this.iconVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.iconCount);
    }
    gl.bindVertexArray(null);
  }

  /** Indexed by Good: Food, Oil, Metal; 0-1 RGB. */
  private colors(): number[] {
    const s = this.settings.deposit;
    return [s.foodColor, s.oilColor, s.metalColor].flatMap((hex) =>
      (hexToRgb(hex) ?? [255, 255, 255]).map((c) => c / 255),
    );
  }

  private hexes(): string[] {
    const s = this.settings.deposit;
    return [s.foodColor, s.oilColor, s.metalColor];
  }

  /** A dark disc ringed in each good's color, with its glyph in white. */
  private createBadgeTexture(): WebGLTexture | null {
    const canvas = document.createElement("canvas");
    canvas.width = BADGE_PX * 3;
    canvas.height = BADGE_PX;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    const r = BADGE_PX / 2;
    this.hexes().forEach((color, good) => {
      ctx.save();
      ctx.translate(good * BADGE_PX + r, r);
      ctx.beginPath();
      ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10, 12, 18, 0.88)";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.stroke();
      // Glyphs are drawn on a 24-unit grid, centered.
      ctx.scale((BADGE_PX * 0.56) / 24, (BADGE_PX * 0.56) / 24);
      ctx.translate(-12, -12);
      ctx.fillStyle = "#ffffff";
      ctx.fill(new Path2D(GLYPHS[good]));
      ctx.restore();
    });
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return tex;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.iconProgram);
    if (this.depositTex) gl.deleteTexture(this.depositTex);
    if (this.iconTex) gl.deleteTexture(this.iconTex);
    gl.deleteBuffer(this.iconInstances);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.iconVao);
  }
}

/** White glyphs on a 24-unit grid, by Good: wheat, oil drop, ingots. */
const GLYPHS = [
  "M11.2 8h1.6v14h-1.6zM12 1.5c1.3 1 1.7 2.6 1.4 4.1-.3 1.2-1 2-1.4 2.4-.4-.4-1.1-1.2-1.4-2.4C10.3 4.1 10.7 2.5 12 1.5zM6.6 7.4c1.6-.1 3 .6 3.8 1.9.6 1 .7 2 .7 2.6-.6 0-1.6-.1-2.6-.7C7.2 10.4 6.5 9 6.6 7.4zm10.8 0c.1 1.6-.6 3-1.9 3.8-1 .6-2 .7-2.6.7 0-.6.1-1.6.7-2.6.8-1.3 2.2-2 3.8-1.9zM6.6 12.4c1.6-.1 3 .6 3.8 1.9.6 1 .7 2 .7 2.6-.6 0-1.6-.1-2.6-.7-1.3-.8-2-2.2-1.9-3.8zm10.8 0c.1 1.6-.6 3-1.9 3.8-1 .6-2 .7-2.6.7 0-.6.1-1.6.7-2.6.8-1.3 2.2-2 3.8-1.9z",
  "M12 1.8s-7 8.2-7 13a7 7 0 0 0 14 0c0-4.8-7-13-7-13zm-3.2 13.4a1 1 0 0 1 1 1 2.2 2.2 0 0 0 2.2 2.2 1 1 0 0 1 0 2 4.2 4.2 0 0 1-4.2-4.2 1 1 0 0 1 1-1z",
  "M2.5 21 4.6 15.2h6.8l2.1 5.8zM12.5 21l2.1-5.8h6.8l2.1 5.8zM7.5 13.8l2.1-5.8h6.8l2.1 5.8zM9.8 3.5l2.2-1.5 2.2 1.5-.8 2.4h-2.8z",
];

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The middle of every field (4-connected tiles of one good) of at least
 * `minTiles`: the field's tile nearest its centroid, so a badge never sits
 * off a crescent-shaped field. Flat [x, y, good] triples, tile-centered.
 */
export function fieldBadges(
  deposits: Uint8Array,
  w: number,
  h: number,
  minTiles: number,
): Float32Array {
  const seen = new Uint8Array(deposits.length);
  const queue = new Int32Array(deposits.length);
  const out: number[] = [];
  for (let start = 0; start < deposits.length; start++) {
    const good = deposits[start];
    if (good === 0 || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let sx = 0;
    let sy = 0;
    while (head < tail) {
      const t = queue[head++];
      const x = t % w;
      const y = (t - x) / w;
      sx += x;
      sy += y;
      const visit = (n: number) => {
        if (!seen[n] && deposits[n] === good) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      };
      if (x > 0) visit(t - 1);
      if (x < w - 1) visit(t + 1);
      if (y > 0) visit(t - w);
      if (y < h - 1) visit(t + w);
    }
    if (tail < minTiles) continue;
    const cx = sx / tail;
    const cy = sy / tail;
    let best = queue[0];
    let bestD = Infinity;
    for (let i = 0; i < tail; i++) {
      const x = queue[i] % w;
      const y = (queue[i] - x) / w;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = queue[i];
      }
    }
    const bx = best % w;
    out.push(bx + 0.5, (best - bx) / w + 0.5, good - 1);
  }
  return new Float32Array(out);
}
