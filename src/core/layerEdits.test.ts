import { describe, expect, it } from 'vitest';
import { applyEdit, beginPixelEdit, type BatchEdit, type Edit } from './edits.ts';
import { DEFAULT_EXTRUSION, packExtrusion } from './extrusion.ts';
import { History } from './history.ts';
import { createLayer } from './layer.ts';
import {
  addLayerEdit,
  canMergeDown,
  canRemoveLayer,
  duplicateLayerEdit,
  layerPropsEdit,
  mergeDownEdit,
  moveLayerEdit,
  neighborLayerIndex,
  nextLayerName,
  removeLayerEdit,
} from './layerEdits.ts';
import { createPalette } from './palette.ts';
import { createDocument, getPixel, setPixel, type PixelDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff, 0x0000ffff]);

/** Applies an edit the way the editor does and records it. */
function perform(doc: PixelDocument, history: History, edit: Edit | null): void {
  if (!edit) throw new Error('expected an edit');
  applyEdit(doc, edit, 'redo');
  history.push(edit);
}

/**
 * A 2×1 document with `count` front layers named "Layer 1".."Layer N", bottom
 * to top, and none on other sides (which these edits don't mind).
 */
function docWithLayers(count: number): PixelDocument {
  const doc = createDocument(2, 1, palette);
  doc.layers = doc.layers.filter((layer) => layer.facing === 'front');
  for (let i = 1; i < count; i++) applyEdit(doc, addLayerEdit(doc, 'front'), 'redo');
  return doc;
}

const names = (doc: PixelDocument) => doc.layers.map((l) => l.name);

describe('nextLayerName', () => {
  it('continues after the highest default name', () => {
    const doc = docWithLayers(1);
    expect(nextLayerName(doc, 'front')).toBe('Layer 2');
    doc.layers[0].name = 'Layer 7';
    doc.layers.push(createLayer(2, 1, 'Sketch'));
    expect(nextLayerName(doc, 'front')).toBe('Layer 8');
  });
});

describe('add / duplicate / remove', () => {
  it('adds an empty layer at a position, undo removes it', () => {
    const doc = docWithLayers(2);
    const history = new History();
    perform(doc, history, addLayerEdit(doc, 'front', 1));
    expect(names(doc)).toEqual(['Layer 1', 'Layer 3', 'Layer 2']);
    expect(doc.layers[1].pixels.every((p) => p === 0)).toBe(true);
    history.undo(doc);
    expect(names(doc)).toEqual(['Layer 1', 'Layer 2']);
    history.redo(doc);
    expect(names(doc)).toEqual(['Layer 1', 'Layer 3', 'Layer 2']);
  });

  it('rejects positions out of range', () => {
    const doc = docWithLayers(1);
    expect(() => addLayerEdit(doc, 'front', 2)).toThrow(RangeError);
    expect(() => addLayerEdit(doc, 'front', -1)).toThrow(RangeError);
  });

  it('duplicates above the source with independent pixels and a new id', () => {
    const doc = docWithLayers(1);
    const [source] = doc.layers;
    setPixel(source, 0, 0, 2);
    source.extrusion[0] = packExtrusion(1, 4);
    source.opacity = 0.5;
    applyEdit(doc, duplicateLayerEdit(doc, source.id), 'redo');
    const copy = doc.layers[1];
    expect(copy.name).toBe('Layer 1 copy');
    expect(copy.id).not.toBe(source.id);
    expect(copy.opacity).toBe(0.5);
    expect(getPixel(copy, 0, 0)).toBe(2);
    expect(copy.extrusion[0]).toBe(packExtrusion(1, 4));
    setPixel(copy, 0, 0, 3);
    copy.extrusion[0] = DEFAULT_EXTRUSION;
    expect(getPixel(source, 0, 0)).toBe(2);
    expect(source.extrusion[0]).toBe(packExtrusion(1, 4));
  });

  it('removes a layer, undo restores it at the same position', () => {
    const doc = docWithLayers(3);
    const history = new History();
    const middle = doc.layers[1];
    perform(doc, history, removeLayerEdit(doc, middle.id));
    expect(names(doc)).toEqual(['Layer 1', 'Layer 3']);
    history.undo(doc);
    expect(doc.layers[1]).toBe(middle);
  });

  it('refuses to remove the last layer', () => {
    const doc = docWithLayers(1);
    expect(() => removeLayerEdit(doc, doc.layers[0].id)).toThrow(/at least one layer/);
  });

  it('pixel edits still undo after their layer is removed and restored', () => {
    const doc = docWithLayers(2);
    const history = new History();
    const top = doc.layers[1];
    const stroke = beginPixelEdit(top, 'Pencil');
    stroke.setPixel(1, 0, 1);
    history.push(stroke.finish()!);
    perform(doc, history, removeLayerEdit(doc, top.id));

    history.undo(doc); // restores the layer
    history.undo(doc); // undoes the stroke on it
    expect(getPixel(top, 1, 0)).toBe(0);
    history.redo(doc);
    history.redo(doc);
    expect(names(doc)).toEqual(['Layer 1']);
    history.undo(doc);
    expect(getPixel(doc.layers[1], 1, 0)).toBe(1);
  });
});

