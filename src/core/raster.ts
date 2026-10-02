export interface Point {
  x: number;
  y: number;
}

/**
 * Calls `plot` for every pixel on the line from (x0, y0) to (x1, y1), both
 * ends included, using Bresenham's algorithm. Coordinates must be integers.
 */
export function plotLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void {
  if (![x0, y0, x1, y1].every(Number.isInteger)) {
    throw new RangeError('plotLine requires integer coordinates');
  }
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += stepX;
    }
    if (e2 <= dx) {
      err += dx;
      y += stepY;
    }
  }
}

/**
 * Calls `plot` for every pixel of the rectangle with corners (x0, y0) and
 * (x1, y1), both included, in any order. Outline only unless `filled`. Each
 * pixel is plotted once.
 */
export function plotRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
  plot: (x: number, y: number) => void,
): void {
  if (![x0, y0, x1, y1].every(Number.isInteger)) {
    throw new RangeError('plotRect requires integer coordinates');
  }
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  for (let y = top; y <= bottom; y++) {
    if (filled || y === top || y === bottom) {
      for (let x = left; x <= right; x++) plot(x, y);
    } else {
      plot(left, y);
      if (right !== left) plot(right, y);
    }
  }
}

const TAN_22_5 = Math.tan(Math.PI / 8);

/** Snaps `end` so the line from `start` is horizontal, vertical, or 45° diagonal, whichever is closest. */
export function snapLineEnd(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay <= ax * TAN_22_5) return { x: end.x, y: start.y };
  if (ax <= ay * TAN_22_5) return { x: start.x, y: end.y };
  const d = Math.max(ax, ay);
  return { x: start.x + Math.sign(dx) * d, y: start.y + Math.sign(dy) * d };
}

/** Moves `end` so the rectangle from `start` is a square, growing toward the drag direction. */
export function squareEnd(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -d : d), y: start.y + (dy < 0 ? -d : d) };
}
