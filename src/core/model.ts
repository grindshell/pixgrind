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
import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  directionAxis,
  directionSign,
  directionVector,
  FACINGS,
  facingFrame,
  facingVoxel,
  NEG_X,
  NEG_Y,
  NEG_Z,
  oppositeDirection,
  POS_X,
  POS_Y,
  POS_Z,
  stepsAlong,
  volumeSize,
  type Axis,
  type Direction,
  type Facing,
  type Volume,
} from './facing.ts';
import type { Layer } from './layer.ts';
import { weldPolygons } from './meshWeld.ts';
import { colorForIndex, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/*
 * The 3D model: every painted pixel of the visible layers becomes a box one
 * pixel wide and tall (or a diagonal half of one), reaching from its
 * extrusion's offset to its end toward its layer's camera (see `Facing`).
 * Layers stack boxes behind the same pixel, which is how a pixel gets gaps.
 * Built fresh from the document whenever it's needed; nothing here is saved.
 *
 * Coordinates are the volume's: x left to right, y top to bottom, z front to
 * back. A box is a line of voxels along its layer's axis (z for the front
 * and back, y for the top and bottom, x for the sides), and a diagonal pixel
 * cuts each voxel along that axis: every voxel is split by both diagonals
 * across one axis (its split axis) into four quarters, each touching one
 * side. A square fills all four, a diagonal half two. Colors are kept per
 * quarter, so where a diagonal pixel lies over a square one on a lower
 * layer, the square shows in the cut-off half.
 */

/** A quarter of a voxel, numbered as `QUARTER_DIRECTIONS` lists their sides. */
export type Quarter = 0 | 1 | 2 | 3;

/**
 * Per split axis, the side each quarter touches, going around the axis. For
 * z, the front's quarters clockwise from the top: top, right, bottom, left.
 * For y and x, the top's and the right side's, likewise as their cameras see
 * them.
 */
export const QUARTER_DIRECTIONS: ReadonlyArray<readonly [Direction, Direction, Direction, Direction]> = [
  [NEG_Y, POS_Z, POS_Y, NEG_Z],
  [POS_Z, POS_X, NEG_Z, NEG_X],
  [NEG_Y, POS_X, POS_Y, NEG_X],
];

/** Per split axis and direction, the quarter touching that side, or -1 for the two sides across the axis. */
const QUARTER_TOWARD: ReadonlyArray<readonly number[]> = QUARTER_DIRECTIONS.map((sides) =>
  Array.from({ length: 6 }, (_, direction) => sides.indexOf(direction as Direction)),
);

/** The quarter of a voxel split across `axis` that touches side `direction`, or -1 when none does. */
export function quarterToward(axis: Axis, direction: Direction): number {
  return QUARTER_TOWARD[axis][direction];
}

/**
 * Palette indices of a voxel's four quarters, packed as
 * `q0 | q1 << 8 | q2 << 16 | q3 << 24` (unsigned), 0 where a quarter is
 * empty.
 */
export type Quarters = number;

export function quarterIndex(quarters: Quarters, quarter: number): number {
  return (quarters >>> (quarter * 8)) & 0xff;
}

/** Quarters all of palette color `index`: a whole voxel. */
export function solidQuarters(index: number): Quarters {
  return index * 0x01010101;
}

/** What fills a voxel: its quarters, split across `axis` (z when all four are one color). */
export interface Content {
  axis: Axis;
  quarters: Quarters;
}

/** Which quarters a shape fills, one bit each, numbered as its layer's camera sees them: up, right, down, left. */
const SHAPE_QUARTERS: Readonly<Record<Shape, number>> = {
  [SQUARE]: 0b1111,
  [CUT_TOP_LEFT]: 0b0110,
  [CUT_TOP_RIGHT]: 0b1100,
  [CUT_BOTTOM_RIGHT]: 0b1001,
  [CUT_BOTTOM_LEFT]: 0b0011,
};

/** Packed `Quarters` bytes of 0xff where each quarter is filled. */
const ALL_QUARTERS = 0xffffffff;

/**
 * Per facing and shape, packed `Quarters` bytes of 0xff where it fills, in
 * the voxel's quarters: its camera's up, right, down and left are sides of
 * the volume, each touched by one quarter.
 */
const SHAPE_BYTES = {} as Record<Facing, readonly number[]>;
for (const facing of FACINGS) {
  const { right, down, toward } = facingFrame(facing);
  const sides = [oppositeDirection(down), right, down, oppositeDirection(right)];
  const quarter = sides.map((side) => QUARTER_TOWARD[directionAxis(toward)][side]);
  SHAPE_BYTES[facing] = SHAPES.map((shape) => {
    let filled = 0;
    for (let q = 0; q < 4; q++) if (SHAPE_QUARTERS[shape] & (1 << q)) filled += 0xff * 2 ** (quarter[q] * 8);
    return filled;
  });
}

/** Part of a pixel's column: z from `start` up to (not including) `end`, all filled alike. */
export interface Run extends Content {
  start: number;
  end: number;
}

/**
 * The model as runs per front pixel. Where boxes from several layers
 * overlap, the upper layer's color wins in the quarters it fills, as in the
 * 2D view.
 */
export interface VoxelModel extends Volume {
  /**
   * Runs per front pixel (`y * width + x`), sorted by z, never overlapping,
   * and never touching another run with the same content. Undefined where
   * there are none.
   */
  columns: ReadonlyArray<readonly Run[] | undefined>;
}

/**
 * Builds the model of the visible layers. Layer opacity isn't modeled (a
 * layer at 0% is left out like a hidden one), and neither are fully
 * transparent palette colors. Boxes reaching past the volume are cut at its
 * side.
 */
export function buildVoxelModel(doc: PixelDocument): VoxelModel {
  const { width, height, depth } = doc;
  const columns: Array<Run[] | undefined> = new Array<Run[] | undefined>(width * height);
  const shown = shownIndices(doc.palette);
  // Bottom to top, so upper layers overwrite where boxes overlap.
  for (const layer of modeledLayers(doc)) addLayer(columns, doc, layer, shown);
  return { width, height, depth, columns };
}

/**
 * What fills any one voxel, as `buildVoxelModel` would make it, without
 * building the rest: a function of (x, y, z), null where nothing does. For
 * views that need a few voxels fresh (the side view's slice).
 */
export function voxelSampler(doc: PixelDocument): (x: number, y: number, z: number) => Content | null {
  const shown = shownIndices(doc.palette);
  const layers = modeledLayers(doc).map((layer) => {
    const frame = facingFrame(layer.facing);
    const axis = directionAxis(frame.toward);
    return { layer, frame, axis, extent: volumeSize(doc, axis), bytes: SHAPE_BYTES[layer.facing] };
  });
  return (x, y, z) => {
    let content: Content | null = null;
    for (const { layer, frame, axis, extent, bytes } of layers) {
      const i = stepsAlong(doc, frame.down, x, y, z) * layer.width + stepsAlong(doc, frame.right, x, y, z);
      const index = layer.pixels[i];
      if (!shown[index]) continue;
      const extrusion = layer.extrusion[i];
      const w = stepsAlong(doc, frame.toward, x, y, z);
      if (w < extrusionOffset(extrusion) || w >= Math.min(extrusionEnd(extrusion), extent)) continue;
      const filled = bytes[extrusionShape(extrusion)];
      const quarters = (solidQuarters(index) & filled) >>> 0;
      content = content ? overlay(content, axis, quarters, filled) : normalized(axis, quarters);
    }
    return content;
  };
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

/** A piece of a run still to be laid in: its quarters, and which of them it fills (bytes of 0xff). */
interface Piece {
  start: number;
  end: number;
  quarters: Quarters;
  filled: number;
}

/** Lays a layer's boxes over the columns. */
function addLayer(columns: Array<Run[] | undefined>, volume: Volume, layer: Layer, shown: Uint8Array): void {
  const { pixels, extrusion } = layer;
  // Most sides of most documents are empty.
  let painted = false;
  for (let i = 0; i < pixels.length && !painted; i++) painted = shown[pixels[i]] === 1;
  if (!painted) return;
  const { right, down, toward } = facingFrame(layer.facing);
  const axis = directionAxis(toward);
  const extent = volumeSize(volume, axis);
  const bytes = SHAPE_BYTES[layer.facing];
  const { width, depth } = volume;
  const voxel = [0, 0, 0];
  const place = (direction: Direction, step: number) => {
    const a = directionAxis(direction);
    voxel[a] = directionSign(direction) > 0 ? step : volumeSize(volume, a) - 1 - step;
  };

  if (axis === AXIS_Z) {
    // Each box is one run of its pixel's column: x from u (mirrored for the back), y = v.
    const mirrored = directionSign(right) < 0;
    const fromBack = directionSign(toward) > 0;
    for (let v = 0; v < layer.height; v++) {
      for (let u = 0; u < layer.width; u++) {
        const i = v * layer.width + u;
        const index = pixels[i];
        if (!shown[index]) continue;
        const from = extrusionOffset(extrusion[i]);
        const to = Math.min(extrusionEnd(extrusion[i]), extent);
        if (from >= to) continue;
        const start = fromBack ? from : extent - to;
        const filled = bytes[extrusionShape(extrusion[i])];
        const c = v * width + (mirrored ? width - 1 - u : u);
        columns[c] = insertRun(columns[c], start, start + to - from, axis, (solidQuarters(index) & filled) >>> 0, filled);
      }
    }
    return;
  }

  // Boxes across z: a voxel in each column they cross. Gather each column's
  // voxels front to back (the pixel art's columns or rows in order of z),
  // joining them into runs, then lay those in.
  const pending = new Map<number, Piece[]>();
  const along = directionAxis(right) === AXIS_Z ? right : down;
  const lines = along === right ? layer.height : layer.width;
  for (let z = 0; z < depth; z++) {
    const at = directionSign(along) > 0 ? z : depth - 1 - z;
    for (let k = 0; k < lines; k++) {
      const u = along === right ? at : k;
      const v = along === right ? k : at;
      const i = v * layer.width + u;
      const index = pixels[i];
      if (!shown[index]) continue;
      const from = extrusionOffset(extrusion[i]);
      const to = Math.min(extrusionEnd(extrusion[i]), extent);
      const filled = bytes[extrusionShape(extrusion[i])];
      const quarters = (solidQuarters(index) & filled) >>> 0;
      place(right, u);
      place(down, v);
      for (let w = from; w < to; w++) {
        place(toward, w);
        const c = voxel[1] * width + voxel[0];
        let pieces = pending.get(c);
        if (!pieces) pending.set(c, (pieces = []));
        const last = pieces[pieces.length - 1];
        if (last?.end === z && last.quarters === quarters && last.filled === filled) last.end = z + 1;
        else pieces.push({ start: z, end: z + 1, quarters, filled });
      }
    }
  }
  for (const [c, pieces] of pending) {
    for (const { start, end, quarters, filled } of pieces) columns[c] = insertRun(columns[c], start, end, axis, quarters, filled);
  }
}

/** Content with the axis made canonical: z when all four quarters are one color. */
function normalized(axis: Axis, quarters: Quarters): Content {
  return { axis: quarters === solidQuarters(quarters & 0xff) ? AXIS_Z : axis, quarters };
}

/**
 * `content` with `quarters` (split across `axis`) laid over it: they replace
 * what was there in the quarters `filled` covers, and the others keep their
 * colors. Quarters split across different axes don't line up; then the lower
 * content is kept only on the sides both split alike (the axis neither is
 * split across), and the rest of the voxel goes to the upper.
 */
function overlay(content: Content, axis: Axis, quarters: Quarters, filled: number): Content {
  if (filled === ALL_QUARTERS) return normalized(axis, quarters);
  const solid = content.quarters === solidQuarters(content.quarters & 0xff);
  if (content.axis === axis || solid) return normalized(axis, ((content.quarters & ~filled) | quarters) >>> 0);
  let result = quarters;
  for (let q = 0; q < 4; q++) {
    if (quarterIndex(filled, q)) continue;
    const below = QUARTER_TOWARD[content.axis][QUARTER_DIRECTIONS[axis][q]];
    if (below >= 0) result += quarterIndex(content.quarters, below) * 2 ** (q * 8);
  }
  return normalized(axis, result);
}

/**
 * `runs` (or none) with `quarters` (split across `axis`) laid over z from
 * `start` to `end`, as `overlay` does. Keeps the `columns` invariants.
 */
function insertRun(
  runs: readonly Run[] | undefined,
  start: number,
  end: number,
  axis: Axis,
  quarters: Quarters,
  filled: number,
): Run[] {
  const freshAxis = quarters === solidQuarters(quarters & 0xff) ? AXIS_Z : axis;
  if (!runs) return [{ start, end, axis: freshAxis, quarters }];
  const fresh: Content = { axis: freshAxis, quarters };
  const pieces: Run[] = [];
  let cursor = start;
  for (const run of runs) {
    if (run.end <= start || run.start >= end) {
      pieces.push(run);
      continue;
    }
    if (run.start < start) pieces.push({ ...run, end: start });
    if (run.start > cursor) pieces.push({ start: cursor, end: run.start, ...fresh });
    const overlapEnd = Math.min(run.end, end);
    pieces.push({ start: Math.max(run.start, start), end: overlapEnd, ...overlay(run, axis, quarters, filled) });
    cursor = overlapEnd;
    if (run.end > end) pieces.push({ ...run, start: end });
  }
  if (cursor < end) pieces.push({ start: cursor, end, ...fresh });
  pieces.sort((a, b) => a.start - b.start);
  const merged: Run[] = [];
  for (const next of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.end === next.start && last.quarters === next.quarters && last.axis === next.axis) {
      merged[merged.length - 1] = { ...last, end: next.end };
    } else {
      merged.push(next);
    }
  }
  return merged;
}

/** The run at depth z in a column, if any. */
export function runAt(runs: readonly Run[] | undefined, z: number): Run | undefined {
  return runs?.find((run) => run.start <= z && z < run.end);
}

/**
 * The color (0 for none) a viewer on side `side` of a voxel sees through it,
 * in the half of their view toward `up` (`upper`) or the other: the quarter
 * on their side, else those beyond it in that half, else the far one. Along
 * the split axis each half looks down one quarter alone.
 */
export function seenFrom(content: Content, side: Direction, up: Direction, upper: boolean): number {
  const { axis, quarters } = content;
  const quarter = (direction: Direction) => {
    const q = QUARTER_TOWARD[axis][direction];
    return q < 0 ? 0 : quarterIndex(quarters, q);
  };
  const half = upper ? up : oppositeDirection(up);
  if (directionAxis(side) === axis) return quarter(half);
  const near = quarter(side) || (directionAxis(up) !== axis ? quarter(half) : 0);
  if (near) return near;
  // Halves split along the axis: both quarters beside the line of sight meet in the middle.
  const across = QUARTER_DIRECTIONS[axis].find((direction) => directionAxis(direction) !== directionAxis(side))!;
  return (
    (directionAxis(up) === axis ? quarter(across) || quarter(oppositeDirection(across)) : 0) ||
    quarter(oppositeDirection(side))
  );
}

/** An image of palette indices (0 for none), row-major. */
export interface IndexImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * The model seen straight on by a viewer on side `side`, as an image whose
 * columns run toward `across` and rows toward `down` (both square to
 * `side`): the color the nearest voxel shows in each pixel, with two image
 * rows per pixel, the half toward the top (`seenFrom`'s upper) then the
 * other.
 */
export function viewModel(model: VoxelModel, side: Direction, across: Direction, down: Direction): IndexImage {
  const width = volumeSize(model, directionAxis(across));
  const height = volumeSize(model, directionAxis(down)) * 2;
  const pixels = new Uint8Array(width * height);
  const nearest = new Int32Array(width * height).fill(-1);
  const up = oppositeDirection(down);
  const { columns } = model;
  // Seen along z, a run shows only its nearest end.
  const alongZ = directionAxis(side) === AXIS_Z;
  for (let y = 0; y < model.height; y++) {
    for (let x = 0; x < model.width; x++) {
      for (const run of columns[y * model.width + x] ?? []) {
        const first = alongZ && directionSign(side) > 0 ? run.end - 1 : run.start;
        const last = alongZ && directionSign(side) < 0 ? run.start + 1 : run.end;
        for (let z = first; z < last; z++) {
          const near = stepsAlong(model, side, x, y, z);
          const at = stepsAlong(model, down, x, y, z) * 2 * width + stepsAlong(model, across, x, y, z);
          for (const [half, upper] of [
            [0, true],
            [width, false],
          ] as const) {
            if (near <= nearest[at + half]) continue;
            const index = seenFrom(run, side, up, upper);
            if (!index) continue;
            nearest[at + half] = near;
            pixels[at + half] = index;
          }
        }
      }
    }
  }
  return { width, height, pixels };
}

/**
 * The model of every other side's layers as `facing`'s camera sees it, at
 * its plane's size, one color per pixel: a guide for drawing that side to
 * match the rest.
 */
export function otherSidesView(doc: PixelDocument, facing: Facing): IndexImage {
  const model = buildVoxelModel({ ...doc, layers: doc.layers.filter((layer) => layer.facing !== facing) });
  const { right, down, toward } = facingFrame(facing);
  const view = viewModel(model, toward, right, down);
  const { width } = view;
  const height = view.height / 2;
  const pixels = new Uint8Array(width * height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) pixels[v * width + u] = view.pixels[v * 2 * width + u] || view.pixels[(v * 2 + 1) * width + u];
  }
  return { width, height, pixels };
}

/**
 * What fills each voxel of one slice of the volume: the voxels behind
 * column `column` of `facing`'s plane, as `buildVoxelModel` would make them.
 * Laid out `extent` wide (cells counted from the far side toward the
 * camera, as boxes are) by the plane's rows, with `axes` and `quarters`
 * per cell (quarters 0 where it's empty). Works layer by layer through the
 * pixels that reach the slice, so it's quick enough to redo on every change.
 */
export interface Slice {
  width: number;
  height: number;
  axes: Uint8Array;
  quarters: Uint32Array;
}

export function sliceOf(doc: PixelDocument, facing: Facing, column: number): Slice {
  const frame = facingFrame(facing);
  const sliceAxis = directionAxis(frame.right);
  const width = volumeSize(doc, directionAxis(frame.toward));
  const height = volumeSize(doc, directionAxis(frame.down));
  const slice: Slice = { width, height, axes: new Uint8Array(width * height), quarters: new Uint32Array(width * height) };
  // The slice is where the volume's coordinate along `sliceAxis` is `at`.
  const at = directionSign(frame.right) > 0 ? column : volumeSize(doc, sliceAxis) - 1 - column;
  const shown = shownIndices(doc.palette);
  const put = (voxel: readonly number[], axis: Axis, quarters: Quarters, filled: number) => {
    const [x, y, z] = voxel;
    const cell = stepsAlong(doc, frame.down, x, y, z) * width + stepsAlong(doc, frame.toward, x, y, z);
    const below = slice.quarters[cell];
    const content = below ? overlay({ axis: slice.axes[cell] as Axis, quarters: below }, axis, quarters, filled) : normalized(axis, quarters);
    slice.axes[cell] = content.axis;
    slice.quarters[cell] = content.quarters;
  };
  for (const layer of modeledLayers(doc)) {
    const { right, down, toward } = facingFrame(layer.facing);
    const axis = directionAxis(toward);
    const extent = volumeSize(doc, axis);
    const bytes = SHAPE_BYTES[layer.facing];
    /** Lays in the voxels of pixel (u, v)'s box from `from` up to `to`. */
    const box = (u: number, v: number, from: number, to: number) => {
      const i = v * layer.width + u;
      const index = layer.pixels[i];
      if (!shown[index]) return;
      const extrusion = layer.extrusion[i];
      const filled = bytes[extrusionShape(extrusion)];
      const quarters = (solidQuarters(index) & filled) >>> 0;
      const start = Math.max(from, extrusionOffset(extrusion));
      const end = Math.min(to, extrusionEnd(extrusion), extent);
      for (let w = start; w < end; w++) put(facingVoxel(doc, layer.facing, u, v, w), axis, quarters, filled);
    };
    const steps = (direction: Direction) => (directionSign(direction) > 0 ? at : volumeSize(doc, sliceAxis) - 1 - at);
    if (axis === sliceAxis) {
      // Boxes cross the slice: each pixel's reaches it at most once.
      const w = steps(toward);
      for (let v = 0; v < layer.height; v++) for (let u = 0; u < layer.width; u++) box(u, v, w, w + 1);
    } else if (directionAxis(right) === sliceAxis) {
      // The slice is one column of the layer's pixels, their boxes lying in it.
      const u = steps(right);
      for (let v = 0; v < layer.height; v++) box(u, v, 0, extent);
    } else {
      const v = steps(down);
      for (let u = 0; u < layer.width; u++) box(u, v, 0, extent);
    }
  }
  return slice;
}

/** The triangles of one palette color. */
export interface MeshPart {
  /** Palette index. */
  index: number;
  color: Rgba;
  /** x, y, z per vertex. */
  positions: Float32Array;
  /**
   * Unit normal per vertex, parallel to `positions`. Null for watertight
   * meshes, whose vertices are shared by faces facing different ways: those
   * are shaded flat, from each triangle's winding.
   */
  normals: Float32Array | null;
  /** Three vertex numbers per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
}

export interface MeshOptions {
  /**
   * Make each color a closed, manifold surface (see `weldPolygons`): faces
   * are hidden only by the same color, so where two colors touch both get a
   * face, and vertices are shared. For export to tools that need watertight
   * solids. Otherwise faces an opaque neighbor covers are left out and every
   * face has its own vertices, which is fewer faces and what the 3D view
   * draws.
   */
  watertight?: boolean;
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
 * one unit per pixel. The volume is centered on x and z, with y = 0 at its
 * bottom.
 */

/**
 * Planes faces merge in, by the lines their rectangles' corners follow:
 *
 * | Family         | Plane              | Rows                          | Span                        |
 * | -------------- | ------------------ | ----------------------------- | --------------------------- |
 * | FACE_X         | x                  | y                             | z                           |
 * | FACE_Y         | y                  | x                             | z                           |
 * | FACE_Z         | z                  | y                             | x                           |
 * | Z_FALL, Z_RISE | x − y, x + y       | half-diagonals, by y (2y, …)  | z                           |
 * | Y_DIFF, Y_SUM  | x − z, x + z       | y                             | half-diagonals, by x        |
 * | X_DIFF, X_SUM  | y − z, y + z       | half-diagonals, by y          | x                           |
 *
 * Slanted planes are the 45° lines through voxel corners across a split
 * axis; each voxel a line crosses gives it two half-diagonals. Pixels are
 * visited row by row and runs front to back, which feeds the axis planes and
 * the z-split slants their rows in order. Slants split across x and y aren't
 * fed in order, so their planes sort them first (`FacePlane`'s `buffered`);
 * they come only from diagonal pixels drawn on the sides, top or bottom.
 */
const FACE_X = 0;
const FACE_Y = 1;
const FACE_Z = 2;
const Z_FALL = 3;
const Z_RISE = 4;
const Y_DIFF = 5;
const Y_SUM = 6;
const X_DIFF = 7;
const X_SUM = 8;
const FIRST_BUFFERED = Y_DIFF;
/** Plane numbers, which may be negative for slants, are offset by this in keys. */
const PLANE_REACH = 4096;

/**
 * Per family, where a point of a plane is: x, y and z each as
 * [per row, per span, per plane] times the point's row, span and plane
 * number, as in the table above (a half-diagonal is half a voxel along each
 * of its axes).
 */
const PLANE_PLACES: ReadonlyArray<readonly [Vec3, Vec3, Vec3]> = [
  // FACE_X, FACE_Y, FACE_Z
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  // Z_FALL (x = plane + t, y = t), Z_RISE (x = plane - t, y = t)
  [[0.5, 0, 1], [0.5, 0, 0], [0, 1, 0]],
  [[-0.5, 0, 1], [0.5, 0, 0], [0, 1, 0]],
  // Y_DIFF (x = t, z = t - plane), Y_SUM (x = t, z = plane - t)
  [[0, 0.5, 0], [1, 0, 0], [0, 0.5, -1]],
  [[0, 0.5, 0], [1, 0, 0], [0, -0.5, 1]],
  // X_DIFF (y = t, z = t - plane), X_SUM (y = t, z = plane - t)
  [[0, 1, 0], [0.5, 0, 0], [0.5, 0, -1]],
  [[0, 1, 0], [0.5, 0, 0], [-0.5, 0, 1]],
];

type Vec3 = [number, number, number];

/** A number for a face's normal, from its steps along x, y and z (each -1, 0 or 1). */
function orientation([x, y, z]: readonly number[]): number {
  return (x + 1) * 9 + (y + 1) * 3 + (z + 1);
}

/** Unit normals in mesh coordinates, by `orientation`. */
const MESH_NORMALS: readonly Vec3[] = Array.from({ length: 27 }, (_, key) => {
  const step = [Math.floor(key / 9) - 1, (Math.floor(key / 3) % 3) - 1, (key % 3) - 1];
  const length = Math.hypot(...step) || 1;
  // y and z flip between the volume's coordinates and the mesh's; 0 - v avoids -0.
  return [step[0] / length, (0 - step[1]) / length, (0 - step[2]) / length];
});

const DIRECTION_ORIENTATION: readonly number[] = Array.from({ length: 6 }, (_, d) => orientation(directionVector(d as Direction)));

/** Per split axis and pair of neighboring quarters (q, q + 1), the orientation of q's slanted face (toward q + 1). */
const SLANT_ORIENTATION: ReadonlyArray<readonly number[]> = QUARTER_DIRECTIONS.map((sides) =>
  sides.map((side, q) => {
    const from = directionVector(side);
    const to = directionVector(sides[(q + 1) % 4]);
    return orientation([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  }),
);

/**
 * The half-diagonals between quarters q and q + 1 of a voxel, per split
 * axis: their plane family and which half of the voxel's diagonal they are
 * (0 from the lower corner to the middle, 1 from the middle on).
 */
const SLANT_PAIRS: ReadonlyArray<ReadonlyArray<{ family: number; half: number }>> = [
  // x: corners (y, z + 1), (y + 1, z + 1), (y + 1, z), (y, z).
  [
    { family: X_SUM, half: 0 },
    { family: X_DIFF, half: 1 },
    { family: X_SUM, half: 1 },
    { family: X_DIFF, half: 0 },
  ],
  // y: corners (x + 1, z + 1), (x + 1, z), (x, z), (x, z + 1).
  [
    { family: Y_DIFF, half: 1 },
    { family: Y_SUM, half: 1 },
    { family: Y_DIFF, half: 0 },
    { family: Y_SUM, half: 0 },
  ],
  // z: corners (x + 1, y), (x + 1, y + 1), (x, y + 1), (x, y).
  [
    { family: Z_RISE, half: 0 },
    { family: Z_FALL, half: 1 },
    { family: Z_RISE, half: 1 },
    { family: Z_FALL, half: 0 },
  ],
];
/** The order z-split slants are visited in, so each plane gets its rows in order: per line, 2y before 2y + 1. */
const Z_SLANT_ORDER = [3, 1, 0, 2];

/**
 * Per split axis and pair of neighboring quarters (q, q + 1), the corner
 * line they share: its offset from the voxel's lowest corner along each
 * axis (0 along the split axis, which the line runs along).
 */
const SLANT_CORNERS: ReadonlyArray<readonly Vec3[]> = QUARTER_DIRECTIONS.map((sides) =>
  sides.map((side, q) => {
    const a = directionVector(side);
    const b = directionVector(sides[(q + 1) % 4]);
    return [0, 1, 2].map((k) => (a[k] + b[k] > 0 ? 1 : 0)) as Vec3;
  }),
);

/** Coordinates of voxel corners reach the volume's size, at most this. */
const EDGE_SPAN = 1026;

/** A key for color `index`'s unit edge from corner (x, y, z) one step along `axis`. */
function edgeKey(index: number, axis: Axis, x: number, y: number, z: number): number {
  return (((index * 3 + axis) * EDGE_SPAN + x) * EDGE_SPAN + y) * EDGE_SPAN + z;
}

/**
 * The edges where slanted faces of each color end: corner lines of split
 * voxels where a quarter of that color meets one of another (`edgeKey`s).
 * There a color's solid thins to a line, and may touch another solid of the
 * same color along it; in a watertight mesh, faces of that color mustn't
 * merge across such an edge, or the welded mesh would have an edge lying
 * inside a face instead of along the face's edges.
 */
function slantEnds(model: VoxelModel, hides: (cover: number, face: number) => boolean): SlantEnds {
  const ends: SlantEnds = { edges: new Set<number>(), colors: new Set<number>() };
  const { width, height, columns } = model;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const runs = columns[y * width + x];
      for (let k = 0; runs && k < runs.length; k++) {
        const run = runs[k];
        if (run.quarters === solidQuarters(run.quarters & 0xff)) continue;
        for (let q = 0; q < 4; q++) {
          const a = quarterIndex(run.quarters, q);
          const b = quarterIndex(run.quarters, (q + 1) % 4);
          if (a === b) continue;
          const colors = [a && !hides(b, a) ? a : 0, b && !hides(a, b) ? b : 0].filter(Boolean);
          const [ox, oy, oz] = SLANT_CORNERS[run.axis][q];
          for (const index of colors) {
            ends.colors.add(index);
            for (let z = run.start; z < run.end; z++) ends.edges.add(edgeKey(index, run.axis, x + ox, y + oy, z + oz));
          }
        }
      }
    }
  }
  return ends;
}

/** The edges `slantEnds` finds (`edgeKey`s), and the colors that have any. */
interface SlantEnds {
  edges: Set<number>;
  colors: Set<number>;
}

/** Whether a rectangle may join a span at `at` in `row`, and grow into `row` over `a` up to `b`. */
interface MergeRules {
  canJoin(row: number, at: number, index: number): boolean;
  canGrow(row: number, a: number, b: number, index: number): boolean;
}

/**
 * The rules keeping one plane's faces from merging across `ends` (see
 * `slantEnds`): the edges a join or a growth would cross, per family (see
 * the table of planes). Slants merge freely between a voxel's two
 * half-diagonals (odd rows or spans) and along their split axis.
 */
function mergeRules(family: number, p: number, { edges, colors }: SlantEnds): MergeRules {
  const ended = (index: number, axis: Axis, x: number, y: number, z: number) =>
    colors.has(index) && edges.has(edgeKey(index, axis, x, y, z));
  /** Whether any unit edge from `a` up to `b` along `axis` has ended, its corners placed by `at`. */
  const anyEnded = (index: number, axis: Axis, a: number, b: number, at: (s: number) => Vec3) => {
    if (!colors.has(index)) return false;
    for (let s = a; s < b; s++) if (edges.has(edgeKey(index, axis, ...at(s)))) return true;
    return false;
  };
  const free = () => true;
  const half = (t: number) => t / 2;
  switch (family) {
    case FACE_X:
      return {
        canJoin: (y, z, index) => !ended(index, AXIS_Y, p, y, z),
        canGrow: (y, a, b, index) => !anyEnded(index, AXIS_Z, a, b, (z) => [p, y, z]),
      };
    case FACE_Y:
      return {
        canJoin: (x, z, index) => !ended(index, AXIS_X, x, p, z),
        canGrow: (x, a, b, index) => !anyEnded(index, AXIS_Z, a, b, (z) => [x, p, z]),
      };
    case FACE_Z:
      return {
        canJoin: (y, x, index) => !ended(index, AXIS_Y, x, y, p),
        canGrow: (y, a, b, index) => !anyEnded(index, AXIS_X, a, b, (x) => [x, y, p]),
      };
    case Z_FALL:
    case Z_RISE: {
      const sign = family === Z_FALL ? 1 : -1;
      return {
        canJoin: free,
        canGrow: (t, a, b, index) => t % 2 === 1 || !anyEnded(index, AXIS_Z, a, b, (z) => [p + sign * half(t), half(t), z]),
      };
    }
    case Y_DIFF:
    case Y_SUM: {
      const z = (t: number) => (family === Y_DIFF ? half(t) - p : p - half(t));
      return { canJoin: (y, t, index) => t % 2 === 1 || !ended(index, AXIS_Y, half(t), y, z(t)), canGrow: free };
    }
    default: {
      const z = (t: number) => (family === X_DIFF ? half(t) - p : p - half(t));
      return {
        canJoin: free,
        canGrow: (t, a, b, index) => t % 2 === 1 || !anyEnded(index, AXIS_X, a, b, (x) => [x, half(t), z(t)]),
      };
    }
  }
}

/**
 * The visible faces of the model. A face is left out where a neighboring
 * voxel covers it: one that's opaque, or the same color (so a translucent
 * color shows no faces inside itself). Side faces are cut where only part of
 * them is covered. Diagonal pixels add slanted faces between their quarters.
 *
 * Faces of one color that lie side by side in one plane are merged into
 * rectangles (`FacePlane`), so a flat area or a straight edge, slanted ones
 * included, takes one quad however many pixels it spans. Faces of voxels
 * split across them (the ends of a diagonal pixel's box) are triangles, not
 * merged.
 */
export function buildMesh(model: VoxelModel, palette: Palette, { watertight = false }: MeshOptions = {}): ModelMesh {
  const { width, height, depth, columns } = model;
  const opaque = new Uint8Array(256);
  for (let index = 1; index < 256; index++) opaque[index] = alpha(colorForIndex(palette, index)) === 255 ? 1 : 0;
  /** Whether color `cover` (0 for none) hides a face of color `face` it touches. */
  const hides = watertight
    ? (cover: number, face: number) => cover === face
    : (cover: number, face: number) => cover !== 0 && (opaque[cover] === 1 || cover === face);
  const neighbor = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? columns[y * width + x] : undefined);

  const builders = new Map<number, PartBuilder>();
  const part = (index: number) => {
    let builder = builders.get(index);
    if (!builder) builders.set(index, (builder = new PartBuilder()));
    return builder;
  };
  const centerX = width / 2;
  const centerZ = depth / 2;
  const toMesh = (x: number, y: number, z: number): Vec3 => [x - centerX, height - y, centerZ - z];

  // Corners of the rectangle being emitted, in mesh coordinates.
  const corners = new Float64Array(12);
  const emitRect = (family: number, plane: number, { a, b, from, to, index }: FaceRect, normal: Vec3) => {
    const [px, py, pz] = PLANE_PLACES[family];
    for (let k = 0; k < 4; k++) {
      // Going around: (row from, span a), (from, b), (to, b), (to, a).
      const row = k < 2 ? from : to;
      const span = k === 0 || k === 3 ? a : b;
      corners[k * 3] = px[0] * row + px[1] * span + px[2] * plane - centerX;
      corners[k * 3 + 1] = height - (py[0] * row + py[1] * span + py[2] * plane);
      corners[k * 3 + 2] = centerZ - (pz[0] * row + pz[1] * span + pz[2] * plane);
    }
    part(index).quad(corners, normal);
  };

  // Per family and facing, the planes by number (offset by PLANE_REACH).
  const planes: Array<Array<FacePlane | undefined>> = [];
  const allPlanes: FacePlane[] = [];
  const ends = watertight ? slantEnds(model, hides) : null;
  const add = (family: number, facing: number, plane: number, row: number, a: number, b: number, index: number) => {
    // Allocated whole, so the array stays fast to index (a far index into an empty one makes it a dictionary).
    const kind = (planes[family * 27 + facing] ??= new Array<FacePlane | undefined>(PLANE_REACH * 2));
    let faces = kind[plane + PLANE_REACH];
    if (!faces) {
      const normal = MESH_NORMALS[facing];
      const rules = ends?.edges.size ? mergeRules(family, plane, ends) : null;
      faces = new FacePlane((rect) => emitRect(family, plane, rect, normal), family >= FIRST_BUFFERED, rules);
      kind[plane + PLANE_REACH] = faces;
      allPlanes.push(faces);
    }
    faces.add(row, a, b, index);
  };

  /**
   * What a voxel's face on side `d` shows, as four triangles (packed like
   * `Quarters`), each along one edge, in the order `QUARTER_DIRECTIONS` goes
   * around that side's axis: the quarters when the voxel is split across it,
   * else the quarter touching that side four times.
   */
  const faceLabels = (content: Content, d: Direction): Quarters =>
    content.axis === directionAxis(d)
      ? content.quarters
      : solidQuarters(quarterIndex(content.quarters, QUARTER_TOWARD[content.axis][d]));
  /** The triangles of `labels` that `cover`'s (the touching face's, 0 for none) don't hide. */
  const shownLabels = (labels: Quarters, cover: Quarters): Quarters => {
    // Most faces are whole on both sides.
    const first = labels & 0xff;
    if (labels === solidQuarters(first) && cover === solidQuarters(cover & 0xff)) {
      return first && !hides(cover & 0xff, first) ? labels : 0;
    }
    let shown = 0;
    for (let q = 0; q < 4; q++) {
      const index = quarterIndex(labels, q);
      if (index && !hides(quarterIndex(cover, q), index)) shown += index * 2 ** (q * 8);
    }
    return shown;
  };
  const whole = (labels: Quarters) => labels === solidQuarters(labels & 0xff);

  /**
   * The face of voxel (x, y, z) on side `d` as triangles: halves where two
   * neighboring triangles share a color, else quarters.
   */
  const faceTriangles = (x: number, y: number, z: number, d: Direction, labels: Quarters) => {
    const edges = QUARTER_DIRECTIONS[directionAxis(d)];
    const [nx, ny, nz] = directionVector(d);
    const [cx, cy, cz] = [x + 0.5 + nx / 2, y + 0.5 + ny / 2, z + 0.5 + nz / 2];
    /** The face's corner between the edges toward `e1` and `e2`. */
    const at = (e1: Direction, e2: Direction): Vec3 => {
      const [ax, ay, az] = directionVector(e1);
      const [bx, by, bz] = directionVector(e2);
      return toMesh(cx + (ax + bx) / 2, cy + (ay + by) / 2, cz + (az + bz) / 2);
    };
    const normal = MESH_NORMALS[DIRECTION_ORIENTATION[d]];
    const done = [false, false, false, false];
    for (let q = 0; q < 4; q++) {
      const n = (q + 1) % 4;
      const index = quarterIndex(labels, q);
      if (index && !done[q] && !done[n] && index === quarterIndex(labels, n)) {
        part(index).triangle(at(edges[q], edges[(q + 3) % 4]), at(edges[q], edges[n]), at(edges[n], edges[(q + 2) % 4]), normal);
        done[q] = done[n] = true;
      }
    }
    for (let q = 0; q < 4; q++) {
      const index = quarterIndex(labels, q);
      if (index && !done[q]) {
        part(index).triangle(toMesh(cx, cy, cz), at(edges[q], edges[(q + 3) % 4]), at(edges[q], edges[(q + 1) % 4]), normal);
      }
    }
  };

  /** A run's front (`NEG_Z`) or back face, against the run touching it there, if any. */
  const endFace = (run: Run, cover: Run | undefined, d: Direction, x: number, y: number) => {
    const shown = shownLabels(faceLabels(run, d), cover ? faceLabels(cover, oppositeDirection(d)) : 0);
    if (!shown) return;
    const plane = d === NEG_Z ? run.start : run.end;
    if (whole(shown)) add(FACE_Z, DIRECTION_ORIENTATION[d], plane, y, x, x + 1, shown & 0xff);
    else faceTriangles(x, y, d === NEG_Z ? run.start : run.end - 1, d, shown);
  };

  /**
   * A run's faces on side `d` (across x or y), cut into the stretches of z
   * where what's in the neighboring column, `covers`, stays the same.
   */
  const sideFaces = (run: Run, d: Direction, covers: readonly Run[] | undefined, x: number, y: number) => {
    const labels = faceLabels(run, d);
    let from = run.start;
    for (const cover of covers ?? []) {
      if (cover.end <= from) continue;
      if (cover.start >= run.end) break;
      if (cover.start > from) sideStretch(labels, 0, d, x, y, from, cover.start);
      const to = Math.min(run.end, cover.end);
      sideStretch(labels, faceLabels(cover, oppositeDirection(d)), d, x, y, Math.max(from, cover.start), to);
      from = to;
    }
    if (from < run.end) sideStretch(labels, 0, d, x, y, from, run.end);
  };
  /** The faces on side `d` of column (x, y)'s voxels from z = a up to b, showing `labels` against `cover`. */
  const sideStretch = (labels: Quarters, cover: Quarters, d: Direction, x: number, y: number, a: number, b: number) => {
    const shown = shownLabels(labels, cover);
    if (!shown) return;
    if (!whole(shown)) {
      for (let z = a; z < b; z++) faceTriangles(x, y, z, d, shown);
    } else if (directionAxis(d) === AXIS_X) {
      add(FACE_X, DIRECTION_ORIENTATION[d], x + (d === POS_X ? 1 : 0), y, a, b, shown & 0xff);
    } else {
      add(FACE_Y, DIRECTION_ORIENTATION[d], y + (d === POS_Y ? 1 : 0), x, a, b, shown & 0xff);
    }
  };

  /**
   * Faces inside a run split across x or y, between each voxel and the next
   * along z: one voxel's back quarter meets the next one's front quarter,
   * which may differ.
   */
  const betweenVoxels = (run: Run, x: number, y: number) => {
    const back = quarterIndex(run.quarters, QUARTER_TOWARD[run.axis][POS_Z]);
    const front = quarterIndex(run.quarters, QUARTER_TOWARD[run.axis][NEG_Z]);
    if (back === front) return;
    for (let z = run.start + 1; z < run.end; z++) {
      if (back && !hides(front, back)) add(FACE_Z, DIRECTION_ORIENTATION[POS_Z], z, y, x, x + 1, back);
      if (front && !hides(back, front)) add(FACE_Z, DIRECTION_ORIENTATION[NEG_Z], z, y, x, x + 1, front);
    }
  };

  /** The slanted faces between quarters q and q + 1 of a split voxel (or run), if they differ. */
  const slant = (content: Content, q: number, plane: number, row: number, a: number, b: number) => {
    const n = (q + 1) % 4;
    const iq = quarterIndex(content.quarters, q);
    const iN = quarterIndex(content.quarters, n);
    if (iq === iN) return;
    const { family } = SLANT_PAIRS[content.axis][q];
    const facing = SLANT_ORIENTATION[content.axis][q];
    if (iq && !hides(iN, iq)) add(family, facing, plane, row, a, b, iq);
    if (iN && !hides(iq, iN)) add(family, 26 - facing, plane, row, a, b, iN);
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
        endFace(run, before?.end === run.start ? before : undefined, NEG_Z, x, y);
        endFace(run, after?.start === run.end ? after : undefined, POS_Z, x, y);
        sideFaces(run, POS_X, right, x, y);
        sideFaces(run, NEG_X, left, x, y);
        sideFaces(run, NEG_Y, above, x, y);
        sideFaces(run, POS_Y, below, x, y);
        if (run.axis !== AXIS_Z) betweenVoxels(run, x, y);
        // Slants of voxels split across y or x: one voxel at a time, since they cross z.
        if (run.axis === AXIS_Y) {
          for (let z = run.start; z < run.end; z++) {
            for (let q = 0; q < 4; q++) {
              const { family, half } = SLANT_PAIRS[AXIS_Y][q];
              const t = 2 * x + half;
              slant(run, q, family === Y_DIFF ? x - z : x + z + 1, y, t, t + 1);
            }
          }
        } else if (run.axis === AXIS_X) {
          for (let z = run.start; z < run.end; z++) {
            for (let q = 0; q < 4; q++) {
              const { family, half } = SLANT_PAIRS[AXIS_X][q];
              slant(run, q, family === X_DIFF ? y - z : y + z + 1, 2 * y + half, x, x + 1);
            }
          }
        }
      }
      // Slants of voxels split across z run along whole runs, a half-diagonal
      // at a time so each line gets its rows in order.
      for (const q of Z_SLANT_ORDER) {
        const { family, half } = SLANT_PAIRS[AXIS_Z][q];
        const plane = family === Z_FALL ? x - y : x + y + 1;
        for (const run of runs) if (run.axis === AXIS_Z) slant(run, q, plane, 2 * y + half, run.start, run.end);
      }
    }
  }

  for (const faces of allPlanes) faces.finish();

  const sorted = [...builders].sort(([a], [b]) => a - b);
  const parts = sorted.map(([index, builder]) =>
    watertight ? builder.buildWelded(index, colorForIndex(palette, index)) : builder.build(index, colorForIndex(palette, index)),
  );
  return { parts, faces: sorted.reduce((sum, [, builder]) => sum + builder.faces, 0), bounds: meshBounds(parts) };
}

