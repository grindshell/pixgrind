import { brushLine, brushMask, brushRect, type BrushMask } from '../core/brush.ts';
import { visibleIndexAt } from '../core/composite.ts';
import { combineEdits, type PixelEditSession } from '../core/edits.ts';
import { floodRegion } from '../core/floodFill.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { documentRect } from '../core/pixelDocument.ts';
import { snapLineEnd, squareEnd, type Point } from '../core/raster.ts';
import { clipRect, rectFromCorners, translateRect } from '../core/rect.ts';
import { scaleAround } from '../core/referencePlacement.ts';
import { movedPixels, selectionChange } from '../core/selection.ts';
import type { Editor } from './editor.ts';
import type { IconName } from './icons.ts';

export type ToolId =
  | 'select'
  | 'move'
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'rect-filled'
  | 'fill'
  | 'eyedropper'
  | 'reference';

/** Pointer position in document pixels, plus modifiers tools care about. */
export interface ToolInput extends Point {
  /** Exact (fractional) document coordinates, for tools that don't work in whole pixels. */
  exact: Point;
  /** Constrains shapes: lines to 45° steps, rectangles to squares. */
  shift: boolean;
}

/** One press–drag–release on the canvas. */
export interface ToolGesture {
  move(input: ToolInput): void;
  end(): void;
}

export interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  /** Single-key shortcut, as `KeyboardEvent.key` reports it (so "R" means Shift+R). */
  shortcut?: string;
  /** Not shown in the tool strip; activated from elsewhere (e.g. the reference panel). */
  hidden?: boolean;
  /** Whether the tool writes pixels. Painting tools are blocked on hidden layers. */
  paints: boolean;
  /** Draws with the editor's brush (size and shape); the canvas shows its outline under the pointer. */
  brush?: boolean;
  /** Receive every pointer move, not just moves to a new pixel. */
  continuous?: boolean;
  /**
   * Starts a gesture. `index` is the palette index for the pressed button:
   * the primary color for the left button, transparent for the right.
   */
  begin(editor: Editor, input: ToolInput, index: number): ToolGesture;
  /** Handles the mouse wheel instead of zooming (Ctrl+wheel still zooms). */
  wheel?(editor: Editor, input: ToolInput, direction: 1 | -1): void;
}

/** Freehand drawing; consecutive pointer positions are joined with lines so fast strokes have no gaps. */
function freehand(editor: Editor, start: ToolInput, index: number, label: string): ToolGesture {
  const session = editor.beginStroke(label);
  const mask = brushMask(editor.brush);
  let last: Point = start;
  paintLine(session, mask, start, start, index);
  editor.requestRender();
  return {
    move(input) {
      if (paintLine(session, mask, last, input, index)) editor.requestRender();
      last = input;
    },
    end: () => editor.endStroke(),
  };
}

/** A shape that is redrawn from scratch on every move, then committed on release. */
function shape(
  editor: Editor,
  start: ToolInput,
  label: string,
  draw: (session: PixelEditSession, input: ToolInput) => void,
): ToolGesture {
  const session = editor.beginStroke(label);
  const redraw = (input: ToolInput) => {
    session.revert();
    draw(session, input);
    editor.requestRender();
  };
  redraw(start);
  return { move: redraw, end: () => editor.endStroke() };
}

/** Drags the brush from `from` to `to`. Returns whether any pixel changed. */
function paintLine(session: PixelEditSession, mask: BrushMask, from: Point, to: Point, index: number): boolean {
  let changed = false;
  brushLine(mask, from.x, from.y, to.x, to.y, (x, y) => {
    changed = session.setPixel(x, y, index) || changed;
  });
  return changed;
}

const pencil: Tool = {
  id: 'pencil',
  label: 'Pencil',
  icon: 'pencil',
  shortcut: 'b',
  paints: true,
  brush: true,
  begin: (editor, input, index) => freehand(editor, input, index, index === TRANSPARENT ? 'Eraser' : 'Pencil'),
};

const eraser: Tool = {
  id: 'eraser',
  label: 'Eraser',
  icon: 'eraser',
  shortcut: 'e',
  paints: true,
  brush: true,
  begin: (editor, input) => freehand(editor, input, TRANSPARENT, 'Eraser'),
};

const line: Tool = {
  id: 'line',
  label: 'Line',
  icon: 'line',
  shortcut: 'l',
  paints: true,
  brush: true,
  begin(editor, start, index) {
    const mask = brushMask(editor.brush);
    return shape(editor, start, 'Line', (session, input) => {
      const end = input.shift ? snapLineEnd(start, input) : input;
      paintLine(session, mask, start, end, index);
    });
  },
};

function rectangle(filled: boolean): Tool {
  return {
    id: filled ? 'rect-filled' : 'rect',
    label: filled ? 'Filled rectangle' : 'Rectangle',
    icon: filled ? 'rectFilled' : 'rect',
    shortcut: filled ? 'R' : 'r',
    paints: true,
    brush: true,
    begin(editor, start, index) {
      const mask = brushMask(editor.brush);
      return shape(editor, start, 'Rectangle', (session, input) => {
        const end = input.shift ? squareEnd(start, input) : input;
        brushRect(mask, start.x, start.y, end.x, end.y, filled, (x, y) => session.setPixel(x, y, index));
      });
    },
  };
}

