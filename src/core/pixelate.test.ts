import { describe, expect, it } from 'vitest';
import { packRgba, type Rgba } from './color.ts';
import type { RgbaImage } from './image.ts';
import { countUsedColors, createPixelator, pixelateImage, usedColorsOnly, type PixelateOptions } from './pixelate.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const CLEAR = 0;

/** `rows` of colors, each pixel enlarged to `scale`×`scale`. */
function enlarged(rows: Rgba[][], scale: number): RgbaImage {
  const width = rows[0].length * scale;
  const height = rows.length * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = rows[Math.floor(y / scale)][Math.floor(x / scale)];
      data.set([color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const SPRITE = [
  [RED, GREEN, CLEAR],
  [BLUE, RED, RED],
];

function options(changes: Partial<PixelateOptions> = {}): PixelateOptions {
  return { width: 3, height: 2, sampling: 'average', colors: null, colorCount: 16, dither: 'none', ditherStrength: 1, ...changes };
}

/** The colors of the pixels, by name. */
function colorsOf({ pixels, colors }: { pixels: Uint8Array; colors: Rgba[] }): Rgba[] {
  return Array.from(pixels, (index) => (index === 0 ? CLEAR : colors[index - 1]));
}

describe('pixelateImage', () => {
  it('shrinks enlarged pixel art back exactly, in any sampling', () => {
    for (const sampling of ['average', 'dominant', 'nearest'] as const) {
      const result = pixelateImage(enlarged(SPRITE, 5), options({ sampling }));
      expect([result.width, result.height]).toEqual([3, 2]);
      expect(colorsOf(result), sampling).toEqual(SPRITE.flat());
    }
  });

  it('generates only colors it uses, dark to light', () => {
    const result = pixelateImage(enlarged(SPRITE, 2), options());
    expect(result.colors).toEqual([BLUE, RED, GREEN]);
  });

  it('maps to given colors, keeping all of them', () => {
    const colors = [0x000000ff, 0xc00000ff, 0xffffffff];
    const result = pixelateImage(enlarged(SPRITE, 2), options({ colors }));
    expect(result.colors).toEqual(colors);
    // Green and blue are nearest black; red, the dark red.
    expect(Array.from(result.pixels)).toEqual([2, 1, 0, 1, 2, 2]);
  });

  it('votes with given colors when sampling the dominant color', () => {
    // Each 2×2 cell: three pixels near blue and one red, which averages to purple.
    const source = enlarged([[0x1010e0ff, 0x1010e0ff], [0x1010e0ff, RED]], 1);
    const purple = 0x800080ff;
    const colors = [BLUE, RED, purple];
    expect(Array.from(pixelateImage(source, options({ width: 1, height: 1, colors, sampling: 'dominant' })).pixels)).toEqual([1]);
    expect(Array.from(pixelateImage(source, options({ width: 1, height: 1, colors, sampling: 'average' })).pixels)).toEqual([3]);
  });

  it('gives an empty palette for an image with nothing opaque enough', () => {
    const result = pixelateImage(enlarged([[packRgba(255, 0, 0, 20)]], 2), options({ width: 1, height: 1 }));
    expect(result.colors).toEqual([]);
    expect(Array.from(result.pixels)).toEqual([0]);
  });

  it('refuses sizes a document can’t have', () => {
    const source = enlarged(SPRITE, 1);
    expect(() => pixelateImage(source, options({ width: 0 }))).toThrow(RangeError);
    expect(() => pixelateImage(source, options({ width: 2000 }))).toThrow(/too large/);
  });
});

describe('createPixelator', () => {
  it('gives the same results as pixelating afresh as the options change', () => {
    let state = 4;
    const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const source: RgbaImage = {
      width: 40,
      height: 30,
      data: Uint8ClampedArray.from({ length: 40 * 30 * 4 }, (_, i) => (i % 4 === 3 ? 255 : random() * 256)),
    };
    const pixelate = createPixelator(source);
    const steps: Partial<PixelateOptions>[] = [
      { width: 8, height: 6 },
      { width: 8, height: 6, dither: 'ordered' },
      { width: 8, height: 6, dither: 'diffusion', colorCount: 4 },
      { width: 10, height: 6, dither: 'diffusion', colorCount: 4 },
      { width: 10, height: 6, sampling: 'dominant', colorCount: 4 },
      { width: 10, height: 6, sampling: 'nearest', colors: [0x000000ff, 0xffffffff] },
      { width: 8, height: 6 },
    ];
    for (const step of steps) {
      expect(pixelate(options(step)), JSON.stringify(step)).toEqual(pixelateImage(source, options(step)));
    }
  });
});

describe('usedColorsOnly', () => {
  it('drops unused colors and renumbers pixels to match', () => {
    const image = { width: 3, height: 1, colors: [RED, GREEN, BLUE], pixels: Uint8Array.of(3, 0, 1) };
    const used = usedColorsOnly(image);
    expect(used.colors).toEqual([RED, BLUE]);
    expect(Array.from(used.pixels)).toEqual([2, 0, 1]);
    expect(countUsedColors(image)).toBe(2);
    const all = { ...image, pixels: Uint8Array.of(3, 2, 1) };
    expect(usedColorsOnly(all)).toBe(all);
  });
});
