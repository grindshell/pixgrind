import { outlineRuns, type OutlineRun } from './mask.ts';
import { plotLine, plotRect, type Point } from './raster.ts';

export type BrushShape = 'round' | 'square';

export interface Brush {
  /** Width and height in pixels, MIN_BRUSH_SIZE–MAX_BRUSH_SIZE. */
  size: number;
  shape: BrushShape;
}

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 64;
export const DEFAULT_BRUSH: Brush = { size: 1, shape: 'round' };

/** Sizes the size shortcuts step through: every size up to 8, then coarser. */
const SIZE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];

export function clampBrushSize(size: number): number {
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(size)));
}

/** The next larger (direction 1) or smaller (-1) step from `size`, which needn't be a step itself. */
export function stepBrushSize(size: number, direction: 1 | -1): number {
  const next =
    direction > 0 ? SIZE_STEPS.find((step) => step > size) : SIZE_STEPS.findLast((step) => step < size);
  return next ?? clampBrushSize(size);
}

/** A brush's footprint, as offsets from the pixel under the pointer. */
export interface BrushMask {
  /** Every pixel the brush covers. */
  readonly pixels: readonly Point[];
  /**
   * Pixels with a neighbor (diagonals included) outside the footprint. When
   * the brush moves one pixel in any direction, only these can cover new
   * pixels, so lines stamp them alone after the first point.
   */
  readonly edge: readonly Point[];
  /** The footprint's border, for drawing the brush cursor, relative to the pointer pixel's top-left corner. */
  readonly outline: readonly OutlineRun[];
}

const masks = new Map<string, BrushMask>();

/**
 * The footprint of a brush. The pointer pixel is the center for odd sizes;
 * for even sizes it's the pixel right of and below the center.
 */
export function brushMask({ size, shape }: Brush): BrushMask {
  const key = `${shape}:${size}`;
  let mask = masks.get(key);
  if (!mask) {
    mask = buildMask(clampBrushSize(size), shape);
    masks.set(key, mask);
  }
  return mask;
}

function buildMask(size: number, shape: BrushShape): BrushMask {
  // Pixel (i, j) of the size×size box is in the circle when its center is
  // within the radius. Shrinking r² by 0.5 gives the usual pixel-art circles
  // (a plus at 3, rounded corners from 4 on); never below 0, so size 1 works.
  const half = size / 2;
  const radiusSquared = Math.max(0, half * half - 0.5);
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= size || j >= size) return false;
    if (shape === 'square') return true;
    const dx = i + 0.5 - half;
    const dy = j + 0.5 - half;
    return dx * dx + dy * dy <= radiusSquared;
  };

  const origin = -Math.floor(size / 2);
  const pixels: Point[] = [];
  const edge: Point[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!inside(i, j)) continue;
      const point = { x: origin + i, y: origin + j };
      pixels.push(point);
      const onEdge = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => !inside(i + dx, j + dy)));
      if (onEdge) edge.push(point);
    }
  }

  const outline = outlineRuns(size, size, inside).map((run) => ({
    ...run,
    at: origin + run.at,
    from: origin + run.from,
    to: origin + run.to,
  }));
  return { pixels, edge, outline };
}

type Plot = (x: number, y: number) => void;

/** Calls `plot` for every pixel the brush covers at (x, y). */
export function stampBrush(mask: BrushMask, x: number, y: number, plot: Plot): void {
  for (const p of mask.pixels) plot(x + p.x, y + p.y);
}

/**
 * Calls `plot` for every pixel the brush covers when dragged from (x0, y0)
 * to (x1, y1), both included. Pixels may be plotted more than once.
 */
export function brushLine(mask: BrushMask, x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  let first = true;
  plotLine(x0, y0, x1, y1, (x, y) => {
    // Each step moves at most one pixel, so after the first stamp only the
    // brush's edge can reach new pixels.
    for (const p of first ? mask.pixels : mask.edge) plot(x + p.x, y + p.y);
    first = false;
  });
}

/**
 * A rectangle between two corners (any order) drawn with the brush: the
 * brush traces the outline, and `filled` also fills the inside.
 */
export function brushRect(
  mask: BrushMask,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
  plot: Plot,
): void {
  if (filled) plotRect(x0, y0, x1, y1, true, plot);
  brushLine(mask, x0, y0, x1, y0, plot);
  brushLine(mask, x1, y0, x1, y1, plot);
  brushLine(mask, x1, y1, x0, y1, plot);
  brushLine(mask, x0, y1, x0, y0, plot);
}