describe('moveLayerEdit', () => {
  it('moves up and down, undo restores the order', () => {
    const doc = docWithLayers(3);
    const history = new History();
    const bottom = doc.layers[0];
    const up = moveLayerEdit(doc, bottom.id, 2);
    expect(up?.label).toBe('Move layer up');
    perform(doc, history, up);
    expect(names(doc)).toEqual(['Layer 2', 'Layer 3', 'Layer 1']);
    perform(doc, history, moveLayerEdit(doc, bottom.id, 1));
    expect(names(doc)).toEqual(['Layer 2', 'Layer 1', 'Layer 3']);
    history.undo(doc);
    history.undo(doc);
    expect(names(doc)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
  });

  it('returns null for no-op moves and rejects bad positions', () => {
    const doc = docWithLayers(2);
    expect(moveLayerEdit(doc, doc.layers[0].id, 0)).toBeNull();
    expect(() => moveLayerEdit(doc, doc.layers[0].id, 2)).toThrow(RangeError);
  });

  it('refuses to apply when the layer is not where the edit expects', () => {
    const doc = docWithLayers(3);
    const edit = moveLayerEdit(doc, doc.layers[0].id, 2)!;
    doc.layers.reverse();
    expect(() => applyEdit(doc, edit, 'redo')).toThrow(/not at position/);
  });
});

describe('layerPropsEdit', () => {
  it('renames, undo restores the old name', () => {
    const doc = docWithLayers(1);
    const history = new History();
    const edit = layerPropsEdit(doc, doc.layers[0].id, { name: 'Outline' });
    expect(edit?.label).toBe('Rename layer');
    perform(doc, history, edit);
    expect(doc.layers[0].name).toBe('Outline');
    history.undo(doc);
    expect(doc.layers[0].name).toBe('Layer 1');
  });

  it('uses an explicit `before` for changes previewed live', () => {
    const doc = docWithLayers(1);
    const [layer] = doc.layers;
    const history = new History();
    layer.opacity = 0.3; // preview already applied
    perform(doc, history, layerPropsEdit(doc, layer.id, { opacity: 0.3 }, { opacity: 1 }));
    history.undo(doc);
    expect(layer.opacity).toBe(1);
    history.redo(doc);
    expect(layer.opacity).toBe(0.3);
  });

  it('returns null when nothing changes', () => {
    const doc = docWithLayers(1);
    const id = doc.layers[0].id;
    expect(layerPropsEdit(doc, id, { name: 'Layer 1' })).toBeNull();
    expect(layerPropsEdit(doc, id, { opacity: 1 })).toBeNull();
    expect(layerPropsEdit(doc, id, { opacity: 0.5 }, { opacity: 0.5 })).toBeNull();
  });

  it('only touches the given properties', () => {
    const doc = docWithLayers(1);
    const [layer] = doc.layers;
    applyEdit(doc, layerPropsEdit(doc, layer.id, { opacity: 0.5 })!, 'redo');
    expect(layer.name).toBe('Layer 1');
    expect(layer.visible).toBe(true);
  });

  it('validates names and opacity', () => {
    const doc = docWithLayers(1);
    const id = doc.layers[0].id;
    expect(() => layerPropsEdit(doc, id, { name: '  ' })).toThrow();
    expect(() => layerPropsEdit(doc, id, { opacity: 1.5 })).toThrow(RangeError);
    expect(() => layerPropsEdit(doc, id, { opacity: Number.NaN })).toThrow(RangeError);
  });
});

describe('merge down', () => {
  function twoLayers(): PixelDocument {
    const doc = docWithLayers(2);
    const [lower, upper] = doc.layers;
    setPixel(lower, 0, 0, 1);
    setPixel(lower, 1, 0, 1);
    setPixel(upper, 1, 0, 2);
    return doc;
  }

  it('explains why a merge is not possible', () => {
    const doc = twoLayers();
    const [lower, upper] = doc.layers;
    expect(canMergeDown(doc, lower.id)).toEqual({ ok: false, reason: 'No layer below to merge into' });
    expect(canMergeDown(doc, upper.id)).toEqual({ ok: true });
    upper.visible = false;
    expect(canMergeDown(doc, upper.id)).toMatchObject({ ok: false, reason: 'Both layers must be visible' });
    upper.visible = true;
    lower.opacity = 0.5;
    expect(canMergeDown(doc, upper.id)).toMatchObject({ ok: false, reason: 'Both layers must be at 100% opacity' });
    expect(() => mergeDownEdit(doc, upper.id)).toThrow(/100% opacity/);
  });

  it('upper pixels replace lower ones; transparent upper pixels keep the lower', () => {
    const doc = twoLayers();
    const [lower, upper] = doc.layers;
    applyEdit(doc, mergeDownEdit(doc, upper.id), 'redo');
    expect(doc.layers).toEqual([lower]);
    expect([getPixel(lower, 0, 0), getPixel(lower, 1, 0)]).toEqual([1, 2]);
  });

  it('undo restores both layers as one step', () => {
    const doc = twoLayers();
    const [lower, upper] = doc.layers;
    const history = new History();
    perform(doc, history, mergeDownEdit(doc, upper.id));
    history.undo(doc);
    expect(doc.layers).toEqual([lower, upper]);
    expect([getPixel(lower, 0, 0), getPixel(lower, 1, 0)]).toEqual([1, 1]);
    expect(getPixel(upper, 1, 0)).toBe(2);
  });

  it('merging an empty layer only removes it', () => {
    const doc = docWithLayers(2);
    const edit = mergeDownEdit(doc, doc.layers[1].id);
    expect(edit.edits.map((e) => e.kind)).toEqual(['layer-remove']);
  });

  it('takes upper extrusions, and refuses when overlapping pixels differ in depth', () => {
    const doc = twoLayers();
    const [lower, upper] = doc.layers;
    upper.extrusion[1] = packExtrusion(1, 3);
    expect(canMergeDown(doc, upper.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/extrusions/) });
    lower.extrusion[1] = packExtrusion(1, 3);
    upper.extrusion[0] = packExtrusion(0, 9); // over a transparent upper pixel: irrelevant
    applyEdit(doc, mergeDownEdit(doc, upper.id), 'redo');
    expect(lower.extrusion[1]).toBe(packExtrusion(1, 3));
    expect(lower.extrusion[0]).toBe(DEFAULT_EXTRUSION);
  });
});

