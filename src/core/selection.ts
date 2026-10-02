import { combineEdits, pixelEditFromValues, type Edit, type PixelEdit, type SelectionEdit } from './edits.ts';
import type { Layer } from './layer.ts';
import { TRANSPARENT } from './palette.ts';
import { documentRect, inBounds, type PixelDocument } from './pixelDocument.ts';
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
