import {
  combineEdits,
  pixelEditFromValues,
  type Edit,
  type FloatingEdit,
  type PixelEdit,
  type SelectionEdit,
} from './edits.ts';
import type { Layer } from './layer.ts';
import { clipMask, maskHas, masksEqual, type Mask } from './mask.ts';
import { TRANSPARENT } from './palette.ts';
import { findLayer, inBounds, type FloatingPixels, type PixelDocument } from './pixelDocument.ts';
import { translateRect, type Rect } from './rect.ts';

/** Changes the selection. `after` is clipped to the document. Null when nothing changes. */
export function selectionEdit(doc: PixelDocument, after: Mask | null, label: string): SelectionEdit | null {
  return selectionChange(doc.selection, after && clipMask(after, doc.width, doc.height), label);
}

/** A selection edit between two known states (e.g. after a live preview). Null when they are equal. */
export function selectionChange(before: Mask | null, after: Mask | null, label: string): SelectionEdit | null {
  return masksEqual(before, after) ? null : { kind: 'selection', label, before, after };
}

/**
 * New palette indices for every pixel touched by moving the whole of `layer`
 * by (dx, dy): everything is cleared, then its non-transparent pixels are
 * stamped at the destination. Pixels that land outside the document are
 * dropped.
 */
export function movedPixels(doc: PixelDocument, layer: Layer, dx: number, dy: number): Map<number, number> {
  const values = new Map<number, number>();
  if (dx === 0 && dy === 0) return values;
  for (let offset = 0; offset < layer.pixels.length; offset++) values.set(offset, TRANSPARENT);
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      const index = layer.pixels[y * doc.width + x];
      if (index !== TRANSPARENT && inBounds(doc, x + dx, y + dy)) values.set((y + dy) * doc.width + x + dx, index);
    }
  }
  return values;
}

/** Moves all of `layer` by (dx, dy), losing pixels moved off the document. Null when nothing would change. */
export function moveLayerEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): PixelEdit | null {
  return pixelEditFromValues(layer, label, movedPixels(doc, layer, dx, dy));
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
  const { rect, bits } = area;
  const pixels = new Uint8Array(rect.width * rect.height);
  for (let j = 0; j < rect.height; j++) {
    const start = (rect.y + j) * doc.width + rect.x;
    pixels.set(layer.pixels.subarray(start, start + rect.width), j * rect.width);
  }
  if (bits) {
    for (let i = 0; i < bits.length; i++) if (!bits[i]) pixels[i] = TRANSPARENT;
  }
  return pixels;
}

/** Lifts the selected pixels of `layer` into a float at the same place. Null without a selection. */
export function liftSelection(doc: PixelDocument, layer: Layer): FloatingPixels | null {
  const { selection } = doc;
  if (!selection) return null;
  const pixels = selectedPixels(doc, layer, selection);
  // Under each lifted pixel is the hole it leaves: transparent, Uint8Array's default.
  return { layerId: layer.id, rect: selection.rect, bits: selection.bits, pixels, under: new Uint8Array(pixels.length) };
}

/**
 * Moves a float by (dx, dy): new values for every layer pixel it touches
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
): { values: Map<number, number>; moved: FloatingPixels } {
  const values = unstampedValues(doc, floating);
  const rect = translateRect(floating.rect, dx, dy);
  const under = stampValues(doc, layer, floating.pixels, rect, values);
  return { values, moved: { ...floating, rect, under } };
}

/**
 * Puts new pixels down as a float on `layer`, replacing any current float.
 * `area` is its shape and place (which may extend past the document), and
 * `pixels` are row-major over `area.rect`, transparent outside the mask.
 * Pasting does this.
 */
export function placeFloatingEdit(
  doc: PixelDocument,
  layer: Layer,
  pixels: Uint8Array,
  area: Mask,
  label: string,
): Edit | null {
  const values = new Map<number, number>();
  const under = stampValues(doc, layer, pixels, area.rect, values);
  const floating: FloatingPixels = { layerId: layer.id, rect: area.rect, bits: area.bits, pixels, under };
  return combineEdits(label, [
    pixelEditFromValues(layer, label, values),
    floatingChange(doc.floating, floating, label),
    selectionChange(doc.selection, clipMask(area, doc.width, doc.height), label),
  ]);
}

/**
 * Adds to `values` the stamping of `pixels` at `rect` (non-transparent
 * pixels inside the document), reading the layer through `values`. Returns
 * what each stamped pixel covers.
 */
function stampValues(
  doc: PixelDocument,
  layer: Layer,
  pixels: Uint8Array,
  rect: Rect,
  values: Map<number, number>,
): Uint8Array {
  const under = new Uint8Array(pixels.length);
  forEachStamped(doc, pixels, rect, (i, offset) => {
    under[i] = values.get(offset) ?? layer.pixels[offset];
    values.set(offset, pixels[i]);
  });
  return under;
}

/**
 * Moves the selected pixels of `layer` by (dx, dy) as a float, lifting them
 * first unless they already float, so pixels moved past the edge are kept
 * until the float is dropped. Without a selection the whole layer moves
 * instead (`moveLayerEdit`), and pixels moved off the document are lost.
 */
export function moveSelectionEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): Edit | null {
  const origin = doc.floating?.layerId === layer.id ? doc.floating : liftSelection(doc, layer);
  if (!origin) return moveLayerEdit(doc, layer, dx, dy, label);
  if (dx === 0 && dy === 0) return null;
  const { values, moved } = moveFloating(doc, layer, origin, dx, dy);
  return combineEdits(label, [
    pixelEditFromValues(layer, label, values),
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
  const pixels = layer ? pixelEditFromValues(layer, label, unstampedValues(doc, floating)) : null;
  return combineEdits(label, [pixels, floatingChange(floating, null, label)]);
}

/** Layer values that put back what the float covers. */
function unstampedValues(doc: PixelDocument, floating: FloatingPixels): Map<number, number> {
  const values = new Map<number, number>();
  forEachStamped(doc, floating.pixels, floating.rect, (i, offset) => values.set(offset, floating.under[i]));
  return values;
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
