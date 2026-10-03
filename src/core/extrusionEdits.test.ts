import { describe, expect, it } from 'vitest';
import { applyEdit } from './edits.ts';
import { CUT_TOP_LEFT, DEFAULT_EXTRUSION, extrusionShape, packExtrusion, withShape } from './extrusion.ts';
import { updateExtrusionsEdit } from './extrusionEdits.ts';
import { createPalette } from './palette.ts';
import { createDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff]);
const DEEP = packExtrusion(1, 3);
const deep = () => DEEP;

describe('updateExtrusionsEdit', () => {
  it('extrudes painted pixels in the area, undoably', () => {
    const doc = createDocument(3, 1, palette);
    const [layer] = doc.layers;
    layer.pixels.set([1, 0, 1]);
    const area = { rect: { x: 1, y: 0, width: 2, height: 1 }, bits: null };
    const edit = updateExtrusionsEdit(doc, layer, area, deep)!;
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
    applyEdit(doc, updateExtrusionsEdit(doc, layer, diagonal, deep)!, 'redo');
    expect(Array.from(layer.extrusion)).toEqual([DEEP, DEFAULT_EXTRUSION, DEFAULT_EXTRUSION, DEEP]);
    applyEdit(doc, updateExtrusionsEdit(doc, layer, null, deep)!, 'redo');
    expect(layer.extrusion.every((e) => e === DEEP)).toBe(true);
    expect(updateExtrusionsEdit(doc, layer, null, deep)).toBeNull();
  });

  it('passes each pixel its extrusion and position', () => {
    const doc = createDocument(2, 1, palette);
    const [layer] = doc.layers;
    layer.pixels.fill(1);
    layer.extrusion[1] = DEEP;
    const edit = updateExtrusionsEdit(doc, layer, null, (e, x) => (x === 1 ? withShape(e, CUT_TOP_LEFT) : e))!;
    applyEdit(doc, edit, 'redo');
    expect(Array.from(layer.extrusion)).toEqual([DEFAULT_EXTRUSION, withShape(DEEP, CUT_TOP_LEFT)]);
    expect(extrusionShape(layer.extrusion[1])).toBe(CUT_TOP_LEFT);
  });
});
