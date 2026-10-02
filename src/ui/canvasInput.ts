import { screenToDocument, stepZoom, zoomAt } from '../render/viewport.ts';
import type { ColorSlot, Editor } from './editor.ts';
import { getTool, type Tool, type ToolGesture, type ToolInput } from './tools.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;

type Gesture =
  | { kind: 'tool'; pointerId: number; tool: Tool; gesture: ToolGesture; last: ToolInput }
  | { kind: 'pan'; pointerId: number; lastClientX: number; lastClientY: number };

/**
 * Pointer handling for the stage canvas. Left button uses the current tool
 * with the primary color, right button with the secondary color. Alt+click
 * picks a color whatever the tool. Middle-drag pans. The wheel zooms, unless
 * the current tool handles it (Ctrl+wheel always zooms).
 */
export function attachCanvasInput(canvas: HTMLCanvasElement, editor: Editor): void {
  let gesture: Gesture | null = null;

  const toolInput = (e: MouseEvent): ToolInput => {
    const rect = canvas.getBoundingClientRect();
    const exact = screenToDocument(editor.viewport, e.clientX - rect.left, e.clientY - rect.top);
    return { x: Math.floor(exact.x), y: Math.floor(exact.y), exact, shift: e.shiftKey };
  };

  /** Tracks the pixel under the pointer for the brush outline. */
  const trackPointer = (e: MouseEvent) => {
    const { x, y } = toolInput(e);
    editor.setPointer({ x, y });
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (gesture) return;
    // Pens and touch have no hover, so the first we hear of them is here.
    trackPointer(e);

    if (e.button === BUTTON_MIDDLE) {
      e.preventDefault();
      gesture = { kind: 'pan', pointerId: e.pointerId, lastClientX: e.clientX, lastClientY: e.clientY };
    } else if (e.button === BUTTON_PRIMARY || e.button === BUTTON_SECONDARY) {
      const tool = getTool(e.altKey ? 'eyedropper' : editor.tool);
      // Painting on a hidden layer would change pixels the user can't see.
      if (tool.paints && !editor.activeLayer.visible) return;
      const input = toolInput(e);
      const slot: ColorSlot = e.button === BUTTON_SECONDARY ? 'secondary' : 'primary';
      editor.setGestureActive(true);
      const toolGesture = tool.begin(editor, input, editor.colorIndex(slot), slot);
      gesture = { kind: 'tool', pointerId: e.pointerId, tool, gesture: toolGesture, last: input };
    } else {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (gesture?.pointerId !== e.pointerId) {
      trackPointer(e);
      return;
    }

    if (gesture.kind === 'pan') {
      editor.viewport = {
        ...editor.viewport,
        offsetX: editor.viewport.offsetX + e.clientX - gesture.lastClientX,
        offsetY: editor.viewport.offsetY + e.clientY - gesture.lastClientY,
      };
      gesture.lastClientX = e.clientX;
      gesture.lastClientY = e.clientY;
      trackPointer(e);
      editor.requestRender();
      return;
    }

    const input = toolInput(e);
    editor.setPointer({ x: input.x, y: input.y });
    const { last } = gesture;
    const samePixel = input.x === last.x && input.y === last.y && input.shift === last.shift;
    if (samePixel && !gesture.tool.continuous) return;
    gesture.gesture.move(input);
    gesture.last = input;
  });

  const endGesture = (e: PointerEvent) => {
    if (gesture?.pointerId !== e.pointerId) return;
    const ended = gesture;
    gesture = null;
    if (ended.kind === 'tool') {
      editor.setGestureActive(false);
      ended.gesture.end();
    }
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('lostpointercapture', endGesture);

  // Pressing or releasing Shift mid-gesture re-applies the shape constraint
  // (45° lines, squares, axis-locked moves) without waiting for the pointer to move.
  const onShift = (e: KeyboardEvent) => {
    if (e.key !== 'Shift' || gesture?.kind !== 'tool' || gesture.last.shift === e.shiftKey) return;
    const input = { ...gesture.last, shift: e.shiftKey };
    gesture.gesture.move(input);
    gesture.last = input;
  };
  window.addEventListener('keydown', onShift);
  window.addEventListener('keyup', onShift);

  canvas.addEventListener('pointerleave', () => {
    // Keep the brush outline while a captured gesture continues off the canvas.
    if (!gesture) editor.setPointer(null);
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const direction = e.deltaY < 0 ? 1 : -1;
      const tool = getTool(editor.tool);
      if (tool.wheel && !e.ctrlKey && !gesture) {
        tool.wheel(editor, toolInput(e), direction);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const zoom = stepZoom(editor.viewport.zoom, direction);
      editor.viewport = zoomAt(editor.viewport, zoom, e.clientX - rect.left, e.clientY - rect.top);
      trackPointer(e);
      editor.requestRender();
    },
    { passive: false },
  );
}
