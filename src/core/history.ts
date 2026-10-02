import { applyEdit, type Edit, type EditDirection } from './edits.ts';
import type { PixelDocument } from './pixelDocument.ts';

export const DEFAULT_HISTORY_LIMIT = 256;

/** Undo/redo stacks of {@link Edit}s. Entries beyond `limit` are dropped, oldest first. */
export class History {
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`Invalid history limit ${limit}`);
    this.limit = limit;
  }

  /** The edit `undo()` would revert. */
  get nextUndo(): Edit | undefined {
    return this.undoStack.at(-1);
  }

  /** The edit `redo()` would reapply. */
  get nextRedo(): Edit | undefined {
    return this.redoStack.at(-1);
  }

  /** Records an edit that has already been applied to the document. Clears the redo stack. */
  push(edit: Edit): void {
    this.undoStack.push(edit);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Reverts the latest edit. Returns it, or null when there is nothing to undo. */
  undo(doc: PixelDocument): Edit | null {
    return this.move(doc, this.undoStack, this.redoStack, 'undo');
  }

  /** Reapplies the latest undone edit. Returns it, or null when there is nothing to redo. */
  redo(doc: PixelDocument): Edit | null {
    return this.move(doc, this.redoStack, this.undoStack, 'redo');
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  private move(doc: PixelDocument, from: Edit[], to: Edit[], direction: EditDirection): Edit | null {
    const edit = from.at(-1);
    if (!edit) return null;
    // Apply first: if it throws, both stacks are left as they were.
    applyEdit(doc, edit, direction);
    from.pop();
    to.push(edit);
    return edit;
  }
}
