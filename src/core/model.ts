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
 * them is covered.
 *
 * Faces of one color that lie side by side in one plane are merged into
 * rectangles (`FacePlane`), so a flat area or a straight edge takes one quad
 * however many pixels it spans.
 */
export function buildMesh(model: VoxelModel, palette: Palette): ModelMesh {
  const { width, height, columns } = model;
  const opaque = new Uint8Array(256);
  for (let index = 1; index < 256; index++) opaque[index] = alpha(colorForIndex(palette, index)) === 255 ? 1 : 0;
  const hides = (cover: Run, face: Run) => opaque[cover.index] === 1 || cover.index === face.index;
  const neighbor = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? columns[y * width + x] : undefined);

  const builders = new Map<number, PartBuilder>();
  const part = (index: number) => {
    let builder = builders.get(index);
    if (!builder) builders.set(index, (builder = new PartBuilder()));
    return builder;
  };
  const centerX = width / 2;

  // Planes per facing: depths for front and back, column edges for right and
  // left, row edges for top and bottom. Pixels are visited row by row, which
  // feeds each plane its rows in order.
  const planes: Record<Facing, Array<FacePlane | undefined>> = { front: [], back: [], right: [], left: [], top: [], bottom: [] };
  const add = (facing: Facing, plane: number, row: number, a: number, b: number, index: number) => {
    let faces = planes[facing][plane];
    if (!faces) {
      faces = new FacePlane((rect) => faceQuad(part(rect.index), facing, plane, rect, centerX, height));
      planes[facing][plane] = faces;
    }
    faces.add(row, a, b, index);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const runs = columns[y * width + x];
      if (!runs) continue;
      const right = neighbor(x + 1, y);
      const left = neighbor(x - 1, y);
      const above = neighbor(x, y - 1);
      const below = neighbor(x, y + 1);
      for (let k = 0; k < runs.length; k++) {
        const run = runs[k];
        const { index } = run;
        const before = runs[k - 1];
        const after = runs[k + 1];
        if (!(before && before.end === run.start && hides(before, run))) add('front', run.start, y, x, x + 1, index);
        if (!(after && after.start === run.end && hides(after, run))) add('back', run.end, y, x, x + 1, index);
        uncovered(run, right, hides, (a, b) => add('right', x + 1, y, a, b, index));
        uncovered(run, left, hides, (a, b) => add('left', x, y, a, b, index));
        uncovered(run, above, hides, (a, b) => add('top', y, x, a, b, index));
        uncovered(run, below, hides, (a, b) => add('bottom', y + 1, x, a, b, index));
      }
    }
  }

  for (const facing of FACINGS) {
    for (const faces of planes[facing]) faces?.finish();
  }

  const parts = [...builders]
    .sort(([a], [b]) => a - b)
    .map(([index, builder]) => builder.build(index, colorForIndex(palette, index)));
  return { parts, quads: parts.reduce((sum, p) => sum + p.indices.length / 6, 0), bounds: meshBounds(parts) };
}

/** Which way a face points: front is +z (toward the viewer), top is +y, right is +x. */
type Facing = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
const FACINGS: readonly Facing[] = ['front', 'back', 'right', 'left', 'top', 'bottom'];
type Vec3 = [number, number, number];

/**
 * Faces in one plane, all pointing one way, as rectangles: rows `from` up to
 * `to`, each spanning `a` up to `b`.
 *
 * | Facing       | Plane        | Rows        | Span        |
 * | ------------ | ------------ | ----------- | ----------- |
 * | front, back  | depth        | document y  | document x  |
 * | right, left  | column edge  | document y  | depth       |
 * | top, bottom  | row edge     | document x  | depth       |
 */
interface FaceRect {
  a: number;
  b: number;
  index: number;
  from: number;
  to: number;
}

