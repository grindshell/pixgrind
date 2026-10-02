import type { Layer } from './layer.ts';
import { inBounds, setPixel, type PixelDocument } from './pixelDocument.ts';

/** A pixel-level change to one layer, stored as a diff. */
export interface PixelEdit {
  kind: 'pixels';
  /** Shown in the UI, e.g. "Undo Pencil". */
  label: string;
  layerId: string;
  /** Offsets (`y * width + x`) of the changed pixels, ascending. */
  offsets: Uint32Array;
  /** Palette indices before and after the edit, parallel to `offsets`. */
  before: Uint8Array;
  after: Uint8Array;
}

/**
 * A reversible change to a document. New kinds of change (layer add/remove,
 * reorder, palette edits, …) join this union and get a case in `applyEdit`.
 */
export type Edit = PixelEdit;

export type EditDirection = 'undo' | 'redo';

/** Reverts (`undo`) or reapplies (`redo`) an edit. Throws without changing anything if the edit no longer fits the document. */
export function applyEdit(doc: PixelDocument, edit: Edit, direction: EditDirection): void {
  switch (edit.kind) {
    case 'pixels': {
      const layer = doc.layers.find((l) => l.id === edit.layerId);
      if (!layer) throw new Error(`Cannot ${direction} "${edit.label}": layer ${edit.layerId} not found`);
      const values = direction === 'undo' ? edit.before : edit.after;
      edit.offsets.forEach((offset, i) => {
        layer.pixels[offset] = values[i];
      });
      return;
    }
  }
}

/** Records pixel writes to one layer so they can be committed as a single {@link PixelEdit}. */
export interface PixelEditSession {
  readonly layer: Layer;
  /** Same contract as {@link setPixel}, but remembers each pixel's original value. */
  setPixel(x: number, y: number, index: number): boolean;
  /** Ends the session. Returns null when no pixel ended up different from its original value. */
  finish(): PixelEdit | null;
}

export function beginPixelEdit(doc: PixelDocument, layer: Layer, label: string): PixelEditSession {
  const original = new Map<number, number>();
  let finished = false;

  return {
    layer,

    setPixel(x, y, index) {
      if (finished) throw new Error('Pixel edit session already finished');
      if (!inBounds(doc, x, y)) return false;
      const offset = y * doc.width + x;
      const previous = layer.pixels[offset];
      if (!setPixel(doc, layer, x, y, index)) return false;
      if (!original.has(offset)) original.set(offset, previous);
      return true;
    },

    finish() {
      finished = true;
      // Pixels painted and then painted back to their original value aren't changes.
      const changed = [...original]
        .filter(([offset, value]) => layer.pixels[offset] !== value)
        .sort(([a], [b]) => a - b);
      if (changed.length === 0) return null;
      return {
        kind: 'pixels',
        label,
        layerId: layer.id,
        offsets: Uint32Array.from(changed, ([offset]) => offset),
        before: Uint8Array.from(changed, ([, value]) => value),
        after: Uint8Array.from(changed, ([offset]) => layer.pixels[offset]),
      };
    },
  };
}
