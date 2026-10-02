import type { Point } from './raster.ts';

/**
 * Tracks a 1px freehand stroke for pixel-perfect drawing: whenever three
 * consecutive points make an L (the outer two are diagonal neighbors), the
 * corner is dropped, so diagonal strokes come out as clean single-pixel
 * steps.
 */
export interface PixelPerfectPath {
  /**
   * Adds the stroke's next point (consecutive points must be 8-connected; a
   * repeat of the last point is ignored). Returns a dropped corner whose pixel
   * no longer belongs to the stroke and should be put back, or null. A corner
   * the stroke also passes through elsewhere is dropped from the path but not
   * returned, since that pixel stays painted.
   */
  add(point: Point): Point | null;
}

export function pixelPerfectPath(): PixelPerfectPath {
  const path: Point[] = [];
  /** How many times each pixel appears in `path`. */
  const visits = new Map<string, number>();
  const key = (p: Point) => `${p.x},${p.y}`;

  return {
    add(point) {
      const last = path.at(-1);
      if (last && last.x === point.x && last.y === point.y) return null;
      path.push(point);
      visits.set(key(point), (visits.get(key(point)) ?? 0) + 1);
      if (path.length < 3) return null;

      const [a, corner, c] = path.slice(-3);
      if (!isLTurn(a, corner, c)) return null;
      path.splice(-2, 1);
      const remaining = (visits.get(key(corner)) ?? 1) - 1;
      if (remaining > 0) {
        visits.set(key(corner), remaining);
        return null;
      }
      visits.delete(key(corner));
      return corner;
    },
  };
}

/** Whether `a` → `corner` → `c` is an L: two orthogonal steps whose ends are diagonal neighbors. */
function isLTurn(a: Point, corner: Point, c: Point): boolean {
  const orthogonal = (p: Point, q: Point) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  return Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 && orthogonal(a, corner) && orthogonal(corner, c);
}
