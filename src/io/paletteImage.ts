import { alpha, blue, green, red } from '../core/color.ts';
import { createPalette, type Palette } from '../core/palette.ts';
import { decodeImage, encodeImage } from './imageCodec.ts';
import { uniqueColors } from './paletteFormats.ts';

/** A palette of an image's distinct colors in reading order (e.g. a Lospec PNG swatch strip). */
export async function paletteFromImageFile(file: Blob, name: string): Promise<Palette> {
  const colors = uniqueColors((await decodeImage(file)).data);
  if (colors.length === 0) throw new Error('The image has no visible colors');
  return createPalette(name, colors);
}

/** A PNG with one pixel per color in a single row: the Lospec "1x" swatch format. Keeps alpha. */
export async function paletteToPng(palette: Palette): Promise<Blob> {
  const width = Math.max(1, palette.colors.length);
  const data = new Uint8ClampedArray(width * 4);
  palette.colors.forEach((color, i) => data.set([red(color), green(color), blue(color), alpha(color)], i * 4));
  return encodeImage({ width, height: 1, data }, 'png');
}
