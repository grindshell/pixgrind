import { describe, expect, it } from 'vitest';
import { clipRect, rectContains, rectFromCorners, rectsEqual, translateRect } from './rect.ts';

describe('rect helpers', () => {
  it('builds a rectangle from corners in any order, both included', () => {
    expect(rectFromCorners({ x: 5, y: 1 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 1, width: 4, height: 3 });
    expect(rectFromCorners({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual({ x: 4, y: 4, width: 1, height: 1 });
  });

  it('clips to an area, or returns null when outside it', () => {
    expect(clipRect({ x: -2, y: 3, width: 5, height: 10 }, 8, 8)).toEqual({ x: 0, y: 3, width: 3, height: 5 });
    expect(clipRect({ x: 8, y: 0, width: 2, height: 2 }, 8, 8)).toBeNull();
    expect(clipRect({ x: -3, y: 0, width: 3, height: 2 }, 8, 8)).toBeNull();
  });

  it('tests containment with an exclusive far edge', () => {
    const r = { x: 1, y: 1, width: 2, height: 2 };
    expect(rectContains(r, 1, 1)).toBe(true);
    expect(rectContains(r, 2, 2)).toBe(true);
    expect(rectContains(r, 3, 2)).toBe(false);
    expect(rectContains(r, 0, 1)).toBe(false);
  });

  it('translates and compares', () => {
    const r = { x: 1, y: 2, width: 3, height: 4 };
    expect(translateRect(r, -1, 5)).toEqual({ x: 0, y: 7, width: 3, height: 4 });
    expect(rectsEqual(r, { ...r })).toBe(true);
    expect(rectsEqual(r, translateRect(r, 1, 0))).toBe(false);
    expect(rectsEqual(null, null)).toBe(true);
    expect(rectsEqual(r, null)).toBe(false);
  });
});
