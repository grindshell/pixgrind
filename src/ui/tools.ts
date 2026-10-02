import { visibleIndexAt } from '../core/composite.ts';
import type { PixelEditSession } from '../core/edits.ts';
import { floodRegion } from '../core/floodFill.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { plotLine, plotRect, snapLineEnd, squareEnd, type Point } from '../core/raster.ts';
import type { Editor } from './editor.ts';
import type { IconName } from './icons.ts';

export type ToolId = 'pencil' | 'eraser' | 'line' | 'rect' | 'rect-filled' | 'fill' | 'eyedropper';

/** Pointer position in document pixels, plus modifiers tools care about. */
export interface ToolInput extends Point {
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
  shortcut: string;
  /** Whether the tool writes pixels. Painting tools are blocked on hidden layers. */
  paints: boolean;
  /**
   * Starts a gesture. `index` is the palette index for the pressed button:
   * the primary color for the left button, transparent for the right.
   */
  begin(editor: Editor, input: ToolInput, index: number): ToolGesture;
}

/** Freehand drawing; consecutive pointer positions are joined with lines so fast strokes have no gaps. */
function freehand(editor: Editor, start: ToolInput, index: number, label: string): ToolGesture {
  const session = editor.beginStroke(label);
  let last: Point = start;
  paintLine(session, start, start, index);
  editor.requestRender();
  return {
    move(input) {
      if (paintLine(session, last, input, index)) editor.requestRender();
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

function paintLine(session: PixelEditSession, from: Point, to: Point, index: number): boolean {
  let changed = false;
  plotLine(from.x, from.y, to.x, to.y, (x, y) => {
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
  begin: (editor, input, index) => freehand(editor, input, index, index === TRANSPARENT ? 'Eraser' : 'Pencil'),
};

const eraser: Tool = {
  id: 'eraser',
  label: 'Eraser',
  icon: 'eraser',
  shortcut: 'e',
  paints: true,
  begin: (editor, input) => freehand(editor, input, TRANSPARENT, 'Eraser'),
};

const line: Tool = {
  id: 'line',
  label: 'Line',
  icon: 'line',
  shortcut: 'l',
  paints: true,
  begin: (editor, start, index) =>
    shape(editor, start, 'Line', (session, input) => {
      const end = input.shift ? snapLineEnd(start, input) : input;
      paintLine(session, start, end, index);
    }),
};

function rectangle(filled: boolean): Tool {
  return {
    id: filled ? 'rect-filled' : 'rect',
    label: filled ? 'Filled rectangle' : 'Rectangle',
    icon: filled ? 'rectFilled' : 'rect',
    shortcut: filled ? 'R' : 'r',
    paints: true,
    begin: (editor, start, index) =>
      shape(editor, start, 'Rectangle', (session, input) => {
        const end = input.shift ? squareEnd(start, input) : input;
        plotRect(start.x, start.y, end.x, end.y, filled, (x, y) => session.setPixel(x, y, index));
      }),
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
    for (const offset of floodRegion(doc, session.layer, start.x, start.y)) {
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

/** Toolbar order. */
export const TOOLS: readonly Tool[] = [pencil, eraser, line, rectangle(false), rectangle(true), fill, eyedropper];

export function getTool(id: ToolId): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool ${id}`);
  return tool;
}
