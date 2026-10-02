import { describe, expect, it } from 'vitest';
import { documentImage, flattenImage, indexImageColors, indexImageToPalette, upscaleImage, type RgbaImage } from './image.ts';
import { createPalette } from './palette.ts';
import { createDocument, setPixel } from './pixelDocument.ts';

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const CLEAR = [0, 0, 0, 0];
const HALF_BLUE = [0, 0, 255, 128];

function rgba(...pixels: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

function pixelsOf(image: RgbaImage): string[] {
  const out: string[] = [];
  for (let i = 0; i < image.data.length; i += 4) out.push(Array.from(image.data.subarray(i, i + 4)).join(','));
  return out;
}

describe('indexImageColors', () => {
  it('builds a palette of distinct visible colors in reading order', () => {
    const { colors, pixels } = indexImageColors(rgba(GREEN, RED, CLEAR, GREEN, HALF_BLUE));
    expect(colors).toEqual([0x00ff00ff, 0xff0000ff, 0x0000ff80]);
    expect(Array.from(pixels)).toEqual([1, 2, 0, 1, 3]);
  });

  it('treats any fully transparent pixel as index 0, whatever its RGB', () => {
    expect(Array.from(indexImageColors(rgba([9, 9, 9, 0])).pixels)).toEqual([0]);
  });

  it('reports the real color count past the limit', () => {
    expect(() => indexImageColors(rgba(RED, GREEN, HALF_BLUE), 2)).toThrow(/3 colors/);
  });
});

describe('indexImageToPalette', () => {
  it('maps each pixel to the nearest palette color, keeping transparency', () => {
    const palette = createPalette('p', [0x000000ff, 0xff0000ff, 0x00ff00ff]);
    const pixels = indexImageToPalette(rgba([200, 30, 30, 255], CLEAR, [10, 10, 10, 255], [20, 220, 40, 255]), palette);
    expect(Array.from(pixels)).toEqual([2, 0, 1, 3]);
  });
});

describe('upscaleImage', () => {
  it('repeats each pixel scale×scale times', () => {
    const image = { width: 2, height: 1, data: rgba(RED, GREEN) };
    const scaled = upscaleImage(image, 2);
    expect([scaled.width, scaled.height]).toEqual([4, 2]);
    expect(pixelsOf(scaled)).toEqual([
      RED.join(), RED.join(), GREEN.join(), GREEN.join(),
      RED.join(), RED.join(), GREEN.join(), GREEN.join(),
    ]);
  });

  it('copies at 1× and rejects non-integer scales', () => {
    const image = { width: 1, height: 1, data: rgba(RED) };
    const same = upscaleImage(image, 1);
    expect(same.data).not.toBe(image.data);
    expect(pixelsOf(same)).toEqual([RED.join()]);
    expect(() => upscaleImage(image, 1.5)).toThrow(RangeError);
    expect(() => upscaleImage(image, 0)).toThrow(RangeError);
  });

  it('works on views into larger buffers', () => {
    const buffer = rgba(GREEN, RED, GREEN);
    const view = { width: 1, height: 1, data: buffer.subarray(4, 8) };
    expect(pixelsOf(upscaleImage(view, 2))).toEqual(Array(4).fill(RED.join()));
  });
});

describe('flattenImage', () => {
  it('fills transparency with the background and blends partial alpha', () => {
    const flat = flattenImage({ width: 3, height: 1, data: rgba(RED, CLEAR, HALF_BLUE) }, 0xffffffff);
    const [opaque, cleared, blended] = pixelsOf(flat).map((p) => p.split(',').map(Number));
    expect(opaque).toEqual(RED);
    expect(cleared).toEqual([255, 255, 255, 255]);
    expect(blended[3]).toBe(255);
    expect(blended[0]).toBeCloseTo(127, -1);
    expect(blended[2]).toBe(255);
  });
});

describe('documentImage', () => {
  it('flattens visible layers at document size', () => {
    const doc = createDocument(2, 1, createPalette('p', [0xff0000ff]));
    setPixel(doc, doc.layers[0], 1, 0, 1);
    const image = documentImage(doc);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(pixelsOf(image)).toEqual([CLEAR.join(), RED.join()]);
  });
});
