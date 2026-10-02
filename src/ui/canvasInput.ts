import { TRANSPARENT } from '../core/palette.ts';
import { screenToPixel, stepZoom, zoomAt } from '../render/viewport.ts';
import type { Editor } from './editor.ts';
import { getTool, type ToolGesture, type ToolInput } from './tools.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;

type Gesture =
  | { kind: 'tool'; pointerId: number; tool: ToolGesture; last: ToolInput }
  | { kind: 'pan'; pointerId: number; lastClientX: number; lastClientY: number };

/**
 * Pointer handling for the stage canvas. Left button uses the current tool
 * with the primary color, right button with transparent (erase). Alt+click
 * picks a color whatever the tool. Middle-drag pans, wheel zooms.
 */
export function attachCanvasInput(canvas: HTMLCanvasElement, editor: Editor): void {
  let gesture: Gesture | null = null;

  const toolInput = (e: PointerEvent): ToolInput => {
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToPixel(editor.viewport, e.clientX - rect.left, e.clientY - rect.top);
    return { x, y, shift: e.shiftKey };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (gesture) return;

    if (e.button === BUTTON_MIDDLE) {
      e.preventDefault();
      gesture = { kind: 'pan', pointerId: e.pointerId, lastClientX: e.clientX, lastClientY: e.clientY };
    } else if (e.button === BUTTON_PRIMARY || e.button === BUTTON_SECONDARY) {
      const tool = getTool(e.altKey ? 'eyedropper' : editor.tool);
      // Painting on a hidden layer would change pixels the user can't see.
      if (tool.paints && !editor.activeLayer.visible) return;
      const input = toolInput(e);
      const index = e.button === BUTTON_SECONDARY ? TRANSPARENT : editor.primaryIndex;
      gesture = { kind: 'tool', pointerId: e.pointerId, tool: tool.begin(editor, input, index), last: input };
    } else {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (gesture?.pointerId !== e.pointerId) return;

    if (gesture.kind === 'pan') {
      editor.viewport = {
        ...editor.viewport,
        offsetX: editor.viewport.offsetX + e.clientX - gesture.lastClientX,
        offsetY: editor.viewport.offsetY + e.clientY - gesture.lastClientY,
      };
      gesture.lastClientX = e.clientX;
      gesture.lastClientY = e.clientY;
      editor.requestRender();
      return;
    }

    const input = toolInput(e);
    const { last } = gesture;
    if (input.x === last.x && input.y === last.y && input.shift === last.shift) return;
    gesture.tool.move(input);
    gesture.last = input;
  });

  const endGesture = (e: PointerEvent) => {
    if (gesture?.pointerId !== e.pointerId) return;
    const ended = gesture;
    gesture = null;
    if (ended.kind === 'tool') ended.tool.end();
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('lostpointercapture', endGesture);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const rect = canvas.getBoundingClientRect();
      const zoom = stepZoom(editor.viewport.zoom, e.deltaY < 0 ? 1 : -1);
      editor.viewport = zoomAt(editor.viewport, zoom, e.clientX - rect.left, e.clientY - rect.top);
      editor.requestRender();
    },
    { passive: false },
  );
}
