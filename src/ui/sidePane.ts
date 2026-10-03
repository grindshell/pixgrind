import type { PixelEditSession } from '../core/edits.ts';
import { carveCell, extendCell } from '../core/extrusion.ts';
import { pixelRuns, runAt, type VoxelModel } from '../core/model.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { cellAt } from '../core/pixelDocument.ts';
import { plotLine } from '../core/raster.ts';
import { SideRenderer } from '../render/sideRenderer.ts';
import { clampZoom, stepZoom, zoomAt } from '../render/viewport.ts';
import { el, iconButton } from './dom.ts';
import type { ColorSlot, Editor } from './editor.ts';
import { addToBar, createPaneFrame } from './paneFrame.ts';
import { adaptiveThrottle } from './throttle.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;
/** Where the picture plane starts, from the pane's left edge (CSS px). */
const DEFAULT_OFFSET_X = 24;

/** A depth cell of the side view: depth z of document row y. */
interface SideCell {
  z: number;
  y: number;
}

type Gesture =
  | { kind: 'paint'; pointerId: number; session: PixelEditSession; index: number; last: SideCell }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number };

/**
 * The side view: the model's column `editor.sliceColumn` seen from the
 * right, depth left to right, its rows level with the canvas's. Painting a
 * cell with a color adds that depth to the pixel's box on the active layer
 * (or makes a new pixel there, one deep); painting with transparent (the
 * right button, by default) takes it away. A pixel's box has no gaps, so
 * adding fills up to the cell and taking away trims from the nearer end.
 * Alt+click picks the cell's color. Middle-drag pans and the wheel zooms,
 * together with the canvas.
 */
