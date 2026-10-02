import { describe, expect, it } from 'vitest';
import { pixelPerfectPath } from './pixelPerfect.ts';
import type { Point } from './raster.ts';

/** Feeds points (as [x, y]) and returns the dropped corners that should be put back. */
function restoredCorners(points: Array<[number, number]>): Point[] {
  const path = pixelPerfectPath();
  return points.flatMap(([x, y]) => {
    const removed = path.add({ x, y });
    return removed ? [removed] : [];
  });
}

describe('pixelPerfectPath', () => {
  it('drops the corner of an L', () => {
    expect(restoredCorners([[0, 0], [1, 0], [1, 1]])).toEqual([{ x: 1, y: 0 }]);
  });

  it('turns an orthogonal staircase into a clean diagonal', () => {
    expect(restoredCorners([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]])).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it('keeps straight runs, diagonals and wide turns', () => {
    expect(restoredCorners([[0, 0], [1, 0], [2, 0], [3, 1], [4, 2], [4, 3], [4, 4]])).toEqual([]);
  });

  it('ignores repeats of the last point', () => {
    expect(restoredCorners([[0, 0], [0, 0], [1, 0], [1, 0], [1, 1]])).toEqual([{ x: 1, y: 0 }]);
  });

  it('keeps a dropped corner painted when the stroke also passes through it elsewhere', () => {
    // Down through (1, 1), around, and back through it as the corner of an L.
    const points: Array<[number, number]> = [[1, 0], [1, 1], [1, 2], [2, 3], [3, 2], [2, 1], [1, 1], [1, 0]];
    expect(restoredCorners(points)).toEqual([]);
  });
});
