import { describe, expect, it } from 'vitest';
import { beginPixelEdit, type PixelEdit } from './edits.ts';
import { History } from './history.ts';
import { createPalette } from './palette.ts';
import { createDocument, getPixel, type PixelDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff]);

/** Paints (x, 0) with `index` as one edit, the way a stroke would. */
function paint(doc: PixelDocument, x: number, index: number): PixelEdit {
  const session = beginPixelEdit(doc, doc.layers[0], `paint ${x}`);
  session.setPixel(x, 0, index);
  const edit = session.finish();
  if (!edit) throw new Error('expected a change');
  return edit;
}

function row(doc: PixelDocument): number[] {
  return [0, 1, 2, 3].map((x) => getPixel(doc, doc.layers[0], x, 0));
}

describe('History', () => {
  it('undoes and redoes in order', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    history.push(paint(doc, 0, 1));
    history.push(paint(doc, 1, 2));
    expect(row(doc)).toEqual([1, 2, 0, 0]);

    expect(history.undo(doc)?.label).toBe('paint 1');
    expect(row(doc)).toEqual([1, 0, 0, 0]);
    expect(history.undo(doc)?.label).toBe('paint 0');
    expect(row(doc)).toEqual([0, 0, 0, 0]);
    expect(history.undo(doc)).toBeNull();

    expect(history.redo(doc)?.label).toBe('paint 0');
    expect(history.redo(doc)?.label).toBe('paint 1');
    expect(row(doc)).toEqual([1, 2, 0, 0]);
    expect(history.redo(doc)).toBeNull();
  });

  it('reports the next undo/redo', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    expect(history.nextUndo).toBeUndefined();
    expect(history.nextRedo).toBeUndefined();
    history.push(paint(doc, 0, 1));
    expect(history.nextUndo?.label).toBe('paint 0');
    history.undo(doc);
    expect(history.nextUndo).toBeUndefined();
    expect(history.nextRedo?.label).toBe('paint 0');
  });

  it('clears redo when a new edit is pushed', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    history.push(paint(doc, 0, 1));
    history.undo(doc);
    history.push(paint(doc, 1, 1));
    expect(history.nextRedo).toBeUndefined();
    expect(history.redo(doc)).toBeNull();
    expect(row(doc)).toEqual([0, 1, 0, 0]);
  });

  it('drops the oldest edits past the limit', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History(2);
    history.push(paint(doc, 0, 1));
    history.push(paint(doc, 1, 1));
    history.push(paint(doc, 2, 1));
    history.undo(doc);
    history.undo(doc);
    expect(history.undo(doc)).toBeNull();
    expect(row(doc)).toEqual([1, 0, 0, 0]);
  });

  it('leaves both stacks intact when an edit fails to apply', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    history.push(paint(doc, 0, 1));
    const layers = doc.layers;
    doc.layers = [];
    expect(() => history.undo(doc)).toThrow();
    expect(history.nextUndo?.label).toBe('paint 0');
    expect(history.nextRedo).toBeUndefined();
    doc.layers = layers;
    expect(history.undo(doc)?.label).toBe('paint 0');
  });

  it('clear() empties both stacks', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    history.push(paint(doc, 0, 1));
    history.push(paint(doc, 1, 1));
    history.undo(doc);
    history.clear();
    expect(history.nextUndo).toBeUndefined();
    expect(history.nextRedo).toBeUndefined();
  });

  it('reports the same position when undo/redo returns to a state', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History();
    const start = history.position;
    history.push(paint(doc, 0, 1));
    const saved = history.position;
    expect(saved).not.toBe(start);
    history.push(paint(doc, 1, 1));
    expect(history.position).not.toBe(saved);
    history.undo(doc);
    expect(history.position).toBe(saved);
    history.undo(doc);
    expect(history.position).toBe(start);
    history.redo(doc);
    expect(history.position).toBe(saved);
    // A different edit from the same state is a different position.
    history.undo(doc);
    history.push(paint(doc, 2, 1));
    expect(history.position).not.toBe(saved);
  });

  it('never reports the starting position once older edits were dropped', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History(1);
    const start = history.position;
    history.push(paint(doc, 0, 1));
    history.push(paint(doc, 1, 1));
    history.undo(doc);
    // Nothing left to undo, but the first edit is still applied.
    expect(history.nextUndo).toBeUndefined();
    expect(history.position).not.toBe(start);

    const beforeClear = history.position;
    history.clear();
    expect(history.position).not.toBe(beforeClear);
  });

  it('keeps the position of the state after a dropped edit', () => {
    const doc = createDocument(4, 1, palette);
    const history = new History(1);
    history.push(paint(doc, 0, 1));
    const saved = history.position;
    history.push(paint(doc, 1, 1));
    history.undo(doc);
    // Back to the state right after the dropped edit, e.g. where the document was saved.
    expect(history.position).toBe(saved);
  });

  it('rejects invalid limits', () => {
    expect(() => new History(0)).toThrow(RangeError);
    expect(() => new History(1.5)).toThrow(RangeError);
  });
});
