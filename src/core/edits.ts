import { cellExtrusion, cellIndex, packCell, type Cell, type Extrusion } from './extrusion.ts';
import { planeSize, type Facing, type Volume } from './facing.ts';
import { inLayer, type Layer } from './layer.ts';
import { clonePalette, TRANSPARENT, type Palette } from './palette.ts';
import { findLayer, layerIndex, setCellAt, setPixel, type FloatingPixels, type PixelDocument } from './pixelDocument.ts';
import { maskHas, type Mask } from './mask.ts';

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
  /** Extrusions before and after, parallel to `offsets`. Absent when the edit changes none. */
  extrusion?: { before: Uint32Array; after: Uint32Array };
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
export interface DocumentState extends Volume {
  name: string;
  palette: Palette;
  /** Layer objects are held by reference, as in layer add/remove edits. */
  layers: Layer[];
  selections: Record<Facing, Mask | null>;
  floating: FloatingPixels | null;
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
    depth: doc.depth,
    palette: clonePalette(doc.palette),
    layers: [...doc.layers],
    selections: { ...doc.selections },
    floating: doc.floating,
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

/** Changes one facing's selection. */
export interface SelectionEdit {
  kind: 'selection';
  label: string;
  facing: Facing;
  before: Mask | null;
  after: Mask | null;
}

/**
 * Sets or clears the floating selection. Changes no pixels: moves batch it
 * with the pixel edit that restamps the float.
 */
export interface FloatingEdit {
  kind: 'floating';
  label: string;
  before: FloatingPixels | null;
  after: FloatingPixels | null;
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
  | FloatingEdit
  | DocumentEdit
  | BatchEdit;

/**
 * Whether an edit sets the floating selection itself. Any other edit drops
 * the float first (`Editor.perform`), which is safe because dropping changes
 * no pixels.
 */
export function editSetsFloating(edit: Edit): boolean {
  switch (edit.kind) {
    case 'floating':
    case 'document':
      return true;
    case 'batch':
      return edit.edits.some(editSetsFloating);
    default:
      return false;
  }
}

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

/**
 * Where an edit changed the document, to show it after undo or redo: the
 * layer it changed and that layer's side, or the side whose selection or
 * float it changed. Null for edits of the whole document or the palette.
 */
export function editedSide(doc: PixelDocument, edit: Edit): { facing: Facing; layerId?: string } | null {
  const ofLayer = (layerId: string) => {
    const layer = findLayer(doc, layerId);
    return layer ? { facing: layer.facing, layerId } : null;
  };
  switch (edit.kind) {
    case 'pixels':
    case 'layer-move':
    case 'layer-props':
      return ofLayer(edit.layerId);
    case 'layer-add':
    case 'layer-remove':
      // Gone after an add is undone or a removal redone: its side is still where the change shows.
      return ofLayer(edit.layer.id) ?? { facing: edit.layer.facing };
    case 'selection':
      return { facing: edit.facing };
    case 'floating': {
      const floating = edit.after ?? edit.before;
      const where = floating && ofLayer(floating.layerId);
      return where && { facing: where.facing };
    }
    case 'batch': {
      // A float dropped along the way says less than the change itself.
      const sides = edit.edits.map((part) => [part, editedSide(doc, part)] as const).filter(([, side]) => side);
      return (sides.find(([part]) => part.kind !== 'floating') ?? sides[0])?.[1] ?? null;
    }
    default:
      return null;
  }
}

/** Groups edits into one history entry: null if none, the edit itself if one, else a batch. */
export function combineEdits(label: string, edits: ReadonlyArray<Edit | null>): Edit | null {
  const present = edits.filter((edit): edit is Edit => edit !== null);
  if (present.length <= 1) return present[0] ?? null;
  return { kind: 'batch', label, edits: present };
}

/**
 * A pixel edit that sets each offset in `values` to its palette index,
 * keeping only the pixels that actually change. Extrusions stay as they are.
 * Built unapplied. Null when nothing changes.
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

/**
 * A pixel edit that sets each offset in `cells` to its cell (index and
 * extrusion, see `Cell`), keeping only the pixels that actually change.
 * Built unapplied. Null when nothing changes.
 */
export function pixelEditFromCells(layer: Layer, label: string, cells: ReadonlyMap<number, Cell>): PixelEdit | null {
  const changed = [...cells]
    .map(([offset, cell]): [number, number, Extrusion] => {
      const index = cellIndex(cell);
      return [offset, index, index === TRANSPARENT ? layer.extrusion[offset] : cellExtrusion(cell)];
    })
    .filter(([offset, index, extrusion]) => layer.pixels[offset] !== index || layer.extrusion[offset] !== extrusion)
    .sort(([a], [b]) => a - b);
  if (changed.length === 0) return null;
  const edit: PixelEdit = {
    kind: 'pixels',
    label,
    layerId: layer.id,
    offsets: Uint32Array.from(changed, ([offset]) => offset),
    before: Uint8Array.from(changed, ([offset]) => layer.pixels[offset]),
    after: Uint8Array.from(changed, ([, index]) => index),
  };
  if (changed.some(([offset, , extrusion]) => layer.extrusion[offset] !== extrusion)) {
    edit.extrusion = {
      before: Uint32Array.from(changed, ([offset]) => layer.extrusion[offset]),
      after: Uint32Array.from(changed, ([, , extrusion]) => extrusion),
    };
  }
  return edit;
}

/**
 * A pixel edit that changes `layer` to `after` (laid out like its pixels)
 * and, when given, its extrusions to `afterExtrusion`, keeping only the
 * pixels that differ. Built unapplied. Null when nothing changes. For
 * whole-layer changes, where a map of values would be slow.
 */
export function pixelEditFromArray(
  layer: Layer,
  label: string,
  after: Uint8Array,
  afterExtrusion: Uint32Array = layer.extrusion,
): PixelEdit | null {
  if (after.length !== layer.pixels.length || afterExtrusion.length !== layer.pixels.length) {
    throw new RangeError('Pixel array does not match the layer');
  }
  return diffPixels(layer.id, label, layer, { pixels: after, extrusion: afterExtrusion }, 0, after.length);
}

/** A layer's worth of indices and extrusions. */
interface PixelState {
  pixels: Uint8Array;
  extrusion: Uint32Array;
}

/**
 * An edit from `before` to `after` (both layer-sized) for the offsets in
 * [start, end) where they differ. Extrusions count only where the pixel is
 * painted: elsewhere they mean nothing.
 */
function diffPixels(
  layerId: string,
  label: string,
  before: PixelState,
  after: PixelState,
  start: number,
  end: number,
): PixelEdit | null {
  const differs = (i: number) =>
    before.pixels[i] !== after.pixels[i] ||
    (after.pixels[i] !== TRANSPARENT && before.extrusion[i] !== after.extrusion[i]);
  // Count first, then fill typed arrays: whole-layer edits have a million entries.
  let count = 0;
  let extruded = false;
  for (let i = start; i < end; i++) {
    if (!differs(i)) continue;
    count++;
    if (before.extrusion[i] !== after.extrusion[i]) extruded = true;
  }
  if (count === 0) return null;
  const edit: PixelEdit = {
    kind: 'pixels',
    label,
    layerId,
    offsets: new Uint32Array(count),
    before: new Uint8Array(count),
    after: new Uint8Array(count),
  };
  const extrusion = extruded ? { before: new Uint32Array(count), after: new Uint32Array(count) } : undefined;
  if (extrusion) edit.extrusion = extrusion;
  for (let i = start, k = 0; i < end; i++) {
    if (!differs(i)) continue;
    edit.offsets[k] = i;
    edit.before[k] = before.pixels[i];
    edit.after[k] = after.pixels[i];
    if (extrusion) {
      extrusion.before[k] = before.extrusion[i];
      extrusion.after[k] = after.extrusion[i];
    }
    k++;
  }
  return edit;
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
      const { offsets, extrusion } = edit;
      for (let i = 0; i < offsets.length; i++) layer.pixels[offsets[i]] = values[i];
      if (extrusion) {
        const extrusions = direction === 'undo' ? extrusion.before : extrusion.after;
        for (let i = 0; i < offsets.length; i++) layer.extrusion[offsets[i]] = extrusions[i];
      }
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
      doc.selections[edit.facing] = direction === 'redo' ? edit.after : edit.before;
      return;
    case 'floating':
      doc.floating = direction === 'redo' ? edit.after : edit.before;
      return;
    case 'document': {
      const state = direction === 'redo' ? edit.after : edit.before;
      if (state.layers.some((layer) => !layerFits(layer, state))) {
        throw conflict(edit, direction, 'layer size does not match the document');
      }
      doc.name = state.name;
      doc.width = state.width;
      doc.height = state.height;
      doc.depth = state.depth;
      doc.palette = clonePalette(state.palette);
      doc.layers = [...state.layers];
      doc.selections = { ...state.selections };
      doc.floating = state.floating;
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
  if (!layerFits(layer, doc)) throw conflict(edit, direction, 'layer size does not match');
  doc.layers.splice(index, 0, layer);
}

/** Whether a layer is the size of its facing's plane in `volume`. */
function layerFits(layer: Layer, volume: Volume): boolean {
  const { width, height } = planeSize(volume, layer.facing);
  return (
    layer.width === width &&
    layer.height === height &&
    layer.pixels.length === width * height &&
    layer.extrusion.length === width * height
  );
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
  /**
   * Sets the extrusion of a painted pixel to `update(its extrusion)`;
   * transparent ones are left alone. Returns whether it changed.
   */
  updateExtrusion(x: number, y: number, update: (extrusion: Extrusion) => Extrusion): boolean;
  /** Sets a pixel's index and extrusion together (see `setCellAt`). Returns whether it changed. */
  setCell(x: number, y: number, cell: Cell): boolean;
  /**
   * Sets every pixel to `pixels` (laid out like the layer's), and painted
   * ones' extrusions to `extrusion` when given, as `setCell` would one by
   * one, only faster. For whole-layer previews (moving a layer).
   */
  setAll(pixels: Uint8Array, extrusion?: Uint32Array): void;
  /** Restores every pixel written so far to its original value. Used to redraw shape previews. */
  revert(): void;
  /**
   * Puts one pixel back to its value before the session (e.g. a corner a
   * pixel-perfect stroke takes back). Returns whether the pixel changed.
   */
  restore(x: number, y: number): boolean;
  /** Ends the session. Returns null when no pixel ended up different from its original value. */
  finish(): PixelEdit | null;
}

/** Starts a session. With `clip`, writes outside those pixels are ignored (e.g. painting inside a selection). */
export function beginPixelEdit(layer: Layer, label: string, clip: Mask | null = null): PixelEditSession {
  // The layer as it was (nothing else writes to it during a session), and
  // the range of offsets written since, so revert and finish look only there.
  const original: PixelState = { pixels: layer.pixels.slice(), extrusion: layer.extrusion.slice() };
  let low = Infinity;
  let high = -1;
  let finished = false;
  const checkOpen = () => {
    if (finished) throw new Error('Pixel edit session already finished');
  };
  /** The offset of (x, y) when the session may write there, else -1. */
  const writable = (x: number, y: number) => {
    checkOpen();
    return inLayer(layer, x, y) && (!clip || maskHas(clip, x, y)) ? y * layer.width + x : -1;
  };
  const wrote = (offset: number) => {
    if (offset < low) low = offset;
    if (offset > high) high = offset;
  };

  return {
    layer,

    setPixel(x, y, index) {
      if (writable(x, y) < 0 || !setPixel(layer, x, y, index)) return false;
      wrote(y * layer.width + x);
      return true;
    },

    updateExtrusion(x, y, update) {
      const offset = writable(x, y);
      if (offset < 0 || layer.pixels[offset] === TRANSPARENT) return false;
      const extrusion = update(layer.extrusion[offset]);
      if (layer.extrusion[offset] === extrusion) return false;
      layer.extrusion[offset] = extrusion;
      wrote(offset);
      return true;
    },

    setCell(x, y, cell) {
      const offset = writable(x, y);
      if (offset < 0 || !setCellAt(layer, offset, cell)) return false;
      wrote(offset);
      return true;
    },

    setAll(pixels, extrusion) {
      checkOpen();
      if (pixels.length !== layer.pixels.length || (extrusion && extrusion.length !== layer.pixels.length)) {
        throw new RangeError('Pixel array does not match the layer');
      }
      const { width } = layer;
      for (let offset = 0; offset < pixels.length; offset++) {
        const index = pixels[offset];
        const extrudes = extrusion !== undefined && index !== TRANSPARENT && layer.extrusion[offset] !== extrusion[offset];
        if (layer.pixels[offset] === index && !extrudes) continue;
        if (clip && !maskHas(clip, offset % width, Math.floor(offset / width))) continue;
        layer.pixels[offset] = index;
        if (extrudes) layer.extrusion[offset] = extrusion[offset];
        wrote(offset);
      }
    },

    revert() {
      checkOpen();
      if (high >= low) {
        layer.pixels.set(original.pixels.subarray(low, high + 1), low);
        layer.extrusion.set(original.extrusion.subarray(low, high + 1), low);
      }
      low = Infinity;
      high = -1;
    },

    restore(x, y) {
      checkOpen();
      if (!inLayer(layer, x, y)) return false;
      const offset = y * layer.width + x;
      return setCellAt(layer, offset, packCell(original.pixels[offset], original.extrusion[offset]));
    },

    finish() {
      finished = true;
      // Pixels painted and then painted back to their original value aren't changes.
      return high < low ? null : diffPixels(layer.id, label, original, layer, low, high + 1);
    },
  };
}
