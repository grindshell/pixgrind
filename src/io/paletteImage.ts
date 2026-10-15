import { createPalette, type Palette } from '../core/palette.ts';
import { decodeImage } from './imageCodec.ts';
import { uniqueColors } from './paletteFormats.ts';
import { decodePng, encodeIndexedPng } from './png.ts';

/** Larger images are read through the browser instead (see `paletteFromImageFile`). */
const MAX_PNG_PIXELS = 8192 * 8192;

/**
 * A palette of an image's distinct colors in reading order (e.g. a Lospec
 * PNG swatch strip). PNGs are read exactly (`decodePng`), so translucent
 * colors come back as saved; anything else, and PNGs that decoder can't
 * read (interlaced ones), goes through the browser, which rounds them.
 */
export async function paletteFromImageFile(file: Blob, name: string): Promise<Palette> {
  const colors = uniqueColors((await decodeSwatches(file)).data);
  if (colors.length === 0) throw new Error('The image has no visible colors');
  return createPalette(name, colors);
}

async function decodeSwatches(file: Blob): Promise<{ data: Uint8ClampedArray }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await decodePng(bytes, MAX_PNG_PIXELS);
  } catch {
    return decodeImage(file);
  }
}

/**
 * A PNG with one pixel per color in a single row: the Lospec "1x" swatch
 * format. An indexed PNG with each color as it is, alpha included; a canvas
 * would round translucent colors on the way out.
 */
export async function paletteToPng(palette: Palette): Promise<Blob> {
  const width = Math.max(1, palette.colors.length);
  const pixels = Uint8Array.from({ length: width }, (_, i) => (i < palette.colors.length ? i + 1 : 0));
  return new Blob([await encodeIndexedPng({ width, height: 1, pixels }, palette.colors)], { type: 'image/png' });
}
