import { alpha, type Rgba } from './color.ts';
import { extrusionEnd, extrusionOffset } from './extrusion.ts';
import type { Layer } from './layer.ts';
import { colorForIndex, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/*
 * The 3D model: every painted pixel of the visible layers becomes a box one
 * pixel wide and tall, reaching from its extrusion's offset to its end along
 * z (into the picture). Layers stack boxes behind the same pixel, which is
 * how a pixel gets gaps along z. Built fresh from the document whenever it's
 * needed; nothing here is saved.
 */

/** Part of a pixel's column: z from `start` up to (not including) `end`, in palette color `index`. */
export interface Run {
  start: number;
  end: number;
  index: number;
}

/**
 * The model as runs per pixel. Where boxes from several layers overlap, the
 * upper layer's color wins, as in the 2D view.
 */
export interface VoxelModel {
  width: number;
  height: number;
  /** One past the deepest z any run reaches; 0 for an empty model. */
  depth: number;
  /**
   * Runs per pixel (`y * width + x`), sorted by z, never overlapping, and
   * never touching another run of the same color. Undefined where there are
   * none.
   */
  columns: ReadonlyArray<readonly Run[] | undefined>;
}

/**
 * Builds the model of the visible layers. Layer opacity isn't modeled (a
 * layer at 0% is left out like a hidden one), and neither are fully
 * transparent palette colors.
 */
export function buildVoxelModel(doc: PixelDocument): VoxelModel {
  const { width, height } = doc;
  const columns: Array<Run[] | undefined> = new Array<Run[] | undefined>(width * height);
  const shown = shownIndices(doc.palette);
  let depth = 0;
  // Bottom to top, so upper layers overwrite where boxes overlap.
  for (const layer of modeledLayers(doc)) {
    const { pixels, extrusion } = layer;
    for (let i = 0; i < pixels.length; i++) {
      const index = pixels[i];
      if (!shown[index]) continue;
      const run = { start: extrusionOffset(extrusion[i]), end: extrusionEnd(extrusion[i]), index };
      const column = columns[i];
      columns[i] = column ? insertRun(column, run) : [run];
      if (run.end > depth) depth = run.end;
    }
  }
  return { width, height, depth, columns };
}

/** One pixel's runs, as `buildVoxelModel` makes them, without building the rest. Undefined where there are none. */
export function pixelRuns(doc: PixelDocument, x: number, y: number): readonly Run[] | undefined {
  const offset = y * doc.width + x;
  const shown = shownIndices(doc.palette);
  let runs: Run[] | undefined;
  for (const { pixels, extrusion } of modeledLayers(doc)) {
    const index = pixels[offset];
    if (!shown[index]) continue;
    const run = { start: extrusionOffset(extrusion[offset]), end: extrusionEnd(extrusion[offset]), index };
    runs = runs ? insertRun(runs, run) : [run];
  }
  return runs;
}

function modeledLayers(doc: PixelDocument): Layer[] {
  return doc.layers.filter((layer) => layer.visible && layer.opacity > 0);
}

/** 1 for each palette index that shows in the model: a color that isn't fully transparent. */
function shownIndices(palette: Palette): Uint8Array {
  const shown = new Uint8Array(256);
  for (let index = 1; index < 256; index++) shown[index] = alpha(colorForIndex(palette, index)) > 0 ? 1 : 0;
  return shown;
}

/** `runs` with `run` laid over them: it replaces whatever it overlaps. Keeps the `columns` invariants. */
function insertRun(runs: readonly Run[], run: Run): Run[] {
  const kept: Run[] = [];
  for (const other of runs) {
    if (other.end <= run.start || other.start >= run.end) {
      kept.push(other);
      continue;
    }
    if (other.start < run.start) kept.push({ ...other, end: run.start });
    if (other.end > run.end) kept.push({ ...other, start: run.end });
  }
  kept.push(run);
  kept.sort((a, b) => a.start - b.start);
  const merged: Run[] = [];
  for (const next of kept) {
    const last = merged[merged.length - 1];
    if (last && last.end === next.start && last.index === next.index) merged[merged.length - 1] = { ...last, end: next.end };
    else merged.push(next);
  }
  return merged;
}

/** The run at depth z in a column, if any. */
export function runAt(runs: readonly Run[] | undefined, z: number): Run | undefined {
  return runs?.find((run) => run.start <= z && z < run.end);
}

/** The triangles of one palette color. */
export interface MeshPart {
  /** Palette index. */
  index: number;
  color: Rgba;
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Unit normal per vertex, parallel to `positions`. */
  normals: Float32Array;
  /** Three vertex numbers per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
}

export interface ModelMesh {
  /** One per palette color in the model, in index order. */
  parts: MeshPart[];
  /** Number of quads (each two triangles). */
  quads: number;
  /** Corners of the box around every vertex; null for an empty mesh. */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

/*
 * Mesh coordinates follow glTF: y up, and the front of the model faces +z,
 * one unit per pixel. x is centered on the document, y = 0 is its bottom
 * edge, and z = 0 is the picture plane, so boxes extend toward -z.
 */

/**
 * The visible faces of the model. A face is left out where a neighboring
 * box covers it: one that's opaque, or the same color (so a translucent
 * color shows no faces inside itself). Side faces are cut where only part of
 * them is covered; each face is one quad, however deep.
 */
export function buildMesh(model: VoxelModel, palette: Palette): ModelMesh {
  const { width, height, columns } = model;
  const opaque = new Uint8Array(256);
  for (let index = 1; index < 256; index++) opaque[index] = alpha(colorForIndex(palette, index)) === 255 ? 1 : 0;
  const hides = (cover: Run, face: Run) => opaque[cover.index] === 1 || cover.index === face.index;
  const builders = new Map<number, PartBuilder>();
  const part = (index: number) => {
    let builder = builders.get(index);
    if (!builder) builders.set(index, (builder = new PartBuilder()));
    return builder;
  };
  const neighbor = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? columns[y * width + x] : undefined);
  const centerX = width / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const runs = columns[y * width + x];
      if (!runs) continue;
      const x0 = x - centerX;
      const x1 = x0 + 1;
      const y0 = height - y - 1;
      const y1 = y0 + 1;
      const sides: Array<[readonly Run[] | undefined, Side]> = [
        [neighbor(x + 1, y), 'right'],
        [neighbor(x - 1, y), 'left'],
        [neighbor(x, y - 1), 'top'],
        [neighbor(x, y + 1), 'bottom'],
      ];
      runs.forEach((run, k) => {
        const builder = part(run.index);
        const before = runs[k - 1];
        const after = runs[k + 1];
        if (!(before && before.end === run.start && hides(before, run))) {
          builder.quad([x0, y0, zAt(run.start)], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        }
        if (!(after && after.start === run.end && hides(after, run))) {
          builder.quad([x1, y0, zAt(run.end)], [-1, 0, 0], [0, 1, 0], [0, 0, -1]);
        }
        for (const [covers, side] of sides) {
          uncovered(run, covers, hides, (a, b) => sideQuad(builder, side, x0, x1, y0, y1, a, b));
        }
      });
    }
  }

  const parts = [...builders]
    .sort(([a], [b]) => a - b)
    .map(([index, builder]) => builder.build(index, colorForIndex(palette, index)));
  return { parts, quads: parts.reduce((sum, p) => sum + p.indices.length / 6, 0), bounds: meshBounds(parts) };
}

