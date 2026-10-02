import { describe, expect, it } from 'vitest';
import {
  clipMask,
  combineMasks,
  invertMask,
  lassoMask,
  maskFromBits,
  maskFromOffsets,
  maskHas,
  maskOutline,
  masksEqual,
  outlineRuns,
  rectMask,
  translateMask,
  type Mask,
} from './mask.ts';
import type { Point } from './raster.ts';

const BOUNDS = { x: 0, y: 0, width: 16, height: 16 };

/** A mask from rows of "#" (in) and "." (out), with its top-left at (x, y). */
function maskFrom(rows: string[], x = 0, y = 0): Mask | null {
  const bits = Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0));
  return maskFromBits({ x, y, width: rows[0].length, height: rows.length }, bits);
}

/** The mask drawn as rows over `area` (default: its own rect). */
function show(mask: Mask | null, area = mask?.rect ?? { x: 0, y: 0, width: 1, height: 1 }): string[] {
  return Array.from({ length: area.height }, (_, j) =>
    Array.from({ length: area.width }, (_, i) => (mask && maskHas(mask, area.x + i, area.y + j) ? '#' : '.')).join(''),
  );
}

describe('maskFromBits', () => {
  it('trims to the tight bounding box', () => {
    const mask = maskFrom(['....', '.#..', '..#.'], 10, 20);
    expect(mask?.rect).toEqual({ x: 11, y: 21, width: 2, height: 2 });
    expect(show(mask)).toEqual(['#.', '.#']);
  });

  it('drops the bits when every pixel is in, and is null when none is', () => {
    expect(maskFrom(['...', '.##', '.##'])).toEqual(rectMask({ x: 1, y: 1, width: 2, height: 2 }));
    expect(maskFrom(['..', '..'])).toBeNull();
  });

  it('keeps the bits array when nothing needs trimming', () => {
    const bits = Uint8Array.of(1, 0, 0, 1);
    expect(maskFromBits({ x: 0, y: 0, width: 2, height: 2 }, bits)?.bits).toBe(bits);
  });
});

describe('maskFromOffsets', () => {
  it('collects document offsets into a mask', () => {
    // Document 5 wide: (1,0), (2,1) and (1,1).
    expect(show(maskFromOffsets([1, 7, 6], 5))).toEqual(['#.', '##']);
    expect(maskFromOffsets([], 5)).toBeNull();
  });
});

describe('mask helpers', () => {
  it('clips to a document, normalizing what is left', () => {
    const mask = maskFrom(['#..', '.##'], -1, 0)!;
    expect(clipMask(mask, 4, 4)).toEqual(rectMask({ x: 0, y: 1, width: 2, height: 1 }));
    expect(clipMask(translateMask(mask, 10, 0), 4, 4)).toBeNull();
    const inside = maskFrom(['#.', '.#'], 1, 1)!;
    expect(clipMask(inside, 4, 4)).toEqual(inside);
    // A float is a mask too, but its selection is just the mask.
    expect(clipMask({ ...inside, pixels: new Uint8Array(4) } as Mask, 4, 4)).toEqual(inside);
  });

  it('translates without copying the bits', () => {
    const mask = maskFrom(['#.', '.#'])!;
    const moved = translateMask(mask, 3, -1);
    expect(moved.rect).toEqual({ x: 3, y: -1, width: 2, height: 2 });
    expect(moved.bits).toBe(mask.bits);
  });

  it('compares by content', () => {
    expect(masksEqual(maskFrom(['#.', '.#']), maskFrom(['#.', '.#']))).toBe(true);
    expect(masksEqual(maskFrom(['#.', '.#']), maskFrom(['.#', '#.']))).toBe(false);
    expect(masksEqual(maskFrom(['##']), maskFrom(['#.', '.#']))).toBe(false);
    expect(masksEqual(null, null)).toBe(true);
    expect(masksEqual(maskFrom(['#']), null)).toBe(false);
  });
});

describe('combineMasks', () => {
  const a = rectMask({ x: 0, y: 0, width: 3, height: 2 });
  const b = rectMask({ x: 2, y: 1, width: 2, height: 2 });
  const area = { x: 0, y: 0, width: 4, height: 3 };

  it('adds, subtracts and intersects', () => {
    expect(show(combineMasks(a, b, 'add'), area)).toEqual(['###.', '####', '..##']);
    expect(show(combineMasks(a, b, 'subtract'), area)).toEqual(['###.', '##..', '....']);
    expect(show(combineMasks(a, b, 'intersect'), area)).toEqual(['....', '..#.', '....']);
    expect(combineMasks(a, b, 'replace')).toBe(b);
  });

  it('handles empty selections and shapes', () => {
    expect(combineMasks(null, b, 'add')).toBe(b);
    expect(combineMasks(a, null, 'add')).toBe(a);
    expect(combineMasks(null, b, 'subtract')).toBeNull();
    expect(combineMasks(a, null, 'subtract')).toBe(a);
    expect(combineMasks(a, null, 'intersect')).toBeNull();
    expect(combineMasks(a, rectMask({ x: 5, y: 5, width: 1, height: 1 }), 'intersect')).toBeNull();
    expect(combineMasks(a, a, 'subtract')).toBeNull();
  });

  it('normalizes the result', () => {
    // Adding the missing piece of an L gives back a plain rectangle.
    const l = maskFrom(['#.', '##'])!;
    expect(combineMasks(l, rectMask({ x: 1, y: 0, width: 1, height: 1 }), 'add')).toEqual(
      rectMask({ x: 0, y: 0, width: 2, height: 2 }),
    );
  });
});

