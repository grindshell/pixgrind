import type { Editor } from './editor.ts';
import { TOOLS } from './tools.ts';

/** Global keyboard shortcuts. Ctrl and Cmd are interchangeable. */
export function attachShortcuts(target: Window, editor: Editor): void {
  target.addEventListener('keydown', (e) => {
    if (isTextEntry(e.target) || e.altKey) return;

    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
        e.preventDefault();
        editor.redo();
      }
      return;
    }

    // Tool shortcuts are case-sensitive: "R" is Shift+R.
    const tool = TOOLS.find((t) => t.shortcut === e.key);
    if (tool && !e.repeat) {
      e.preventDefault();
      editor.setTool(tool.id);
    }
  });
}

/** Text fields keep their own keys. */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}
