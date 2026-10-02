import { describe, expect, it } from 'vitest';
import { plotLine, plotRect, snapLineEnd, squareEnd } from './raster.ts';

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

describe('plotRect', () => {
  function rect(x0: number, y0: number, x1: number, y1: number, filled: boolean): string[] {
    const points: string[] = [];
    plotRect(x0, y0, x1, y1, filled, (x, y) => points.push(`${x},${y}`));
    return points;
  }

  it('plots the outline once per pixel', () => {
    const points = rect(1, 1, 4, 3, false);
    expect(points).toHaveLength(10);
    expect(new Set(points).size).toBe(points.length);
    expect(points).not.toContain('2,2');
    expect(points).toEqual(expect.arrayContaining(['1,1', '4,1', '1,2', '4,2', '1,3', '4,3']));
  });

  it('fills every pixel when filled', () => {
    expect(rect(1, 1, 4, 3, true)).toHaveLength(12);
  });

  it('accepts corners in any order', () => {
    expect(rect(4, 3, 1, 1, false).sort()).toEqual(rect(1, 1, 4, 3, false).sort());
  });

  it('handles single rows, columns and pixels', () => {
    expect(rect(2, 5, 2, 5, false)).toEqual(['2,5']);
    expect(rect(0, 0, 3, 0, false)).toHaveLength(4);
    expect(rect(0, 0, 0, 3, false)).toHaveLength(4);
  });
});

describe('snapLineEnd', () => {
  const start = { x: 10, y: 10 };

  it.each([
    [{ x: 20, y: 12 }, { x: 20, y: 10 }],
    [{ x: 0, y: 13 }, { x: 0, y: 10 }],
    [{ x: 11, y: 20 }, { x: 10, y: 20 }],
    [{ x: 18, y: 16 }, { x: 18, y: 18 }],
    [{ x: 4, y: 3 }, { x: 3, y: 3 }],
    [{ x: 10, y: 10 }, { x: 10, y: 10 }],
  ])('snaps %o to %o', (end, expected) => {
    expect(snapLineEnd(start, end)).toEqual(expected);
  });
});

describe('squareEnd', () => {
  it('extends the shorter side, keeping the drag direction', () => {
    expect(squareEnd({ x: 0, y: 0 }, { x: 5, y: 2 })).toEqual({ x: 5, y: 5 });
    expect(squareEnd({ x: 10, y: 10 }, { x: 7, y: 14 })).toEqual({ x: 6, y: 14 });
    expect(squareEnd({ x: 3, y: 3 }, { x: 3, y: 0 })).toEqual({ x: 6, y: 0 });
  });
});