describe('invertMask', () => {
  const area = { x: 0, y: 0, width: 4, height: 3 };

  it('selects what is left of the area', () => {
    expect(show(invertMask(maskFrom(['##', '#.'], 1, 1), area), area)).toEqual(['####', '#..#', '#.##']);
    // A band across the top inverts to the rectangle below it, without bits.
    expect(invertMask(rectMask({ x: 0, y: 0, width: 4, height: 1 }), area)).toEqual(
      rectMask({ x: 0, y: 1, width: 4, height: 2 }),
    );
  });

  it('turns nothing into everything and back', () => {
    expect(invertMask(null, area)).toEqual(rectMask(area));
    expect(invertMask(rectMask(area), area)).toBeNull();
  });

  it('is its own inverse', () => {
    const mask = maskFrom(['#..#', '.##.'])!;
    expect(invertMask(invertMask(mask, area), area)).toEqual(mask);
  });
});

describe('lassoMask', () => {
  const lasso = (points: Array<[number, number]>, bounds = BOUNDS) =>
    lassoMask(points.map(([x, y]): Point => ({ x, y })), bounds);

  it('selects the path and everything inside it', () => {
    expect(show(lasso([[0, 0], [4, 0], [4, 4], [0, 4]]))).toEqual(['#####', '#####', '#####', '#####', '#####']);
    // A diamond: the closing edges are part of the path too.
    expect(show(lasso([[2, 0], [4, 2], [2, 4], [0, 2]]))).toEqual(['..#..', '.###.', '#####', '.###.', '..#..']);
  });

  it('closes an open path with a straight line', () => {
    expect(show(lasso([[0, 0], [3, 0], [3, 3]]))).toEqual(['####', '.###', '..##', '...#']);
  });

  it('keeps loops drawn over themselves selected (nonzero winding)', () => {
    // Twice around the same square: even-odd would leave the middle out.
    const square: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(show(lasso([...square, ...square]))).toEqual(['#####', '#####', '#####', '#####', '#####']);
  });

  it('is a single pixel for a click, and clips to the bounds', () => {
    expect(lasso([[3, 2]])).toEqual(rectMask({ x: 3, y: 2, width: 1, height: 1 }));
    expect(lasso([[-5, -5], [2, -5], [2, 2], [-5, 2]], { x: 0, y: 0, width: 4, height: 4 })).toEqual(
      rectMask({ x: 0, y: 0, width: 3, height: 3 }),
    );
    expect(lasso([[-5, -5], [-1, -1]], { x: 0, y: 0, width: 4, height: 4 })).toBeNull();
  });
});

describe('outlines', () => {
  it('outlines a rectangle with four convex runs', () => {
    const runs = maskOutline(rectMask({ x: 5, y: 5, width: 3, height: 2 }));
    expect(runs).toHaveLength(4);
    expect(runs.every((run) => !run.concaveFrom && !run.concaveTo)).toBe(true);
    // Same as tracing it pixel by pixel.
    expect(runs).toEqual(outlineRuns(3, 2, (x, y) => x >= 0 && y >= 0 && x < 3 && y < 2));
  });

  it('marks the ends of runs at inner corners as concave', () => {
    // An L: its inner corner is at (1, 1).
    const runs = maskOutline(maskFrom(['#.', '##'])!);
    expect(runs).toHaveLength(6);
    // The top edge of the lower-right pixel turns inward at its start.
    expect(runs).toContainEqual({ horizontal: true, at: 1, from: 1, to: 2, out: -1, concaveFrom: true, concaveTo: false });
    // The right edge of the top pixel turns inward at its end.
    expect(runs).toContainEqual({ horizontal: false, at: 1, from: 0, to: 1, out: 1, concaveFrom: false, concaveTo: true });
  });

  it('keeps pixels that touch only at a corner apart', () => {
    const runs = maskOutline(maskFrom(['#.', '.#'])!);
    expect(runs).toHaveLength(8);
    expect(runs.every((run) => !run.concaveFrom && !run.concaveTo)).toBe(true);
  });
});
