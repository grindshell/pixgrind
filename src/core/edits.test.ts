import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  beginPixelEdit,
  combineEdits,
  editedSide,
  pixelEditFromArray,
  pixelEditFromCells,
  pixelEditFromValues,
  type Edit,
  type PixelEdit,
} from './edits.ts';
import { DEFAULT_EXTRUSION, packCell, packExtrusion } from './extrusion.ts';
import { rectMask } from './mask.ts';
import { createPalette } from './palette.ts';
import { createDocument, getPixel, setPixel, type PixelDocument } from './pixelDocument.ts';
import { selectionEdit } from './selection.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff, 0x0000ffff]);

function docWithPixel(x: number, y: number, index: number): PixelDocument {
  const doc = createDocument(4, 4, palette);
  setPixel(doc.layers[0], x, y, index);
  return doc;
}

describe('beginPixelEdit', () => {
  it('records offsets with before/after values in ascending order', () => {
    const doc = docWithPixel(1, 0, 3);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Pencil');
    session.setPixel(2, 2, 1);
    session.setPixel(1, 0, 2);
    const edit = session.finish();
    expect(edit).toMatchObject({ kind: 'pixels', label: 'Pencil', layerId: layer.id });
    expect(Array.from(edit!.offsets)).toEqual([1, 10]);
    expect(Array.from(edit!.before)).toEqual([3, 0]);
    expect(Array.from(edit!.after)).toEqual([2, 1]);
  });

  it('keeps the first original value when a pixel is painted repeatedly', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(0, 0, 3);
    const edit = session.finish();
    expect(Array.from(edit!.before)).toEqual([1]);
    expect(Array.from(edit!.after)).toEqual([3]);
  });

  it('drops pixels painted back to their original value', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(0, 0, 1);
    session.setPixel(3, 3, 2);
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([15]);
  });

  it('returns null when nothing changed', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    expect(session.setPixel(0, 0, 1)).toBe(false);
    expect(session.setPixel(-1, 0, 2)).toBe(false);
    expect(session.setPixel(4, 0, 2)).toBe(false);
    expect(session.finish()).toBeNull();
  });

  it('revert() restores originals and forgets them', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Line');
    session.setPixel(0, 0, 2);
    session.setPixel(1, 0, 2);
    session.revert();
    expect([getPixel(layer, 0, 0), getPixel(layer, 1, 0)]).toEqual([1, 0]);
    session.setPixel(2, 0, 3);
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([2]);
    expect(Array.from(edit!.before)).toEqual([0]);
  });

  it('restore() puts back one pixel and leaves it out of the edit', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(1, 0, 2);
    expect(session.restore(0, 0)).toBe(true);
    expect(getPixel(layer, 0, 0)).toBe(1);
    // Untouched or out-of-bounds pixels have nothing to restore.
    expect(session.restore(3, 3)).toBe(false);
    expect(session.restore(-1, 0)).toBe(false);
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([1]);
  });

  it('ignores writes outside the clip mask', () => {
    const doc = createDocument(4, 4, palette);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Pencil', rectMask({ x: 1, y: 1, width: 2, height: 2 }));
    expect(session.setPixel(0, 0, 1)).toBe(false);
    expect(session.setPixel(3, 2, 1)).toBe(false);
    expect(session.setPixel(2, 2, 1)).toBe(true);
    expect(Array.from(session.finish()!.offsets)).toEqual([10]);

    // Inside the clip's rectangle but not its mask.
    const diagonal = { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 0, 1) };
    const clipped = beginPixelEdit(layer, 'Pencil', diagonal);
    expect(clipped.setPixel(1, 0, 1)).toBe(false);
    expect(clipped.setPixel(1, 1, 1)).toBe(true);
  });

  it('setAll() writes a whole layer, clipped, and reverts like single writes', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Move', rectMask({ x: 0, y: 0, width: 4, height: 2 }));
    session.setAll(new Uint8Array(16).fill(2));
    // Rows 2 and 3 are outside the clip.
    expect(Array.from(layer.pixels)).toEqual([...Array(8).fill(2), ...Array(8).fill(0)]);
    session.revert();
    expect(layer.pixels[0]).toBe(1);
    expect(layer.pixels[1]).toBe(0);
    session.setAll(Uint8Array.from({ length: 16 }, (_, i) => (i === 5 ? 3 : i === 0 ? 1 : 0)));
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([5]);
    expect(() => beginPixelEdit(layer, 'x').setAll(new Uint8Array(3))).toThrow(RangeError);
  });

  it('cannot be written to after finishing', () => {
    const doc = createDocument(2, 2, palette);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    session.finish();
    expect(() => session.setPixel(0, 0, 1)).toThrow();
  });
});

