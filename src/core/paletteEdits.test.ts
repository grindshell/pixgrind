import { describe, expect, it } from 'vitest';
import { compositeRgba } from './composite.ts';
import { applyEdit, type Edit } from './edits.ts';
import { History } from './history.ts';
import { createLayer } from './layer.ts';
import { createPalette, MAX_PALETTE_COLORS, type Palette } from './palette.ts';
import {
  addColorEdit,
  canRemoveColor,
  colorUsage,
  nearestColorIndex,
  remapToPaletteEdit,
  removeColorEdit,
  setColorEdit,
  swapPaletteEdit,
} from './paletteEdits.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const DARK_RED = 0x800000ff;
const LIGHT_BLUE = 0x8080ffff;

/** A 4×1 document with the given palette and pixel indices, plus an optional second layer. */
function docWith(colors: number[], pixels: number[], topPixels?: number[]): PixelDocument {
  const doc = createDocument(pixels.length, 1, createPalette('Original', colors));
  doc.layers[0].pixels.set(pixels);
  if (topPixels) {
    const top = createLayer(pixels.length, 1, 'Top');
    top.pixels.set(topPixels);
    doc.layers.push(top);
  }
  return doc;
}

function perform(doc: PixelDocument, history: History, edit: Edit | null): void {
  if (!edit) throw new Error('expected an edit');
  applyEdit(doc, edit, 'redo');
  history.push(edit);
}

const pixels = (doc: PixelDocument, layer = 0) => Array.from(doc.layers[layer].pixels);

describe('colorUsage and nearestColorIndex', () => {
  it('counts indices across all layers', () => {
    const doc = docWith([RED, GREEN], [1, 1, 0, 2], [2, 0, 0, 0]);
    const usage = colorUsage(doc);
    expect([usage[0], usage[1], usage[2]]).toEqual([4, 2, 2]);
  });

  it('finds the closest color, preferring the lower index on ties', () => {
    const palette = createPalette('p', [GREEN, BLUE, RED, RED]);
    expect(nearestColorIndex(palette, DARK_RED)).toBe(3);
    expect(nearestColorIndex(palette, LIGHT_BLUE)).toBe(2);
    expect(() => nearestColorIndex(createPalette('empty', []), RED)).toThrow();
  });
});

describe('editing colors', () => {
  it('changes one color, undo restores it', () => {
    const doc = docWith([RED, GREEN], [1, 2, 0, 0]);
    const history = new History();
    perform(doc, history, setColorEdit(doc, 2, BLUE));
    expect(doc.palette.colors).toEqual([RED, BLUE]);
    history.undo(doc);
    expect(doc.palette.colors).toEqual([RED, GREEN]);
  });

  it('records the pre-preview color as `before`', () => {
    const doc = docWith([RED, GREEN], [0, 0, 0, 0]);
    doc.palette.colors[0] = BLUE; // live preview already applied
    const edit = setColorEdit(doc, 1, BLUE, RED);
    expect(edit?.before.colors).toEqual([RED, GREEN]);
    expect(edit?.after.colors).toEqual([BLUE, GREEN]);
    expect(setColorEdit(doc, 1, BLUE)).toBeNull();
    expect(() => setColorEdit(doc, 3, RED)).toThrow(RangeError);
  });

  it('history snapshots are not affected by later in-place previews', () => {
    const doc = docWith([RED], [0, 0, 0, 0]);
    const history = new History();
    perform(doc, history, setColorEdit(doc, 1, GREEN));
    doc.palette.colors[0] = BLUE; // preview mutates the live palette
    history.undo(doc);
    history.redo(doc);
    expect(doc.palette.colors).toEqual([GREEN]);
  });

  it('adds colors up to the limit', () => {
    const doc = docWith([RED], [0, 0, 0, 0]);
    applyEdit(doc, addColorEdit(doc, GREEN)!, 'redo');
    expect(doc.palette.colors).toEqual([RED, GREEN]);
    doc.palette = createPalette('full', new Array<number>(MAX_PALETTE_COLORS).fill(RED));
    expect(() => addColorEdit(doc, GREEN)).toThrow(RangeError);
  });
});

