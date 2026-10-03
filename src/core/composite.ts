import { planeSize, type Facing } from './facing.ts';
import { inLayer, type Layer } from './layer.ts';
import { TRANSPARENT, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/**
 * Flattens the visible layers of one facing, bottom to top, into
 * straight-alpha RGBA bytes (the `ImageData` layout) the size of its plane.
 * Writes into `out` when given.
 */
export function compositeRgba(doc: PixelDocument, facing: Facing, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { width, height } = planeSize(doc, facing);
  out ??= new Uint8ClampedArray(width * height * 4);
  if (out.length !== width * height * 4) {
    throw new RangeError('Output buffer size does not match the plane');
  }
  out.fill(0);
  const lookup = paletteLookup(doc.palette);

  for (const layer of doc.layers) {
    if (layer.facing !== facing || !layer.visible || layer.opacity <= 0) continue;
    const { pixels, opacity } = layer;

    for (let i = 0; i < pixels.length; i++) {
      const index = pixels[i];
      if (index === TRANSPARENT) continue;
      const color = lookup[index];
      const srcA = ((color & 0xff) / 255) * opacity;
      if (srcA <= 0) continue;

      const o = i * 4;
      const r = color >>> 24;
      const g = (color >>> 16) & 0xff;
      const b = (color >>> 8) & 0xff;

      if (srcA >= 1) {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
        continue;
      }

      // Porter-Duff "source over" with straight (non-premultiplied) alpha.
      const dstWeight = (out[o + 3] / 255) * (1 - srcA);
      const outA = srcA + dstWeight;
      out[o] = (r * srcA + out[o] * dstWeight) / outA;
      out[o + 1] = (g * srcA + out[o + 1] * dstWeight) / outA;
      out[o + 2] = (b * srcA + out[o + 2] * dstWeight) / outA;
      out[o + 3] = outA * 255;
    }
  }
  return out;
}

/**
 * The palette index the user sees at (x, y) of a facing's plane: the topmost
 * visible layer of that facing with a non-transparent pixel there that maps
 * to a palette color. Transparent (0) when there is none or (x, y) is off
 * the plane.
 */
export function visibleIndexAt(doc: PixelDocument, facing: Facing, x: number, y: number): number {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (layer.facing !== facing || !layer.visible || layer.opacity <= 0 || !inLayer(layer, x, y)) continue;
    const index = layer.pixels[y * layer.width + x];
    if (index !== TRANSPARENT && index <= doc.palette.colors.length) return index;
  }
  return TRANSPARENT;
}

/**
 * One layer alone at full opacity, scaled to `width`×`height` by taking the
 * nearest pixel, as RGBA bytes. For thumbnails: a small one of a large layer
 * costs its own size, not the layer's.
 */
export function layerThumbnailRgba(
  palette: Palette,
  layer: Layer,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const lookup = paletteLookup(palette);
  const columns = Array.from({ length: width }, (_, x) => Math.floor(((x + 0.5) * layer.width) / width));
  for (let y = 0; y < height; y++) {
    const row = Math.floor(((y + 0.5) * layer.height) / height) * layer.width;
    for (let x = 0; x < width; x++) {
      const color = lookup[layer.pixels[row + columns[x]]];
      const o = (y * width + x) * 4;
      out[o] = color >>> 24;
      out[o + 1] = (color >>> 16) & 0xff;
      out[o + 2] = (color >>> 8) & 0xff;
      out[o + 3] = color & 0xff;
    }
  }
  return out;
}

/** Index → packed color for all 256 indices. Missing entries are transparent. */
function paletteLookup(palette: Palette): Uint32Array {
  const lookup = new Uint32Array(256);
  palette.colors.forEach((color, i) => {
    lookup[i + 1] = color;
  });
  return lookup;
}
