import { describe, expect, it } from 'vitest';
import {
  autoShape,
  carveCell,
  cellExtrusion,
  cellIndex,
  CUT_BOTTOM_LEFT,
  CUT_BOTTOM_RIGHT,
  CUT_TOP_LEFT,
  CUT_TOP_RIGHT,
  DEFAULT_EXTRUSION,
  extendCell,
  extrusionDepth,
  extrusionEnd,
  extrusionOffset,
  extrusionShape,
  isExtrusion,
  MAX_DEPTH,
  MAX_OFFSET,
  packCell,
  packExtrusion,
  SQUARE,
  withBox,
  withShape,
  type Shape,
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
    // Cells fit a Uint32Array (floats keep what's under them in one).
    const largest = packCell(255, packExtrusion(MAX_OFFSET, MAX_DEPTH, CUT_BOTTOM_LEFT));
    expect(largest).toBeLessThan(2 ** 32);
    expect(cellExtrusion(largest)).toBe(packExtrusion(MAX_OFFSET, MAX_DEPTH, CUT_BOTTOM_LEFT));
  });

  it('carry a shape, changed apart from the box', () => {
    const extrusion = packExtrusion(12, 200, CUT_TOP_RIGHT);
    expect([extrusionOffset(extrusion), extrusionDepth(extrusion), extrusionShape(extrusion)]).toEqual([12, 200, CUT_TOP_RIGHT]);
    expect(extrusionShape(DEFAULT_EXTRUSION)).toBe(SQUARE);
    expect(withBox(extrusion, 1, 2)).toBe(packExtrusion(1, 2, CUT_TOP_RIGHT));
    expect(withShape(extrusion, CUT_BOTTOM_LEFT)).toBe(packExtrusion(12, 200, CUT_BOTTOM_LEFT));
    expect(isExtrusion(extrusion)).toBe(true);
    expect(isExtrusion((5 << 16) | 1)).toBe(false);
    expect(() => packExtrusion(0, 1, 5 as Shape)).toThrow(RangeError);
  });
});

describe('autoShape', () => {
  /** The shape for the middle pixel of three rows of digits. */
  const middle = (...rows: string[]) => autoShape(Uint8Array.from(rows.join('').split('').map(Number)), 3, 3, 1, 1);

  it('cuts the corner between two empty sides', () => {
    expect(middle('000', '011', '010')).toBe(CUT_TOP_LEFT);
    expect(middle('000', '110', '010')).toBe(CUT_TOP_RIGHT);
    expect(middle('010', '110', '000')).toBe(CUT_BOTTOM_RIGHT);
    expect(middle('010', '011', '000')).toBe(CUT_BOTTOM_LEFT);
    // Diagonal neighbors don't matter.
    expect(middle('001', '011', '110')).toBe(CUT_TOP_LEFT);
  });

  it('counts the outside of the document as empty, so a staircase steps down to its edges', () => {
    const pixels = Uint8Array.from(['0001', '0011', '0111', '1111'].join('').split('').map(Number));
    expect(autoShape(pixels, 4, 4, 2, 1)).toBe(CUT_TOP_LEFT);
    expect(autoShape(pixels, 4, 4, 1, 2)).toBe(CUT_TOP_LEFT);
    expect(autoShape(pixels, 4, 4, 3, 3)).toBe(CUT_BOTTOM_RIGHT);
    expect(autoShape(pixels, 4, 4, 0, 3)).toBeNull(); // top, left and bottom empty
  });

  it("leaves pixels where it isn't clear", () => {
    expect(middle('010', '111', '010')).toBeNull(); // none empty
    expect(middle('010', '111', '000')).toBeNull(); // one
    expect(middle('000', '111', '000')).toBeNull(); // two, opposite
    expect(middle('000', '110', '000')).toBeNull(); // three
    expect(middle('000', '010', '000')).toBeNull(); // four
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

  it('keeps the shape, as carving does', () => {
    const diagonal = packCell(2, packExtrusion(3, 2, CUT_TOP_LEFT));
    expect(extendCell(diagonal, 7, 9)).toBe(packCell(2, packExtrusion(3, 5, CUT_TOP_LEFT)));
    expect(carveCell(diagonal, 3)).toBe(packCell(2, packExtrusion(4, 1, CUT_TOP_LEFT)));
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
