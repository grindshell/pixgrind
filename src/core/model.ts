import { alpha, type Rgba } from './color.ts';
import {
  CUT_BOTTOM_LEFT,
  CUT_BOTTOM_RIGHT,
  CUT_TOP_LEFT,
  CUT_TOP_RIGHT,
  extrusionEnd,
  extrusionOffset,
  extrusionShape,
  SHAPES,
  SQUARE,
  type Shape,
} from './extrusion.ts';
import type { Layer } from './layer.ts';
import { colorForIndex, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/*
 * The 3D model: every painted pixel of the visible layers becomes a box one
 * pixel wide and tall (or a diagonal half of one), reaching from its
 * extrusion's offset to its end along z (into the picture). Layers stack
 * boxes behind the same pixel, which is how a pixel gets gaps along z. Built
 * fresh from the document whenever it's needed; nothing here is saved.
 *
 * Each pixel is split by both its diagonals into four quarters, each
 * touching one side: a square fills all four, a diagonal half two. Colors are
 * kept per quarter, so where a diagonal pixel lies over a square one on a
 * lower layer, the square shows in the cut-off half.
 */

/** A quarter of a pixel, named by the side it touches. Numbered clockwise from the top. */
export type Quarter = 0 | 1 | 2 | 3;
export const TOP: Quarter = 0;
export const RIGHT: Quarter = 1;
export const BOTTOM: Quarter = 2;
export const LEFT: Quarter = 3;

/**
 * Palette indices of a pixel's four quarters, packed as
 * `top | right << 8 | bottom << 16 | left << 24` (unsigned), 0 where a
 * quarter is empty.
 */
export type Quarters = number;

export function quarterIndex(quarters: Quarters, quarter: Quarter): number {
  return (quarters >>> (quarter * 8)) & 0xff;
}

/** Quarters all of palette color `index`: a whole square. */
export function solidQuarters(index: number): Quarters {
  return index * 0x01010101;
}

/** The color a viewer on the right sees in the upper or lower half of a pixel's side (0 for none). */
export function seenFromRight(quarters: Quarters, upper: boolean): number {
  return (
    quarterIndex(quarters, RIGHT) || quarterIndex(quarters, upper ? TOP : BOTTOM) || quarterIndex(quarters, LEFT)
  );
}

/** Which quarters a shape fills, one bit each (bit `q` for quarter `q`). */
const SHAPE_QUARTERS: Readonly<Record<Shape, number>> = {
  [SQUARE]: 0b1111,
  [CUT_TOP_LEFT]: 0b0110,
  [CUT_TOP_RIGHT]: 0b1100,
  [CUT_BOTTOM_RIGHT]: 0b1001,
  [CUT_BOTTOM_LEFT]: 0b0011,
};

/** Packed `Quarters` bytes of 0xff for each quarter in `bits`. */
function quarterBytes(bits: number): number {
  let bytes = 0;
  for (let q = 0; q < 4; q++) if (bits & (1 << q)) bytes += 0xff * 2 ** (q * 8);
  return bytes;
}
/** Per shape, packed `Quarters` bytes of 0xff where it fills. */
const SHAPE_BYTES: readonly number[] = SHAPES.map((shape) => quarterBytes(SHAPE_QUARTERS[shape]));

/** Part of a pixel's column: z from `start` up to (not including) `end`, with the colors of its quarters. */
export interface Run {
  start: number;
  end: number;
  quarters: Quarters;
}

/**
 * The model as runs per pixel. Where boxes from several layers overlap, the
 * upper layer's color wins in the quarters it fills, as in the 2D view.
 */
export interface VoxelModel {
  width: number;
  height: number;
  /** One past the deepest z any run reaches; 0 for an empty model. */
  depth: number;
  /**
   * Runs per pixel (`y * width + x`), sorted by z, never overlapping, and
   * never touching another run with the same quarters. Undefined where there
   * are none.
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
      columns[i] = addBox(columns[i], index, extrusion[i]);
      const end = extrusionEnd(extrusion[i]);
      if (end > depth) depth = end;
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
    if (shown[index]) runs = addBox(runs, index, extrusion[offset]);
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

/** A column with a pixel's box in color `index` laid over it. */
function addBox(runs: Run[] | undefined, index: number, extrusion: number): Run[] {
  const start = extrusionOffset(extrusion);
  const end = extrusionEnd(extrusion);
  const shape = SHAPE_BYTES[extrusionShape(extrusion)];
  const quarters = (solidQuarters(index) & shape) >>> 0;
  return runs ? insertRun(runs, start, end, quarters, shape) : [{ start, end, quarters }];
}

/**
 * `runs` with `quarters` laid over z from `start` to `end`: they replace what
 * was there in the quarters `filled` (packed bytes of 0xff) covers, and the
 * other quarters keep their colors. Keeps the `columns` invariants.
 */
function insertRun(runs: readonly Run[], start: number, end: number, quarters: Quarters, filled: number): Run[] {
  const pieces: Run[] = [];
  let cursor = start;
  for (const run of runs) {
    if (run.end <= start || run.start >= end) {
      pieces.push(run);
      continue;
    }
    if (run.start < start) pieces.push({ ...run, end: start });
    if (run.start > cursor) pieces.push({ start: cursor, end: run.start, quarters });
    const overlapEnd = Math.min(run.end, end);
    pieces.push({ start: Math.max(run.start, start), end: overlapEnd, quarters: ((run.quarters & ~filled) | quarters) >>> 0 });
    cursor = overlapEnd;
    if (run.end > end) pieces.push({ ...run, start: end });
  }
  if (cursor < end) pieces.push({ start: cursor, end, quarters });
  pieces.sort((a, b) => a.start - b.start);
  const merged: Run[] = [];
  for (const next of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.end === next.start && last.quarters === next.quarters) merged[merged.length - 1] = { ...last, end: next.end };
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
  /** Number of faces: quads (two triangles each) and single triangles. */
  faces: number;
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
 * them is covered. Diagonal pixels add slanted faces between their quarters.
 *
 * Faces of one color that lie side by side in one plane are merged into
 * rectangles (`FacePlane`), so a flat area or a straight edge, slanted ones
 * included, takes one quad however many pixels it spans. Front and back
 * faces of diagonal pixels are triangles, not merged.
 */
export function buildMesh(model: VoxelModel, palette: Palette): ModelMesh {
  const { width, height, columns } = model;
  const opaque = new Uint8Array(256);
  for (let index = 1; index < 256; index++) opaque[index] = alpha(colorForIndex(palette, index)) === 255 ? 1 : 0;
  /** Whether color `cover` (0 for none) hides a face of color `face` it touches. */
  const hides = (cover: number, face: number) => cover !== 0 && (opaque[cover] === 1 || cover === face);
  const neighbor = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? columns[y * width + x] : undefined);

  const builders = new Map<number, PartBuilder>();
  const part = (index: number) => {
    let builder = builders.get(index);
    if (!builder) builders.set(index, (builder = new PartBuilder()));
    return builder;
  };
  const centerX = width / 2;

  // Planes per facing: depths for front and back, column edges for right and
  // left, row edges for top and bottom, and diagonal lines through pixel
  // corners for slanted faces. Pixels are visited row by row, which feeds each
  // plane its rows in order.
  const planes = {} as Record<Facing, Array<FacePlane | undefined>>;
  for (const facing of FACINGS) planes[facing] = [];
  const add = (facing: Facing, plane: number, row: number, a: number, b: number, index: number) => {
    let faces = planes[facing][plane];
    if (!faces) {
      faces = new FacePlane((rect) => faceQuad(part(rect.index), facing, plane, rect, centerX, height));
      planes[facing][plane] = faces;
    }
    faces.add(row, a, b, index);
  };

  /** The quarters of `run`'s end face that `cover` (the run touching that end, if any) doesn't hide. */
  const exposed = (run: Run, cover: Run | undefined): Quarters => {
    if (!cover) return run.quarters;
    let quarters = 0;
    for (let q = 0; q < 4; q++) {
      const index = quarterIndex(run.quarters, q as Quarter);
      if (index && !hides(quarterIndex(cover.quarters, q as Quarter), index)) quarters += index * 2 ** (q * 8);
    }
    return quarters;
  };

  /**
   * A run's front or back face at `depth`, from the quarters that show
   * there: a whole square goes to its plane to merge, anything else is drawn
   * as triangles, a half of one color as one.
   */
  const endFace = (quarters: Quarters, facing: 'front' | 'back', depth: number, x: number, y: number) => {
    if (!quarters) return;
    const first = quarters & 0xff;
    if (quarters === solidQuarters(first)) {
      add(facing, depth, y, x, x + 1, first);
      return;
    }
    const x0 = x - centerX;
    const y0 = height - y - 1;
    const z = zAt(depth);
    // Corners clockwise from the top left, so quarter q lies between corner
    // q and corner q + 1, counter-clockwise seen from the front.
    const corner: Vec3[] = [
      [x0, y0 + 1, z],
      [x0 + 1, y0 + 1, z],
      [x0 + 1, y0, z],
      [x0, y0, z],
    ];
    const center: Vec3 = [x0 + 0.5, y0 + 0.5, z];
    const triangle = (index: number, p: Vec3, q: Vec3, r: Vec3) => {
      if (facing === 'front') part(index).triangle(p, q, r, NORMALS.front);
      else part(index).triangle(r, q, p, NORMALS.back);
    };
    const done = [false, false, false, false];
    for (let q = 0; q < 4; q++) {
      const n = (q + 1) % 4;
      const index = quarterIndex(quarters, q as Quarter);
      if (index && !done[q] && !done[n] && index === quarterIndex(quarters, n as Quarter)) {
        // Quarters q and q + 1 make the half from corner q to corner q + 2.
        triangle(index, corner[(q + 2) % 4], corner[(q + 1) % 4], corner[q]);
        done[q] = done[n] = true;
      }
    }
    for (let q = 0; q < 4; q++) {
      const index = quarterIndex(quarters, q as Quarter);
      if (index && !done[q]) triangle(index, center, corner[(q + 1) % 4], corner[q]);
    }
  };

  /**
   * The slanted faces along one half-diagonal of a pixel, between quarters
   * `a` and `b` (a's face points `aFacing`, b's the opposite way), for every
   * run of the column. `plane` and `row` place the half-diagonal on its line.
   */
  const slants = (runs: readonly Run[], a: Quarter, b: Quarter, aFacing: Facing, bFacing: Facing, plane: number, row: number) => {
    for (const run of runs) {
      const ia = quarterIndex(run.quarters, a);
      const ib = quarterIndex(run.quarters, b);
      if (ia === ib) continue;
      if (ia && !hides(ib, ia)) add(aFacing, plane, row, run.start, run.end, ia);
      if (ib && !hides(ia, ib)) add(bFacing, plane, row, run.start, run.end, ib);
    }
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
        const before = runs[k - 1];
        const after = runs[k + 1];
        endFace(exposed(run, before?.end === run.start ? before : undefined), 'front', run.start, x, y);
        endFace(exposed(run, after?.start === run.end ? after : undefined), 'back', run.end, x, y);
        uncovered(run, RIGHT, right, LEFT, hides, (a, b, index) => add('right', x + 1, y, a, b, index));
        uncovered(run, LEFT, left, RIGHT, hides, (a, b, index) => add('left', x, y, a, b, index));
        uncovered(run, TOP, above, BOTTOM, hides, (a, b, index) => add('top', y, x, a, b, index));
        uncovered(run, BOTTOM, below, TOP, hides, (a, b, index) => add('bottom', y + 1, x, a, b, index));
      }
      // Slanted faces, a half-diagonal at a time so each line gets its rows in order.
      const falling = x - y + height;
      const rising = x + y + 1;
      slants(runs, LEFT, TOP, 'upRight', 'downLeft', falling, 2 * y);
      slants(runs, BOTTOM, RIGHT, 'upRight', 'downLeft', falling, 2 * y + 1);
      slants(runs, RIGHT, TOP, 'upLeft', 'downRight', rising, 2 * y);
      slants(runs, BOTTOM, LEFT, 'upLeft', 'downRight', rising, 2 * y + 1);
    }
  }

  for (const facing of FACINGS) {
    for (const faces of planes[facing]) faces?.finish();
  }

  const sorted = [...builders].sort(([a], [b]) => a - b);
  const parts = sorted.map(([index, builder]) => builder.build(index, colorForIndex(palette, index)));
  return { parts, faces: sorted.reduce((sum, [, builder]) => sum + builder.faces, 0), bounds: meshBounds(parts) };
}

