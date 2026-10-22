/**
 * DepositPass — Borderfall goods deposits (engine-lib/game/Goods.ts).
 *
 * Deposits are a pure function of the map, so the texture is uploaded once
 * per game. Each deposit tile gets a faint tint in its good's color, and a
 * sparse lattice of dots marks deposits once zoomed in.
 */

import type { RenderSettings } from "../RenderSettings";
import depositFragSrc from "../shaders/deposit/deposit.frag.glsl?raw";
import depositVertSrc from "../shaders/deposit/deposit.vert.glsl?raw";
import { hexToRgb } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

export class DepositPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private depositTex: WebGLTexture | null = null;
  private uCamera: WebGLUniformLocation;
  private uDeposits: WebGLUniformLocation;
  private uColors: WebGLUniformLocation;
  private uTintAlpha: WebGLUniformLocation;
  private uDotAlpha: WebGLUniformLocation;
  private uDotRadius: WebGLUniformLocation;
  private uDotSpacing: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uDotMinZoom: WebGLUniformLocation;
  private uDotFullZoom: WebGLUniformLocation;

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
    this.uTintAlpha = loc("uTintAlpha");
    this.uDotAlpha = loc("uDotAlpha");
    this.uDotRadius = loc("uDotRadius");
    this.uDotSpacing = loc("uDotSpacing");
    this.uZoom = loc("uZoom");
    this.uDotMinZoom = loc("uDotMinZoom");
    this.uDotFullZoom = loc("uDotFullZoom");
    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** One byte per tile (Goods.ts computeDeposits), or null to draw nothing. */
  setDeposits(deposits: Uint8Array | null): void {
    const gl = this.gl;
    if (this.depositTex) gl.deleteTexture(this.depositTex);
    this.depositTex = null;
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
  }

  draw(cam: Float32Array, zoom: number): void {
    if (this.depositTex === null) return;
    const gl = this.gl;
    const s = this.settings.deposit;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depositTex);
    gl.uniform1i(this.uDeposits, 0);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    // Indexed by Good: Food, Oil, Metal.
    const colors = [s.foodColor, s.oilColor, s.metalColor].flatMap((hex) =>
      (hexToRgb(hex) ?? [255, 255, 255]).map((c) => c / 255),
    );
    gl.uniform3fv(this.uColors, colors);
    gl.uniform1f(this.uTintAlpha, s.tintAlpha);
    gl.uniform1f(this.uDotAlpha, s.dotAlpha);
    gl.uniform1f(this.uDotRadius, s.dotRadius);
    gl.uniform1f(this.uDotSpacing, s.dotSpacing);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uDotMinZoom, s.dotMinZoom);
    gl.uniform1f(this.uDotFullZoom, s.dotFullZoom);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.depositTex) gl.deleteTexture(this.depositTex);
    gl.deleteVertexArray(this.vao);
  }
}
