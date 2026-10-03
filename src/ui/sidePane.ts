import type { PixelEditSession } from '../core/edits.ts';
import { carveCell, extendCell } from '../core/extrusion.ts';
import { facingFrame, facingVoxel, oppositeDirection } from '../core/facing.ts';
import { seenFrom, voxelSampler, type VoxelModel } from '../core/model.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { cellAt } from '../core/pixelDocument.ts';
import { plotLine } from '../core/raster.ts';
import { SideRenderer, type SideCell } from '../render/sideRenderer.ts';
import { clampZoom, stepZoom, zoomAt } from '../render/viewport.ts';
import { commitTextEntry, el, iconButton } from './dom.ts';
import type { ColorSlot, Editor } from './editor.ts';
import { addToBar, createPaneFrame } from './paneFrame.ts';
import { facingName } from './perspectiveBar.ts';
import { adaptiveThrottle } from './throttle.ts';

const BUTTON_PRIMARY = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_SECONDARY = 2;
/** Where the camera's side of the volume starts, from the pane's left edge (CSS px). */
const DEFAULT_OFFSET_X = 24;

type Gesture =
  | { kind: 'paint'; pointerId: number; session: PixelEditSession; index: number; last: SideCell }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number };

/**
 * The side view: the model behind column `editor.sliceColumn` of the side
 * being edited, seen from that side's right, its rows level with the
 * canvas's: depth runs left to right from the camera's side to the far side.
 * Painting a cell with a color adds it to the box of the active layer's
 * pixel in that row (or makes a new pixel there, one deep); painting with
 * transparent (the right button, by default) takes it away. A pixel's box
 * has no gaps, so adding fills up to the cell and taking away trims from the
 * nearer end. Alt+click picks the cell's color. Middle-drag pans and the
 * wheel zooms, together with the canvas.
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

  /** A redraw requested by input, pending for the next animation frame (0 for none). */
  let queuedDraw = 0;
  /** Redraws on the next animation frame: input handlers call this, so they redraw at most once a frame. */
  const requestDraw = () => {
    queuedDraw ||= requestAnimationFrame(draw);
  };

  const draw = () => {
    // A redraw now makes a pending one unneeded.
    cancelAnimationFrame(queuedDraw);
    queuedDraw = 0;
    if (!renderer || !editor.panes.side) return;
    if (!model) {
      modelVersion = editor.contentVersion;
      model = editor.voxelModel;
    }
    renderer.render({
      doc,
      facing: editor.facing,
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
    column.textContent = `${facingName(editor.facing)} column ${editor.sliceColumn}`;
    previous.disabled = editor.sliceColumn <= 0;
    next.disabled = editor.sliceColumn >= editor.plane.width - 1;
    frame.canvas.classList.toggle('is-locked', !editor.activeLayer.visible);
  };
  editor.onChange(syncBar);
  syncBar();

  /** Whether a cell is in the volume: one of the plane's rows, within its depth. */
  const inside = ({ s, v }: SideCell) => v >= 0 && v < editor.plane.height && s >= 0 && s < editor.extent;

  const showWhere = () => {
    // Depth counted from the far side, as boxes are.
    where.textContent = hover && inside(hover) ? `row ${hover.v} · depth ${editor.extent - 1 - hover.s}` : '';
  };

  const cellAtPointer = (e: MouseEvent): SideCell => {
    const rect = canvas.getBoundingClientRect();
    const { zoom, offsetY } = editor.viewport;
    return {
      s: Math.floor((e.clientX - rect.left - offsetX) / zoom),
      v: Math.floor((e.clientY - rect.top - offsetY) / zoom),
    };
  };

  /** Adds (a color) or takes away (transparent) a cell of the column's box in its row, on the active layer. */
  const paintCell = (session: PixelEditSession, cell: SideCell, index: number): boolean => {
    const layer = editor.activeLayer;
    const u = editor.sliceColumn;
    if (!inside(cell) || u >= layer.width) return false;
    const w = editor.extent - 1 - cell.s;
    const current = cellAt(layer, cell.v * layer.width + u);
    const changed = index === TRANSPARENT ? carveCell(current, w) : extendCell(current, w, index);
    return changed !== current && session.setCell(u, cell.v, changed);
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
        pickColor(at, upperHalf(e), slot);
        return;
      }
      // Painting on a hidden layer would change pixels the user can't see.
      if (!editor.activeLayer.visible || editor.busy) return;
      commitTextEntry();
      const index = editor.colorIndex(slot);
      const session = editor.beginStroke('Side view');
      if (paintCell(session, at, index)) editor.requestRender();
      gesture = { kind: 'paint', pointerId: e.pointerId, session, index, last: at };
    } else {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
  });

  /** Whether the pointer is in the upper half of its cell, where a diagonal pixel may show another color. */
  const upperHalf = (e: MouseEvent): boolean => {
    const { zoom, offsetY } = editor.viewport;
    const y = (e.clientY - canvas.getBoundingClientRect().top - offsetY) / zoom;
    return y - Math.floor(y) < 0.5;
  };

  /** Picks the color shown at a cell, in its upper or lower half. */
  const pickColor = (cell: SideCell, upper: boolean, slot: ColorSlot) => {
    if (!inside(cell) || editor.sliceColumn >= editor.plane.width) return;
    const { facing } = editor;
    const { right, down } = facingFrame(facing);
    const [x, y, z] = facingVoxel(doc, facing, editor.sliceColumn, cell.v, editor.extent - 1 - cell.s);
    const content = voxelSampler(doc)(x, y, z);
    const index = content && seenFrom(content, right, oppositeDirection(down), upper);
    if (index && index !== editor.colorIndex(slot)) editor.setColorIndex(slot, index);
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
      if (at.s === last.s && at.v === last.v) return;
      let changed = false;
      // Every cell between, so fast drags leave no gaps.
      plotLine(last.s, last.v, at.s, at.v, (s, v) => {
        changed = paintCell(session, { s, v }, index) || changed;
      });
      gesture.last = at;
      if (changed) editor.requestRender();
    }
    if (at.s !== hover?.s || at.v !== hover.v) {
      hover = at;
      showWhere();
      if (!gesture) requestDraw();
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
    requestDraw();
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