export function createSidePane(editor: Editor): HTMLElement {
  const { doc } = editor;
  let renderer: SideRenderer | null = null;
  let offsetX = DEFAULT_OFFSET_X;
  let hover: SideCell | null = null;
  let gesture: Gesture | null = null;
  /** The whole model, for the faint projection; refreshed less often than every frame when that's slow. */
  let model: VoxelModel | null = null;
  let modelVersion = -1;

  const frame = createPaneFrame(editor, 'side', 'Side', 'side view', (width, height) => {
    renderer ??= new SideRenderer(frame.canvas);
    renderer.resize(width, height);
    draw();
  });
  const { canvas } = frame;
  canvas.classList.add('side-canvas');

  const previous = iconButton('chevronLeft', 'Previous column', () => editor.setSliceColumn(editor.sliceColumn - 1));
  const next = iconButton('chevronRight', 'Next column', () => editor.setSliceColumn(editor.sliceColumn + 1));
  const column = el('span', 'pane-readout');
  const where = el('span', 'pane-readout pane-hint');
  addToBar(frame, previous, column, next, where);

  const refreshModel = adaptiveThrottle(() => {
    modelVersion = editor.contentVersion;
    model = editor.voxelModel;
    draw();
  });

  const draw = () => {
    if (!renderer || !editor.panes.side) return;
    if (!model) {
      modelVersion = editor.contentVersion;
      model = editor.voxelModel;
    }
    renderer.render({
      doc,
      model,
      version: editor.contentVersion,
      column: editor.sliceColumn,
      activeLayer: editor.activeLayer.visible ? editor.activeLayer : null,
      zoom: editor.viewport.zoom,
      offsetX,
      offsetY: editor.viewport.offsetY,
      hover,
    });
  };

  // The canvas's view and content drive this one's.
  editor.onRender((contentChanged) => {
    if (!editor.panes.side) return;
    if (contentChanged || modelVersion !== editor.contentVersion) refreshModel();
    draw();
  });

  const syncBar = () => {
    column.textContent = `x ${editor.sliceColumn}`;
    previous.disabled = editor.sliceColumn <= 0;
    next.disabled = editor.sliceColumn >= doc.width - 1;
    frame.canvas.classList.toggle('is-locked', !editor.activeLayer.visible);
  };
  editor.onChange(syncBar);
  syncBar();

  const showWhere = () => {
    const inside = hover && hover.y >= 0 && hover.y < doc.height && hover.z >= 0;
    where.textContent = inside ? `y ${hover!.y} · z ${hover!.z}` : '';
  };

  const cellAtPointer = (e: MouseEvent): SideCell => {
    const rect = canvas.getBoundingClientRect();
    const { zoom, offsetY } = editor.viewport;
    return {
      z: Math.floor((e.clientX - rect.left - offsetX) / zoom),
      y: Math.floor((e.clientY - rect.top - offsetY) / zoom),
    };
  };

  /** Adds (a color) or takes away (transparent) depth z at row y of the column, on the active layer. */
  const paintCell = (session: PixelEditSession, { z, y }: SideCell, index: number): boolean => {
    const x = editor.sliceColumn;
    if (y < 0 || y >= doc.height || z < 0 || x >= doc.width) return false;
    const layer = editor.activeLayer;
    const cell = cellAt(layer, y * doc.width + x);
    const changed = index === TRANSPARENT ? carveCell(cell, z) : extendCell(cell, z, index);
    return changed !== cell && session.setCell(x, y, changed);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (gesture) return;
    if (e.button === BUTTON_MIDDLE) {
      e.preventDefault();
      gesture = { kind: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    } else if (e.button === BUTTON_PRIMARY || e.button === BUTTON_SECONDARY) {
      const slot: ColorSlot = e.button === BUTTON_SECONDARY ? 'secondary' : 'primary';
      const at = cellAtPointer(e);
      if (e.altKey) {
        pickColor(at, slot);
        return;
      }
      // Painting on a hidden layer would change pixels the user can't see.
      if (!editor.activeLayer.visible || editor.busy) return;
      const index = editor.colorIndex(slot);
      const session = editor.beginStroke('Side view');
      if (paintCell(session, at, index)) editor.requestRender();
      gesture = { kind: 'paint', pointerId: e.pointerId, session, index, last: at };
    } else {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  });

  const pickColor = ({ z, y }: SideCell, slot: ColorSlot) => {
    if (y < 0 || y >= doc.height || editor.sliceColumn >= doc.width) return;
    const index = runAt(pixelRuns(doc, editor.sliceColumn, y), z)?.index;
    if (index !== undefined && index !== editor.colorIndex(slot)) editor.setColorIndex(slot, index);
  };

  canvas.addEventListener('pointermove', (e) => {
    const at = cellAtPointer(e);
    if (gesture?.pointerId === e.pointerId && gesture.kind === 'pan') {
      offsetX += e.clientX - gesture.lastX;
      editor.viewport = { ...editor.viewport, offsetY: editor.viewport.offsetY + e.clientY - gesture.lastY };
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
      editor.requestRender('view');
    } else if (gesture?.pointerId === e.pointerId && gesture.kind === 'paint') {
      const { session, last, index } = gesture;
      if (at.z === last.z && at.y === last.y) return;
      let changed = false;
      // Every cell between, so fast drags leave no gaps.
      plotLine(last.z, last.y, at.z, at.y, (z, y) => {
        changed = paintCell(session, { z, y }, index) || changed;
      });
      gesture.last = at;
      if (changed) editor.requestRender();
    }
    if (at.z !== hover?.z || at.y !== hover.y) {
      hover = at;
      showWhere();
      if (!gesture) draw();
    }
  });

  const endGesture = (e: PointerEvent) => {
    if (gesture?.pointerId !== e.pointerId) return;
    const ended = gesture;
    gesture = null;
    if (ended.kind === 'paint') editor.endStroke();
  };
  canvas.addEventListener('pointerup', endGesture);
  canvas.addEventListener('pointercancel', endGesture);
  canvas.addEventListener('lostpointercapture', endGesture);
  canvas.addEventListener('pointerleave', () => {
    if (gesture) return;
    hover = null;
    showWhere();
    draw();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Zooms with the canvas, keeping the cell under the pointer in place: its
  // row through the shared zoom and offset, its depth through this pane's offset.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const zoom = clampZoom(stepZoom(editor.viewport.zoom, e.deltaY < 0 ? 1 : -1));
      offsetX = x - ((x - offsetX) * zoom) / editor.viewport.zoom;
      editor.viewport = zoomAt(editor.viewport, zoom, editor.renderer.viewSize.width / 2, y);
      editor.requestRender('view');
    },
    { passive: false },
  );

  return frame.element;
}