/**
 * Which way a face points. Front is +z (toward the viewer), top is +y, right
 * is +x; the slanted ones point between up or down and left or right.
 */
type Facing =
  | 'front'
  | 'back'
  | 'right'
  | 'left'
  | 'top'
  | 'bottom'
  | 'upRight'
  | 'downLeft'
  | 'upLeft'
  | 'downRight';
const FACINGS: readonly Facing[] = [
  'front',
  'back',
  'right',
  'left',
  'top',
  'bottom',
  'upRight',
  'downLeft',
  'upLeft',
  'downRight',
];
type Vec3 = [number, number, number];

const NORMALS: Readonly<Record<Facing, Vec3>> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  upRight: [Math.SQRT1_2, Math.SQRT1_2, 0],
  downLeft: [-Math.SQRT1_2, -Math.SQRT1_2, 0],
  upLeft: [-Math.SQRT1_2, Math.SQRT1_2, 0],
  downRight: [Math.SQRT1_2, -Math.SQRT1_2, 0],
};

/**
 * Faces in one plane, all pointing one way, as rectangles: rows `from` up to
 * `to`, each spanning `a` up to `b`.
 *
 * | Facing               | Plane                    | Rows                    | Span        |
 * | -------------------- | ------------------------ | ----------------------- | ----------- |
 * | front, back          | depth                    | document y              | document x  |
 * | right, left          | column edge              | document y              | depth       |
 * | top, bottom          | row edge                 | document x              | depth       |
 * | upRight, downLeft    | corner x - y + height    | half-diagonals, by 2y   | depth       |
 * | upLeft, downRight    | corner x + y             | half-diagonals, by 2y   | depth       |
 *
 * Slanted planes are the lines through pixel corners at 45°: falling ones
 * (top left to bottom right, as the document's y grows) and rising ones.
 * Each pixel a line crosses gives it two rows, one per half-diagonal.
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

/**
 * Calls `emit(a, b, index)` for each stretch of z in [run.start, run.end)
 * where the run's `quarter` (the one on the side facing the neighbor) has a
 * color and the neighbor's `coverQuarter` (the one on the facing side) doesn't
 * hide it.
 */