/** A rectangle of faces in one plane: rows `from` up to `to`, each spanning `a` up to `b`. */
interface FaceRect {
  a: number;
  b: number;
  index: number;
  from: number;
  to: number;
}

/**
 * Merges the faces of one plane: row by row in order, each row's spans
 * sorted and not overlapping. Touching spans of one color in a row join, and
 * a rectangle grows into the next row while that row has exactly its span in
 * its color. Not always the fewest rectangles, but linear, and flat areas
 * and straight edges come out as one quad.
 *
 * Faces must arrive in that order, unless the plane is `buffered`: then it
 * keeps them all and sorts them when finished. Otherwise each rectangle goes
 * to `emit` as soon as it can't grow, so only two rows' worth are held at a
 * time. `rules`, when given, can forbid joins and growths.
 */
class FacePlane {
  private readonly emit: (rect: FaceRect) => void;
  private readonly rules: MergeRules | null;
  /** Faces kept to sort (row, a, b, index each), until `finish`; null when they arrive in order. */
  private buffer: number[] | null;
  private row = -Infinity;
  /** Spans of `row`, so far. */
  private spans: FaceRect[] = [];
  /** Rectangles reaching the row before `row`, sorted by `a`. */
  private open: FaceRect[] = [];

  constructor(emit: (rect: FaceRect) => void, buffered = false, rules: MergeRules | null = null) {
    this.emit = emit;
    this.rules = rules;
    this.buffer = buffered ? [] : null;
  }

