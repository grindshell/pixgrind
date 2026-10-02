import type { Editor } from './editor.ts';

/** Global keyboard shortcuts. Ctrl and Cmd are interchangeable. */
export function attachShortcuts(target: Window, editor: Editor): void {
  target.addEventListener('keydown', (e) => {
    if (isTextEntry(e.target)) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      editor.undo();
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
      e.preventDefault();
      editor.redo();
    }
  });
}

/** Text fields keep their own undo/redo. */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}
