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
import type { Facing } from './facing.ts';
import { newId } from './id.ts';
import type { Layer } from './layer.ts';
import { TRANSPARENT } from './palette.ts';
import { createFacingLayer, facingLayers, layerIndex, type PixelDocument } from './pixelDocument.ts';

/*
 * Constructors for layer edits. Each validates against the current document
 * and returns an unapplied edit; perform it with `applyEdit(doc, edit, 'redo')`
 * (the editor does this in `Editor.perform`).
 *
 * Layers of all facings share one stack, but each facing's layers are a list
 * of their own in the UI: moving and merging go to the next layer of the same
 * facing, skipping others.
 */

const DEFAULT_NAME = /^Layer (\d+)$/;

/** "Layer N", with N one past the highest existing "Layer N" on `facing`. */
export function nextLayerName(doc: PixelDocument, facing: Facing): string {
  const names = facingLayers(doc, facing).map((layer) => Number(DEFAULT_NAME.exec(layer.name)?.[1] ?? 0));
  return `Layer ${Math.max(0, ...names) + 1}`;
}

/** A new empty layer on `facing` at `index` (0 = bottom; defaults to the top). */
export function addLayerEdit(doc: PixelDocument, facing: Facing, index = doc.layers.length): LayerAddEdit {
  if (!Number.isInteger(index) || index < 0 || index > doc.layers.length) {
    throw new RangeError(`Invalid layer position ${index}`);
  }
  return {
    kind: 'layer-add',
    label: 'Add layer',
    layer: createFacingLayer(doc, facing, nextLayerName(doc, facing)),
    index,
  };
}

/**
 * Position (in `doc.layers`) of the nearest layer above (`step` 1) or below
 * (-1) a layer that has its facing, or -1 when there's none.
 */
export function neighborLayerIndex(doc: PixelDocument, layerId: string, step: 1 | -1): number {
  const index = requireIndex(doc, layerId);
  const { facing } = doc.layers[index];
  for (let i = index + step; i >= 0 && i < doc.layers.length; i += step) {
    if (doc.layers[i].facing === facing) return i;
  }
  return -1;
}

/** A copy of a layer, placed directly above it. */
export function duplicateLayerEdit(doc: PixelDocument, layerId: string): LayerAddEdit {
  const index = requireIndex(doc, layerId);
  const source = doc.layers[index];
  const copy: Layer = {
    ...source,
    id: newId(),
    name: `${source.name} copy`,
    pixels: source.pixels.slice(),
    extrusion: source.extrusion.slice(),
  };
  return { kind: 'layer-add', label: 'Duplicate layer', layer: copy, index: index + 1 };
}

/** Whether a layer can be deleted: every facing keeps at least one. */
export function canRemoveLayer(doc: PixelDocument, layerId: string): boolean {
  const index = layerIndex(doc, layerId);
  return index >= 0 && facingLayers(doc, doc.layers[index].facing).length > 1;
}

export function removeLayerEdit(doc: PixelDocument, layerId: string): LayerRemoveEdit {
  const index = requireIndex(doc, layerId);
  if (!canRemoveLayer(doc, layerId)) throw new Error('Each side of the model needs at least one layer');
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
 * Whether a layer can merge into the one below it on its facing. Palette
 * indices can't blend, so a merge is only exact when both layers are visible
 * and fully opaque. A pixel has one box in 3D, so where both layers have a
 * pixel their extrusions must match, or the lower layer's boxes would be
 * lost.
 */
export function canMergeDown(doc: PixelDocument, layerId: string): MergeCheck {
  const index = layerIndex(doc, layerId);
  if (index < 0) return { ok: false, reason: 'Layer not found' };
  const below = neighborLayerIndex(doc, layerId, -1);
  if (below < 0) return { ok: false, reason: 'No layer below to merge into' };
  const upper = doc.layers[index];
  const lower = doc.layers[below];
  if (!upper.visible || !lower.visible) return { ok: false, reason: 'Both layers must be visible' };
  if (upper.opacity !== 1 || lower.opacity !== 1) return { ok: false, reason: 'Both layers must be at 100% opacity' };
  for (let i = 0; i < upper.pixels.length; i++) {
    if (upper.pixels[i] !== TRANSPARENT && lower.pixels[i] !== TRANSPARENT && upper.extrusion[i] !== lower.extrusion[i]) {
      return { ok: false, reason: 'Pixels on both layers have different 3D extrusions' };
    }
  }
  return { ok: true };
}

/**
 * Merges a layer into the one below it on its facing: the upper layer's
 * non-transparent pixels replace the lower layer's, extrusions included,
 * then the upper layer is removed. Exact for opaque palette colors; a
 * translucent color replaces what was beneath it instead of blending.
 */
export function mergeDownEdit(doc: PixelDocument, layerId: string): BatchEdit {
  const check = canMergeDown(doc, layerId);
  if (!check.ok) throw new Error(`Cannot merge down: ${check.reason}`);
  const index = layerIndex(doc, layerId);
  const upper = doc.layers[index];
  const lower = doc.layers[neighborLayerIndex(doc, layerId, -1)];

  const merged = lower.pixels.slice();
  const mergedExtrusion = lower.extrusion.slice();
  for (let i = 0; i < merged.length; i++) {
    if (upper.pixels[i] === TRANSPARENT) continue;
    merged[i] = upper.pixels[i];
    mergedExtrusion[i] = upper.extrusion[i];
  }

  const label = 'Merge down';
  const edits: Edit[] = [];
  const pixels = pixelEditFromArray(lower, label, merged, mergedExtrusion);
  if (pixels) edits.push(pixels);
  edits.push({ kind: 'layer-remove', label, layer: upper, index });
  return { kind: 'batch', label, edits };
}

function requireIndex(doc: PixelDocument, layerId: string): number {
  const index = layerIndex(doc, layerId);
  if (index < 0) throw new Error(`Layer ${layerId} not found`);
  return index;
}