  add(row: number, a: number, b: number, index: number): void {
    if (this.buffer) {
      this.buffer.push(row, a, b, index);
      return;
    }
    if (row !== this.row) {
      this.endRow();
      this.row = row;
    }
    const last = this.spans[this.spans.length - 1];
    if (last && last.b === a && last.index === index && (this.rules?.canJoin(row, a, index) ?? true)) last.b = b;
    else this.spans.push({ a, b, index, from: row, to: row + 1 });
  }

  /** Emits the rectangles still open. Call once, after the last `add`. */
  finish(): void {
    const { buffer } = this;
    if (buffer) {
      const order = Array.from({ length: buffer.length / 4 }, (_, k) => k * 4);
      order.sort((p, q) => buffer[p] - buffer[q] || buffer[p + 1] - buffer[q + 1]);
      this.buffer = null;
      for (const k of order) this.add(buffer[k], buffer[k + 1], buffer[k + 2], buffer[k + 3]);
    }
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
      const repeats = rect && rect.to === span.from && rect.a === span.a && rect.b === span.b && rect.index === span.index;
      if (repeats && (this.rules?.canGrow(span.from, span.a, span.b, span.index) ?? true)) {
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

/** Collects one part's quads and triangles in typed arrays that grow as needed. */
class PartBuilder {
  private positions = new Float32Array(48);
  private normals = new Float32Array(48);
  private indices = new Uint32Array(24);
  /** Corners of each face, for welding. */
  private readonly sizes: number[] = [];
  private vertices = 0;
  private indexCount = 0;
  faces = 0;

  /**
   * A quad with `corners` (x, y, z each, going around it), wound
   * counter-clockwise seen from where `normal` points.
   */
  quad(corners: ArrayLike<number>, normal: Vec3): void {
    this.reserve(4, 6);
    const { positions, normals } = this;
    const c = corners;
    const cross = crossDot(c[3] - c[0], c[4] - c[1], c[5] - c[2], c[6] - c[0], c[7] - c[1], c[8] - c[2], normal);
    const order = cross >= 0 ? QUAD_FORWARD : QUAD_BACKWARD;
    const first = this.vertices;
    let i = first * 3;
    for (const k of order) {
      for (let axis = 0; axis < 3; axis++, i++) {
        positions[i] = c[k * 3 + axis];
        normals[i] = normal[axis];
      }
    }
    this.vertices += 4;
    this.index(first, first + 1, first + 2);
    this.index(first, first + 2, first + 3);
    this.sizes.push(4);
    this.faces++;
  }

  /** A triangle with corners p, q, r, wound counter-clockwise seen from where `normal` points. */
  triangle(p: Vec3, q: Vec3, r: Vec3, normal: Vec3): void {
    this.reserve(3, 3);
    const cross = crossDot(q[0] - p[0], q[1] - p[1], q[2] - p[2], r[0] - p[0], r[1] - p[1], r[2] - p[2], normal);
    const first = this.vertices;
    for (const [k, corner] of (cross >= 0 ? [p, q, r] : [p, r, q]).entries()) {
      this.positions.set(corner, (first + k) * 3);
      this.normals.set(normal, (first + k) * 3);
    }
    this.vertices += 3;
    this.index(first, first + 1, first + 2);
    this.sizes.push(3);
    this.faces++;
  }

  /** Every face with its own vertices and normals. */
  build(index: number, color: Rgba): MeshPart {
    return {
      index,
      color,
      positions: this.positions.slice(0, this.vertices * 3),
      normals: this.normals.slice(0, this.vertices * 3),
      indices: this.indices.slice(0, this.indexCount),
    };
  }

  /** The faces welded into a manifold mesh with shared vertices and no normals. */
  buildWelded(index: number, color: Rgba): MeshPart {
    const { positions, indices } = weldPolygons(this.positions.subarray(0, this.vertices * 3), this.sizes);
    return { index, color, positions, normals: null, indices };
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

const QUAD_FORWARD = [0, 1, 2, 3];
const QUAD_BACKWARD = [0, 3, 2, 1];

/** (u × v) · n. */
function crossDot(ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, n: Vec3): number {
  return (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
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
