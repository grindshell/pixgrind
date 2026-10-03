import { describe, expect, it } from 'vitest';
import { applyEdit } from './edits.ts';
import { DEFAULT_EXTRUSION, packExtrusion } from './extrusion.ts';
import { setExtrusionEdit } from './extrusionEdits.ts';
import { createPalette } from './palette.ts';
import { createDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff]);
const DEEP = packExtrusion(1, 3);

describe('setExtrusionEdit', () => {
  it('extrudes painted pixels in the area, undoably', () => {
    const doc = createDocument(3, 1, palette);
    const [layer] = doc.layers;
    layer.pixels.set([1, 0, 1]);
    const area = { rect: { x: 1, y: 0, width: 2, height: 1 }, bits: null };
    const edit = setExtrusionEdit(doc, layer, area, DEEP)!;
    applyEdit(doc, edit, 'redo');
    expect(Array.from(layer.extrusion)).toEqual([DEFAULT_EXTRUSION, DEFAULT_EXTRUSION, DEEP]);
    applyEdit(doc, edit, 'undo');
    expect(layer.extrusion[2]).toBe(DEFAULT_EXTRUSION);
  });

  it('covers the whole layer without an area, follows the mask, and is null for no change', () => {
    const doc = createDocument(2, 2, palette);
    const [layer] = doc.layers;
    layer.pixels.fill(1);
    const diagonal = { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 0, 1) };
    applyEdit(doc, setExtrusionEdit(doc, layer, diagonal, DEEP)!, 'redo');
    expect(Array.from(layer.extrusion)).toEqual([DEEP, DEFAULT_EXTRUSION, DEFAULT_EXTRUSION, DEEP]);
    applyEdit(doc, setExtrusionEdit(doc, layer, null, DEEP)!, 'redo');
    expect(layer.extrusion.every((e) => e === DEEP)).toBe(true);
    expect(setExtrusionEdit(doc, layer, null, DEEP)).toBeNull();
  });
});
