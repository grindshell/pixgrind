import { describe, expect, it } from 'vitest';
import {
  colorForIndex,
  createPalette,
  DEFAULT_PALETTE,
  MAX_PALETTE_COLORS,
  TRANSPARENT,
} from './palette.ts';

describe('palette', () => {
  const palette = createPalette('test', [0xff0000ff, 0x00ff00ff]);

  it('maps index 0 to transparent', () => {
    expect(colorForIndex(palette, TRANSPARENT)).toBe(0);
  });

  it('maps index n to colors[n - 1]', () => {
    expect(colorForIndex(palette, 1)).toBe(0xff0000ff);
    expect(colorForIndex(palette, 2)).toBe(0x00ff00ff);
  });

  it('maps indices past the end to transparent', () => {
    expect(colorForIndex(palette, 3)).toBe(0);
  });

  it('copies the color list', () => {
    const colors = [0xff0000ff];
    const p = createPalette('copy', colors);
    colors.push(0x00ff00ff);
    expect(p.colors).toHaveLength(1);
  });

  it('rejects more than 255 colors', () => {
    const tooMany = new Array<number>(MAX_PALETTE_COLORS + 1).fill(0xffffffff);
    expect(() => createPalette('big', tooMany)).toThrow(RangeError);
    expect(() => createPalette('max', tooMany.slice(1))).not.toThrow();
  });

  it('ships a 16-color default', () => {
    expect(DEFAULT_PALETTE.colors).toHaveLength(16);
  });
});
