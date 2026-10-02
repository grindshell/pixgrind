import { describe, expect, it } from 'vitest';
import { applyEdit, editSetsFloating, type Edit } from './edits.ts';
import { History } from './history.ts';
import { rectMask, type Mask } from './mask.ts';
import { createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';
import type { Rect } from './rect.ts';
import {
  clearSelectionEdit,
  deleteFloatingEdit,
  dropFloatingEdit,
  invertSelectionEdit,
  liftSelection,
  moveFloating,
  moveLayerEdit,
  moveSelectionEdit,
  selectionChange,
  selectionEdit,
  shiftedPixels,
} from './selection.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff, 0x0000ffff]);

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

describe('selection edits', () => {
  it('select, then undo/redo restores the previous selection', () => {
    const doc = createDocument(8, 8, palette);
    const history = new History();
    const selected = rectMask({ x: 1, y: 1, width: 3, height: 2 });
    perform(doc, history, selectionEdit(doc, selected, 'Select'));
    expect(doc.selection).toEqual(selected);
    perform(doc, history, selectionEdit(doc, null, 'Deselect'));
    expect(doc.selection).toBeNull();
    history.undo(doc);
    expect(doc.selection).toEqual(selected);
    history.undo(doc);
    expect(doc.selection).toBeNull();
  });

  it('clips to the document and returns null for no change', () => {
    const doc = createDocument(4, 4, palette);
    expect(selectionEdit(doc, rectMask({ x: 2, y: -1, width: 5, height: 3 }), 'Select')?.after).toEqual(
      rectMask({ x: 2, y: 0, width: 2, height: 2 }),
    );
    expect(selectionEdit(doc, null, 'Deselect')).toBeNull();
    const pixel = { x: 0, y: 0, width: 1, height: 1 };
    expect(selectionChange(rectMask(pixel), rectMask({ ...pixel }), 'x')).toBeNull();
    const diagonal = (): Mask => ({ rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 0, 1) });
    expect(selectionChange(diagonal(), diagonal(), 'x')).toBeNull();
  });
});

describe('invertSelectionEdit', () => {
  it('selects the rest of the document, undoably', () => {
    const doc = createDocument(3, 2, palette);
    const history = new History();
    doc.selection = rectMask({ x: 0, y: 0, width: 1, height: 2 });
    perform(doc, history, invertSelectionEdit(doc));
    expect(doc.selection).toEqual(rectMask({ x: 1, y: 0, width: 2, height: 2 }));
    history.undo(doc);
    expect(doc.selection).toEqual(rectMask({ x: 0, y: 0, width: 1, height: 2 }));
  });

  it('selects everything when nothing is selected, and deselects when everything is', () => {
    const doc = createDocument(3, 2, palette);
    expect(invertSelectionEdit(doc)?.after).toEqual(rectMask({ x: 0, y: 0, width: 3, height: 2 }));
    doc.selection = rectMask({ x: 0, y: 0, width: 3, height: 2 });
    expect(invertSelectionEdit(doc)?.after).toBeNull();
  });
});

describe('shiftedPixels', () => {
  const shifted = (source: string[], dx: number, dy: number, out?: Uint8Array): string[] => {
    const doc = docFrom(source);
    doc.layers[0].pixels.set(shiftedPixels(doc, doc.layers[0].pixels, dx, dy, out));
    return rows(doc);
  };

  it('moves the whole layer, transparent where nothing lands', () => {
    expect(shifted(['1200', '0300', '0000'], 2, 1)).toEqual(['0000', '0012', '0003']);
    expect(shifted(['1200', '0300', '0045'], -1, -1)).toEqual(['3000', '0450', '0000']);
    expect(shifted(['12', '34'], 0, 0)).toEqual(['12', '34']);
  });

  it('drops pixels moved off the document, and clears a reused buffer', () => {
    expect(shifted(['12'], 1, 0)).toEqual(['01']);
    expect(shifted(['12', '34'], 2, 0, Uint8Array.of(9, 9, 9, 9))).toEqual(['00', '00']);
    expect(shifted(['12', '34'], 0, -5)).toEqual(['00', '00']);
  });
});

