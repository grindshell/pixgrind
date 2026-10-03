import { brushLine, brushMask, brushRect, type BrushMask } from '../core/brush.ts';
import { visibleIndexAt } from '../core/composite.ts';
import { combineEdits, type PixelEditSession } from '../core/edits.ts';
import { autoShape, fitExtrusion, SQUARE, withBox, withShape, type Cell, type Extrusion } from '../core/extrusion.ts';
import { planeRect } from '../core/facing.ts';
import { colorRegion, floodRegion } from '../core/floodFill.ts';
import {
  clipMask,
  combineMasks,
  lassoMask,
  maskFromOffsets,
  rectMask,
  type Mask,
  type SelectionMode,
} from '../core/mask.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { pixelPerfectPath } from '../core/pixelPerfect.ts';
import { plotLine, snapLineEnd, squareEnd, type Point } from '../core/raster.ts';
import { rectFromCorners, rectsEqual } from '../core/rect.ts';
import { scaleAround } from '../core/referencePlacement.ts';
import { floatingChange, liftSelection, moveFloating, selectionChange, shiftedValues } from '../core/selection.ts';
import type { ColorSlot, Editor } from './editor.ts';
import type { IconName } from './icons.ts';

export type ToolId =
  | 'select'
  | 'lasso'
  | 'polygon'
  | 'wand'
  | 'move'
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'rect-filled'
  | 'fill'
  | 'eyedropper'
  | 'extrude'
  | 'diagonal'
  | 'reference';

/** Pointer position in document pixels, plus modifiers tools care about. */
export interface ToolInput extends Point {
  /** Exact (fractional) document coordinates, for tools that don't work in whole pixels. */
  exact: Point;
  /** Constrains shapes: lines to 45° steps, rectangles to squares. Selection tools: add to the selection. */
  shift: boolean;
  /** Ctrl or Cmd. Selection tools: subtract from the selection (intersect with Shift). */
  ctrl: boolean;
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
   * Starts a gesture. `slot` is the pressed button's color (primary for the
   * left button, secondary for the right) and `index` its palette index,
   * which may be `TRANSPARENT`.
   */
  begin(editor: Editor, input: ToolInput, index: number, slot: ColorSlot): ToolGesture;
  /** Handles the mouse wheel instead of zooming (Ctrl+wheel still zooms). */
  wheel?(editor: Editor, input: ToolInput, direction: 1 | -1): void;
  /**
   * Follows the pointer between gestures: over the canvas (including while
   * panning or zooming moves the document under it), or null when it leaves.
   */
  hover?(editor: Editor, input: ToolInput | null): void;
  /**
   * Gets first go at keys (without Ctrl/Cmd or Alt) while the tool is
   * active, e.g. Enter to finish a polygon. Returns whether it used the key.
   */
  key?(editor: Editor, key: string): boolean;
  /** Called when another tool is chosen, to drop unfinished work. */
  deactivate?(editor: Editor): void;
}

/**
 * Freehand drawing; consecutive pointer positions are joined with lines so
 * fast strokes have no gaps. In pixel-perfect mode (1px brush only), the
 * corners of L-shaped turns are taken back as the stroke goes.
 */
