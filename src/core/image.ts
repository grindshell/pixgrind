import { blue, green, packRgba, red, type Rgba } from './color.ts';
import { compositeRgba } from './composite.ts';
import { planeSize, type Facing } from './facing.ts';
import { MAX_PALETTE_COLORS, type Palette } from './palette.ts';
import { nearestColorIndex } from './paletteEdits.ts';
import type { PixelDocument } from './pixelDocument.ts';

/** Straight-alpha RGBA pixels, row-major (the `ImageData` layout). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Palette indices, row-major, as in a layer: 0 is transparent and `i` is the palette's color `i - 1`. */
export interface IndexedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/* ---- Import: RGBA → palette indices ---- */

/**
 * Indexes an image exactly: its distinct visible colors in reading order
 * become the palette, and each pixel gets the index of its color. Fully
 * transparent pixels become index 0. Throws when there are more than `limit`
 * colors.
 */
export function indexImageColors(
  data: Uint8ClampedArray,
  limit = MAX_PALETTE_COLORS,
): { colors: Rgba[]; pixels: Uint8Array } {
  const indexOf = new Map<Rgba, number>();
  const pixels = new Uint8Array(data.length / 4);
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    const color = packRgba(data[o], data[o + 1], data[o + 2], data[o + 3]);
    let index = indexOf.get(color);
    if (index === undefined) {
      index = indexOf.size + 1;
      indexOf.set(color, index);
    }
    // Keep counting past the limit so the error can report the real total.
    if (index <= limit) pixels[i] = index;
  }
  if (indexOf.size > limit) {
    throw new RangeError(`The image has ${indexOf.size} colors; a palette holds at most ${limit}`);
  }
  return { colors: [...indexOf.keys()], pixels };
}

/** Maps every pixel to the nearest color in `palette`. Fully transparent pixels become index 0. */
export function indexImageToPalette(data: Uint8ClampedArray, palette: Palette): Uint8Array {
  const pixels = new Uint8Array(data.length / 4);
  const cache = new Map<Rgba, number>();
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    const color = packRgba(data[o], data[o + 1], data[o + 2], data[o + 3]);
    let index = cache.get(color);
    if (index === undefined) {
      index = nearestColorIndex(palette, color);
      cache.set(color, index);
    }
    pixels[i] = index;
  }
  return pixels;
}

/* ---- Export: document → RGBA ---- */

/** The visible layers of one facing flattened into one image. */
export function documentImage(doc: PixelDocument, facing: Facing): RgbaImage {
  return { ...planeSize(doc, facing), data: compositeRgba(doc, facing) };
}

/** Scales up by a whole number with nearest-neighbor sampling, so pixels stay crisp squares. */
export function upscaleImage(image: RgbaImage, scale: number): RgbaImage {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`Invalid scale ${scale}`);
  if (scale === 1) return { ...image, data: image.data.slice() };
  const width = image.width * scale;
  const height = image.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  // Copy whole pixels as 32-bit words; byte order doesn't matter for a copy.
  const source = new Uint32Array(image.data.buffer, image.data.byteOffset, image.width * image.height);
  const target = new Uint32Array(data.buffer);
  for (let y = 0; y < height; y++) {
    const sourceRow = Math.floor(y / scale) * image.width;
    const targetRow = y * width;
    for (let x = 0; x < width; x++) target[targetRow + x] = source[sourceRow + Math.floor(x / scale)];
  }
  return { width, height, data };
}

/** Composites the image over an opaque background color, for formats without transparency (JPEG). */
export function flattenImage(image: RgbaImage, background: Rgba): RgbaImage {
  const data = new Uint8ClampedArray(image.data.length);
  const bg = [red(background), green(background), blue(background)];
  for (let o = 0; o < data.length; o += 4) {
    const a = image.data[o + 3] / 255;
    for (let c = 0; c < 3; c++) data[o + c] = image.data[o + c] * a + bg[c] * (1 - a);
    data[o + 3] = 255;
  }
  return { ...image, data };
}
