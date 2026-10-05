import { describe, expect, it } from 'vitest';
import type { RgbaImage } from './image.ts';
import { averageResample, dominantResample, nearestResample } from './resample.ts';

function image(width: number, height: number, pixels: number[][]): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(pixels.flat()) };
}

function pixelsOf(result: RgbaImage): number[][] {
  const out: number[][] = [];
  for (let o = 0; o < result.data.length; o += 4) out.push(Array.from(result.data.subarray(o, o + 4)));
  return out;
}

/** A random image, seeded so failures repeat. */
function noise(width: number, height: number, seed = 1): RgbaImage {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, () => Math.floor(random() * 256)) };
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

describe('averageResample', () => {
  it('averages each cell', () => {
    const source = image(4, 2, [RED, RED, BLUE, BLUE, RED, RED, BLUE, BLUE]);
    expect(pixelsOf(averageResample(source, 2, 1))).toEqual([RED, BLUE]);
  });

  it('keeps every color of a flat area exactly, through linear light and back', () => {
    for (let v = 0; v < 256; v++) {
      const flat = image(3, 3, Array.from({ length: 9 }, () => [v, 255 - v, v, 255]));
      expect(pixelsOf(averageResample(flat, 2, 2))).toEqual(Array(4).fill([v, 255 - v, v, 255]));
    }
  });

  it('mixes in linear light: black and white make a light gray', () => {
    const [mixed] = pixelsOf(averageResample(image(2, 1, [BLACK, WHITE]), 1, 1));
    // Half of white's light is sRGB 188, not 128.
    expect(mixed).toEqual([188, 188, 188, 255]);
  });

  it('weights colors by alpha, so transparent pixels thin a color without darkening it', () => {
    const [mixed] = pixelsOf(averageResample(image(2, 1, [RED, CLEAR]), 1, 1));
    expect(mixed).toEqual([255, 0, 0, 128]);
    expect(pixelsOf(averageResample(image(2, 1, [CLEAR, CLEAR]), 1, 1))).toEqual([CLEAR]);
  });

  it('counts pixels on the edge of a cell by how much of them it covers', () => {
    // Three pixels into two: the middle one is split between both cells.
    const result = pixelsOf(averageResample(image(3, 1, [RED, [255, 0, 0, 0], RED]), 2, 1));
    // Each cell covers one opaque pixel and half a transparent one: alpha 2/3.
    expect(result).toEqual([
      [255, 0, 0, 170],
      [255, 0, 0, 170],
    ]);
  });

  it('matches averaging every covered pixel by its exact share', () => {
    const source = noise(7, 5);
    const result = averageResample(source, 3, 2);
    // The alpha of output (1, 1): x covers 7/3..14/3, y covers 2.5..5.
    let expected = 0;
    for (let y = 2; y < 5; y++) {
      for (let x = 2; x < 5; x++) {
        const share = (Math.min(14 / 3, x + 1) - Math.max(7 / 3, x)) * (Math.min(5, y + 1) - Math.max(2.5, y));
        expected += source.data[(y * 7 + x) * 4 + 3] * share;
      }
    }
    expect(result.data[(1 * 3 + 1) * 4 + 3]).toBe(Math.round(expected / ((7 / 3) * 2.5)));
  });

  it('stretches too, and rejects invalid sizes', () => {
    expect(pixelsOf(averageResample(image(1, 1, [RED]), 2, 2))).toEqual(Array(4).fill(RED));
    expect(() => averageResample(image(1, 1, [RED]), 0, 1)).toThrow(RangeError);
    expect(() => averageResample(image(1, 1, [RED]), 1.5, 1)).toThrow(RangeError);
  });
});

describe('resampling a region', () => {
  // Two pixels; the region starts half a pixel before the image and runs a pixel past it.
  const source = image(2, 1, [RED, BLUE]);
  const region = { x: -0.5, y: 0, width: 3.5, height: 1 };

  it('averages what the region covers, transparent off the image', () => {
    // Seven half-pixel cells: off, red, red, blue, blue, off, off.
    expect(pixelsOf(averageResample(source, 7, 1, region))).toEqual([CLEAR, RED, RED, BLUE, BLUE, CLEAR, CLEAR]);
    // Cells straddling the edge are partly transparent.
    const [first, , last] = pixelsOf(averageResample(source, 3, 1, { x: -0.5, y: 0, width: 3, height: 1 }));
    expect(first).toEqual([255, 0, 0, 128]);
    expect(last).toEqual([0, 0, 255, 128]);
  });

  it('samples centers on the image only', () => {
    expect(pixelsOf(nearestResample(source, 7, 1, region))).toEqual([CLEAR, RED, RED, BLUE, BLUE, CLEAR, CLEAR]);
  });

  it('counts what lies off the image as transparent when voting', () => {
    const indexAt = (o: number) => (source.data[o] === 255 ? 1 : 2);
    // Cells of 1.5: the first is two thirds off the image and a third red.
    expect(Array.from(dominantResample(source, 2, 1, indexAt, { x: -1, y: 0, width: 3, height: 1 }))).toEqual([0, 2]);
    // Wholly off the image.
    expect(Array.from(dominantResample(source, 1, 1, indexAt, { x: 5, y: 0, width: 1, height: 1 }))).toEqual([0]);
  });

  it('rejects empty regions', () => {
    expect(() => averageResample(source, 1, 1, { x: 0, y: 0, width: 0, height: 1 })).toThrow(RangeError);
  });
});

describe('nearestResample', () => {
  it("takes each cell's center pixel", () => {
    // Cells of 3 pixels: centers 1 and 4.
    const source = image(6, 1, [BLACK, RED, BLACK, BLACK, BLUE, BLACK]);
    expect(pixelsOf(nearestResample(source, 2, 1))).toEqual([RED, BLUE]);
  });

  it('shrinks enlarged pixel art back exactly', () => {
    const small = noise(5, 4, 7);
    const big = image(
      20,
      12,
      Array.from({ length: 20 * 12 }, (_, i) => {
        const o = (Math.floor(Math.floor(i / 20) / 3) * 5 + Math.floor((i % 20) / 4)) * 4;
        return Array.from(small.data.subarray(o, o + 4));
      }),
    );
    expect(nearestResample(big, 5, 4).data).toEqual(small.data);
  });
});

describe('dominantResample', () => {
  /** Index by color: red 1, blue 2, black 3, transparent 0. */
  const indexAt = (source: RgbaImage) => (o: number) => {
    const [r, , b, a] = source.data.subarray(o, o + 4);
    if (a === 0) return 0;
    return r === 255 ? 1 : b === 255 ? 2 : 3;
  };

  it('gives each cell the index covering the most of it', () => {
    const source = image(4, 2, [RED, BLUE, BLUE, BLUE, RED, RED, BLUE, RED]);
    expect(Array.from(dominantResample(source, 2, 1, indexAt(source)))).toEqual([1, 2]);
  });

  it('counts transparency like a color, and breaks ties toward the lower index', () => {
    const source = image(4, 1, [CLEAR, CLEAR, BLUE, RED]);
    expect(Array.from(dominantResample(source, 2, 1, indexAt(source)))).toEqual([0, 1]);
  });

  it('weights pixels on the edge of a cell by how much of them it covers', () => {
    // Cells of 1.5 pixels: the first covers all of pixel 0 and half of pixel 1.
    const source = image(3, 1, [BLUE, RED, RED]);
    expect(Array.from(dominantResample(source, 2, 1, indexAt(source)))).toEqual([2, 1]);
  });
});