describe('removing colors', () => {
  it('only allows unused colors, and never the last one', () => {
    const doc = docWith([RED, GREEN, BLUE], [1, 1, 3, 0]);
    expect(canRemoveColor(doc, 1)).toEqual({ ok: false, reason: 'Used by 2 pixels' });
    expect(canRemoveColor(doc, 2)).toEqual({ ok: true });
    expect(canRemoveColor(doc, 4)).toMatchObject({ ok: false });
    const single = docWith([RED], [0, 0, 0, 0]);
    expect(canRemoveColor(single, 1)).toEqual({ ok: false, reason: 'A palette needs at least one color' });
  });

  it('renumbers pixels above the removed index on every layer, as one undoable edit', () => {
    const doc = docWith([RED, GREEN, BLUE], [1, 3, 3, 0], [3, 0, 1, 0]);
    const history = new History();
    perform(doc, history, removeColorEdit(doc, 2));
    expect(doc.palette.colors).toEqual([RED, BLUE]);
    expect(pixels(doc, 0)).toEqual([1, 2, 2, 0]);
    expect(pixels(doc, 1)).toEqual([2, 0, 1, 0]);
    history.undo(doc);
    expect(doc.palette.colors).toEqual([RED, GREEN, BLUE]);
    expect(pixels(doc, 0)).toEqual([1, 3, 3, 0]);
    expect(pixels(doc, 1)).toEqual([3, 0, 1, 0]);
  });

  it('refuses to remove a used color', () => {
    const doc = docWith([RED, GREEN], [2, 0, 0, 0]);
    expect(() => removeColorEdit(doc, 2)).toThrow(/Used by 1 pixel$/);
  });
});

describe('palette swap (keep indices)', () => {
  it('only replaces the palette when the new one is long enough', () => {
    const doc = docWith([RED, GREEN], [1, 2, 0, 0]);
    const edit = swapPaletteEdit(doc, createPalette('Night', [BLUE, DARK_RED]));
    expect(edit?.kind).toBe('palette');
    applyEdit(doc, edit!, 'redo');
    expect(doc.palette).toEqual(createPalette('Night', [BLUE, DARK_RED]));
    expect(pixels(doc)).toEqual([1, 2, 0, 0]);
  });

  it('remaps used indices the new palette lacks to the nearest new color', () => {
    const doc = docWith([RED, GREEN, LIGHT_BLUE], [1, 2, 3, 0]);
    const history = new History();
    perform(doc, history, swapPaletteEdit(doc, createPalette('Short', [GREEN, BLUE])));
    expect(pixels(doc)).toEqual([1, 2, 2, 0]); // index 3 (light blue) → blue
    history.undo(doc);
    expect(pixels(doc)).toEqual([1, 2, 3, 0]);
    expect(doc.palette.name).toBe('Original');
  });

  it('turns indices that already had no color transparent, so nothing new appears', () => {
    const doc = docWith([RED], [1, 2, 0, 0]); // index 2 is invisible today
    applyEdit(doc, swapPaletteEdit(doc, createPalette('Two', [GREEN, BLUE]))!, 'redo');
    expect(pixels(doc)).toEqual([1, 0, 0, 0]);
  });

  it('is null when switching to an identical palette', () => {
    const doc = docWith([RED], [1, 0, 0, 0]);
    expect(swapPaletteEdit(doc, createPalette('Original', [RED]))).toBeNull();
  });
});

describe('remap to palette (match colors)', () => {
  function appearance(doc: PixelDocument): number[] {
    return Array.from(compositeRgba(doc));
  }

  it('keeps the image looking the same when the new palette is a reordering', () => {
    const doc = docWith([RED, GREEN, BLUE], [1, 2, 3, 0], [0, 3, 0, 1]);
    const before = appearance(doc);
    applyEdit(doc, remapToPaletteEdit(doc, createPalette('Reordered', [BLUE, RED, GREEN]))!, 'redo');
    expect(pixels(doc, 0)).toEqual([2, 3, 1, 0]);
    expect(pixels(doc, 1)).toEqual([0, 1, 0, 2]);
    expect(appearance(doc)).toEqual(before);
  });

  it('moves each pixel to the closest new color', () => {
    const doc = docWith([DARK_RED, LIGHT_BLUE], [1, 2, 0, 0]);
    const palette: Palette = createPalette('Primaries', [GREEN, BLUE, RED]);
    applyEdit(doc, remapToPaletteEdit(doc, palette)!, 'redo');
    expect(pixels(doc)).toEqual([3, 2, 0, 0]);
  });

  it('rejects an empty palette', () => {
    const doc = docWith([RED], [0, 0, 0, 0]);
    expect(() => remapToPaletteEdit(doc, createPalette('empty', []))).toThrow();
    expect(() => swapPaletteEdit(doc, createPalette('empty', []))).toThrow();
  });
});
