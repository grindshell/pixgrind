import { combineEdits } from '../core/edits.ts';
import { rectMask } from '../core/mask.ts';
import { documentRect } from '../core/pixelDocument.ts';
import {
  clearSelectionEdit,
  deleteFloatingEdit,
  dropFloatingEdit,
  invertSelectionEdit,
  moveSelectionEdit,
  selectionEdit,
} from '../core/selection.ts';
import type { Editor } from './editor.ts';

/*
 * Editor commands that aren't pointer gestures, shared by keyboard shortcuts
 * and (later) menus. Each is one undoable edit, or nothing if it would change
 * nothing.
 */

/** Shown when `Editor.perform` refuses an edit because a gesture is in progress. */
export const BUSY_MESSAGE = 'Finish drawing first, then try again.';

export function selectAll(editor: Editor): void {
  editor.perform(selectionEdit(editor.doc, rectMask(documentRect(editor.doc)), 'Select all'));
}

/** Selects every unselected pixel instead, dropping a floating selection where it is. */
export function invertSelection(editor: Editor): void {
  editor.perform(invertSelectionEdit(editor.doc));
}

/** Deselects, dropping a floating selection where it is. */
export function deselect(editor: Editor): void {
  const { doc } = editor;
  editor.perform(combineEdits('Deselect', [dropFloatingEdit(doc, 'Deselect'), selectionEdit(doc, null, 'Deselect')]));
}

/** Drops a floating selection where it is, keeping the selection. */
export function dropFloating(editor: Editor): void {
  editor.perform(dropFloatingEdit(editor.doc));
}

/**
 * Deletes the selected pixels on the active layer: a floating selection's
 * pixels (uncovering what they were over), or else everything in the
 * selection. Does nothing without a selection or on a hidden layer.
 */
export function clearSelection(editor: Editor): void {
  const { doc, activeLayer } = editor;
  if (!activeLayer.visible) return;
  const floatsHere = doc.floating?.layerId === activeLayer.id;
  editor.perform(floatsHere ? deleteFloatingEdit(doc) : clearSelectionEdit(doc, activeLayer));
}

/**
 * Moves the selected pixels (or the whole active layer) by (dx, dy). Selected
 * pixels float, as with the Move tool. Does nothing on a hidden layer.
 */
export function nudge(editor: Editor, dx: number, dy: number): void {
  if (!editor.activeLayer.visible) return;
  editor.perform(moveSelectionEdit(editor.doc, editor.activeLayer, dx, dy, 'Nudge'));
}
