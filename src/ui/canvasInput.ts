import { TRANSPARENT } from '../core/palette.ts';
import { setPixel } from '../core/pixelDocument.ts';
import { plotLine } from '../core/raster.ts';
import { screenToPixel, stepZoom, zoomAt } from '../render/viewport.ts';
import type { Editor } from './editor.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;

type Gesture =
  | { kind: 'stroke'; pointerId: number; index: number; lastX: number; lastY: number }
  | { kind: 'pan'; pointerId: number; lastClientX: number; lastClientY: number };

/**
 * Pointer handling for the stage canvas:
 * left = paint primary color, right = erase, middle-drag = pan, wheel = zoom.
 */
export function attachCanvasInput(canvas: HTMLCanvasElement, editor: Editor): void {
  let gesture: Gesture | null = null;

  const toScreen = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const paintTo = (x: number, y: number, index: number, fromX = x, fromY = y) => {
    const { doc, activeLayer } = editor;
    let changed = false;
    plotLine(fromX, fromY, x, y, (px, py) => {
      changed = setPixel(doc, activeLayer, px, py, index) || changed;
    });
    if (changed) editor.requestRender();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (gesture) return;

    if (e.button === BUTTON_MIDDLE) {
      e.preventDefault();
      gesture = { kind: 'pan', pointerId: e.pointerId, lastClientX: e.clientX, lastClientY: e.clientY };
    } else if (e.button === BUTTON_PRIMARY || e.button === BUTTON_SECONDARY) {
      const screen = toScreen(e);
      const { x, y } = screenToPixel(editor.viewport, screen.x, screen.y);
      const index = e.button === BUTTON_SECONDARY ? TRANSPARENT : editor.primaryIndex;
      gesture = { kind: 'stroke', pointerId: e.pointerId, index, lastX: x, lastY: y };
      paintTo(x, y, index);
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

    const screen = toScreen(e);
    const { x, y } = screenToPixel(editor.viewport, screen.x, screen.y);
    if (x === gesture.lastX && y === gesture.lastY) return;
    paintTo(x, y, gesture.index, gesture.lastX, gesture.lastY);
    gesture.lastX = x;
    gesture.lastY = y;
  });

  const endGesture = (e: PointerEvent) => {
    if (gesture?.pointerId === e.pointerId) gesture = null;
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const screen = toScreen(e);
      const zoom = stepZoom(editor.viewport.zoom, e.deltaY < 0 ? 1 : -1);
      editor.viewport = zoomAt(editor.viewport, zoom, screen.x, screen.y);
      editor.requestRender();
    },
    { passive: false },
  );
}
