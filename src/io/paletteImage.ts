import { alpha, blue, green, red } from '../core/color.ts';
import { createPalette, type Palette } from '../core/palette.ts';
import { uniqueColors } from './paletteFormats.ts';

/** A palette of an image's distinct colors in reading order (e.g. a Lospec PNG swatch strip). */
export async function paletteFromImageFile(file: Blob, name: string): Promise<Palette> {
  // No color-space conversion or premultiplication, so colors come out exactly as stored.
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const colors = uniqueColors(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
    if (colors.length === 0) throw new Error('The image has no visible colors');
    return createPalette(name, colors);
  } finally {
    bitmap.close();
  }
}

/** A PNG with one pixel per color in a single row: the Lospec "1x" swatch format. Keeps alpha. */
export async function paletteToPng(palette: Palette): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, palette.colors.length);
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const image = ctx.createImageData(canvas.width, 1);
  palette.colors.forEach((color, i) => {
    image.data.set([red(color), green(color), blue(color), alpha(color)], i * 4);
  });
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}
