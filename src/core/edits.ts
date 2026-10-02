import type { Layer } from './layer.ts';
import { findLayer, inBounds, layerIndex, setPixel, type PixelDocument } from './pixelDocument.ts';

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

/*
 * Layer add/remove edits hold the layer object itself rather than a copy.
 * History is linear, so whenever one of these is undone or redone, every later
 * edit has already been undone and the layer is back in the state it had when
 * the edit was made.
 */

export interface LayerAddEdit {
  kind: 'layer-add';
  label: string;
  layer: Layer;
  /** Position the layer is inserted at (0 = bottom). */
  index: number;
}

export interface LayerRemoveEdit {
  kind: 'layer-remove';
  label: string;
  layer: Layer;
  /** Position the layer was removed from, and is restored to on undo. */
  index: number;
}

export interface LayerMoveEdit {
  kind: 'layer-move';
  label: string;
  layerId: string;
  from: number;
  to: number;
}

/** Undoable layer properties. Visibility is deliberately not undoable. */
export type LayerProps = Partial<Pick<Layer, 'name' | 'opacity'>>;

export interface LayerPropsEdit {
  kind: 'layer-props';
  label: string;
  layerId: string;
  before: LayerProps;
  after: LayerProps;
}

/** Several edits applied as one history entry, in order on redo and in reverse on undo. */
export interface BatchEdit {
  kind: 'batch';
  label: string;
  edits: Edit[];
}

/**
 * A reversible change to a document. Each kind is plain data with a case in
 * `applyEdit`; add new kinds of change here rather than as callbacks.
 */
export type Edit = PixelEdit | LayerAddEdit | LayerRemoveEdit | LayerMoveEdit | LayerPropsEdit | BatchEdit;

export type EditDirection = 'undo' | 'redo';

/**
 * Reverts (`undo`) or applies (`redo`) an edit. Edits are built unapplied, so
 * performing one for the first time is a `redo`. Throws without changing the
 * document if the edit no longer fits it.
 */
export function applyEdit(doc: PixelDocument, edit: Edit, direction: EditDirection): void {
  switch (edit.kind) {
    case 'pixels': {
      const layer = requireLayer(doc, edit.layerId, edit, direction);
      const values = direction === 'undo' ? edit.before : edit.after;
      edit.offsets.forEach((offset, i) => {
        layer.pixels[offset] = values[i];
      });
      return;
    }
    case 'layer-add':
      if (direction === 'redo') insertLayer(doc, edit.layer, edit.index, edit, direction);
      else removeLayer(doc, edit.layer.id, edit, direction);
      return;
    case 'layer-remove':
      if (direction === 'redo') removeLayer(doc, edit.layer.id, edit, direction);
      else insertLayer(doc, edit.layer, edit.index, edit, direction);
      return;
    case 'layer-move': {
      const [from, to] = direction === 'redo' ? [edit.from, edit.to] : [edit.to, edit.from];
      if (layerIndex(doc, edit.layerId) !== from || to >= doc.layers.length) {
        throw conflict(edit, direction, `layer ${edit.layerId} is not at position ${from}`);
      }
      const [layer] = doc.layers.splice(from, 1);
      doc.layers.splice(to, 0, layer);
      return;
    }
    case 'layer-props':
      Object.assign(requireLayer(doc, edit.layerId, edit, direction), direction === 'redo' ? edit.after : edit.before);
      return;
    case 'batch':
      applyBatch(doc, edit, direction);
      return;
    default:
      return assertNever(edit);
  }
}

function applyBatch(doc: PixelDocument, batch: BatchEdit, direction: EditDirection): void {
  const ordered = direction === 'redo' ? batch.edits : [...batch.edits].reverse();
  const applied: Edit[] = [];
  try {
    for (const edit of ordered) {
      applyEdit(doc, edit, direction);
      applied.push(edit);
    }
  } catch (error) {
    // Roll back what was applied so the batch is all-or-nothing.
    const opposite: EditDirection = direction === 'redo' ? 'undo' : 'redo';
    for (const edit of applied.reverse()) applyEdit(doc, edit, opposite);
    throw error;
  }
}

function insertLayer(doc: PixelDocument, layer: Layer, index: number, edit: Edit, direction: EditDirection): void {
  if (index < 0 || index > doc.layers.length) throw conflict(edit, direction, `position ${index} is out of range`);
  if (findLayer(doc, layer.id)) throw conflict(edit, direction, `layer ${layer.id} already exists`);
  if (layer.pixels.length !== doc.width * doc.height) throw conflict(edit, direction, 'layer size does not match');
  doc.layers.splice(index, 0, layer);
}

function removeLayer(doc: PixelDocument, layerId: string, edit: Edit, direction: EditDirection): void {
  const index = layerIndex(doc, layerId);
  if (index < 0) throw conflict(edit, direction, `layer ${layerId} not found`);
  doc.layers.splice(index, 1);
}

function requireLayer(doc: PixelDocument, layerId: string, edit: Edit, direction: EditDirection): Layer {
  const layer = findLayer(doc, layerId);
  if (!layer) throw conflict(edit, direction, `layer ${layerId} not found`);
  return layer;
}

function conflict(edit: Edit, direction: EditDirection, reason: string): Error {
  return new Error(`Cannot ${direction} "${edit.label}": ${reason}`);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled edit: ${JSON.stringify(value)}`);
}

/** Records pixel writes to one layer so they can be committed as a single {@link PixelEdit}. */
export interface PixelEditSession {
  readonly layer: Layer;
  /** Same contract as {@link setPixel}, but remembers each pixel's original value. */
  setPixel(x: number, y: number, index: number): boolean;
  /** Restores every pixel written so far to its original value. Used to redraw shape previews. */
  revert(): void;
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

    revert() {
      if (finished) throw new Error('Pixel edit session already finished');
      for (const [offset, value] of original) layer.pixels[offset] = value;
      original.clear();
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