function freehand(editor: Editor, start: ToolInput, index: number, label: string): ToolGesture {
  const session = editor.beginStroke(label);
  const mask = brushMask(editor.brush);
  const perfect = editor.pixelPerfect && editor.brush.size === 1 ? pixelPerfectPath() : null;
  /** Where the stroke has painted up to; null before the first point. */
  let last: Point | null = null;
  const paintTo = (to: Point): boolean => {
    const from = last ?? to;
    const continued = last !== null;
    last = to;
    if (!perfect) return paintLine(session, mask, from, to, index, continued);
    let changed = false;
    plotLine(from.x, from.y, to.x, to.y, (x, y) => {
      changed = session.setPixel(x, y, index) || changed;
      const corner = perfect.add({ x, y });
      if (corner) changed = session.restore(corner.x, corner.y) || changed;
    });
    return changed;
  };
  paintTo(start);
  editor.requestRender();
  return {
    move(input) {
      if (paintTo(input)) editor.requestRender();
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

/**
 * Drags the brush from `from` to `to` (`continued`: a stroke's next segment,
 * already painted at `from`). Returns whether any pixel changed.
 */
function paintLine(session: PixelEditSession, mask: BrushMask, from: Point, to: Point, index: number, continued = false): boolean {
  let changed = false;
  brushLine(
    mask,
    from.x,
    from.y,
    to.x,
    to.y,
    (x, y) => {
      changed = session.setPixel(x, y, index) || changed;
    },
    continued,
  );
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
    const session = editor.beginStroke('Fill');
    const { width } = session.layer;
    for (const offset of floodRegion(session.layer, start.x, start.y, editor.selection)) {
      session.setPixel(offset % width, Math.floor(offset / width), index);
    }
    editor.requestRender();
    return { move() {}, end: () => editor.endStroke() };
  },
};

/** Drags the brush over painted pixels of the active layer, changing each one's extrusion to `update(it, x, y)`. */
function extrusionStroke(
  editor: Editor,
  start: ToolInput,
  label: string,
  update: (extrusion: Extrusion, x: number, y: number) => Extrusion,
): ToolGesture {
  const session = editor.beginStroke(label);
  const mask = brushMask(editor.brush);
  /** Where the stroke has painted up to; null before the first point. */
  let last: Point | null = null;
  const paintTo = (to: Point) => {
    const from = last ?? to;
    let changed = false;
    brushLine(
      mask,
      from.x,
      from.y,
      to.x,
      to.y,
      (x, y) => {
        changed = session.updateExtrusion(x, y, (extrusion) => update(extrusion, x, y)) || changed;
      },
      last !== null,
    );
    last = to;
    if (changed) editor.requestRender();
  };
  paintTo(start);
  return { move: paintTo, end: () => editor.endStroke() };
}

/**
 * Extrude: paints depth instead of color. The left button gives painted
 * pixels of the active layer the 3D panel's depth and offset, so their
 * boxes grow toward the camera (cut short where they'd leave the volume);
 * the right button puts them back to the default (one deep, against the far
 * side). Shapes stay. Pressing also shows the pressed column in the side
 * view.
 */
const extrude: Tool = {
  id: 'extrude',
  label: 'Extrude',
  icon: 'extrude',
  shortcut: 'd',
  paints: true,
  brush: true,
  begin(editor, start, _index, slot) {
    const primary = slot === 'primary';
    const { offset, depth } = primary ? editor.extrude : { offset: 0, depth: 1 };
    const { extent } = editor;
    if (start.x >= 0 && start.x < editor.plane.width) editor.setSliceColumn(start.x);
    return extrusionStroke(editor, start, primary ? 'Extrude' : 'Reset extrusion', (extrusion) =>
      fitExtrusion(withBox(extrusion, offset, depth), extent),
    );
  },
};

/**
 * Diagonal: paints shapes instead of color, keeping depths. The left button
 * cuts painted pixels of the active layer in half along a diagonal: at the
 * 3D panel's corner, or with Auto at the corner between a pixel's two empty
 * sides (the steps of a staircase edge), leaving pixels where that isn't
 * clear. The right button makes pixels square again.
 */
const diagonal: Tool = {
  id: 'diagonal',
  label: 'Diagonal',
  icon: 'diagonal',
  shortcut: 'D',
  paints: true,
  brush: true,
  begin(editor, start, _index, slot) {
    const choice = slot === 'primary' ? editor.diagonal : SQUARE;
    const { pixels, width, height } = editor.activeLayer;
    return extrusionStroke(editor, start, slot === 'primary' ? 'Diagonal' : 'Square', (extrusion, x, y) => {
      const shape = choice === 'auto' ? autoShape(pixels, width, height, x, y) : choice;
      return shape === null ? extrusion : withShape(extrusion, shape);
    });
  },
};

/**
 * Picks the visible color under the pointer as the pressed button's color
 * (primary for left, secondary for right). Ignores transparent pixels.
 */
const eyedropper: Tool = {
  id: 'eyedropper',
  label: 'Eyedropper',
  icon: 'eyedropper',
  shortcut: 'i',
  paints: false,
  begin(editor, start, _index, slot) {
    const pick = (input: ToolInput) => {
      const index = visibleIndexAt(editor.doc, editor.facing, input.x, input.y);
      if (index !== TRANSPARENT && index !== editor.colorIndex(slot)) editor.setColorIndex(slot, index);
    };
    pick(start);
    return { move: pick, end() {} };
  },
};

/**
 * A selection tool's gesture makes a shape that combines with the selection
 * it started from, in a mode fixed at the press: Shift adds, Ctrl (Cmd)
 * subtracts, both intersect, and otherwise the Selection panel's mode
 * applies. Any floating selection is dropped where it is.
 */
interface Selecting {
  mode: SelectionMode;
  /** Shows the selection as it would be with `shape` (clipped to the document); null is an empty shape. */
  preview(shape: Mask | null): void;
  /** Records the change from the starting selection to the one shown, with the drop, as one undo step. */
  commit(): void;
}

function selecting(editor: Editor, start: ToolInput): Selecting {
  const { doc, facing, plane } = editor;
  const before = editor.selection;
  const floating = doc.floating;
  const mode = modifierMode(start) ?? editor.selectionMode;
  // Show the selection being made rather than the float's outline.
  editor.previewFloating(null);
  return {
    mode,
    preview(shape) {
      editor.previewSelection(combineMasks(before, shape && clipMask(shape, plane.width, plane.height), mode));
    },
    commit() {
      const after = doc.selections[facing];
      const label = after ? 'Select' : 'Deselect';
      editor.record(
        combineEdits(label, [floatingChange(floating, null, label), selectionChange(facing, before, after, label)]),
      );
    },
  };
}

function modifierMode({ shift, ctrl }: ToolInput): SelectionMode | null {
  if (shift && ctrl) return 'intersect';
  if (shift) return 'add';
  if (ctrl) return 'subtract';
  return null;
}

/**
 * Rectangle marquee: dragging selects the spanned pixels. Clicking without
 * dragging is an empty shape, which deselects in replace mode.
 */
const select: Tool = {
  id: 'select',
  label: 'Rectangle select',
  icon: 'select',
  shortcut: 'm',
  paints: false,
  begin(editor, start) {
    const selection = selecting(editor, start);
    let dragged = false;
    return {
      move(input) {
        // A Shift press re-sends the start pixel; that isn't a drag.
        if (input.x !== start.x || input.y !== start.y) dragged = true;
        if (dragged) selection.preview(rectMask(rectFromCorners(start, input)));
      },
      end() {
        if (!dragged) selection.preview(null);
        selection.commit();
      },
    };
  },
};

/**
 * Freehand lasso: selects the pixels the path passes over and everything it
 * encloses, the path being closed with a straight line on release. Clicking
 * without dragging is an empty shape, which deselects in replace mode.
 */
const lasso: Tool = {
  id: 'lasso',
  label: 'Lasso select',
  icon: 'lasso',
  shortcut: 'q',
  paints: false,
  begin(editor, start) {
    const selection = selecting(editor, start);
    // A new selection replaces the old one, so stop showing it straight away.
    if (selection.mode === 'replace') selection.preview(null);
    const points: Point[] = [{ x: start.x, y: start.y }];
    editor.previewLasso(points);
    return {
      move(input) {
        const last = points[points.length - 1];
        if (input.x === last.x && input.y === last.y) return;
        points.push({ x: input.x, y: input.y });
        editor.previewLasso(points);
      },
      end() {
        editor.previewLasso(null);
        selection.preview(points.length > 1 ? lassoMask(points, planeRect(editor.doc, editor.facing)) : null);
        selection.commit();
      },
    };
  },
};

/** A polygonal lasso's corners so far, and the press that placed the first (its modifiers pick the mode). */
interface Polygon {
  corners: Point[];
  start: ToolInput;
}

/** Unfinished polygons, per editor. They outlast gestures: each click adds a corner. */
const polygons = new WeakMap<Editor, Polygon>();

/** Within this many screen pixels of the first corner, a click closes the polygon. */
const CLOSE_DISTANCE = 8;

/** Whether placing a corner at `input` would close the polygon instead: on the last corner, or near the first. */
function closesPolygon(editor: Editor, { corners }: Polygon, input: ToolInput): boolean {
  const last = corners[corners.length - 1];
  if (input.x === last.x && input.y === last.y) return true;
  if (corners.length < 2) return false;
  const first = corners[0];
  const distance = Math.hypot(input.exact.x - (first.x + 0.5), input.exact.y - (first.y + 0.5));
  return (input.x === first.x && input.y === first.y) || distance * editor.viewport.zoom <= CLOSE_DISTANCE;
}

/** Shows the corners, plus a line to the pointer (`tip`), which snaps to the first corner when a click would close. */
function showPolygon(editor: Editor, polygon: Polygon, tip: ToolInput | null): void {
  const points = [...polygon.corners];
  if (tip) points.push(closesPolygon(editor, polygon, tip) ? polygon.corners[0] : { x: tip.x, y: tip.y });
  editor.previewLasso(points);
}

/** Selects the polygon's pixels (as the lasso does) and forgets it. Fewer than two corners is an empty shape. */
function finishPolygon(editor: Editor): void {
  const polygon = polygons.get(editor);
  if (!polygon) return;
  cancelPolygon(editor);
  const { corners } = polygon;
  const selection = selecting(editor, polygon.start);
  selection.preview(corners.length > 1 ? lassoMask(corners, planeRect(editor.doc, editor.facing)) : null);
  selection.commit();
}

function cancelPolygon(editor: Editor): void {
  polygons.delete(editor);
  editor.previewLasso(null);
}

/**
 * Polygonal lasso: each click places a corner (dragging moves it until
 * release), and the edges between them are straight. Clicking the first
 * corner, clicking the last one again (so double-clicking) or Enter
 * finishes; it then selects as the lasso does. Backspace takes back the last
 * corner and Escape cancels. The selection mode comes from the first click.
 */
const polygonLasso: Tool = {
  id: 'polygon',
  label: 'Polygonal lasso',
  icon: 'polygon',
  shortcut: 'Q',
  paints: false,
  continuous: true,
  begin(editor, start) {
    const pending = polygons.get(editor);
    let at = start;
    // Keys (Enter, Escape, another tool) can finish or drop the polygon while
    // the button is down. The press is then void.
    const abandoned = () => editor.tool !== 'polygon' || polygons.get(editor) !== pending;
    const show = (input: ToolInput) => {
      if (abandoned()) return;
      if (pending) showPolygon(editor, pending, input);
      else editor.previewLasso([{ x: input.x, y: input.y }]);
    };
    show(start);
    return {
      move(input) {
        at = input;
        show(input);
      },
      end() {
        if (abandoned()) {
          editor.previewLasso(null);
          return;
        }
        if (!pending) {
          polygons.set(editor, { corners: [{ x: at.x, y: at.y }], start });
        } else if (closesPolygon(editor, pending, at)) {
          finishPolygon(editor);
          return;
        } else {
          pending.corners.push({ x: at.x, y: at.y });
        }
        showPolygon(editor, polygons.get(editor)!, at);
      },
    };
  },
  hover(editor, input) {
    const polygon = polygons.get(editor);
    if (polygon) showPolygon(editor, polygon, input);
  },
  key(editor, key) {
    const polygon = polygons.get(editor);
    if (!polygon) return false;
    if (key === 'Enter') {
      finishPolygon(editor);
    } else if (key === 'Escape') {
      cancelPolygon(editor);
    } else if (key === 'Backspace' || key === 'Delete') {
      polygon.corners.pop();
      if (polygon.corners.length === 0) cancelPolygon(editor);
      else showPolygon(editor, polygon, null);
    } else {
      return false;
    }
    return true;
  },
  deactivate: cancelPolygon,
};

/**
 * Magic wand: selects the pixels of the clicked color on the active layer,
 * either the touching ones (4-connected, like fill) or all of them, per the
 * Selection panel. Clicking outside the canvas is an empty shape.
 */
const wand: Tool = {
  id: 'wand',
  label: 'Magic wand',
  icon: 'wand',
  shortcut: 'w',
  paints: false,
  begin(editor, start) {
    const selection = selecting(editor, start);
    const layer = editor.activeLayer;
    const region = editor.wandContiguous ? floodRegion(layer, start.x, start.y) : colorRegion(layer, start.x, start.y);
    selection.preview(maskFromOffsets(region, layer.width));
    return { move() {}, end: () => selection.commit() };
  },
};

/**
 * Drags the selected pixels of the active layer, and the selection with
 * them; Shift locks to one axis. Selected pixels float (see
 * `FloatingPixels`): ones dragged off the canvas are kept, across drags,
 * until the float is dropped. With nothing selected the whole layer moves,
 * and pixels dragged off the canvas are lost on release.
 */
const move: Tool = {
  id: 'move',
  label: 'Move',
  icon: 'move',
  shortcut: 'v',
  paints: true,
  begin(editor, start) {
    const { doc } = editor;
    const layer = editor.activeLayer;
    const { facing, width, height } = layer;
    const startSelection = doc.selections[facing];
    const startFloating = doc.floating;
    const origin = startFloating?.layerId === layer.id ? startFloating : liftSelection(doc, layer);
    // Not clipped: moved pixels may land outside the original selection.
    const session = editor.beginStroke('Move', { clipToSelection: false });
    const write = (cells: Map<number, Cell>) => {
      for (const [offset, cell] of cells) session.setCell(offset % width, Math.floor(offset / width), cell);
    };
    /** Whole-layer moves rewrite the layer on every pointer move; these save allocating each time. */
    let shifted: { pixels: Uint8Array; extrusion: Uint32Array } | undefined;

    return {
      move(input) {
        let dx = input.x - start.x;
        let dy = input.y - start.y;
        if (input.shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        // Recompute from the state at the start of the drag each time.
        session.revert();
        if (origin) {
          const { cells, moved } = moveFloating(layer, origin, dx, dy);
          write(cells);
          editor.previewFloating(moved);
          editor.previewSelection(clipMask(moved, width, height));
        } else {
          shifted ??= { pixels: new Uint8Array(layer.pixels.length), extrusion: new Uint32Array(layer.pixels.length) };
          session.setAll(
            shiftedValues(layer, layer.pixels, dx, dy, shifted.pixels),
            shiftedValues(layer, layer.extrusion, dx, dy, shifted.extrusion),
          );
        }
        editor.requestRender();
      },
      end() {
        const pixels = editor.takeStroke();
        if (origin && rectsEqual(doc.floating?.rect ?? null, origin.rect)) {
          // Dragged back to where it started: nothing to record, not even a lift.
          editor.previewFloating(startFloating);
          editor.previewSelection(startSelection);
          editor.record(pixels);
          return;
        }
        editor.record(
          combineEdits('Move', [
            pixels,
            floatingChange(startFloating, doc.floating, 'Move'),
            selectionChange(facing, startSelection, doc.selections[facing], 'Move'),
          ]),
        );
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
  lasso,
  polygonLasso,
  wand,
  move,
  pencil,
  eraser,
  line,
  rectangle(false),
  rectangle(true),
  fill,
  eyedropper,
  extrude,
  diagonal,
  reference,
];

export function getTool(id: ToolId): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool ${id}`);
  return tool;
}
