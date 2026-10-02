import type { Layer } from './layer.ts';
import { clonePalette, type Palette } from './palette.ts';
import { findLayer, inBounds, layerIndex, setPixel, type PixelDocument } from './pixelDocument.ts';
import { rectContains, type Rect } from './rect.ts';

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

/** Everything that makes up a document, for edits that replace it wholesale. */
export interface DocumentState {
  name: string;
  width: number;
  height: number;
  palette: Palette;
  /** Layer objects are held by reference, as in layer add/remove edits. */
  layers: Layer[];
  selection: Rect | null;
}

/**
 * Replaces the whole document (e.g. opening an image), so even that can be
 * undone instead of discarding work.
 */
export interface DocumentEdit {
  kind: 'document';
  label: string;
  before: DocumentState;
  after: DocumentState;
}

/** A snapshot of the document's current state. */
export function documentState(doc: PixelDocument): DocumentState {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    palette: clonePalette(doc.palette),
    layers: [...doc.layers],
    selection: doc.selection,
  };
}

/** Replaces the document palette. Palettes are small, so whole snapshots are stored. */
export interface PaletteEdit {
  kind: 'palette';
  label: string;
  before: Palette;
  after: Palette;
  /**
   * Set when colors change index (e.g. a deletion shifts later colors down):
   * `redo[i]` is where index i goes when the edit is applied, `undo[i]` where
   * it goes back. Pixels are renumbered by pixel edits batched with this one;
   * this is for state outside the document that refers to colors by index
   * (see `followIndex`).
   */
  renumber?: { redo: Uint8Array; undo: Uint8Array };
}

export interface SelectionEdit {
  kind: 'selection';
  label: string;
  before: Rect | null;
  after: Rect | null;
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
export type Edit =
  | PixelEdit
  | LayerAddEdit
  | LayerRemoveEdit
  | LayerMoveEdit
  | LayerPropsEdit
  | PaletteEdit
  | SelectionEdit
  | DocumentEdit
  | BatchEdit;

/**
 * Where palette index `index` ends up after applying (`redo`) or reverting
 * (`undo`) an edit, so editor state like the paint colors keeps pointing at
 * the same color when colors are renumbered.
 */
export function followIndex(edit: Edit, index: number, direction: EditDirection): number {
  switch (edit.kind) {
    case 'palette':
      return edit.renumber ? edit.renumber[direction][index] : index;
    case 'batch': {
      const ordered = direction === 'redo' ? edit.edits : [...edit.edits].reverse();
      return ordered.reduce((current, part) => followIndex(part, current, direction), index);
    }
    default:
      return index;
  }
}

/** Groups edits into one history entry: null if none, the edit itself if one, else a batch. */
export function combineEdits(label: string, edits: ReadonlyArray<Edit | null>): Edit | null {
  const present = edits.filter((edit): edit is Edit => edit !== null);
  if (present.length <= 1) return present[0] ?? null;
  return { kind: 'batch', label, edits: present };
}

/**
 * A pixel edit that sets each offset in `values` to its value, keeping only
 * the pixels that actually change. Built unapplied. Null when nothing changes.
 */
export function pixelEditFromValues(layer: Layer, label: string, values: ReadonlyMap<number, number>): PixelEdit | null {
  const changed = [...values].filter(([offset, value]) => layer.pixels[offset] !== value).sort(([a], [b]) => a - b);
  if (changed.length === 0) return null;
  return {
    kind: 'pixels',
    label,
    layerId: layer.id,
    offsets: Uint32Array.from(changed, ([offset]) => offset),
    before: Uint8Array.from(changed, ([offset]) => layer.pixels[offset]),
    after: Uint8Array.from(changed, ([, value]) => value),
  };
}

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
    case 'palette':
      // Copy, so live previews that mutate doc.palette can't reach into history.
      doc.palette = clonePalette(direction === 'redo' ? edit.after : edit.before);
      return;
    case 'selection':
      doc.selection = direction === 'redo' ? edit.after : edit.before;
      return;
    case 'document': {
      const state = direction === 'redo' ? edit.after : edit.before;
      if (state.layers.some((layer) => layer.pixels.length !== state.width * state.height)) {
        throw conflict(edit, direction, 'layer size does not match the document');
      }
      doc.name = state.name;
      doc.width = state.width;
      doc.height = state.height;
      doc.palette = clonePalette(state.palette);
      doc.layers = [...state.layers];
      doc.selection = state.selection;
      return;
    }
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

/** Starts a session. With `clip`, writes outside that rectangle are ignored (e.g. painting inside a selection). */
export function beginPixelEdit(doc: PixelDocument, layer: Layer, label: string, clip: Rect | null = null): PixelEditSession {
  const original = new Map<number, number>();
  let finished = false;

  return {
    layer,

    setPixel(x, y, index) {
      if (finished) throw new Error('Pixel edit session already finished');
      if (!inBounds(doc, x, y) || (clip && !rectContains(clip, x, y))) return false;
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
