import { TRANSPARENT } from './palette.ts';

/**
 * How a pixel reaches into the third dimension in the 3D model: a box
 * `depth` pixels deep whose front is `offset` pixels behind the picture
 * plane, so it fills z from `offset` to `offset + depth`, with its `shape`
 * seen from the front (a square, or a diagonal half). Packed as
 * `shape << 16 | offset << 8 | depth`, so a layer keeps one `Uint32Array` of
 * them parallel to its palette indices. Only meaningful where the pixel isn't
 * transparent.
 */
export type Extrusion = number;

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 255;
export const MAX_OFFSET = 255;
/** One past the deepest z a box can reach. */
export const MAX_Z = MAX_OFFSET + MAX_DEPTH;

/**
 * A pixel's outline seen from the front: a square, or what's left when one
 * corner is cut off along the diagonal (a right triangle, half the pixel), so
 * staircase edges can become 45° slopes. Numbered clockwise from the top left.
 */
export type Shape = 0 | 1 | 2 | 3 | 4;
export const SQUARE = 0;
export const CUT_TOP_LEFT = 1;
export const CUT_TOP_RIGHT = 2;
export const CUT_BOTTOM_RIGHT = 3;
export const CUT_BOTTOM_LEFT = 4;
export const SHAPES: readonly Shape[] = [SQUARE, CUT_TOP_LEFT, CUT_TOP_RIGHT, CUT_BOTTOM_RIGHT, CUT_BOTTOM_LEFT];

export function isShape(value: number): value is Shape {
  return Number.isInteger(value) && value >= SQUARE && value <= CUT_BOTTOM_LEFT;
}

export function packExtrusion(offset: number, depth: number, shape: Shape = SQUARE): Extrusion {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new RangeError(`Invalid offset ${offset}`);
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) throw new RangeError(`Invalid depth ${depth}`);
  if (!isShape(shape)) throw new RangeError(`Invalid shape ${shape}`);
  return (shape << 16) | (offset << 8) | depth;
}

/** What a painted pixel is until it's given an extrusion: a square one pixel deep, at the front. */
export const DEFAULT_EXTRUSION: Extrusion = packExtrusion(0, 1);

export function extrusionOffset(extrusion: Extrusion): number {
  return (extrusion >>> 8) & 0xff;
}

export function extrusionDepth(extrusion: Extrusion): number {
  return extrusion & 0xff;
}

/** The z just behind the box. */
export function extrusionEnd(extrusion: Extrusion): number {
  return extrusionOffset(extrusion) + extrusionDepth(extrusion);
}

export function extrusionShape(extrusion: Extrusion): Shape {
  return (extrusion >>> 16) as Shape;
}

/** `extrusion` with its box moved to `offset` and made `depth` deep, keeping its shape. */
export function withBox(extrusion: Extrusion, offset: number, depth: number): Extrusion {
  return packExtrusion(offset, depth, extrusionShape(extrusion));
}

/** `extrusion` with another shape, keeping its box. */
export function withShape(extrusion: Extrusion, shape: Shape): Extrusion {
  return packExtrusion(extrusionOffset(extrusion), extrusionDepth(extrusion), shape);
}

/** Whether a stored value is a valid extrusion: a box at least one pixel deep, of a known shape. */
export function isExtrusion(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffff &&
    extrusionDepth(value) >= MIN_DEPTH &&
    isShape(extrusionShape(value))
  );
}

/** A layer-sized array of default extrusions. */
export function defaultExtrusions(length: number): Uint32Array {
  return new Uint32Array(length).fill(DEFAULT_EXTRUSION);
}

/**
 * The diagonal shape for the painted pixel at (x, y) of a layer's `pixels`,
 * from which of its neighbors are transparent (or off the document): exactly
 * two that meet at a corner, and that corner is cut, as at each step of a
 * staircase edge. Null when that doesn't say (no empty sides, one, three,
 * four, or two opposite ones).
 */
export function autoShape(pixels: Uint8Array, width: number, height: number, x: number, y: number): Shape | null {
  const empty = (nx: number, ny: number) =>
    nx < 0 || ny < 0 || nx >= width || ny >= height || pixels[ny * width + nx] === TRANSPARENT;
  const top = empty(x, y - 1);
  const right = empty(x + 1, y);
  const bottom = empty(x, y + 1);
  const left = empty(x - 1, y);
  if (Number(top) + Number(right) + Number(bottom) + Number(left) !== 2) return null;
  if (top && left) return CUT_TOP_LEFT;
  if (top && right) return CUT_TOP_RIGHT;
  if (bottom && right) return CUT_BOTTOM_RIGHT;
  if (bottom && left) return CUT_BOTTOM_LEFT;
  return null;
}

/**
 * A layer pixel's palette index and extrusion as one number,
 * `extrusion * 256 + index`, for code that moves whole pixels around (floats,
 * pastes). Writing a transparent cell leaves the extrusion alone: it means
 * nothing there.
 */
export type Cell = number;

export function packCell(index: number, extrusion: Extrusion): Cell {
  return extrusion * 256 + index;
}

export function cellIndex(cell: Cell): number {
  return cell & 0xff;
}

export function cellExtrusion(cell: Cell): Extrusion {
  return cell >>> 8;
}

/**
 * The cell after adding depth z to its box, as painting a side view cell
 * does: a transparent pixel becomes `index`, a square one deep at z; a
 * painted one grows its box to reach z and keeps its color and shape.
 * Unchanged when z is already in the box or the box can't reach it.
 */
export function extendCell(cell: Cell, z: number, index: number): Cell {
  if (cellIndex(cell) === TRANSPARENT) return z <= MAX_OFFSET ? packCell(index, packExtrusion(z, 1)) : cell;
  const extrusion = cellExtrusion(cell);
  const start = Math.min(extrusionOffset(extrusion), z);
  const end = Math.max(extrusionEnd(extrusion), z + 1);
  if (end - start > MAX_DEPTH) return cell;
  return packCell(cellIndex(cell), withBox(extrusion, start, end - start));
}

/**
 * The cell after taking depth z out of its box, as erasing a side view cell
 * does. A box can't have a gap, so everything from z to the nearer end goes
 * (to the back on a tie, keeping the front that the 2D view shows). A box
 * with nothing left becomes transparent. The shape stays.
 */
export function carveCell(cell: Cell, z: number): Cell {
  const index = cellIndex(cell);
  const extrusion = cellExtrusion(cell);
  const start = extrusionOffset(extrusion);
  const end = extrusionEnd(extrusion);
  if (index === TRANSPARENT || z < start || z >= end) return cell;
  if (end - start === 1) return packCell(TRANSPARENT, extrusion);
  // Nearer the front: keep what's behind z. Otherwise keep what's in front.
  if (z - start < end - 1 - z) return packCell(index, withBox(extrusion, z + 1, end - z - 1));
  return packCell(index, withBox(extrusion, start, z - start));
}