describe('applyEdit', () => {
  function paintedDoc(): { doc: PixelDocument; edit: PixelEdit } {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(1, 1, 3);
    return { doc, edit: session.finish()! };
  }

  it('undo restores and redo reapplies', () => {
    const { doc, edit } = paintedDoc();
    const [layer] = doc.layers;
    applyEdit(doc, edit, 'undo');
    expect([getPixel(layer, 0, 0), getPixel(layer, 1, 1)]).toEqual([1, 0]);
    applyEdit(doc, edit, 'redo');
    expect([getPixel(layer, 0, 0), getPixel(layer, 1, 1)]).toEqual([2, 3]);
  });

  it('finds the layer by id, not position', () => {
    const { doc, edit } = paintedDoc();
    const painted = doc.layers[0];
    doc.layers.unshift({ ...painted, id: 'other', pixels: new Uint8Array(16) });
    applyEdit(doc, edit, 'undo');
    expect(getPixel(painted, 0, 0)).toBe(1);
    expect(doc.layers[0].pixels.every((p) => p === 0)).toBe(true);
  });

  it('throws when the layer no longer exists', () => {
    const { doc, edit } = paintedDoc();
    doc.layers = [];
    expect(() => applyEdit(doc, edit, 'undo')).toThrow(/not found/);
  });
});

describe('pixelEditFromValues', () => {
  it('keeps only changed pixels, sorted, with current values as before', () => {
    const doc = docWithPixel(1, 0, 2);
    const edit = pixelEditFromValues(doc.layers[0], 'Set', new Map([[5, 3], [1, 2], [0, 1]]));
    expect(Array.from(edit!.offsets)).toEqual([0, 5]);
    expect(Array.from(edit!.before)).toEqual([0, 0]);
    expect(Array.from(edit!.after)).toEqual([1, 3]);
  });

  it('is null when nothing changes', () => {
    const doc = docWithPixel(0, 0, 1);
    expect(pixelEditFromValues(doc.layers[0], 'Set', new Map([[0, 1]]))).toBeNull();
  });
});

