import {
  combineEdits,
  pixelEditFromArray,
  pixelEditFromCells,
  pixelEditFromValues,
  type Edit,
  type FloatingEdit,
  type PixelEdit,
  type SelectionEdit,
} from './edits.ts';
import { packCell, type Cell } from './extrusion.ts';
import type { Layer } from './layer.ts';
import { clipMask, invertMask, maskHas, masksEqual, type Mask } from './mask.ts';
import { TRANSPARENT } from './palette.ts';
import { cellAt, documentRect, findLayer, inBounds, type FloatingPixels, type PixelDocument } from './pixelDocument.ts';
import { translateRect, type Rect } from './rect.ts';

/** Changes the selection. `after` is clipped to the document. Null when nothing changes. */
export function selectionEdit(doc: PixelDocument, after: Mask | null, label: string): SelectionEdit | null {
  return selectionChange(doc.selection, after && clipMask(after, doc.width, doc.height), label);
}

/**
 * Selects the unselected pixels of the document instead of the selected
 * ones. With nothing selected that's everything; with everything, nothing.
 */
export function invertSelectionEdit(doc: PixelDocument, label = 'Invert selection'): SelectionEdit | null {
  return selectionEdit(doc, invertMask(doc.selection, documentRect(doc)), label);
}

/** A selection edit between two known states (e.g. after a live preview). Null when they are equal. */
export function selectionChange(before: Mask | null, after: Mask | null, label: string): SelectionEdit | null {
  return masksEqual(before, after) ? null : { kind: 'selection', label, before, after };
}

/**
 * A whole layer's `values` (its pixels or extrusions) moved by (dx, dy),
 * zero (transparent) where nothing lands. Values that land outside the
 * document are dropped. Writes into `out` (not `values` itself), so moves can
 * reuse one buffer.
 */
export function shiftedValues<T extends Uint8Array | Uint16Array>(
  doc: PixelDocument,
  values: T,
  dx: number,
  dy: number,
  out: T,
): T {
  const { width, height } = doc;
  out.fill(TRANSPARENT);
  // The source columns and rows that stay on the document, copied a row at a time.
  const left = Math.max(0, -dx);
  const right = Math.min(width, width - dx);
  if (right <= left) return out;
  for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y++) {
    const row = y * width;
    out.set(values.subarray(row + left, row + right), (y + dy) * width + left + dx);
  }
  return out;
}

/** Moves all of `layer` by (dx, dy), losing pixels moved off the document. Null when nothing would change. */
export function shiftLayerEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): PixelEdit | null {
  if (dx === 0 && dy === 0) return null;
  const { pixels, extrusion } = layer;
  return pixelEditFromArray(
    layer,
    label,
    shiftedValues(doc, pixels, dx, dy, new Uint8Array(pixels.length)),
    shiftedValues(doc, extrusion, dx, dy, new Uint16Array(extrusion.length)),
  );
}

/*
 * Floating selections (see `FloatingPixels`). The float's pixels are always
 * stamped into its layer, so lifting and dropping change no pixels; only
 * moving and deleting do.
 */

/**
 * A copy of `layer`'s pixels in `area` (which must be inside the document),
 * row-major over `area.rect`, with pixels outside the mask transparent.
 */
export function selectedPixels(doc: PixelDocument, layer: Layer, area: Mask): Uint8Array {
  const pixels = copyArea(doc, layer.pixels, area.rect, new Uint8Array(area.rect.width * area.rect.height));
  const { bits } = area;
  if (bits) {
    for (let i = 0; i < bits.length; i++) if (!bits[i]) pixels[i] = TRANSPARENT;
  }
  return pixels;
}

/** A copy of `layer`'s extrusions in `area` (inside the document), laid out as `selectedPixels`. */
export function selectedExtrusion(doc: PixelDocument, layer: Layer, area: Mask): Uint16Array {
  return copyArea(doc, layer.extrusion, area.rect, new Uint16Array(area.rect.width * area.rect.height));
}

/** Copies the layer-sized `values` in `rect` (inside the document) into `out`, row-major over `rect`. */
function copyArea<T extends Uint8Array | Uint16Array>(doc: PixelDocument, values: T, rect: Rect, out: T): T {
  for (let j = 0; j < rect.height; j++) {
    const start = (rect.y + j) * doc.width + rect.x;
    out.set(values.subarray(start, start + rect.width), j * rect.width);
  }
  return out;
}

/** Lifts the selected pixels of `layer` into a float at the same place. Null without a selection. */
export function liftSelection(doc: PixelDocument, layer: Layer): FloatingPixels | null {
  const { selection } = doc;
  if (!selection) return null;
  const pixels = selectedPixels(doc, layer, selection);
  return {
    layerId: layer.id,
    rect: selection.rect,
    bits: selection.bits,
    pixels,
    extrusion: selectedExtrusion(doc, layer, selection),
    // Under each lifted pixel is the hole it leaves: a transparent cell, the array's default.
    under: new Uint32Array(pixels.length),
  };
}

/**
 * Moves a float by (dx, dy): new cells for every layer pixel it touches
 * (what it covered comes back, then its non-transparent pixels are stamped
 * at the new place), and the moved float. Pixels that land outside the
 * document stay in the float.
 */
export function moveFloating(
  doc: PixelDocument,
  layer: Layer,
  floating: FloatingPixels,
  dx: number,
  dy: number,
): { cells: Map<number, Cell>; moved: FloatingPixels } {
  const cells = unstampedCells(doc, floating);
  const rect = translateRect(floating.rect, dx, dy);
  const under = stampCells(doc, layer, floating, rect, cells);
  return { cells, moved: { ...floating, rect, under } };
}

