import { describe, expect, it } from 'vitest';
import { plotLine } from './raster.ts';

function line(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  plotLine(x0, y0, x1, y1, (x, y) => points.push([x, y]));
  return points;
}

describe('plotLine', () => {
  it('plots a single point', () => {
    expect(line(3, 4, 3, 4)).toEqual([[3, 4]]);
  });

  it('plots horizontal, vertical and diagonal lines', () => {
    expect(line(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(line(0, 2, 0, 0)).toEqual([[0, 2], [0, 1], [0, 0]]);
    expect(line(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it.each([
    [0, 0, 7, 3],
    [0, 0, 3, 7],
    [5, 5, -4, 1],
    [-2, 6, 3, -5],
  ])('from (%d, %d) to (%d, %d) is gap-free and hits both ends', (x0, y0, x1, y1) => {
    const points = line(x0, y0, x1, y1);
    expect(points[0]).toEqual([x0, y0]);
    expect(points.at(-1)).toEqual([x1, y1]);
    expect(points).toHaveLength(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    for (let i = 1; i < points.length; i++) {
      const [px, py] = points[i - 1];
      const [x, y] = points[i];
      expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1);
    }
  });

  it('rejects non-integer coordinates instead of looping forever', () => {
    expect(() => line(0, 0, 1.5, 2)).toThrow(RangeError);
  });
});
