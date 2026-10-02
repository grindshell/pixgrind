import { TRANSPARENT, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/**
 * Flattens the visible layers, bottom to top, into straight-alpha RGBA bytes
 * (the `ImageData` layout). Writes into `out` when given.
 */
export function compositeRgba(
  doc: PixelDocument,
  out: Uint8ClampedArray = new Uint8ClampedArray(doc.width * doc.height * 4),
): Uint8ClampedArray {
  if (out.length !== doc.width * doc.height * 4) {
    throw new RangeError('Output buffer size does not match the document');
  }
  out.fill(0);
  const lookup = paletteLookup(doc.palette);

  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
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

/** Index → packed color for all 256 indices. Missing entries are transparent. */
function paletteLookup(palette: Palette): Uint32Array {
  const lookup = new Uint32Array(256);
  palette.colors.forEach((color, i) => {
    lookup[i + 1] = color;
  });
  return lookup;
}