type Side = 'right' | 'left' | 'top' | 'bottom';
type Vec3 = [number, number, number];

/** Mesh z of a depth: `0 - depth`, since `-depth` makes -0 at the picture plane. */
function zAt(depth: number): number {
  return 0 - depth;
}

/** Calls `emit(a, b)` for each stretch of z in [run.start, run.end) that no run of `covers` hides. */
function uncovered(
  run: Run,
  covers: readonly Run[] | undefined,
  hides: (cover: Run, face: Run) => boolean,
  emit: (a: number, b: number) => void,
): void {
  let from = run.start;
  if (covers) {
    for (const cover of covers) {
      if (cover.end <= from) continue;
      if (cover.start >= run.end) break;
      if (!hides(cover, run)) continue;
      if (cover.start > from) emit(from, cover.start);
      from = cover.end;
      if (from >= run.end) return;
    }
  }
  if (from < run.end) emit(from, run.end);
}

/** A side face of the column at x0..x1, y0..y1 (mesh units), spanning depths a..b. */
function sideQuad(builder: PartBuilder, side: Side, x0: number, x1: number, y0: number, y1: number, a: number, b: number): void {
  const length = b - a;
  switch (side) {
    case 'right':
      return builder.quad([x1, y0, zAt(a)], [0, 0, -length], [0, 1, 0], [1, 0, 0]);
    case 'left':
      return builder.quad([x0, y0, zAt(b)], [0, 0, length], [0, 1, 0], [-1, 0, 0]);
    case 'top':
      return builder.quad([x0, y1, zAt(a)], [1, 0, 0], [0, 0, -length], [0, 1, 0]);
    case 'bottom':
      return builder.quad([x0, y0, zAt(b)], [1, 0, 0], [0, 0, length], [0, -1, 0]);
  }
}

/** Collects one part's quads in typed arrays that grow as needed. */
class PartBuilder {
  private positions = new Float32Array(48);
  private normals = new Float32Array(48);
  private vertices = 0;

  /** A quad with corners o, o+u, o+u+v, o+v. u × v must point along `normal`, out of the box. */
  quad(o: Vec3, u: Vec3, v: Vec3, normal: Vec3): void {
    if ((this.vertices + 4) * 3 > this.positions.length) {
      this.positions = grow(this.positions);
      this.normals = grow(this.normals);
    }
    const corners: Vec3[] = [
      o,
      [o[0] + u[0], o[1] + u[1], o[2] + u[2]],
      [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]],
      [o[0] + v[0], o[1] + v[1], o[2] + v[2]],
    ];
    for (const corner of corners) {
      this.positions.set(corner, this.vertices * 3);
      this.normals.set(normal, this.vertices * 3);
      this.vertices++;
    }
  }

  build(index: number, color: Rgba): MeshPart {
    const quads = this.vertices / 4;
    const indices = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    return {
      index,
      color,
      positions: this.positions.slice(0, this.vertices * 3),
      normals: this.normals.slice(0, this.vertices * 3),
      indices,
    };
  }
}

function grow(array: Float32Array): Float32Array<ArrayBuffer> {
  const bigger = new Float32Array(array.length * 2);
  bigger.set(array);
  return bigger;
}

function meshBounds(parts: readonly MeshPart[]): ModelMesh['bounds'] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      if (positions[i] < min[axis]) min[axis] = positions[i];
      if (positions[i] > max[axis]) max[axis] = positions[i];
    }
  }
  return min[0] === Infinity ? null : { min, max };
}
