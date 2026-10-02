import { el, textButton } from './dom.ts';
import type { Editor } from './editor.ts';

/** Undo/redo buttons, disabled when there is nothing to undo or redo. */
export function createHistoryControls(editor: Editor): HTMLElement {
  const group = el('div', 'toolbar');
  group.setAttribute('role', 'toolbar');
  group.setAttribute('aria-label', 'History');

  const undo = textButton('Undo', () => editor.undo());
  const redo = textButton('Redo', () => editor.redo());

  const render = () => {
    const { nextUndo, nextRedo } = editor.history;
    undo.disabled = !nextUndo;
    undo.title = nextUndo ? `Undo ${nextUndo.label} (Ctrl+Z)` : 'Nothing to undo';
    redo.disabled = !nextRedo;
    redo.title = nextRedo ? `Redo ${nextRedo.label} (Ctrl+Y)` : 'Nothing to redo';
  };

  editor.onChange(render);
  render();
  group.append(undo, redo);
  return group;
}
