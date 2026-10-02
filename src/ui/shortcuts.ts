import { clearSelection, deselect, nudge, selectAll } from './commands.ts';
import type { Editor } from './editor.ts';
import { TOOLS } from './tools.ts';

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Pixels per arrow-key nudge with Shift held. */
const BIG_NUDGE = 10;

/** File commands owned by the File panel, which reports their results. */
export interface FileShortcuts {
  open(): void;
  save(): void;
}

/** Global keyboard shortcuts. Ctrl and Cmd are interchangeable. */
export function attachShortcuts(target: Window, editor: Editor, files: FileShortcuts): void {
  target.addEventListener('keydown', (e) => {
    if (e.altKey) return;
    const command = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // Open and save work from text fields too, instead of the browser's own open file/save page.
    if (command && !e.shiftKey && (key === 'o' || key === 's')) {
      e.preventDefault();
      if (e.repeat) return;
      if (key === 'o') files.open();
      else files.save();
      return;
    }

    if (isTextEntry(e.target)) return;

    if (command) {
      if (key === 'z' && !e.shiftKey) editor.undo();
      else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) editor.redo();
      else if (key === 'a' && !e.shiftKey) selectAll(editor);
      else if (key === 'd' && !e.shiftKey) deselect(editor);
      else return;
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      deselect(editor);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSelection(editor);
      return;
    }

    const arrow = ARROWS[e.key];
    if (arrow) {
      // Arrows nudge only with the Move tool, so they stay free for focused controls otherwise.
      if (editor.tool !== 'move') return;
      e.preventDefault();
      const step = e.shiftKey ? BIG_NUDGE : 1;
      nudge(editor, arrow[0] * step, arrow[1] * step);
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
