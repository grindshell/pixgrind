import { describe, expect, it } from 'vitest';
import { blue, green, packRgba, red, type Rgba } from './color.ts';
import type { RgbaImage } from './image.ts';
import { createPalette } from './palette.ts';
import { nearestColorIndex } from './paletteEdits.ts';
import { ALPHA_THRESHOLD, colorMatcher, generatePalette, paletteSpread, quantizeImage } from './quantize.ts';

const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

/** A seeded random number generator in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

/** An image of `colors`, one pixel each, row by row. */
function imageOf(width: number, colors: Rgba[]): RgbaImage {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((color, i) => data.set([red(color), green(color), blue(color), color & 0xff], i * 4));
  return { width, height: colors.length / width, data };
}

function flat(width: number, height: number, color: Rgba): RgbaImage {
  return imageOf(width, Array(width * height).fill(color));
}

/** The average of the colors the indices stand for, per channel. */
function meanColor(pixels: Uint8Array, colors: Rgba[]): number[] {
  const sums = [0, 0, 0];
  for (const index of pixels) {
    const color = colors[index - 1];
    sums[0] += red(color);
    sums[1] += green(color);
    sums[2] += blue(color);
  }
  return sums.map((sum) => sum / pixels.length);
}

describe('colorMatcher', () => {
  it('agrees with nearestColorIndex, ties and translucent colors included', () => {
    const random = seeded(3);
    const colors = Array.from({ length: 24 }, () =>
      packRgba(random() * 256, random() * 256, random() * 256, random() < 0.2 ? random() * 256 : 255),
    );
    colors.push(colors[5]);
    const palette = createPalette('p', colors);
    const matcher = colorMatcher(colors);
    for (let n = 0; n < 2000; n++) {
      const [r, g, b] = [random(), random(), random()].map((v) => Math.floor(v * 256));
      // Twice: the second answer comes from the table.
      expect(matcher.nearest(r, g, b)).toBe(nearestColorIndex(palette, packRgba(r, g, b)));
      expect(matcher.nearest(r, g, b)).toBe(nearestColorIndex(palette, packRgba(r, g, b)));
    }
  });

  it('refuses an empty palette', () => {
    expect(() => colorMatcher([])).toThrow(/no colors/);
  });
});

describe('quantizeImage', () => {
  const colors = [BLACK, 0xff0000ff, WHITE];

  it('maps to the nearest colors, with faint pixels transparent', () => {
    const image = imageOf(4, [0x100000ff, 0xe01010ff, 0xffffff00 | ALPHA_THRESHOLD, 0xffffff00 | (ALPHA_THRESHOLD - 1)]);
    expect(Array.from(quantizeImage(image, colorMatcher(colors)))).toEqual([1, 2, 3, 0]);
  });

  it('keeps palette colors exactly whatever the dithering', () => {
    const image = imageOf(3, [WHITE, 0xff0000ff, BLACK, BLACK, WHITE, 0xff0000ff]);
    for (const dither of ['none', 'ordered', 'diffusion'] as const) {
      expect(Array.from(quantizeImage(image, colorMatcher(colors), dither))).toEqual([3, 2, 1, 1, 3, 2]);
    }
  });

  it('dithers a gray between black and white to about its shade', () => {
    const matcher = colorMatcher([BLACK, WHITE]);
    for (const dither of ['ordered', 'diffusion'] as const) {
      for (const level of [64, 128, 192]) {
        const pixels = quantizeImage(flat(32, 32, packRgba(level, level, level)), matcher, dither);
        const [mean] = meanColor(pixels, [BLACK, WHITE]);
        expect(Math.abs(mean - level), `${dither} ${level}`).toBeLessThan(10);
      }
    }
  });

  it('draws ordered dithering in a repeating 8×8 pattern', () => {
    const pixels = quantizeImage(flat(16, 16, 0x808080ff), colorMatcher([BLACK, WHITE]), 'ordered');
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(pixels[(y + 8) * 16 + x + 8]).toBe(pixels[y * 16 + x]);
      }
    }
    // Neighbors differ in a checkerboard-like pattern rather than in runs.
    expect(pixels[0]).not.toBe(pixels[1]);
  });

  it("doesn't dither at strength 0", () => {
    const image = flat(8, 8, 0x808080ff);
    const matcher = colorMatcher([BLACK, WHITE]);
    const plain = Array.from(quantizeImage(image, matcher));
    expect(Array.from(quantizeImage(image, matcher, 'ordered', 0))).toEqual(plain);
    expect(Array.from(quantizeImage(image, matcher, 'diffusion', 0))).toEqual(plain);
  });

  it('passes no error through transparent pixels', () => {
    const matcher = colorMatcher([BLACK, WHITE]);
    // Gray rounds up to white, and the error left makes the next gray black…
    expect(Array.from(quantizeImage(imageOf(3, [0x808080ff, 0x808080ff, 0x808080ff]), matcher, 'diffusion'))).toEqual([2, 1, 2]);
    // …unless a transparent pixel comes between.
    expect(Array.from(quantizeImage(imageOf(3, [0x808080ff, 0x00000000, 0x808080ff]), matcher, 'diffusion'))).toEqual([2, 0, 2]);
  });
});

