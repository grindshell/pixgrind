import {
  pixelEditFromArray,
  type BatchEdit,
  type Edit,
  type LayerAddEdit,
  type LayerMoveEdit,
  type LayerProps,
  type LayerPropsEdit,
  type LayerRemoveEdit,
} from './edits.ts';
import { newId } from './id.ts';
import { createLayer, type Layer } from './layer.ts';
import { TRANSPARENT } from './palette.ts';
import { layerIndex, type PixelDocument } from './pixelDocument.ts';

/*
 * Constructors for layer edits. Each validates against the current document
 * and returns an unapplied edit; perform it with `applyEdit(doc, edit, 'redo')`
 * (the editor does this in `Editor.perform`).
 */

const DEFAULT_NAME = /^Layer (\d+)$/;

/** "Layer N", with N one past the highest existing "Layer N". */
export function nextLayerName(doc: PixelDocument): string {
  const highest = Math.max(0, ...doc.layers.map((layer) => Number(DEFAULT_NAME.exec(layer.name)?.[1] ?? 0)));
  return `Layer ${highest + 1}`;
}

/** A new empty layer at `index` (0 = bottom; defaults to the top). */
export function addLayerEdit(doc: PixelDocument, index = doc.layers.length): LayerAddEdit {
  if (!Number.isInteger(index) || index < 0 || index > doc.layers.length) {
    throw new RangeError(`Invalid layer position ${index}`);
  }
  return {
    kind: 'layer-add',
    label: 'Add layer',
    layer: createLayer(doc.width, doc.height, nextLayerName(doc)),
    index,
  };
}

/** A copy of a layer, placed directly above it. */
export function duplicateLayerEdit(doc: PixelDocument, layerId: string): LayerAddEdit {
  const index = requireIndex(doc, layerId);
  const source = doc.layers[index];
  const copy: Layer = { ...source, id: newId(), name: `${source.name} copy`, pixels: source.pixels.slice() };
  return { kind: 'layer-add', label: 'Duplicate layer', layer: copy, index: index + 1 };
}

export function removeLayerEdit(doc: PixelDocument, layerId: string): LayerRemoveEdit {
  const index = requireIndex(doc, layerId);
  if (doc.layers.length <= 1) throw new Error('A document needs at least one layer');
  return { kind: 'layer-remove', label: 'Delete layer', layer: doc.layers[index], index };
}

/** Moves a layer to position `to` (0 = bottom). Null when it is already there. */
export function moveLayerEdit(doc: PixelDocument, layerId: string, to: number): LayerMoveEdit | null {
  const from = requireIndex(doc, layerId);
  if (!Number.isInteger(to) || to < 0 || to >= doc.layers.length) {
    throw new RangeError(`Invalid layer position ${to}`);
  }
  if (from === to) return null;
  return { kind: 'layer-move', label: to > from ? 'Move layer up' : 'Move layer down', layerId, from, to };
}

/**
 * Changes a layer's name and/or opacity. `before` defaults to the layer's
 * current values; pass it when the change was already previewed live (e.g.
 * while dragging an opacity slider). Null when nothing would change.
 */
export function layerPropsEdit(
  doc: PixelDocument,
  layerId: string,
  after: LayerProps,
  before?: LayerProps,
): LayerPropsEdit | null {
  const layer = doc.layers[requireIndex(doc, layerId)];
  if (after.name !== undefined && after.name.trim() === '') throw new Error('Layer name cannot be empty');
  if (after.opacity !== undefined && !(after.opacity >= 0 && after.opacity <= 1)) {
    throw new RangeError(`Invalid opacity ${after.opacity}`);
  }

  const current: LayerProps = {};
  if (after.name !== undefined) current.name = layer.name;
  if (after.opacity !== undefined) current.opacity = layer.opacity;
  const original = before ?? current;

  const renamed = after.name !== undefined && after.name !== original.name;
  const opacityChanged = after.opacity !== undefined && after.opacity !== original.opacity;
  if (!renamed && !opacityChanged) return null;

  const label = renamed && opacityChanged ? 'Edit layer' : renamed ? 'Rename layer' : 'Change layer opacity';
  return { kind: 'layer-props', label, layerId, before: { ...original }, after: { ...after } };
}

export type MergeCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a layer can merge into the one below it. Palette indices can't
 * blend, so a merge is only exact when both layers are visible and fully
 * opaque.
 */
export function canMergeDown(doc: PixelDocument, layerId: string): MergeCheck {
  const index = layerIndex(doc, layerId);
  if (index < 0) return { ok: false, reason: 'Layer not found' };
  if (index === 0) return { ok: false, reason: 'No layer below to merge into' };
  const upper = doc.layers[index];
  const lower = doc.layers[index - 1];
  if (!upper.visible || !lower.visible) return { ok: false, reason: 'Both layers must be visible' };
  if (upper.opacity !== 1 || lower.opacity !== 1) return { ok: false, reason: 'Both layers must be at 100% opacity' };
  return { ok: true };
}

/**
 * Merges a layer into the one below: the upper layer's non-transparent pixels
 * replace the lower layer's, then the upper layer is removed. Exact for opaque
 * palette colors; a translucent color replaces what was beneath it instead of
 * blending.
 */
export function mergeDownEdit(doc: PixelDocument, layerId: string): BatchEdit {
  const check = canMergeDown(doc, layerId);
  if (!check.ok) throw new Error(`Cannot merge down: ${check.reason}`);
  const index = layerIndex(doc, layerId);
  const upper = doc.layers[index];
  const lower = doc.layers[index - 1];

  const merged = lower.pixels.slice();
  for (let i = 0; i < merged.length; i++) {
    if (upper.pixels[i] !== TRANSPARENT) merged[i] = upper.pixels[i];
  }

  const label = 'Merge down';
  const edits: Edit[] = [];
  const pixels = pixelEditFromArray(lower, label, merged);
  if (pixels) edits.push(pixels);
  edits.push({ kind: 'layer-remove', label, layer: upper, index });
  return { kind: 'batch', label, edits };
}

function requireIndex(doc: PixelDocument, layerId: string): number {
  const index = layerIndex(doc, layerId);
  if (index < 0) throw new Error(`Layer ${layerId} not found`);
  return index;
}