describe('pixelEditFromArray', () => {
  it('keeps only the pixels that differ from the layer', () => {
    const doc = docWithPixel(1, 0, 2);
    const after = new Uint8Array(16);
    after[0] = 1;
    after[1] = 2;
    after[15] = 3;
    const edit = pixelEditFromArray(doc.layers[0], 'Set', after);
    expect(Array.from(edit!.offsets)).toEqual([0, 15]);
    expect(Array.from(edit!.before)).toEqual([0, 0]);
    expect(Array.from(edit!.after)).toEqual([1, 3]);
  });

  it('is null when nothing changes, and rejects arrays of another size', () => {
    const doc = docWithPixel(0, 0, 1);
    expect(pixelEditFromArray(doc.layers[0], 'Set', doc.layers[0].pixels.slice())).toBeNull();
    expect(() => pixelEditFromArray(doc.layers[0], 'Set', new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('extrusion edits', () => {
  const DEEP = packExtrusion(2, 6);

  it('records extrusion changes with pixels, and undo/redo applies them', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Extrude');
    expect(session.updateExtrusion(0, 0, () => DEEP)).toBe(true);
    expect(session.updateExtrusion(0, 0, (e) => e)).toBe(false); // unchanged
    expect(session.updateExtrusion(1, 0, () => DEEP)).toBe(false); // transparent: nothing to extrude
    const edit = session.finish()!;
    expect(Array.from(edit.offsets)).toEqual([0]);
    expect(edit.extrusion).toEqual({ before: Uint32Array.of(DEFAULT_EXTRUSION), after: Uint32Array.of(DEEP) });
    applyEdit(doc, edit, 'undo');
    expect(layer.extrusion[0]).toBe(DEFAULT_EXTRUSION);
    applyEdit(doc, edit, 'redo');
    expect(layer.extrusion[0]).toBe(DEEP);
  });

  it('leaves extrusions out of edits that change none', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    expect(session.finish()!.extrusion).toBeUndefined();
  });

  it('gives newly painted pixels the default extrusion', () => {
    const doc = createDocument(2, 1, palette);
    const [layer] = doc.layers;
    layer.extrusion[0] = DEEP; // left by an erased pixel
    const session = beginPixelEdit(layer, 'Pencil');
    session.setPixel(0, 0, 1);
    expect(layer.extrusion[0]).toBe(DEFAULT_EXTRUSION);
    const edit = session.finish()!;
    applyEdit(doc, edit, 'undo');
    expect([layer.pixels[0], layer.extrusion[0]]).toEqual([0, DEEP]);
  });

  it('setAll without extrusions gives newly painted pixels the default', () => {
    const doc = docWithPixel(1, 0, 1);
    const [layer] = doc.layers;
    layer.extrusion[0] = DEEP; // left by an erased pixel
    layer.extrusion[1] = DEEP; // a painted pixel's own
    const session = beginPixelEdit(layer, 'Move');
    session.setAll(Uint8Array.from({ length: 16 }, (_, i) => (i < 2 ? 2 : 0)));
    expect([layer.extrusion[0], layer.extrusion[1]]).toEqual([DEFAULT_EXTRUSION, DEEP]);
    const edit = session.finish()!;
    applyEdit(doc, edit, 'undo');
    expect([layer.pixels[0], layer.extrusion[0], layer.pixels[1]]).toEqual([0, DEEP, 1]);
  });

  it('ignores extrusion differences on transparent pixels', () => {
    const doc = createDocument(2, 1, palette);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Move');
    session.setAll(new Uint8Array(2), Uint32Array.of(DEEP, DEEP));
    expect(session.finish()).toBeNull();
  });

  it('setCell sets both, and a transparent cell keeps the extrusion', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(layer, 'Side');
    session.setCell(1, 0, packCell(3, DEEP));
    session.setCell(0, 0, packCell(0, DEEP));
    expect([layer.pixels[1], layer.extrusion[1]]).toEqual([3, DEEP]);
    expect([layer.pixels[0], layer.extrusion[0]]).toEqual([0, DEFAULT_EXTRUSION]);
    session.revert();
    expect([layer.pixels[1], layer.pixels[0]]).toEqual([0, 1]);
  });

  it('pixelEditFromCells keeps only real changes', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const cells = new Map([
      [0, packCell(1, DEFAULT_EXTRUSION)], // unchanged
      [1, packCell(0, DEEP)], // transparent to transparent
      [2, packCell(2, DEEP)],
    ]);
    const edit = pixelEditFromCells(layer, 'Paste', cells)!;
    expect(Array.from(edit.offsets)).toEqual([2]);
    expect(Array.from(edit.after)).toEqual([2]);
    expect(Array.from(edit.extrusion!.after)).toEqual([DEEP]);
  });
});

describe('editedSide', () => {
  it('names the layer an edit changed and its side, or the side of a selection', () => {
    const doc = createDocument(2, 2, palette);
    const top = doc.layers.find((layer) => layer.facing === 'top')!;
    const stroke = beginPixelEdit(top, 'Pencil');
    stroke.setPixel(0, 0, 1);
    const pixels = stroke.finish()!;
    expect(editedSide(doc, pixels)).toEqual({ facing: 'top', layerId: top.id });
    const select = selectionEdit(doc, 'left', rectMask({ x: 0, y: 0, width: 1, height: 1 }), 'Select')!;
    expect(editedSide(doc, select)).toEqual({ facing: 'left' });
    // A float dropped first says less than the change after it.
    const drop: Edit = { kind: 'floating', label: 'Drop', before: { layerId: doc.layers[0].id, rect: { x: 0, y: 0, width: 1, height: 1 }, bits: null, pixels: new Uint8Array(1), extrusion: new Uint32Array(1), under: new Uint32Array(1) }, after: null };
    expect(editedSide(doc, combineEdits('Pencil', [drop, pixels])!)).toEqual({ facing: 'top', layerId: top.id });
    expect(editedSide(doc, drop)).toEqual({ facing: 'front' });
    expect(editedSide(doc, { kind: 'palette', label: 'Color', before: palette, after: palette })).toBeNull();
  });
});

describe('combineEdits', () => {
  const a: PixelEdit = { kind: 'pixels', label: 'a', layerId: 'x', offsets: new Uint32Array(), before: new Uint8Array(), after: new Uint8Array() };

  it('returns null, the single edit, or a batch', () => {
    expect(combineEdits('Move', [null, null])).toBeNull();
    expect(combineEdits('Move', [null, a])).toBe(a);
    expect(combineEdits('Move', [a, a])).toEqual({ kind: 'batch', label: 'Move', edits: [a, a] });
  });
});