function uncovered(
  run: Run,
  quarter: Quarter,
  covers: readonly Run[] | undefined,
  coverQuarter: Quarter,
  hides: (cover: number, face: number) => boolean,
  emit: (a: number, b: number, index: number) => void,
): void {
  const index = quarterIndex(run.quarters, quarter);
  if (!index) return;
  let from = run.start;
  if (covers) {
    for (const cover of covers) {
      if (cover.end <= from) continue;
      if (cover.start >= run.end) break;
      if (!hides(quarterIndex(cover.quarters, coverQuarter), index)) continue;
      if (cover.start > from) emit(from, cover.start, index);
      from = cover.end;
      if (from >= run.end) return;
    }
  }
  if (from < run.end) emit(from, run.end, index);
}

/** Adds the quad of a merged rectangle of faces, in mesh coordinates. */
function faceQuad(builder: PartBuilder, facing: Facing, plane: number, rect: FaceRect, centerX: number, height: number): void {
  const { a, b, from, to } = rect;
  const rows = to - from;
  const normal = NORMALS[facing];
  // Slanted rows are half-diagonals: half a pixel each way.
  const t0 = from / 2;
  const t1 = to / 2;
  const length = t1 - t0;
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
    // A falling line's corners are at document (k + t, t), k = x - y.
    case 'upRight': {
      const k = plane - height;
      return builder.quad([k + t0 - centerX, height - t0, zAt(a)], [length, -length, 0], [0, 0, a - b], normal);
    }
    case 'downLeft': {
      const k = plane - height;
      return builder.quad([k + t1 - centerX, height - t1, zAt(a)], [-length, length, 0], [0, 0, a - b], normal);
    }
    // A rising line's corners are at document (k - t, t), k = x + y.
    case 'downRight':
      return builder.quad([plane - t0 - centerX, height - t0, zAt(a)], [-length, -length, 0], [0, 0, a - b], normal);
    case 'upLeft':
      return builder.quad([plane - t1 - centerX, height - t1, zAt(a)], [length, length, 0], [0, 0, a - b], normal);
  }
}

