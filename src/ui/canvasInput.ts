import type { PixelEditSession } from '../core/edits.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { plotLine } from '../core/raster.ts';
import { screenToPixel, stepZoom, zoomAt } from '../render/viewport.ts';
import type { Editor } from './editor.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;

type Gesture =
  | { kind: 'stroke'; pointerId: number; session: PixelEditSession; index: number; lastX: number; lastY: number }
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

  const paintTo = (session: PixelEditSession, index: number, x: number, y: number, fromX = x, fromY = y) => {
    let changed = false;
    plotLine(fromX, fromY, x, y, (px, py) => {
      changed = session.setPixel(px, py, index) || changed;
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
      const erase = e.button === BUTTON_SECONDARY;
      const index = erase ? TRANSPARENT : editor.primaryIndex;
      const session = editor.beginStroke(erase ? 'Eraser' : 'Pencil');
      gesture = { kind: 'stroke', pointerId: e.pointerId, session, index, lastX: x, lastY: y };
      paintTo(session, index, x, y);
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
    paintTo(gesture.session, gesture.index, x, y, gesture.lastX, gesture.lastY);
    gesture.lastX = x;
    gesture.lastY = y;
  });

  const endGesture = (e: PointerEvent) => {
    if (gesture?.pointerId !== e.pointerId) return;
    if (gesture.kind === 'stroke') editor.endStroke();
    gesture = null;
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
      const screen = toScreen(e);
      const zoom = stepZoom(editor.viewport.zoom, e.deltaY < 0 ? 1 : -1);
      editor.viewport = zoomAt(editor.viewport, zoom, screen.x, screen.y);
      editor.requestRender();
    },
    { passive: false },
  );
}
