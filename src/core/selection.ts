import {
  combineEdits,
  pixelEditFromValues,
  type Edit,
  type FloatingEdit,
  type PixelEdit,
  type SelectionEdit,
} from './edits.ts';
import type { Layer } from './layer.ts';
import { TRANSPARENT } from './palette.ts';
import { documentRect, findLayer, inBounds, type FloatingPixels, type PixelDocument } from './pixelDocument.ts';
import { clipRect, rectsEqual, translateRect, type Rect } from './rect.ts';

/** Changes the selection. `after` is clipped to the document. Null when nothing changes. */
export function selectionEdit(doc: PixelDocument, after: Rect | null, label: string): SelectionEdit | null {
  return selectionChange(doc.selection, after && clipRect(after, doc.width, doc.height), label);
}

/** A selection edit between two known states (e.g. after a live preview). Null when they are equal. */
export function selectionChange(before: Rect | null, after: Rect | null, label: string): SelectionEdit | null {
  return rectsEqual(before, after) ? null : { kind: 'selection', label, before, after };
}

/**
 * New palette indices for every pixel touched by moving the contents of
 * `area` by (dx, dy): the area is cleared, then its non-transparent pixels
 * are stamped at the destination. Transparent pixels don't cover what's
 * beneath them. Pixels that land outside the document are dropped.
 */
export function movedPixels(doc: PixelDocument, layer: Layer, area: Rect, dx: number, dy: number): Map<number, number> {
  const values = new Map<number, number>();
  const source = clipRect(area, doc.width, doc.height);
  if (!source || (dx === 0 && dy === 0)) return values;

  for (let y = source.y; y < source.y + source.height; y++) {
    for (let x = source.x; x < source.x + source.width; x++) values.set(y * doc.width + x, TRANSPARENT);
  }
  for (let y = source.y; y < source.y + source.height; y++) {
    for (let x = source.x; x < source.x + source.width; x++) {
      const index = layer.pixels[y * doc.width + x];
      if (index !== TRANSPARENT && inBounds(doc, x + dx, y + dy)) values.set((y + dy) * doc.width + x + dx, index);
    }
  }
  return values;
}

/**
 * Moves the selected pixels of `layer` (the whole layer when nothing is
 * selected) by (dx, dy), and the selection with them. One undoable edit, or
 * null when nothing would change.
 */
export function moveEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): Edit | null {
  const { selection } = doc;
  const pixels = pixelEditFromValues(layer, label, movedPixels(doc, layer, selection ?? documentRect(doc), dx, dy));
  const moved = selection && clipRect(translateRect(selection, dx, dy), doc.width, doc.height);
  return combineEdits(label, [pixels, selection ? selectionChange(selection, moved, label) : null]);
}

/*
 * Floating selections (see `FloatingPixels`). The float's pixels are always
 * stamped into its layer, so lifting and dropping change no pixels; only
 * moving and deleting do.
 */

/** Lifts the selected pixels of `layer` into a float at the same place. Null without a selection. */
export function liftSelection(doc: PixelDocument, layer: Layer): FloatingPixels | null {
  const rect = doc.selection;
  if (!rect) return null;
  const pixels = new Uint8Array(rect.width * rect.height);
  for (let j = 0; j < rect.height; j++) {
    const start = (rect.y + j) * doc.width + rect.x;
    pixels.set(layer.pixels.subarray(start, start + rect.width), j * rect.width);
  }
  // Under each lifted pixel is the hole it leaves: transparent, Uint8Array's default.
  return { layerId: layer.id, rect, pixels, under: new Uint8Array(pixels.length) };
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
  const under = new Uint8Array(floating.pixels.length);
  forEachStamped(doc, floating.pixels, rect, (i, offset) => {
    under[i] = values.get(offset) ?? layer.pixels[offset];
    values.set(offset, floating.pixels[i]);
  });
  return { values, moved: { ...floating, rect, under } };
}

/**
 * Moves the selected pixels of `layer` by (dx, dy) as a float, lifting them
 * first unless they already float, so pixels moved past the edge are kept
 * until the float is dropped. Without a selection the whole layer moves
 * instead (`moveEdit`), and pixels moved off the document are lost.
 */
export function moveSelectionEdit(doc: PixelDocument, layer: Layer, dx: number, dy: number, label = 'Move'): Edit | null {
  const origin = doc.floating?.layerId === layer.id ? doc.floating : liftSelection(doc, layer);
  if (!origin) return moveEdit(doc, layer, dx, dy, label);
  if (dx === 0 && dy === 0) return null;
  const { values, moved } = moveFloating(doc, layer, origin, dx, dy);
  return combineEdits(label, [
    pixelEditFromValues(layer, label, values),
    floatingChange(doc.floating, moved, label),
    selectionChange(doc.selection, clipRect(moved.rect, doc.width, doc.height), label),
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
  const area = doc.selection;
  if (!area) return null;
  const values = new Map<number, number>();
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) values.set(y * doc.width + x, TRANSPARENT);
  }
  return pixelEditFromValues(layer, 'Clear', values);
}
