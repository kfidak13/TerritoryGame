/**
 * TileMaskPass — tints a set of tiles, e.g. the land in a Borderfall trade
 * offer (1 = land you give, 2 = land you ask for). The client pushes a whole
 * mask, or null to clear it.
 */

import type { RenderSettings } from "../RenderSettings";
import tileMaskFragSrc from "../shaders/tile-mask/tile-mask.frag.glsl?raw";
import tileMaskVertSrc from "../shaders/tile-mask/tile-mask.vert.glsl?raw";
import { hexToRgb } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

export class TileMaskPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private maskTex: WebGLTexture | null = null;
  private uCamera: WebGLUniformLocation;
  private uMask: WebGLUniformLocation;
  private uColors: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    private settings: RenderSettings,
  ) {
    const defines = { MAP_W: mapW, MAP_H: mapH };
    this.program = createProgram(
      gl,
      shaderSrc(tileMaskVertSrc, defines),
      shaderSrc(tileMaskFragSrc, defines),
      "TileMaskPass",
    );
    const loc = (name: string) => gl.getUniformLocation(this.program, name)!;
    this.uCamera = loc("uCamera");
    this.uMask = loc("uMask");
    this.uColors = loc("uColors");
    this.uAlpha = loc("uAlpha");
    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** One byte per tile (0 = clear), or null to draw nothing. */
  setMask(mask: Uint8Array | null): void {
    const gl = this.gl;
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    this.maskTex = null;
    if (mask === null || mask.length !== this.mapW * this.mapH) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.maskTex = createTexture2D(gl, {
      width: this.mapW,
      height: this.mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: mask,
      filter: gl.NEAREST,
    });
  }

  draw(cam: Float32Array): void {
    if (this.maskTex === null) return;
    const gl = this.gl;
    const s = this.settings.tileMask;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(this.uMask, 0);
    gl.uniformMatrix3fv(this.uCamera, false, cam);
    gl.uniform3fv(
      this.uColors,
      [s.firstColor, s.secondColor].flatMap((hex) =>
        (hexToRgb(hex) ?? [255, 255, 255]).map((c) => c / 255),
      ),
    );
    gl.uniform1f(this.uAlpha, s.alpha);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    gl.deleteVertexArray(this.vao);
  }
}
