import { describe, expect, it } from 'vitest';
import {
  clipFromImage,
  clipImage,
  clipIndices,
  clipMatchesImage,
  copyPixels,
  cutEdit,
  pasteEdit,
  pasteRect,
  type PixelClip,
} from './clipboard.ts';
import { applyEdit, type Edit } from './edits.ts';
import { History } from './history.ts';
import { rectMask } from './mask.ts';
import { createPalette } from './palette.ts';
import { createDocument, MAX_DOCUMENT_SIZE, type PixelDocument } from './pixelDocument.ts';
import { moveSelectionEdit } from './selection.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const BLUE = 0x0000ffff;
const palette = createPalette('test', [RED, GREEN, BLUE]);

/** A one-layer document from rows of digits (palette indices). */
function docFrom(rows: string[]): PixelDocument {
  const doc = createDocument(rows[0].length, rows.length, palette);
  doc.layers[0].pixels.set(rows.join('').split('').map(Number));
  return doc;
}

function rows(doc: PixelDocument): string[] {
  const cells = Array.from(doc.layers[0].pixels).join('');
  return Array.from({ length: doc.height }, (_, y) => cells.slice(y * doc.width, (y + 1) * doc.width));
}

function perform(doc: PixelDocument, history: History, edit: Edit | null): void {
  if (!edit) throw new Error('expected an edit');
  applyEdit(doc, edit, 'redo');
  history.push(edit);
}

describe('copyPixels', () => {
  it('copies the selection, or the whole layer without one', () => {
    const doc = docFrom(['120', '303']);
    doc.selection = rectMask({ x: 1, y: 0, width: 2, height: 2 });
    const clip = copyPixels(doc, doc.layers[0]);
    expect(clip.rect).toEqual({ x: 1, y: 0, width: 2, height: 2 });
    expect(Array.from(clip.pixels)).toEqual([2, 0, 0, 3]);
    expect(clip.colors).toEqual([RED, GREEN, BLUE]);
    doc.selection = null;
    expect(copyPixels(doc, doc.layers[0]).pixels).toHaveLength(6);
  });

  it('copies only the pixels in a non-rectangular selection, keeping its shape', () => {
    const doc = docFrom(['12', '31']);
    doc.selection = { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 1, 1) };
    const clip = copyPixels(doc, doc.layers[0]);
    expect(Array.from(clip.pixels)).toEqual([1, 0, 3, 1]);
    expect(clip.bits).toBe(doc.selection.bits);
    // Cut clears just those pixels; pasting back floats the same shape.
    applyEdit(doc, cutEdit(doc, doc.layers[0])!, 'redo');
    expect(rows(doc)).toEqual(['02', '00']);
    applyEdit(doc, pasteEdit(doc, doc.layers[0], clip)!, 'redo');
    expect(rows(doc)).toEqual(['12', '31']);
    expect(doc.floating?.bits).toBe(clip.bits);
    expect(doc.selection).toEqual({ rect: { x: 0, y: 0, width: 2, height: 2 }, bits: clip.bits });
  });

  it('copies a float whole, including pixels off the document', () => {
    const doc = docFrom(['12']);
    doc.selection = rectMask({ x: 0, y: 0, width: 2, height: 1 });
    applyEdit(doc, moveSelectionEdit(doc, doc.layers[0], 1, 0)!, 'redo');
    const clip = copyPixels(doc, doc.layers[0]);
    expect(clip.rect).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(Array.from(clip.pixels)).toEqual([1, 2]);
  });
});

describe('cutEdit', () => {
  it('clears the selection, or deletes a float', () => {
    const doc = docFrom(['123']);
    doc.selection = rectMask({ x: 0, y: 0, width: 2, height: 1 });
    applyEdit(doc, cutEdit(doc, doc.layers[0])!, 'redo');
    expect(rows(doc)).toEqual(['003']);

    const floated = docFrom(['13']);
    floated.selection = rectMask({ x: 0, y: 0, width: 1, height: 1 });
    applyEdit(floated, moveSelectionEdit(floated, floated.layers[0], 1, 0)!, 'redo');
    const cut = cutEdit(floated, floated.layers[0])!;
    expect(cut.label).toBe('Cut');
    applyEdit(floated, cut, 'redo');
    expect(rows(floated)).toEqual(['03']);
    expect(floated.floating).toBeNull();
  });
});

