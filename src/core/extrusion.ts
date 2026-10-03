import { TRANSPARENT } from './palette.ts';

/**
 * How far a pixel reaches into the third dimension in the 3D model: a box
 * `depth` pixels deep whose front is `offset` pixels behind the picture
 * plane, so it fills z from `offset` to `offset + depth`. Packed into 16 bits
 * as `offset << 8 | depth`, so a layer keeps one `Uint16Array` of them
 * parallel to its palette indices. Only meaningful where the pixel isn't
 * transparent.
 */
export type Extrusion = number;

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 255;
export const MAX_OFFSET = 255;
/** One past the deepest z a box can reach. */
export const MAX_Z = MAX_OFFSET + MAX_DEPTH;

export function packExtrusion(offset: number, depth: number): Extrusion {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new RangeError(`Invalid offset ${offset}`);
  if (!Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) throw new RangeError(`Invalid depth ${depth}`);
  return (offset << 8) | depth;
}

/** What a painted pixel is until it's given an extrusion: one pixel deep, at the front. */
export const DEFAULT_EXTRUSION: Extrusion = packExtrusion(0, 1);

export function extrusionOffset(extrusion: Extrusion): number {
  return extrusion >>> 8;
}

export function extrusionDepth(extrusion: Extrusion): number {
  return extrusion & 0xff;
}

/** The z just behind the box. */
export function extrusionEnd(extrusion: Extrusion): number {
  return extrusionOffset(extrusion) + extrusionDepth(extrusion);
}

/** Whether a stored value is a valid extrusion (a box at least one pixel deep). */
export function isExtrusion(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff && extrusionDepth(value) >= MIN_DEPTH;
}

/** A layer-sized array of default extrusions. */
export function defaultExtrusions(length: number): Uint16Array {
  return new Uint16Array(length).fill(DEFAULT_EXTRUSION);
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
 * does: a transparent pixel becomes `index`, one deep at z; a painted one
 * grows its box to reach z and keeps its color. Unchanged when z is already
 * in the box or the box can't reach it.
 */
export function extendCell(cell: Cell, z: number, index: number): Cell {
  if (cellIndex(cell) === TRANSPARENT) return z <= MAX_OFFSET ? packCell(index, packExtrusion(z, 1)) : cell;
  const extrusion = cellExtrusion(cell);
  const start = Math.min(extrusionOffset(extrusion), z);
  const end = Math.max(extrusionEnd(extrusion), z + 1);
  if (end - start > MAX_DEPTH) return cell;
  return packCell(cellIndex(cell), packExtrusion(start, end - start));
}

/**
 * The cell after taking depth z out of its box, as erasing a side view cell
 * does. A box can't have a gap, so everything from z to the nearer end goes
 * (to the back on a tie, keeping the front that the 2D view shows). A box
 * with nothing left becomes transparent.
 */
export function carveCell(cell: Cell, z: number): Cell {
  const index = cellIndex(cell);
  const extrusion = cellExtrusion(cell);
  const start = extrusionOffset(extrusion);
  const end = extrusionEnd(extrusion);
  if (index === TRANSPARENT || z < start || z >= end) return cell;
  if (end - start === 1) return packCell(TRANSPARENT, extrusion);
  // Nearer the front: keep what's behind z. Otherwise keep what's in front.
  if (z - start < end - 1 - z) return packCell(index, packExtrusion(z + 1, end - z - 1));
  return packCell(index, packExtrusion(start, z - start));
}
