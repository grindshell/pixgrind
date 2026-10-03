import { describe, expect, it } from 'vitest';
import {
  carveCell,
  cellExtrusion,
  cellIndex,
  DEFAULT_EXTRUSION,
  extendCell,
  extrusionDepth,
  extrusionEnd,
  extrusionOffset,
  isExtrusion,
  MAX_DEPTH,
  MAX_OFFSET,
  packCell,
  packExtrusion,
} from './extrusion.ts';

/** A cell as [index, offset, depth], for readable expectations. */
const parts = (cell: number) => {
  const extrusion = cellExtrusion(cell);
  return [cellIndex(cell), extrusionOffset(extrusion), extrusionDepth(extrusion)];
};
const cell = (index: number, offset: number, depth: number) => packCell(index, packExtrusion(offset, depth));

describe('extrusions', () => {
  it('pack and unpack offset and depth', () => {
    const extrusion = packExtrusion(12, 200);
    expect([extrusionOffset(extrusion), extrusionDepth(extrusion), extrusionEnd(extrusion)]).toEqual([12, 200, 212]);
    expect(DEFAULT_EXTRUSION).toBe(packExtrusion(0, 1));
    expect(isExtrusion(packExtrusion(MAX_OFFSET, MAX_DEPTH))).toBe(true);
    expect(isExtrusion(0x0300)).toBe(false);
  });

  it('reject out-of-range values', () => {
    expect(() => packExtrusion(0, 0)).toThrow(RangeError);
    expect(() => packExtrusion(-1, 1)).toThrow(RangeError);
    expect(() => packExtrusion(MAX_OFFSET + 1, 1)).toThrow(RangeError);
    expect(() => packExtrusion(0, MAX_DEPTH + 1)).toThrow(RangeError);
    expect(() => packExtrusion(0.5, 1)).toThrow(RangeError);
  });

  it('pack into cells with an index', () => {
    const packed = cell(7, 3, 4);
    expect(parts(packed)).toEqual([7, 3, 4]);
    expect(packCell(255, 0xffff)).toBeLessThan(2 ** 24);
  });
});

describe('extendCell', () => {
  it('starts a transparent pixel one deep at z', () => {
    expect(parts(extendCell(packCell(0, DEFAULT_EXTRUSION), 5, 3))).toEqual([3, 5, 1]);
  });

  it('grows a box to reach z, keeping its color', () => {
    expect(parts(extendCell(cell(2, 3, 2), 7, 9))).toEqual([2, 3, 5]);
    expect(parts(extendCell(cell(2, 3, 2), 0, 9))).toEqual([2, 0, 5]);
    expect(extendCell(cell(2, 3, 2), 4, 9)).toBe(cell(2, 3, 2));
  });

  it("leaves boxes that can't reach", () => {
    expect(extendCell(packCell(0, DEFAULT_EXTRUSION), MAX_OFFSET + 1, 3)).toBe(packCell(0, DEFAULT_EXTRUSION));
    expect(extendCell(cell(1, 0, 1), MAX_DEPTH, 1)).toBe(cell(1, 0, 1));
    expect(parts(extendCell(cell(1, 0, 1), MAX_DEPTH - 1, 1))).toEqual([1, 0, MAX_DEPTH]);
  });
});

describe('carveCell', () => {
  it('trims whichever end is nearer, the back on a tie', () => {
    // Box from 2 to 7 (exclusive).
    expect(parts(carveCell(cell(4, 2, 5), 2))).toEqual([4, 3, 4]);
    expect(parts(carveCell(cell(4, 2, 5), 3))).toEqual([4, 4, 3]);
    expect(parts(carveCell(cell(4, 2, 5), 4))).toEqual([4, 2, 2]);
    expect(parts(carveCell(cell(4, 2, 5), 6))).toEqual([4, 2, 4]);
  });

  it('makes a one-deep box transparent, and ignores z outside the box', () => {
    expect(cellIndex(carveCell(cell(4, 2, 1), 2))).toBe(0);
    expect(carveCell(cell(4, 2, 1), 3)).toBe(cell(4, 2, 1));
    expect(carveCell(packCell(0, DEFAULT_EXTRUSION), 0)).toBe(packCell(0, DEFAULT_EXTRUSION));
  });
});
