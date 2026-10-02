import { describe, expect, it } from 'vitest';
import { importImageLayerEdit, openImageEdit, replaceDocumentEdit } from './documentEdits.ts';
import { applyEdit, documentState, type DocumentEdit } from './edits.ts';
import { History } from './history.ts';
import type { RgbaImage } from './image.ts';
import { createLayer } from './layer.ts';
import { rectMask } from './mask.ts';
import { createPalette } from './palette.ts';
import { createDocument, MAX_DOCUMENT_SIZE, setPixel, type PixelDocument } from './pixelDocument.ts';

const palette = createPalette('Current', [0x000000ff, 0xff0000ff, 0x00ff00ff]);

/** An image from rows of letters: r = red, g = green, b = blue, . = transparent. */
function imageFrom(rows: string[]): RgbaImage {
  const colors: Record<string, number[]> = { r: [255, 0, 0, 255], g: [0, 255, 0, 255], b: [0, 0, 255, 255], '.': [0, 0, 0, 0] };
  return {
    width: rows[0].length,
    height: rows.length,
    data: new Uint8ClampedArray(rows.join('').split('').flatMap((c) => colors[c])),
  };
}

function existingDoc(): PixelDocument {
  const doc = createDocument(4, 4, palette, 'Old');
  setPixel(doc, doc.layers[0], 0, 0, 2);
  doc.layers.push(createLayer(4, 4, 'Top'));
  doc.selection = rectMask({ x: 1, y: 1, width: 2, height: 2 });
  return doc;
}

describe('openImageEdit', () => {
  it("in image mode, uses the image's size, name and exact colors", () => {
    const doc = existingDoc();
    applyEdit(doc, openImageEdit(doc, imageFrom(['gr.', 'rrb']), 'sprite', 'image'), 'redo');
    expect([doc.name, doc.width, doc.height]).toEqual(['sprite', 3, 2]);
    expect(doc.palette).toEqual(createPalette('sprite', [0x00ff00ff, 0xff0000ff, 0x0000ffff]));
    expect(doc.layers).toHaveLength(1);
    expect(Array.from(doc.layers[0].pixels)).toEqual([1, 2, 0, 2, 2, 3]);
    expect(doc.selection).toBeNull();
  });

  it('in palette mode, maps to the nearest current colors and keeps the palette', () => {
    const doc = existingDoc();
    applyEdit(doc, openImageEdit(doc, imageFrom(['rgb.']), 'photo', 'palette'), 'redo');
    expect(doc.palette.colors).toEqual(palette.colors);
    expect(Array.from(doc.layers[0].pixels)).toEqual([2, 3, 1, 0]); // blue → black (nearest)
  });

  it('is fully undoable, restoring layers, palette, name and selection', () => {
    const doc = existingDoc();
    const before = documentState(doc);
    const history = new History();
    const edit = openImageEdit(doc, imageFrom(['rg']), 'new', 'image');
    applyEdit(doc, edit, 'redo');
    history.push(edit);
    history.undo(doc);
    expect(documentState(doc)).toEqual(before);
    expect(doc.layers[0].pixels[0]).toBe(2);
    history.redo(doc);
    expect([doc.width, doc.height]).toEqual([2, 1]);
  });

  it('keeps the current palette for a fully transparent image', () => {
    const doc = existingDoc();
    applyEdit(doc, openImageEdit(doc, imageFrom(['..']), 'empty', 'image'), 'redo');
    expect(doc.palette.colors).toEqual(palette.colors);
  });

  it('rejects images with too many colors or too large', () => {
    const doc = existingDoc();
    const many: RgbaImage = {
      width: 256,
      height: 1,
      data: new Uint8ClampedArray(Array.from({ length: 256 }, (_, i) => [i, 0, 0, 255]).flat()),
    };
    expect(() => openImageEdit(doc, many, 'x', 'image')).toThrow(/256 colors/);
    expect(() => openImageEdit(doc, many, 'x', 'palette')).not.toThrow();
    const huge: RgbaImage = { width: MAX_DOCUMENT_SIZE + 1, height: 1, data: new Uint8ClampedArray((MAX_DOCUMENT_SIZE + 1) * 4) };
    expect(() => openImageEdit(doc, huge, 'x', 'palette')).toThrow(/too large/);
  });

  it('reports a large many-colored image as too large, not as having too many colors', () => {
    const doc = existingDoc();
    const width = MAX_DOCUMENT_SIZE + 1;
    const photo: RgbaImage = {
      width,
      height: 1,
      data: new Uint8ClampedArray(Array.from({ length: width }, (_, i) => [i % 256, i >> 8, 0, 255]).flat()),
    };
    expect(() => openImageEdit(doc, photo, 'x', 'image')).toThrow(/too large/);
  });

  it('refuses to apply a document state whose layers do not match its size', () => {
    const doc = existingDoc();
    const edit: DocumentEdit = openImageEdit(doc, imageFrom(['rg']), 'x', 'image');
    edit.after.width = 5;
    expect(() => applyEdit(doc, edit, 'redo')).toThrow(/layer size/);
    expect(doc.name).toBe('Old');
  });
});

describe('replaceDocumentEdit', () => {
  it('swaps in another document and back', () => {
    const doc = existingDoc();
    const before = documentState(doc);
    const next = createDocument(2, 3, createPalette('Other', [0x123456ff]), 'project');
    next.layers.push(createLayer(2, 3, 'Second'));
    const edit = replaceDocumentEdit(doc, next, 'Open project');
    expect(edit.label).toBe('Open project');

    applyEdit(doc, edit, 'redo');
    expect([doc.name, doc.width, doc.height, doc.palette.name]).toEqual(['project', 2, 3, 'Other']);
    expect(doc.layers).toEqual(next.layers);
    applyEdit(doc, edit, 'undo');
    expect(documentState(doc)).toEqual(before);
  });
});

describe('importImageLayerEdit', () => {
  it('adds a palette-mapped layer at the top-left, cropped to the document', () => {
    const doc = createDocument(2, 2, palette);
    const edit = importImageLayerEdit(doc, imageFrom(['rgb', '.rg', 'bbb']), 'pasted', 1);
    expect(edit.label).toBe('Add image as layer');
    applyEdit(doc, edit, 'redo');
    expect(doc.layers.map((l) => l.name)).toEqual(['Layer 1', 'pasted']);
    expect(Array.from(doc.layers[1].pixels)).toEqual([2, 3, 0, 2]);
  });

  it('leaves the rest of the layer transparent for smaller images', () => {
    const doc = createDocument(3, 2, palette);
    applyEdit(doc, importImageLayerEdit(doc, imageFrom(['g']), 'dot', 1), 'redo');
    expect(Array.from(doc.layers[1].pixels)).toEqual([3, 0, 0, 0, 0, 0]);
  });
});
