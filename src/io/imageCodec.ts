import type { RgbaImage } from '../core/image.ts';
import { decodePng } from './png.ts';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_FORMATS: Record<ImageFormat, { label: string; mime: string; extension: string }> = {
  png: { label: 'PNG', mime: 'image/png', extension: 'png' },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  webp: { label: 'WebP', mime: 'image/webp', extension: 'webp' },
};

/** Largest export width or height. Browsers refuse canvases much beyond this. */
export const MAX_EXPORT_SIZE = 8192;

/** Throws a RangeError for images too large to encode. Check before building one: they take gigabytes. */
export function checkExportSize(width: number, height: number): void {
  if (width > MAX_EXPORT_SIZE || height > MAX_EXPORT_SIZE) {
    throw new RangeError(`${width}×${height} is too large to export (max ${MAX_EXPORT_SIZE} per side)`);
  }
}

/**
 * Decodes an image file to RGBA without color-space conversion. Opaque and
 * fully transparent pixels come out exact; translucent ones may be off by
 * rounding, because canvases store colors premultiplied by alpha.
 * `checkSize` gets the image's size before its pixels are read and throws to
 * refuse it, so an image too large to use fails fast instead of first taking
 * its full size in memory.
 */
export async function decodeImage(file: Blob, checkSize?: (width: number, height: number) => void): Promise<RgbaImage> {
  const bitmap = await exactBitmap(file);
  try {
    checkSize?.(bitmap.width, bitmap.height);
    return readBitmap(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Decodes the top-left `maxWidth`×`maxHeight` of an image file to RGBA, as
 * `decodeImage` would (exact colors), without a canvas the size of the
 * whole image: a photo added as a layer is cropped to the side anyway, and
 * canvases have size limits. Also resolves to the image's full size.
 */
export async function decodeImageCropped(
  file: Blob,
  maxWidth: number,
  maxHeight: number,
): Promise<{ image: RgbaImage; width: number; height: number }> {
  const bitmap = await exactBitmap(file);
  try {
    const { width, height } = bitmap;
    return { image: readBitmap(bitmap, Math.min(width, maxWidth), Math.min(height, maxHeight)), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Decodes an image file to RGBA exactly as stored where that's possible:
 * PNGs through the pure decoder (`decodePng`), since a canvas rounds
 * translucent pixels (see `decodeImage`), and anything else, including
 * PNGs it can't read (interlaced ones), through the browser. `checkSize`
 * refuses an image by its size before its pixels are decoded.
 */
export async function decodeImageExact(file: Blob, checkSize: (width: number, height: number) => void): Promise<RgbaImage> {
  if (file.type === 'image/png') {
    try {
      // `checkSize` bounds the size first; the pixel cap only keeps a corrupt header in check.
      return await decodePng(new Uint8Array(await file.arrayBuffer()), MAX_EXPORT_SIZE * MAX_EXPORT_SIZE, checkSize);
    } catch (error) {
      // A refused size is the same either way; other failures get a second try through the browser.
      if (error instanceof RangeError) throw error;
    }
  }
  return decodeImage(file, checkSize);
}

/** The file decoded without color-space conversion or premultiplication. */
async function exactBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('The file is not an image this browser can read');
  }
}

/** The top-left `width`×`height` of a bitmap as RGBA bytes. */
function readBitmap(bitmap: ImageBitmap, width: number, height: number): RgbaImage {
  const ctx = createContext(width, height, true);
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/**
 * Decodes an image file to RGBA for resampling (e.g. a photo to pixelate):
 * converted to sRGB as browsers show it, rather than exact, and first shrunk
 * smoothly to at most `maxPixels` pixels when it's larger. Also resolves to
 * its size as stored.
 */
export async function decodeImageWithin(
  file: Blob,
  maxPixels: number,
): Promise<{ image: RgbaImage; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('The file is not an image this browser can read');
  }
  const { width, height } = bitmap;
  try {
    if (width * height > maxPixels) {
      const scale = Math.sqrt(maxPixels / (width * height));
      const smaller = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.floor(width * scale)),
        resizeHeight: Math.max(1, Math.floor(height * scale)),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = smaller;
    }
    const ctx = createContext(bitmap.width, bitmap.height, true);
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { image: { width: bitmap.width, height: bitmap.height, data }, width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Encodes RGBA to an image file. Lossy formats use maximum quality (Chrome
 * encodes WebP losslessly at quality 1). Rejects when the browser silently
 * falls back to another format, as Safari does for WebP.
 */
export async function encodeImage(image: RgbaImage, format: ImageFormat): Promise<Blob> {
  checkExportSize(image.width, image.height);
  const { mime, label } = IMAGE_FORMATS[format];
  const ctx = createContext(image.width, image.height, false);
  const imageData = ctx.createImageData(image.width, image.height);
  imageData.data.set(image.data);
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, mime, 1));
  if (!blob) throw new Error(`Encoding ${label} failed`);
  if (blob.type !== mime) throw new Error(`This browser can't export ${label}`);
  return blob;
}

function createContext(width: number, height: number, willReadFrequently: boolean): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}