describe('layers on several sides', () => {
  /** Front, top, front, top, bottom to top, in a 2×1×3 document. */
  function mixed(): PixelDocument {
    const doc = createDocument(2, 1, palette, 'mixed', 3);
    doc.layers = doc.layers.filter((layer) => layer.facing === 'front' || layer.facing === 'top');
    applyEdit(doc, addLayerEdit(doc, 'front'), 'redo');
    applyEdit(doc, addLayerEdit(doc, 'top'), 'redo');
    return doc;
  }
  const sides = (doc: PixelDocument) => doc.layers.map((l) => `${l.facing} ${l.name}`);

  it('adds layers sized for their side, named per side', () => {
    const doc = mixed();
    expect(sides(doc)).toEqual(['front Layer 1', 'top Layer 1', 'front Layer 2', 'top Layer 2']);
    expect([doc.layers[1].width, doc.layers[1].height]).toEqual([2, 3]);
  });

  it('moves and merges past the next layer of the same side', () => {
    const doc = mixed();
    const [bottom, , upper] = doc.layers;
    expect(neighborLayerIndex(doc, bottom.id, 1)).toBe(2);
    expect(neighborLayerIndex(doc, bottom.id, -1)).toBe(-1);
    applyEdit(doc, moveLayerEdit(doc, bottom.id, neighborLayerIndex(doc, bottom.id, 1))!, 'redo');
    expect(sides(doc)).toEqual(['top Layer 1', 'front Layer 2', 'front Layer 1', 'top Layer 2']);
    setPixel(upper, 0, 0, 1);
    applyEdit(doc, mergeDownEdit(doc, bottom.id), 'redo');
    expect(sides(doc)).toEqual(['top Layer 1', 'front Layer 2', 'top Layer 2']);
    expect(getPixel(upper, 0, 0)).toBe(1);
  });

  it('keeps a layer on every side', () => {
    const doc = mixed();
    expect(canRemoveLayer(doc, doc.layers[0].id)).toBe(true);
    applyEdit(doc, removeLayerEdit(doc, doc.layers[0].id), 'redo');
    expect(canRemoveLayer(doc, doc.layers[1].id)).toBe(false);
    expect(() => removeLayerEdit(doc, doc.layers[1].id)).toThrow(/at least one layer/);
  });
});

describe('batch edits', () => {
  it('roll back already-applied parts when a later part fails', () => {
    const doc = docWithLayers(2);
    const [lower, upper] = doc.layers;
    const batch: BatchEdit = {
      kind: 'batch',
      label: 'Broken',
      edits: [
        { kind: 'layer-props', label: 'Rename', layerId: lower.id, before: { name: 'Layer 1' }, after: { name: 'Renamed' } },
        { kind: 'layer-remove', label: 'Remove', layer: upper, index: 1 },
        { kind: 'layer-remove', label: 'Remove again', layer: upper, index: 1 },
      ],
    };
    expect(() => applyEdit(doc, batch, 'redo')).toThrow(/Remove again/);
    expect(names(doc)).toEqual(['Layer 1', 'Layer 2']);
    expect(doc.layers[1]).toBe(upper);
  });
});
