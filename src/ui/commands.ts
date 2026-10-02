import { documentRect } from '../core/pixelDocument.ts';
import { clearSelectionEdit, moveEdit, selectionEdit } from '../core/selection.ts';
import type { Editor } from './editor.ts';

/*
 * Editor commands that aren't pointer gestures, shared by keyboard shortcuts
 * and (later) menus. Each is one undoable edit, or nothing if it would change
 * nothing.
 */

export function selectAll(editor: Editor): void {
  editor.perform(selectionEdit(editor.doc, documentRect(editor.doc), 'Select all'));
}

export function deselect(editor: Editor): void {
  editor.perform(selectionEdit(editor.doc, null, 'Deselect'));
}

/** Clears the selected pixels on the active layer. Does nothing without a selection or on a hidden layer. */
export function clearSelection(editor: Editor): void {
  if (!editor.activeLayer.visible) return;
  editor.perform(clearSelectionEdit(editor.doc, editor.activeLayer));
}

/** Moves the selected pixels (or the whole active layer) by (dx, dy). Does nothing on a hidden layer. */
export function nudge(editor: Editor, dx: number, dy: number): void {
  if (!editor.activeLayer.visible) return;
  editor.perform(moveEdit(editor.doc, editor.activeLayer, dx, dy, 'Nudge'));
}