const fill: Tool = {
  id: 'fill',
  label: 'Fill',
  icon: 'fill',
  shortcut: 'g',
  paints: true,
  begin(editor, start, index) {
    const { doc } = editor;
    const session = editor.beginStroke('Fill');
    for (const offset of floodRegion(doc, session.layer, start.x, start.y, doc.selection)) {
      session.setPixel(offset % doc.width, Math.floor(offset / doc.width), index);
    }
    editor.requestRender();
    return { move() {}, end: () => editor.endStroke() };
  },
};

/** Picks the visible color under the pointer as the primary color. Ignores transparent pixels. */
const eyedropper: Tool = {
  id: 'eyedropper',
  label: 'Eyedropper',
  icon: 'eyedropper',
  shortcut: 'i',
  paints: false,
  begin(editor, start) {
    const pick = (input: ToolInput) => {
      const index = visibleIndexAt(editor.doc, input.x, input.y);
      if (index !== TRANSPARENT && index !== editor.primaryIndex) editor.setPrimaryIndex(index);
    };
    pick(start);
    return { move: pick, end() {} };
  },
};

/**
 * Rectangle marquee. Dragging selects the spanned pixels (clipped to the
 * document); clicking without dragging deselects.
 */
const select: Tool = {
  id: 'select',
  label: 'Rectangle select',
  icon: 'select',
  shortcut: 'm',
  paints: false,
  begin(editor, start) {
    const { doc } = editor;
    const before = doc.selection;
    let dragged = false;
    return {
      move(input) {
        dragged = true;
        editor.previewSelection(clipRect(rectFromCorners(start, input), doc.width, doc.height));
      },
      end() {
        if (!dragged) editor.previewSelection(null);
        const after = doc.selection;
        editor.record(selectionChange(before, after, after ? 'Select' : 'Deselect'));
      },
    };
  },
};

/**
 * Drags the selected pixels of the active layer (the whole layer when
 * nothing is selected), and the selection with them. Shift locks to one axis.
 * Pixels dragged off the canvas are dropped on release.
 */
const move: Tool = {
  id: 'move',
  label: 'Move',
  icon: 'move',
  shortcut: 'v',
  paints: true,
  begin(editor, start) {
    const { doc } = editor;
    const original = doc.selection;
    const area = original ?? documentRect(doc);
    // Not clipped: moved pixels may land outside the original selection.
    const session = editor.beginStroke('Move', { clipToSelection: false });

    return {
      move(input) {
        let dx = input.x - start.x;
        let dy = input.y - start.y;
        if (input.shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        // Recompute from the untouched original each time, so dragging past
        // the edge and back loses nothing until release.
        session.revert();
        for (const [offset, value] of movedPixels(doc, session.layer, area, dx, dy)) {
          session.setPixel(offset % doc.width, Math.floor(offset / doc.width), value);
        }
        if (original) editor.previewSelection(clipRect(translateRect(original, dx, dy), doc.width, doc.height));
        editor.requestRender();
      },
      end() {
        const pixels = editor.takeStroke();
        editor.record(combineEdits('Move', [pixels, selectionChange(original, doc.selection, 'Move')]));
      },
    };
  },
};

/** Each wheel step scales the reference by this factor. */
const REFERENCE_WHEEL_STEP = 1.1;

/**
 * Positions the reference image: drag to move it, wheel to scale it around
 * the pointer. Works in exact coordinates so alignment isn't limited to
 * whole pixels. Activated from the reference panel.
 */
const reference: Tool = {
  id: 'reference',
  label: 'Move reference',
  icon: 'image',
  hidden: true,
  paints: false,
  continuous: true,
  begin(editor, start) {
    const ref = editor.reference;
    if (!ref) return { move() {}, end() {} };
    const origin = { x: ref.x, y: ref.y };
    return {
      move(input) {
        editor.updateReference(
          { x: origin.x + input.exact.x - start.exact.x, y: origin.y + input.exact.y - start.exact.y },
          { silent: true },
        );
      },
      end: () => editor.updateReference({}),
    };
  },
  wheel(editor, input, direction) {
    const ref = editor.reference;
    if (!ref) return;
    const factor = direction > 0 ? REFERENCE_WHEEL_STEP : 1 / REFERENCE_WHEEL_STEP;
    editor.updateReference(scaleAround(ref, ref.scale * factor, input.exact.x, input.exact.y));
  },
};

/** Toolbar order. Hidden tools are last. */
export const TOOLS: readonly Tool[] = [
  select,
  move,
  pencil,
  eraser,
  line,
  rectangle(false),
  rectangle(true),
  fill,
  eyedropper,
  reference,
];

export function getTool(id: ToolId): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool ${id}`);
  return tool;
}