/**
 * Merges the faces of one plane as they arrive: row by row in order, each
 * row's spans sorted and not overlapping. Touching spans of one color in a
 * row join, and a rectangle grows into the next row while that row has
 * exactly its span in its color. Not always the fewest rectangles, but
 * linear, and flat areas and straight edges come out as one quad.
 *
 * Each rectangle goes to `emit` as soon as it can't grow, so only two rows'
 * worth are held at a time.
 */
class FacePlane {
  private readonly emit: (rect: FaceRect) => void;
  private row = -1;
  /** Spans of `row`, so far. */
  private spans: FaceRect[] = [];
  /** Rectangles reaching the row before `row`, sorted by `a`. */
  private open: FaceRect[] = [];

  constructor(emit: (rect: FaceRect) => void) {
    this.emit = emit;
  }

  add(row: number, a: number, b: number, index: number): void {
    if (row !== this.row) {
      this.endRow();
      this.row = row;
    }
    const last = this.spans[this.spans.length - 1];
    if (last && last.b === a && last.index === index) last.b = b;
    else this.spans.push({ a, b, index, from: row, to: row + 1 });
  }

  /** Emits the rectangles still open. Call once, after the last `add`. */
  finish(): void {
    this.endRow();
    for (const rect of this.open) this.emit(rect);
    this.open = [];
  }

  /** Grows the open rectangles that `row` repeats, emits the rest, and opens the row's new spans. */
  private endRow(): void {
    const { open, spans } = this;
    const next: FaceRect[] = [];
    let i = 0;
    for (const span of spans) {
      while (i < open.length && open[i].a < span.a) this.emit(open[i++]);
      const rect = open[i];
      if (rect && rect.to === span.from && rect.a === span.a && rect.b === span.b && rect.index === span.index) {
        rect.to = span.to;
        next.push(rect);
        i++;
      } else {
        next.push(span);
      }
    }
    while (i < open.length) this.emit(open[i++]);
    this.open = next;
    this.spans = [];
  }
}

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

/** Adds the quad of a merged rectangle of faces, in mesh coordinates. */
function faceQuad(builder: PartBuilder, facing: Facing, plane: number, rect: FaceRect, centerX: number, height: number): void {
  const { a, b, from, to } = rect;
  const rows = to - from;
  const normal = NORMALS[facing];
  switch (facing) {
    case 'front':
      return builder.quad([a - centerX, height - to, zAt(plane)], [b - a, 0, 0], [0, rows, 0], normal);
    case 'back':
      return builder.quad([b - centerX, height - to, zAt(plane)], [a - b, 0, 0], [0, rows, 0], normal);
    case 'right':
      return builder.quad([plane - centerX, height - to, zAt(a)], [0, 0, a - b], [0, rows, 0], normal);
    case 'left':
      return builder.quad([plane - centerX, height - to, zAt(b)], [0, 0, b - a], [0, rows, 0], normal);
    case 'top':
      return builder.quad([from - centerX, height - plane, zAt(a)], [rows, 0, 0], [0, 0, a - b], normal);
    case 'bottom':
      return builder.quad([from - centerX, height - plane, zAt(b)], [rows, 0, 0], [0, 0, b - a], normal);
  }
}

const NORMALS: Readonly<Record<Facing, Vec3>> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
};

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
    const { positions, normals } = this;
    let i = this.vertices * 3;
    for (let corner = 0; corner < 4; corner++) {
      const withU = corner === 1 || corner === 2;
      const withV = corner >= 2;
      for (let axis = 0; axis < 3; axis++, i++) {
        positions[i] = o[axis] + (withU ? u[axis] : 0) + (withV ? v[axis] : 0);
        normals[i] = normal[axis];
      }
    }
    this.vertices += 4;
  }

  build(index: number, color: Rgba): MeshPart {
    const quads = this.vertices / 4;
    const indices = new Uint32Array(quads * 6);
    for (let q = 0, i = 0; q < quads; q++) {
      const v = q * 4;
      indices[i++] = v;
      indices[i++] = v + 1;
      indices[i++] = v + 2;
      indices[i++] = v;
      indices[i++] = v + 2;
      indices[i++] = v + 3;
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
