import type { RgbaImage } from '../core/image.ts';

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
 */
export async function decodeImage(file: Blob): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('The file is not an image this browser can read');
  }
  try {
    const ctx = createContext(bitmap.width, bitmap.height, true);
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data };
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
