import { pixelEditFromArray, type PixelEdit } from './edits.ts';
import type { Extrusion } from './extrusion.ts';
import type { Layer } from './layer.ts';
import { maskHas, type Mask } from './mask.ts';
import { TRANSPARENT } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/**
 * Changes the extrusion of every painted pixel of `layer` in `area` (inside
 * the document; null for the whole layer) to `update(its extrusion, x, y)`.
 * Null when nothing changes.
 */
export function updateExtrusionsEdit(
  doc: PixelDocument,
  layer: Layer,
  area: Mask | null,
  update: (extrusion: Extrusion, x: number, y: number) => Extrusion,
  label = 'Set extrusion',
): PixelEdit | null {
  const after = layer.extrusion.slice();
  const { x, y, width, height } = area?.rect ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      const offset = row * doc.width + column;
      if (layer.pixels[offset] !== TRANSPARENT && (!area || maskHas(area, column, row))) {
        after[offset] = update(layer.extrusion[offset], column, row);
      }
    }
  }
  return pixelEditFromArray(layer, label, layer.pixels, after);
}
