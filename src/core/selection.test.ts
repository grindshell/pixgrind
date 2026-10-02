import { describe, expect, it } from 'vitest';
import { applyEdit, type Edit } from './edits.ts';
import { History } from './history.ts';
import { createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';
import { clearSelectionEdit, movedPixels, moveEdit, selectionChange, selectionEdit } from './selection.ts';

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
    perform(doc, history, selectionEdit(doc, { x: 1, y: 1, width: 3, height: 2 }, 'Select'));
    expect(doc.selection).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    perform(doc, history, selectionEdit(doc, null, 'Deselect'));
    expect(doc.selection).toBeNull();
    history.undo(doc);
    expect(doc.selection).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    history.undo(doc);
    expect(doc.selection).toBeNull();
  });

  it('clips to the document and returns null for no change', () => {
    const doc = createDocument(4, 4, palette);
    expect(selectionEdit(doc, { x: 2, y: -1, width: 5, height: 3 }, 'Select')?.after).toEqual({ x: 2, y: 0, width: 2, height: 2 });
    expect(selectionEdit(doc, null, 'Deselect')).toBeNull();
    expect(selectionChange({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }, 'x')).toBeNull();
  });
});

describe('movedPixels', () => {
  it('clears the source and stamps only non-transparent pixels', () => {
    const doc = docFrom([
      '1200',
      '0333',
      '0000',
    ]);
    const values = movedPixels(doc, doc.layers[0], { x: 0, y: 0, width: 2, height: 1 }, 2, 1);
    for (const [offset, value] of values) doc.layers[0].pixels[offset] = value;
    // (0,0)=1 → (2,1), (1,0)=2 → (3,1). Source cleared.
    expect(rows(doc)).toEqual([
      '0000',
      '0312',
      '0000',
    ]);
  });

  it('keeps what is under transparent parts of the moved area', () => {
    const doc = docFrom([
      '10',
      '03',
    ]);
    const values = movedPixels(doc, doc.layers[0], { x: 0, y: 0, width: 2, height: 1 }, 0, 1);
    for (const [offset, value] of values) doc.layers[0].pixels[offset] = value;
    expect(rows(doc)).toEqual([
      '00',
      '13',
    ]);
  });

  it('drops pixels moved off the document, and is empty for a zero move', () => {
    const doc = docFrom(['12']);
    expect(movedPixels(doc, doc.layers[0], { x: 0, y: 0, width: 2, height: 1 }, 0, 0).size).toBe(0);
    const values = movedPixels(doc, doc.layers[0], { x: 0, y: 0, width: 2, height: 1 }, 1, 0);
    for (const [offset, value] of values) doc.layers[0].pixels[offset] = value;
    expect(rows(doc)).toEqual(['01']);
  });
});

describe('moveEdit', () => {
  it('moves the selection contents and the selection as one undoable edit', () => {
    const doc = docFrom([
      '1100',
      '1100',
      '0000',
    ]);
    doc.selection = { x: 0, y: 0, width: 2, height: 2 };
    const history = new History();
    perform(doc, history, moveEdit(doc, doc.layers[0], 1, 1));
    expect(rows(doc)).toEqual([
      '0000',
      '0110',
      '0110',
    ]);
    expect(doc.selection).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    history.undo(doc);
    expect(rows(doc)).toEqual([
      '1100',
      '1100',
      '0000',
    ]);
    expect(doc.selection).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('moves the whole layer when nothing is selected', () => {
    const doc = docFrom(['120']);
    applyEdit(doc, moveEdit(doc, doc.layers[0], 1, 0)!, 'redo');
    expect(rows(doc)).toEqual(['012']);
    expect(doc.selection).toBeNull();
  });

  it('clips the selection when moved partly off the document', () => {
    const doc = docFrom(['11', '11']);
    doc.selection = { x: 0, y: 0, width: 2, height: 2 };
    applyEdit(doc, moveEdit(doc, doc.layers[0], 1, 0)!, 'redo');
    expect(doc.selection).toEqual({ x: 1, y: 0, width: 1, height: 2 });
    expect(rows(doc)).toEqual(['01', '01']);
  });

  it('moves only the selection when the selected pixels are all transparent', () => {
    const doc = createDocument(4, 4, palette);
    doc.selection = { x: 0, y: 0, width: 2, height: 2 };
    const edit = moveEdit(doc, doc.layers[0], 1, 0);
    expect(edit?.kind).toBe('selection');
  });

  it('is null for a zero move', () => {
    const doc = docFrom(['12']);
    expect(moveEdit(doc, doc.layers[0], 0, 0)).toBeNull();
  });
});

describe('clearSelectionEdit', () => {
  it('clears only selected pixels', () => {
    const doc = docFrom(['123', '123']);
    doc.selection = { x: 1, y: 0, width: 2, height: 1 };
    applyEdit(doc, clearSelectionEdit(doc, doc.layers[0])!, 'redo');
    expect(rows(doc)).toEqual(['100', '123']);
  });

  it('is null without a selection or when already clear', () => {
    const doc = docFrom(['100']);
    expect(clearSelectionEdit(doc, doc.layers[0])).toBeNull();
    doc.selection = { x: 1, y: 0, width: 2, height: 1 };
    expect(clearSelectionEdit(doc, doc.layers[0])).toBeNull();
  });
});
