import { alpha, blue, green, red } from '../core/color.ts';
import type { ModelMesh } from '../core/model.ts';
import { FIELD_OF_VIEW, multiply, perspectiveMatrix, viewMatrix, type OrbitCamera } from './camera.ts';

const VERTEX_SHADER = `#version 300 es
in vec3 position;
uniform mat4 viewProjection;
out vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

/**
 * Flat shading from a fixed light at the upper right front, so each side of
 * a box gets its own shade and the front stays close to the palette color.
 * The normal comes from how the position changes across the screen, so it's
 * each triangle's own whether or not vertices are shared (back faces are
 * culled, so it always points toward the viewer, out of the model). Lines
 * (the floor grid) pass `lit = 0` and take the color as is.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vPosition;
uniform vec4 color;
uniform float lit;
out vec4 outColor;
const vec3 light = normalize(vec3(0.35, 0.6, 1.0));
void main() {
  float shade = 1.0;
  // Lines have no normal: a cross product of two parallel steps is zero.
  if (lit > 0.5) {
    vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
    shade = 0.62 + 0.4 * max(dot(normal, light), 0.0);
  }
  outColor = vec4(color.rgb * shade, color.a);
}`;

const BACKGROUND = [0x20 / 255, 0x20 / 255, 0x29 / 255];
const GRID_COLOR = [1, 1, 1, 0.07];
const PLANE_COLOR = [0x5b / 255, 0x8c / 255, 1, 0.45];

/** One palette color's triangles on the GPU. */
interface GpuPart {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  color: [number, number, number, number];
  translucent: boolean;
}

interface GpuLines {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
}

/** Thrown when the browser can't give the 3D view a WebGL 2 context. */
export class WebGlUnavailableError extends Error {
  constructor() {
    super('3D view needs WebGL 2, which this browser or device has turned off');
  }
}

/**
 * Draws a model mesh with WebGL 2: opaque colors first, then translucent
 * ones blended over them, plus a faint floor grid and the picture plane's
 * outline. Draws only when asked (`render`).
 */
export class ModelRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations: {
    position: number;
    viewProjection: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    lit: WebGLUniformLocation | null;
  };
  private parts: GpuPart[] = [];
  private grid: GpuLines | null = null;
  private plane: GpuLines | null = null;
  private cssWidth = 1;
  private cssHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new WebGlUnavailableError();
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.locations = {
      position: gl.getAttribLocation(this.program, 'position'),
      viewProjection: gl.getUniformLocation(this.program, 'viewProjection'),
      color: gl.getUniformLocation(this.program, 'color'),
      lit: gl.getUniformLocation(this.program, 'lit'),
    };
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  /** Replaces the mesh on the GPU. */
  setMesh(mesh: ModelMesh): void {
    const { gl } = this;
    for (const part of this.parts) deleteVertexArray(gl, part.vao, part.buffers);
    this.parts = mesh.parts.map((part) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      // Normals aren't needed: the shader works them out per triangle.
      const buffers = [this.attribute(this.locations.position, part.positions)];
      const indices = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
      buffers.push(indices);
      gl.bindVertexArray(null);
      const a = alpha(part.color) / 255;
      return {
        vao,
        buffers,
        count: part.indices.length,
        color: [red(part.color) / 255, green(part.color) / 255, blue(part.color) / 255, a],
        translucent: a < 1,
      };
    });
  }

  /**
   * Sets the guides for a document `width` × `height` whose model reaches
   * `depth` deep: a floor grid under it, and the picture plane's outline.
   */
  setGuides(width: number, height: number, depth: number): void {
    const { gl } = this;
    if (this.grid) deleteVertexArray(gl, this.grid.vao, [this.grid.buffer]);
    if (this.plane) deleteVertexArray(gl, this.plane.vao, [this.plane.buffer]);
    const left = -width / 2;
    const right = width / 2;
    const front = Math.ceil(Math.max(2, depth / 2));
    const back = -Math.max(depth, 1) - front;
    const step = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(width, depth) / 64)));
    const grid: number[] = [];
    for (let x = left; x <= right + 1e-9; x += step) grid.push(x, 0, front, x, 0, back);
    for (let z = front; z >= back - 1e-9; z -= step) grid.push(left, 0, z, right, 0, z);
    this.grid = this.lines(grid);
    this.plane = this.lines([left, 0, 0, right, 0, 0, right, 0, 0, right, height, 0, right, height, 0, left, height, 0, left, height, 0, left, 0, 0]);
  }

  render(camera: OrbitCamera): void {
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const near = Math.max(0.01, camera.distance / 500);
    const far = camera.distance * 20 + 1000;
    const projection = perspectiveMatrix(FIELD_OF_VIEW, this.cssWidth / this.cssHeight, near, far);
    gl.uniformMatrix4fv(this.locations.viewProjection, false, multiply(projection, viewMatrix(camera)));

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1f(this.locations.lit, 1);
    for (const part of this.parts) if (!part.translucent) this.drawPart(part);

    // Guides and translucent colors blend over what's drawn, without hiding what's drawn after them.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(this.locations.lit, 0);
    if (this.grid) this.drawLines(this.grid, GRID_COLOR);
    if (this.plane) this.drawLines(this.plane, PLANE_COLOR);
    gl.uniform1f(this.locations.lit, 1);
    for (const part of this.parts) if (part.translucent) this.drawPart(part);
    gl.depthMask(true);
  }

  /** Frees GPU resources. */
  dispose(): void {
    this.setMesh({ parts: [], faces: 0, bounds: null });
    const { gl } = this;
    if (this.grid) deleteVertexArray(gl, this.grid.vao, [this.grid.buffer]);
    if (this.plane) deleteVertexArray(gl, this.plane.vao, [this.plane.buffer]);
    gl.deleteProgram(this.program);
  }

  private drawPart(part: GpuPart): void {
    const { gl } = this;
    gl.uniform4fv(this.locations.color, part.color);
    gl.bindVertexArray(part.vao);
    gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private drawLines(lines: GpuLines, color: number[]): void {
    const { gl } = this;
    gl.uniform4fv(this.locations.color, color);
    gl.bindVertexArray(lines.vao);
    gl.drawArrays(gl.LINES, 0, lines.count);
    gl.bindVertexArray(null);
  }

  /** A float vec3 attribute buffer, bound to the current vertex array. */
  private attribute(location: number, data: Float32Array): WebGLBuffer {
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  private lines(points: number[]): GpuLines {
    const { gl } = this;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = this.attribute(this.locations.position, new Float32Array(points));
    gl.bindVertexArray(null);
    return { vao, buffer, count: points.length / 3 };
  }
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function deleteVertexArray(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject, buffers: WebGLBuffer[]): void {
  gl.deleteVertexArray(vao);
  for (const buffer of buffers) gl.deleteBuffer(buffer);
}
