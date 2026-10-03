import { describe, expect, it } from 'vitest';
import { importImageLayerEdit, openImageEdit, replaceDocumentEdit, setDepthEdit } from './documentEdits.ts';
import { applyEdit, documentState, type DocumentEdit } from './edits.ts';
import { extrusionDepth, extrusionOffset, packExtrusion } from './extrusion.ts';
import { buildVoxelModel } from './model.ts';
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
  setPixel(doc.layers[0], 0, 0, 2);
  doc.layers.push(createLayer(4, 4, 'Top'));
  doc.selections.front = rectMask({ x: 1, y: 1, width: 2, height: 2 });
  return doc;
}

describe('openImageEdit', () => {
  it("in image mode, uses the image's size, name and exact colors", () => {
    const doc = existingDoc();
    applyEdit(doc, openImageEdit(doc, imageFrom(['gr.', 'rrb']), 'sprite', 'image'), 'redo');
    expect([doc.name, doc.width, doc.height]).toEqual(['sprite', 3, 2]);
    expect(doc.palette).toEqual(createPalette('sprite', [0x00ff00ff, 0xff0000ff, 0x0000ffff]));
    // The image on the front, an empty layer on every other side, as deep as it is wide.
    expect(doc.layers.map((l) => l.facing)).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
    expect(doc.depth).toBe(3);
    expect(Array.from(doc.layers[0].pixels)).toEqual([1, 2, 0, 2, 2, 3]);
    expect(doc.selections.front).toBeNull();
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
    const edit = importImageLayerEdit(doc, 'front', imageFrom(['rgb', '.rg', 'bbb']), 'pasted', 1);
    expect(edit.label).toBe('Add image as layer');
    applyEdit(doc, edit, 'redo');
    expect(doc.layers.slice(0, 2).map((l) => l.name)).toEqual(['Layer 1', 'pasted']);
    expect(Array.from(doc.layers[1].pixels)).toEqual([2, 3, 0, 2]);
  });

  it('leaves the rest of the layer transparent for smaller images', () => {
    const doc = createDocument(3, 2, palette);
    applyEdit(doc, importImageLayerEdit(doc, 'front', imageFrom(['g']), 'dot', 1), 'redo');
    expect(Array.from(doc.layers[1].pixels)).toEqual([3, 0, 0, 0, 0, 0]);
  });

  it('sizes the layer for its side', () => {
    // 3 wide, 2 tall, 4 deep: the left side is 4×2.
    const doc = createDocument(3, 2, palette, 'test', 4);
    const edit = importImageLayerEdit(doc, 'left', imageFrom(['rgbrg']), 'side', 0);
    expect([edit.layer.facing, edit.layer.width, edit.layer.height]).toEqual(['left', 4, 2]);
    expect(Array.from(edit.layer.pixels)).toEqual([2, 3, 1, 2, 0, 0, 0, 0]);
  });
});

describe('setDepthEdit', () => {
  /** A 2×1 document 3 deep with a pixel on the front (2 deep), back (1 deep, 1 out) and top (row 0, the back). */
  function deepDoc(): PixelDocument {
    const doc = createDocument(2, 1, palette, 'deep', 3);
    const side = (facing: string) => doc.layers.find((l) => l.facing === facing)!;
    setPixel(side('front'), 0, 0, 1);
    side('front').extrusion[0] = packExtrusion(0, 2);
    setPixel(side('back'), 1, 0, 2);
    side('back').extrusion[1] = packExtrusion(1, 1);
    setPixel(side('top'), 0, 0, 3);
    doc.selections.top = rectMask({ x: 0, y: 0, width: 1, height: 1 });
    doc.selections.front = rectMask({ x: 0, y: 0, width: 1, height: 1 });
    return doc;
  }

  it('grows at the front, keeping the model where it is', () => {
    const doc = deepDoc();
    const before = buildVoxelModel(doc).columns;
    applyEdit(doc, setDepthEdit(doc, 5)!, 'redo');
    expect(doc.depth).toBe(5);
    expect(doc.layers.find((l) => l.facing === 'top')!.height).toBe(5);
    // Every run is two further back from the new front.
    expect(buildVoxelModel(doc).columns).toEqual(before.map((runs) => runs?.map((run) => ({ ...run, start: run.start + 2, end: run.end + 2 }))));
    expect(doc.selections.top).toBeNull();
    expect(doc.selections.front).not.toBeNull();
  });

  it('shrinks at the front, cutting boxes short, and undoes', () => {
    const doc = deepDoc();
    const before = documentState(doc);
    const edit = setDepthEdit(doc, 1)!;
    applyEdit(doc, edit, 'redo');
    const [front, back] = doc.layers;
    expect(extrusionDepth(front.extrusion[0])).toBe(1);
    // The back's box was 1 out from the front: now it's cut to the one cell left.
    expect([extrusionOffset(back.extrusion[1]), extrusionDepth(back.extrusion[1])]).toEqual([0, 1]);
    applyEdit(doc, edit, 'undo');
    expect(documentState(doc)).toEqual(before);
    expect(setDepthEdit(doc, 3)).toBeNull();
    expect(() => setDepthEdit(doc, 0)).toThrow(RangeError);
  });
});