describe('paletteSpread', () => {
  it('is the typical gap to the nearest other color, per channel', () => {
    expect(paletteSpread([BLACK, WHITE])).toBeCloseTo(255);
    expect(paletteSpread([BLACK])).toBe(0);
    // Duplicates don't make the gap zero.
    expect(paletteSpread([BLACK, BLACK, WHITE])).toBeCloseTo(255);
  });
});

describe('generatePalette', () => {
  it("returns an image's own colors when it has no more than asked for, dark to light", () => {
    const image = imageOf(4, [WHITE, 0xff0000ff, WHITE, BLACK]);
    expect(generatePalette(image, 8)).toEqual([BLACK, 0xff0000ff, WHITE]);
  });

  it('finds the middle of each cluster of colors', () => {
    const random = seeded(5);
    const around = (r: number, g: number, b: number) =>
      packRgba(r + Math.round(random() * 8 - 4), g + Math.round(random() * 8 - 4), b + Math.round(random() * 8 - 4));
    const pixels = Array.from({ length: 300 }, (_, i) =>
      i % 3 === 0 ? around(40, 60, 200) : i % 3 === 1 ? around(220, 200, 40) : around(30, 140, 50),
    );
    const palette = generatePalette(imageOf(30, pixels), 3);
    expect(palette).toHaveLength(3);
    const expected = [
      [40, 60, 200],
      [30, 140, 50],
      [220, 200, 40],
    ];
    palette.forEach((color, i) => {
      expect(Math.abs(red(color) - expected[i][0])).toBeLessThanOrEqual(2);
      expect(Math.abs(green(color) - expected[i][1])).toBeLessThanOrEqual(2);
      expect(Math.abs(blue(color) - expected[i][2])).toBeLessThanOrEqual(2);
    });
  });

  it('gives as many colors as asked for from many, with faint pixels left out', () => {
    const random = seeded(9);
    // Over 8192 distinct colors, so they're grouped first.
    const pixels = Array.from({ length: 20_000 }, () => packRgba(random() * 256, random() * 256, random() * 256));
    const palette = generatePalette(imageOf(100, pixels), 16);
    expect(palette).toHaveLength(16);
    expect(new Set(palette).size).toBe(16);
    expect(palette.every((color) => (color & 0xff) === 0xff)).toBe(true);
    expect(generatePalette(imageOf(2, [0xff000000 | 10, 0x00ff0000]), 4)).toEqual([]);
  });

  it('is deterministic and rejects invalid counts', () => {
    const random = seeded(2);
    const image = imageOf(50, Array.from({ length: 500 }, () => packRgba(random() * 256, random() * 256, random() * 256)));
    expect(generatePalette(image, 7)).toEqual(generatePalette(image, 7));
    expect(() => generatePalette(image, 0)).toThrow(RangeError);
  });
});