/** Collects one part's quads and triangles in typed arrays that grow as needed. */
class PartBuilder {
  private positions = new Float32Array(48);
  private normals = new Float32Array(48);
  private indices = new Uint32Array(24);
  private vertices = 0;
  private indexCount = 0;
  faces = 0;

  /** A quad with corners o, o+u, o+u+v, o+v. u × v must point along `normal`, out of the box. */
  quad(o: Vec3, u: Vec3, v: Vec3, normal: Vec3): void {
    this.reserve(4, 6);
    const { positions, normals } = this;
    const first = this.vertices;
    let i = first * 3;
    for (let corner = 0; corner < 4; corner++) {
      const withU = corner === 1 || corner === 2;
      const withV = corner >= 2;
      for (let axis = 0; axis < 3; axis++, i++) {
        positions[i] = o[axis] + (withU ? u[axis] : 0) + (withV ? v[axis] : 0);
        normals[i] = normal[axis];
      }
    }
    this.vertices += 4;
    this.index(first, first + 1, first + 2);
    this.index(first, first + 2, first + 3);
    this.faces++;
  }

  /** A triangle with corners p, q, r, counter-clockwise seen from where `normal` points. */
  triangle(p: Vec3, q: Vec3, r: Vec3, normal: Vec3): void {
    this.reserve(3, 3);
    const first = this.vertices;
    for (const [k, corner] of [p, q, r].entries()) {
      this.positions.set(corner, (first + k) * 3);
      this.normals.set(normal, (first + k) * 3);
    }
    this.vertices += 3;
    this.index(first, first + 1, first + 2);
    this.faces++;
  }

  build(index: number, color: Rgba): MeshPart {
    return {
      index,
      color,
      positions: this.positions.slice(0, this.vertices * 3),
      normals: this.normals.slice(0, this.vertices * 3),
      indices: this.indices.slice(0, this.indexCount),
    };
  }

  private index(a: number, b: number, c: number): void {
    const { indices } = this;
    indices[this.indexCount++] = a;
    indices[this.indexCount++] = b;
    indices[this.indexCount++] = c;
  }

  private reserve(vertices: number, indices: number): void {
    if ((this.vertices + vertices) * 3 > this.positions.length) {
      this.positions = grow(this.positions);
      this.normals = grow(this.normals);
    }
    if (this.indexCount + indices > this.indices.length) {
      const bigger = new Uint32Array(this.indices.length * 2);
      bigger.set(this.indices);
      this.indices = bigger;
    }
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
