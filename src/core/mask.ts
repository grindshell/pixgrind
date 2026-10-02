import { plotLine, type Point } from './raster.ts';
import { clipRect, intersectRects, rectContains, rectFromCorners, rectsEqual, translateRect, unionRects, type Rect } from './rect.ts';

/**
 * A set of pixels, such as the selection: the pixels of `rect` whose `bits`
 * entry (row-major over `rect`) is 1, or all of `rect` when `bits` is null.
 *
 * Masks are normalized, so equal sets have equal masks: a mask is never
 * empty (null stands for no pixels), `rect` is the tight bounding box, and
 * `bits` is null exactly when every pixel of `rect` is in the set. Never
 * mutated: changes make a new mask, which may share `bits` (moves do).
 */
export interface Mask {
  rect: Rect;
  bits: Uint8Array | null;
}

/**
 * How a selection tool's shape combines with the current selection:
 * `replace` it, `add` to it, `subtract` from it, or `intersect` (keep the
 * overlap).
 */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Every pixel of `rect`. */
export function rectMask(rect: Rect): Mask {
  return { rect, bits: null };
}

/**
 * The pixels set in `bits` (row-major over `rect`), normalized. Null when
 * none are set. Keeps `bits` itself when no trimming is needed.
 */
export function maskFromBits(rect: Rect, bits: Uint8Array): Mask | null {
  const { width, height } = rect;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let count = 0;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (!bits[j * width + i]) continue;
      count++;
      if (i < left) left = i;
      if (i > right) right = i;
      if (j < top) top = j;
      bottom = j;
    }
  }
  if (count === 0) return null;
  const tight = { x: rect.x + left, y: rect.y + top, width: right - left + 1, height: bottom - top + 1 };
  if (count === tight.width * tight.height) return rectMask(tight);
  if (tight.width === width && tight.height === height) return { rect, bits };
  return { rect: tight, bits: bitsIn({ rect, bits }, tight) };
}

/** The pixels at `offsets` (`y * width + x`) of a document `width` wide, e.g. a flood fill region. */
export function maskFromOffsets(offsets: ArrayLike<number>, width: number): Mask | null {
  if (offsets.length === 0) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let k = 0; k < offsets.length; k++) {
    const x = offsets[k] % width;
    const y = (offsets[k] - x) / width;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const bits = new Uint8Array(rect.width * rect.height);
  for (let k = 0; k < offsets.length; k++) {
    const x = offsets[k] % width;
    const y = (offsets[k] - x) / width;
    bits[(y - top) * rect.width + x - left] = 1;
  }
  return maskFromBits(rect, bits);
}

/**
 * What a lasso drawn through `points` (pixels, in order) selects within
 * `bounds`: the pixels along the closed path, and those inside it. Inside
 * uses the nonzero rule, so a loop drawn over itself stays selected. Null
 * when that's nothing.
 */
export function lassoMask(points: readonly Point[], bounds: Rect): Mask | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const extent = rectFromCorners(
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
  );
  const rect = intersectRects(extent, bounds);
  if (!rect) return null;
  const bits = new Uint8Array(rect.width * rect.height);
  const right = rect.x + rect.width - 1;

  // Each row: where the closing polygon's edges cross the pixel centers
  // (vertices are pixel centers, so a pixel's center is its own position),
  // filling between crossings while the winding number isn't zero.
  const crossings: Array<{ x: number; winding: number }> = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    crossings.length = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      // Half-open in y, so a vertex on this row counts once.
      if (a.y <= y === b.y <= y) continue;
      crossings.push({ x: a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y), winding: b.y > a.y ? 1 : -1 });
    }
    crossings.sort((p, q) => p.x - q.x);
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k].winding;
      if (winding === 0) continue;
      const from = Math.max(rect.x, Math.ceil(crossings[k].x));
      const to = Math.min(right, Math.floor(crossings[k + 1].x));
      const row = (y - rect.y) * rect.width - rect.x;
      if (from <= to) bits.fill(1, row + from, row + to + 1);
    }
  }

  // The path itself, closing segment included, so traced-over pixels are in.
  const plot = (x: number, y: number) => {
    if (rectContains(rect, x, y)) bits[(y - rect.y) * rect.width + x - rect.x] = 1;
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    plotLine(a.x, a.y, b.x, b.y, plot);
  }
  return maskFromBits(rect, bits);
}

export function maskHas(mask: Mask, x: number, y: number): boolean {
  const { rect, bits } = mask;
  if (!rectContains(rect, x, y)) return false;
  return !bits || bits[(y - rect.y) * rect.width + x - rect.x] !== 0;
}

/**
 * The part of `mask` inside a `width`×`height` area at the origin (a
 * document), or null if none. Always a plain mask, even for a float or clip.
 */
export function clipMask(mask: Mask, width: number, height: number): Mask | null {
  const rect = clipRect(mask.rect, width, height);
  if (!rect) return null;
  if (rectsEqual(rect, mask.rect)) return { rect: mask.rect, bits: mask.bits };
  return mask.bits ? maskFromBits(rect, bitsIn(mask, rect)) : rectMask(rect);
}