describe('pasteEdit', () => {
  it('pastes as a float where it was copied from, ready to move', () => {
    const doc = docFrom(['1200', '0000']);
    const history = new History();
    doc.selection = rectMask({ x: 0, y: 0, width: 2, height: 1 });
    const clip = copyPixels(doc, doc.layers[0]);
    doc.selection = null;
    perform(doc, history, pasteEdit(doc, doc.layers[0], clip));
    expect(doc.floating?.rect).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(doc.selection).toEqual(rectMask({ x: 0, y: 0, width: 2, height: 1 }));
    // Moving it uncovers the original pixels underneath: the paste covered them.
    perform(doc, history, moveSelectionEdit(doc, doc.layers[0], 1, 1));
    expect(rows(doc)).toEqual(['1200', '0120']);
    history.undo(doc);
    history.undo(doc);
    expect(rows(doc)).toEqual(['1200', '0000']);
    expect(doc.floating).toBeNull();
    expect(doc.selection).toBeNull();
  });

  it("transparent parts don't cover what's under them", () => {
    const doc = docFrom(['33', '00']);
    const clip: PixelClip = { rect: { x: 0, y: 0, width: 2, height: 1 }, bits: null, pixels: Uint8Array.of(1, 0), colors: palette.colors };
    applyEdit(doc, pasteEdit(doc, doc.layers[0], clip)!, 'redo');
    expect(rows(doc)).toEqual(['13', '00']);
  });

  it('centers clips that would not fit where they came from', () => {
    const doc = docFrom(['0000', '0000', '0000']);
    const clip: PixelClip = { rect: { x: 3, y: 2, width: 2, height: 1 }, bits: null, pixels: Uint8Array.of(1, 2), colors: palette.colors };
    expect(pasteRect(doc, clip)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    // Bigger than the document: centered, hanging off both sides.
    const big: PixelClip = { rect: { x: 0, y: 0, width: 6, height: 1 }, bits: null, pixels: new Uint8Array(6), colors: palette.colors };
    expect(pasteRect(doc, big)).toEqual({ x: -1, y: 1, width: 6, height: 1 });
  });
});

describe('clipIndices', () => {
  it('keeps indices whose color is unchanged and maps the rest to the nearest color', () => {
    const clip: PixelClip = { rect: { x: 0, y: 0, width: 4, height: 1 }, bits: null, pixels: Uint8Array.of(0, 1, 2, 3), colors: [RED, GREEN, BLUE] };
    // Same palette: unchanged.
    expect(Array.from(clipIndices(clip, palette))).toEqual([0, 1, 2, 3]);
    // Reordered palette: follows the colors.
    expect(Array.from(clipIndices(clip, createPalette('x', [BLUE, RED, GREEN])))).toEqual([0, 2, 3, 1]);
  });

  it('turns indices that had no color into transparent', () => {
    const clip: PixelClip = { rect: { x: 0, y: 0, width: 1, height: 1 }, bits: null, pixels: Uint8Array.of(9), colors: [RED] };
    expect(Array.from(clipIndices(clip, palette))).toEqual([0]);
  });
});

describe('clip images', () => {
  it('renders a clip in its own colors and reads images back in palette colors', () => {
    const clip: PixelClip = { rect: { x: 0, y: 0, width: 2, height: 1 }, bits: null, pixels: Uint8Array.of(2, 0), colors: [RED, GREEN] };
    const image = clipImage(clip);
    expect(Array.from(image.data)).toEqual([0, 255, 0, 255, 0, 0, 0, 0]);
    const doc = docFrom(['0000']);
    const back = clipFromImage(image, doc);
    expect(Array.from(back.pixels)).toEqual([2, 0]);
    expect(back.rect).toEqual({ x: 1, y: 0, width: 2, height: 1 });
  });

  it('matches its own image after a lossy round trip, but not other images', () => {
    const HALF_RED = 0xff000080;
    const clip: PixelClip = {
      rect: { x: 0, y: 0, width: 3, height: 1 },
      bits: null,
      pixels: Uint8Array.of(1, 2, 0),
      colors: [GREEN, HALF_RED],
    };
    const exact = clipImage(clip);
    expect(clipMatchesImage(clip, exact)).toBe(true);
    // Premultiplied rounding nudges translucent colors.
    const rounded = { ...exact, data: Uint8ClampedArray.of(0, 255, 0, 255, 253, 2, 1, 128, 0, 0, 0, 0) };
    expect(clipMatchesImage(clip, rounded)).toBe(true);
    // Opaque colors must be exact, and alpha always.
    const recolored = { ...exact, data: Uint8ClampedArray.of(0, 254, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0) };
    expect(clipMatchesImage(clip, recolored)).toBe(false);
    const realpha = { ...exact, data: Uint8ClampedArray.of(0, 255, 0, 255, 255, 0, 0, 127, 0, 0, 0, 0) };
    expect(clipMatchesImage(clip, realpha)).toBe(false);
    expect(clipMatchesImage(clip, { width: 1, height: 3, data: exact.data })).toBe(false);
  });

  it('refuses images too large to paste', () => {
    const doc = docFrom(['0']);
    const huge = { width: MAX_DOCUMENT_SIZE + 1, height: 1, data: new Uint8ClampedArray((MAX_DOCUMENT_SIZE + 1) * 4) };
    expect(() => clipFromImage(huge, doc)).toThrow(/too large to paste/);
  });
});
