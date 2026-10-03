import { pixelEditFromArray, type PixelEdit } from './edits.ts';
import type { Extrusion } from './extrusion.ts';
import type { Layer } from './layer.ts';
import { maskHas, type Mask } from './mask.ts';
import { TRANSPARENT } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/**
 * Gives every painted pixel of `layer` in `area` (inside the document; null
 * for the whole layer) the same extrusion. Null when nothing changes.
 */
export function setExtrusionEdit(
  doc: PixelDocument,
  layer: Layer,
  area: Mask | null,
  extrusion: Extrusion,
  label = 'Set extrusion',
): PixelEdit | null {
  const after = layer.extrusion.slice();
  const { x, y, width, height } = area?.rect ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      const offset = row * doc.width + column;
      if (layer.pixels[offset] !== TRANSPARENT && (!area || maskHas(area, column, row))) after[offset] = extrusion;
    }
  }
  return pixelEditFromArray(layer, label, layer.pixels, after);
}
