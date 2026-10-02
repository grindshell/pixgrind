import { describe, expect, it } from 'vitest';
import { applyEdit, beginPixelEdit, combineEdits, pixelEditFromValues, type PixelEdit } from './edits.ts';
import { createPalette } from './palette.ts';
import { createDocument, getPixel, setPixel, type PixelDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff, 0x0000ffff]);

function docWithPixel(x: number, y: number, index: number): PixelDocument {
  const doc = createDocument(4, 4, palette);
  setPixel(doc, doc.layers[0], x, y, index);
  return doc;
}

describe('beginPixelEdit', () => {
  it('records offsets with before/after values in ascending order', () => {
    const doc = docWithPixel(1, 0, 3);
    const [layer] = doc.layers;
    const session = beginPixelEdit(doc, layer, 'Pencil');
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
    const session = beginPixelEdit(doc, doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(0, 0, 3);
    const edit = session.finish();
    expect(Array.from(edit!.before)).toEqual([1]);
    expect(Array.from(edit!.after)).toEqual([3]);
  });

  it('drops pixels painted back to their original value', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc, doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(0, 0, 1);
    session.setPixel(3, 3, 2);
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([15]);
  });

  it('returns null when nothing changed', () => {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc, doc.layers[0], 'Pencil');
    expect(session.setPixel(0, 0, 1)).toBe(false);
    expect(session.setPixel(-1, 0, 2)).toBe(false);
    expect(session.setPixel(4, 0, 2)).toBe(false);
    expect(session.finish()).toBeNull();
  });

  it('revert() restores originals and forgets them', () => {
    const doc = docWithPixel(0, 0, 1);
    const [layer] = doc.layers;
    const session = beginPixelEdit(doc, layer, 'Line');
    session.setPixel(0, 0, 2);
    session.setPixel(1, 0, 2);
    session.revert();
    expect([getPixel(doc, layer, 0, 0), getPixel(doc, layer, 1, 0)]).toEqual([1, 0]);
    session.setPixel(2, 0, 3);
    const edit = session.finish();
    expect(Array.from(edit!.offsets)).toEqual([2]);
    expect(Array.from(edit!.before)).toEqual([0]);
  });

  it('ignores writes outside the clip rectangle', () => {
    const doc = createDocument(4, 4, palette);
    const [layer] = doc.layers;
    const session = beginPixelEdit(doc, layer, 'Pencil', { x: 1, y: 1, width: 2, height: 2 });
    expect(session.setPixel(0, 0, 1)).toBe(false);
    expect(session.setPixel(3, 2, 1)).toBe(false);
    expect(session.setPixel(2, 2, 1)).toBe(true);
    expect(Array.from(session.finish()!.offsets)).toEqual([10]);
  });

  it('cannot be written to after finishing', () => {
    const doc = createDocument(2, 2, palette);
    const session = beginPixelEdit(doc, doc.layers[0], 'Pencil');
    session.finish();
    expect(() => session.setPixel(0, 0, 1)).toThrow();
  });
});

describe('applyEdit', () => {
  function paintedDoc(): { doc: PixelDocument; edit: PixelEdit } {
    const doc = docWithPixel(0, 0, 1);
    const session = beginPixelEdit(doc, doc.layers[0], 'Pencil');
    session.setPixel(0, 0, 2);
    session.setPixel(1, 1, 3);
    return { doc, edit: session.finish()! };
  }

  it('undo restores and redo reapplies', () => {
    const { doc, edit } = paintedDoc();
    const [layer] = doc.layers;
    applyEdit(doc, edit, 'undo');
    expect([getPixel(doc, layer, 0, 0), getPixel(doc, layer, 1, 1)]).toEqual([1, 0]);
    applyEdit(doc, edit, 'redo');
    expect([getPixel(doc, layer, 0, 0), getPixel(doc, layer, 1, 1)]).toEqual([2, 3]);
  });

  it('finds the layer by id, not position', () => {
    const { doc, edit } = paintedDoc();
    const painted = doc.layers[0];
    doc.layers.unshift({ ...painted, id: 'other', pixels: new Uint8Array(16) });
    applyEdit(doc, edit, 'undo');
    expect(getPixel(doc, painted, 0, 0)).toBe(1);
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

describe('combineEdits', () => {
  const a: PixelEdit = { kind: 'pixels', label: 'a', layerId: 'x', offsets: new Uint32Array(), before: new Uint8Array(), after: new Uint8Array() };

  it('returns null, the single edit, or a batch', () => {
    expect(combineEdits('Move', [null, null])).toBeNull();
    expect(combineEdits('Move', [null, a])).toBe(a);
    expect(combineEdits('Move', [a, a])).toEqual({ kind: 'batch', label: 'Move', edits: [a, a] });
  });
});