/** The same pixels moved by (dx, dy). */
export function translateMask(mask: Mask, dx: number, dy: number): Mask {
  return { rect: translateRect(mask.rect, dx, dy), bits: mask.bits };
}

export function masksEqual(a: Mask | null, b: Mask | null): boolean {
  if (a === b) return true;
  if (!a || !b || !rectsEqual(a.rect, b.rect)) return false;
  const other = b.bits;
  if (!a.bits || !other) return a.bits === other;
  return a.bits.every((bit, i) => bit === other[i]);
}

/**
 * A selection combined with a new shape in `mode` (see `SelectionMode`).
 * Null when no pixels are left.
 */
export function combineMasks(selection: Mask | null, shape: Mask | null, mode: SelectionMode): Mask | null {
  switch (mode) {
    case 'replace':
      return shape;
    case 'add':
      if (!selection || !shape) return selection ?? shape;
      return merge(selection, shape, unionRects(selection.rect, shape.rect), (a, b) => a | b);
    case 'subtract':
      if (!selection || !shape) return selection;
      return merge(selection, shape, selection.rect, (a, b) => a & (b ^ 1));
    case 'intersect': {
      if (!selection || !shape) return null;
      const overlap = intersectRects(selection.rect, shape.rect);
      return overlap && merge(selection, shape, overlap, (a, b) => a & b);
    }
  }
}

function merge(a: Mask, b: Mask, area: Rect, op: (a: number, b: number) => number): Mask | null {
  const bits = bitsIn(a, area);
  const other = bitsIn(b, area);
  for (let i = 0; i < bits.length; i++) bits[i] = op(bits[i], other[i]);
  return maskFromBits(area, bits);
}

/** The mask as bits over `area` (1 for its pixels, 0 elsewhere), row-major. */
function bitsIn(mask: Mask, area: Rect): Uint8Array {
  const out = new Uint8Array(area.width * area.height);
  const overlap = intersectRects(mask.rect, area);
  if (!overlap) return out;
  const { rect, bits } = mask;
  for (let y = overlap.y; y < overlap.y + overlap.height; y++) {
    const start = (y - area.y) * area.width + overlap.x - area.x;
    if (bits) {
      const from = (y - rect.y) * rect.width + overlap.x - rect.x;
      out.set(bits.subarray(from, from + overlap.width), start);
    } else {
      out.fill(1, start, start + overlap.width);
    }
  }
  return out;
}

/**
 * A straight run of the border of a set of pixels, in pixel-corner
 * coordinates. Horizontal runs lie on the line y = `at` from x = `from` to
 * `to`; vertical runs on x = `at`. `out` is the side away from the set: -1
 * for up/left, 1 for down/right. At each end the border turns a corner:
 * concave when it turns into the set (an inner corner), else convex.
 */
export interface OutlineRun {
  horizontal: boolean;
  at: number;
  from: number;
  to: number;
  out: -1 | 1;
  concaveFrom: boolean;
  concaveTo: boolean;
}

/**
 * The border of the pixels for which `has(x, y)` is true in a
 * `width`×`height` box at the origin, merged into straight runs: top edges,
 * then bottom, left and right. `has` is also asked about the pixels just
 * outside the box, and must say no.
 */
export function outlineRuns(width: number, height: number, has: (x: number, y: number) => boolean): OutlineRun[] {
  const runs: OutlineRun[] = [];
  const addRuns = (horizontal: boolean, out: -1 | 1) => {
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const inside = (along: number, line: number) => (horizontal ? has(along, line) : has(line, along));
    for (let line = 0; line < lines; line++) {
      let start: number | null = null;
      for (let along = 0; along <= length; along++) {
        // An edge: a pixel in the set whose neighbor on the `out` side isn't.
        const isEdge = along < length && inside(along, line) && !inside(along, line + out);
        if (isEdge && start === null) start = along;
        if (!isEdge && start !== null) {
          // A run ends where its row of pixels ends (convex), or where the
          // neighbor joins the set (concave); likewise at its start.
          runs.push({
            horizontal,
            at: line + (out > 0 ? 1 : 0),
            from: start,
            to: along,
            out,
            concaveFrom: inside(start - 1, line),
            concaveTo: inside(along, line),
          });
          start = null;
        }
      }
    }
  };
  addRuns(true, -1);
  addRuns(true, 1);
  addRuns(false, -1);
  addRuns(false, 1);
  return runs;
}

/** The mask's border (see `outlineRuns`), relative to the top-left of its `rect`. */
export function maskOutline({ rect, bits }: Mask): OutlineRun[] {
  const { width, height } = rect;
  if (!bits) {
    // A rectangle: one run per side, all corners convex.
    const run = (horizontal: boolean, at: number, to: number, out: -1 | 1): OutlineRun => ({
      horizontal,
      at,
      from: 0,
      to,
      out,
      concaveFrom: false,
      concaveTo: false,
    });
    return [run(true, 0, width, -1), run(true, height, width, 1), run(false, 0, height, -1), run(false, width, height, 1)];
  }
  return outlineRuns(
    width,
    height,
    (x, y) => x >= 0 && y >= 0 && x < width && y < height && bits[y * width + x] !== 0,
  );
}