/**
 * Puts new pixels down as a float on `layer`, replacing any current float.
 * `area` is its shape and place (which may extend past the document), and
 * `pixels` and their `extrusion` are row-major over `area.rect`, pixels
 * transparent outside the mask. Pasting does this.
 */
export function placeFloatingEdit(
  doc: PixelDocument,
  layer: Layer,
  pixels: Uint8Array,
  extrusion: Uint16Array,
  area: Mask,
  label: string,
): Edit | null {
  const cells = new Map<number, Cell>();
  const under = stampCells(doc, layer, { pixels, extrusion }, area.rect, cells);
  const floating: FloatingPixels = { layerId: layer.id, rect: area.rect, bits: area.bits, pixels, extrusion, under };
  return combineEdits(label, [
    pixelEditFromCells(layer, label, cells),
    floatingChange(doc.floating, floating, label),
    selectionChange(doc.selection, clipMask(area, doc.width, doc.height), label),
  ]);
}

/**
 * Adds to `cells` the stamping of `lifted` at `rect` (non-transparent pixels
 * inside the document), reading the layer through `cells`. Returns what each
 * stamped pixel covers.
 */
function stampCells(
  doc: PixelDocument,
  layer: Layer,
  lifted: Pick<FloatingPixels, 'pixels' | 'extrusion'>,
  rect: Rect,
  cells: Map<number, Cell>,
): Uint32Array {
  const { pixels, extrusion } = lifted;
  const under = new Uint32Array(pixels.length);
  forEachStamped(doc, pixels, rect, (i, offset) => {
    under[i] = cells.get(offset) ?? cellAt(layer, offset);
    cells.set(offset, packCell(pixels[i], extrusion[i]));
  });
  return under;
}

/**
 * Moves the selected pixels of `layer` by (dx, dy) as a float, lifting them
 * first unless they already float, so pixels moved past the edge are kept
 * until the float is dropped. Without a selection the whole layer moves
 * instead (`shiftLayerEdit`), and pixels moved off the document are lost.
 */
export function moveSelectionEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): Edit | null {
  const origin = doc.floating?.layerId === layer.id ? doc.floating : liftSelection(doc, layer);
  if (!origin) return shiftLayerEdit(doc, layer, dx, dy, label);
  if (dx === 0 && dy === 0) return null;
  const { cells, moved } = moveFloating(doc, layer, origin, dx, dy);
  return combineEdits(label, [
    pixelEditFromCells(layer, label, cells),
    floatingChange(doc.floating, moved, label),
    selectionChange(doc.selection, clipMask(moved, doc.width, doc.height), label),
  ]);
}

/** A floating edit between two states. Null when they're the same. */
export function floatingChange(before: FloatingPixels | null, after: FloatingPixels | null, label: string): FloatingEdit | null {
  return before === after ? null : { kind: 'floating', label, before, after };
}

/** Drops the float where it is: its pixels stay, and any off the document are gone. Null when nothing floats. */
export function dropFloatingEdit(doc: PixelDocument, label = 'Drop pixels'): FloatingEdit | null {
  return floatingChange(doc.floating, null, label);
}

/** Deletes the floating pixels, uncovering what was under them. The selection stays. Null when nothing floats. */
export function deleteFloatingEdit(doc: PixelDocument, label = 'Delete'): Edit | null {
  const { floating } = doc;
  if (!floating) return null;
  const layer = findLayer(doc, floating.layerId);
  const pixels = layer ? pixelEditFromCells(layer, label, unstampedCells(doc, floating)) : null;
  return combineEdits(label, [pixels, floatingChange(floating, null, label)]);
}

/** Layer cells that put back what the float covers. */
function unstampedCells(doc: PixelDocument, floating: FloatingPixels): Map<number, Cell> {
  const cells = new Map<number, Cell>();
  forEachStamped(doc, floating.pixels, floating.rect, (i, offset) => cells.set(offset, floating.under[i]));
  return cells;
}

/** Calls `fn` for each non-transparent pixel of `pixels` (laid out over `rect`) that is inside the document. */
function forEachStamped(
  doc: PixelDocument,
  pixels: Uint8Array,
  rect: Rect,
  fn: (index: number, offset: number) => void,
): void {
  for (let j = 0; j < rect.height; j++) {
    for (let i = 0; i < rect.width; i++) {
      const index = j * rect.width + i;
      const x = rect.x + i;
      const y = rect.y + j;
      if (pixels[index] !== TRANSPARENT && inBounds(doc, x, y)) fn(index, y * doc.width + x);
    }
  }
}

/** Clears the selected pixels of `layer` to transparent. Null when nothing is selected or nothing changes. */
export function clearSelectionEdit(doc: PixelDocument, layer: Layer): PixelEdit | null {
  return doc.selection && clearAreaEdit(doc, layer, doc.selection, 'Clear');
}

/** Clears `layer`'s pixels in `area` (inside the document) to transparent. Null when nothing changes. */
export function clearAreaEdit(doc: PixelDocument, layer: Layer, area: Mask, label: string): PixelEdit | null {
  const values = new Map<number, number>();
  const { rect } = area;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (maskHas(area, x, y)) values.set(y * doc.width + x, TRANSPARENT);
    }
  }
  return pixelEditFromValues(layer, label, values);
}