describe('moveLayerEdit', () => {
  it('moves the whole layer as one undoable edit', () => {
    const doc = docFrom(['120']);
    const history = new History();
    perform(doc, history, moveLayerEdit(doc, doc.layers[0], 1, 0));
    expect(rows(doc)).toEqual(['012']);
    history.undo(doc);
    expect(rows(doc)).toEqual(['120']);
  });

  it('is null when nothing would change', () => {
    const doc = docFrom(['12']);
    expect(moveLayerEdit(doc, doc.layers[0], 0, 0)).toBeNull();
    const empty = createDocument(3, 3, palette);
    expect(moveLayerEdit(empty, empty.layers[0], 1, 1)).toBeNull();
  });
});

describe('floating selections', () => {
  /** Selects `area` and moves it by each step in turn, as separate history entries. */
  function moveSteps(doc: PixelDocument, history: History, area: Rect | Mask, steps: Array<[number, number]>): void {
    doc.selection = 'rect' in area ? area : rectMask(area);
    for (const [dx, dy] of steps) perform(doc, history, moveSelectionEdit(doc, doc.layers[0], dx, dy));
  }

  it('keeps pixels moved off the document until they come back', () => {
    const doc = docFrom(['0000', '0120', '0000']);
    const history = new History();
    moveSteps(doc, history, { x: 1, y: 1, width: 2, height: 1 }, [[2, 0]]);
    expect(rows(doc)).toEqual(['0000', '0001', '0000']);
    expect(doc.floating?.rect).toEqual({ x: 3, y: 1, width: 2, height: 1 });
    expect(doc.selection).toEqual(rectMask({ x: 3, y: 1, width: 1, height: 1 }));
    perform(doc, history, moveSelectionEdit(doc, doc.layers[0], -2, 0));
    expect(rows(doc)).toEqual(['0000', '0120', '0000']);
    expect(doc.selection).toEqual(rectMask({ x: 1, y: 1, width: 2, height: 1 }));
  });

  it('uncovers what it passed over, and transparent parts cover nothing', () => {
    const doc = docFrom(['1033']);
    const history = new History();
    moveSteps(doc, history, { x: 0, y: 0, width: 2, height: 1 }, [[2, 0]]);
    expect(rows(doc)).toEqual(['0013']);
    perform(doc, history, moveSelectionEdit(doc, doc.layers[0], -1, 0));
    expect(rows(doc)).toEqual(['0133']);
  });

  it('survives being moved entirely off the document', () => {
    const doc = docFrom(['12']);
    const history = new History();
    moveSteps(doc, history, { x: 0, y: 0, width: 2, height: 1 }, [[5, 0]]);
    expect(rows(doc)).toEqual(['00']);
    expect(doc.selection).toBeNull();
    perform(doc, history, moveSelectionEdit(doc, doc.layers[0], -5, 0));
    expect(rows(doc)).toEqual(['12']);
  });

  it('undoes each move, back to no float', () => {
    const doc = docFrom(['1200']);
    const history = new History();
    moveSteps(doc, history, { x: 0, y: 0, width: 2, height: 1 }, [[3, 0], [-1, 0]]);
    expect(rows(doc)).toEqual(['0012']);
    history.undo(doc);
    expect(rows(doc)).toEqual(['0001']);
    history.undo(doc);
    expect(rows(doc)).toEqual(['1200']);
    expect(doc.floating).toBeNull();
    expect(doc.selection).toEqual(rectMask({ x: 0, y: 0, width: 2, height: 1 }));
  });

  it('dropping keeps the pixels and forgets what they covered', () => {
    const doc = docFrom(['13']);
    const history = new History();
    moveSteps(doc, history, { x: 0, y: 0, width: 1, height: 1 }, [[1, 0]]);
    expect(rows(doc)).toEqual(['01']);
    const drop = dropFloatingEdit(doc);
    expect(drop?.kind).toBe('floating');
    perform(doc, history, drop);
    expect(rows(doc)).toEqual(['01']);
    expect(doc.floating).toBeNull();
    // Moving again lifts afresh: the covered 3 is gone.
    perform(doc, history, moveSelectionEdit(doc, doc.layers[0], -1, 0));
    expect(rows(doc)).toEqual(['10']);
  });

  it('deleting the float uncovers what was under it and keeps the selection', () => {
    const doc = docFrom(['13']);
    const history = new History();
    moveSteps(doc, history, { x: 0, y: 0, width: 1, height: 1 }, [[1, 0]]);
    perform(doc, history, deleteFloatingEdit(doc));
    expect(rows(doc)).toEqual(['03']);
    expect(doc.floating).toBeNull();
    expect(doc.selection).toEqual(rectMask({ x: 1, y: 0, width: 1, height: 1 }));
    history.undo(doc);
    expect(rows(doc)).toEqual(['01']);
    expect(doc.floating).not.toBeNull();
  });

  it('lifting changes no pixels', () => {
    const doc = docFrom(['12', '30']);
    doc.selection = rectMask({ x: 0, y: 0, width: 2, height: 2 });
    const floating = liftSelection(doc, doc.layers[0]);
    expect(Array.from(floating!.pixels)).toEqual([1, 2, 3, 0]);
    const { values } = moveFloating(doc, doc.layers[0], floating!, 0, 0);
    for (const [offset, value] of values) expect(doc.layers[0].pixels[offset]).toBe(value);
  });

  it('moves only the pixels in a non-rectangular selection, with its shape', () => {
    const doc = docFrom([
      '120',
      '310',
      '000',
    ]);
    const history = new History();
    // An L: everything in the top-left 2×2 except the 2.
    const shape: Mask = { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 1, 1) };
    moveSteps(doc, history, shape, [[1, 1]]);
    expect(rows(doc)).toEqual([
      '020',
      '010',
      '031',
    ]);
    expect(doc.selection).toEqual({ rect: { x: 1, y: 1, width: 2, height: 2 }, bits: shape.bits });
    history.undo(doc);
    expect(rows(doc)).toEqual(['120', '310', '000']);
  });

  it('clips a non-rectangular selection moved partly off the document, and normalizes it', () => {
    const doc = docFrom(['10', '01']);
    const history = new History();
    moveSteps(doc, history, { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(1, 0, 0, 1) }, [[1, 0]]);
    // Only the top-left pixel is still on the document: a plain 1×1 rectangle.
    expect(doc.selection).toEqual(rectMask({ x: 1, y: 0, width: 1, height: 1 }));
    expect(rows(doc)).toEqual(['01', '00']);
  });

  it('falls back to moving the whole layer without a selection', () => {
    const doc = docFrom(['120']);
    applyEdit(doc, moveSelectionEdit(doc, doc.layers[0], 1, 0)!, 'redo');
    expect(rows(doc)).toEqual(['012']);
    expect(doc.floating).toBeNull();
  });

  it('marks which edits manage the float themselves', () => {
    const doc = docFrom(['12']);
    doc.selection = rectMask({ x: 0, y: 0, width: 1, height: 1 });
    expect(editSetsFloating(moveSelectionEdit(doc, doc.layers[0], 1, 0)!)).toBe(true);
    expect(editSetsFloating(clearSelectionEdit(doc, doc.layers[0])!)).toBe(false);
  });
});

describe('clearSelectionEdit', () => {
  it('clears only selected pixels', () => {
    const doc = docFrom(['123', '123']);
    doc.selection = rectMask({ x: 1, y: 0, width: 2, height: 1 });
    applyEdit(doc, clearSelectionEdit(doc, doc.layers[0])!, 'redo');
    expect(rows(doc)).toEqual(['100', '123']);

    const masked = docFrom(['12', '31']);
    masked.selection = { rect: { x: 0, y: 0, width: 2, height: 2 }, bits: Uint8Array.of(0, 1, 1, 0) };
    applyEdit(masked, clearSelectionEdit(masked, masked.layers[0])!, 'redo');
    expect(rows(masked)).toEqual(['10', '01']);
  });

  it('is null without a selection or when already clear', () => {
    const doc = docFrom(['100']);
    expect(clearSelectionEdit(doc, doc.layers[0])).toBeNull();
    doc.selection = rectMask({ x: 1, y: 0, width: 2, height: 1 });
    expect(clearSelectionEdit(doc, doc.layers[0])).toBeNull();
  });
});
