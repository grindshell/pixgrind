import { applyEdit, beginPixelEdit, type Edit, type PixelEdit, type PixelEditSession } from '../core/edits.ts';
import { History } from '../core/history.ts';
import type { Layer } from '../core/layer.ts';
import { findLayer, layerIndex, type PixelDocument } from '../core/pixelDocument.ts';
import type { Rect } from '../core/rect.ts';
import { CanvasRenderer } from '../render/canvasRenderer.ts';
import { fitViewport, type Viewport } from '../render/viewport.ts';
import { attachCanvasInput } from './canvasInput.ts';
import { el } from './dom.ts';
import { createHistoryControls } from './historyControls.ts';
import { createLayersPanel } from './layersPanel.ts';
import { createPalettePanel } from './palettePanel.ts';
import { attachShortcuts } from './shortcuts.ts';
import { createToolbar } from './toolbar.ts';
import { getTool, type ToolId } from './tools.ts';

/**
 * Editor session state: the document plus everything about how it is being
 * edited. All document changes from the UI go through this class so they
 * reach history, trigger a redraw, and notify listeners.
 */
export class Editor {
  readonly doc: PixelDocument;
  readonly renderer: CanvasRenderer;
  readonly history = new History();
  viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
  tool: ToolId = 'pencil';
  /** Palette index the primary (left) button paints with. */
  primaryIndex = 1;
  private activeLayerId: string;
  /** Last known position of the active layer; used to pick a neighbor if it disappears. */
  private activeIndexHint = 0;
  private stroke: PixelEditSession | null = null;
  private gestureActive = false;
  private renderQueued = false;
  private readonly listeners = new Set<() => void>();

  constructor(doc: PixelDocument, canvas: HTMLCanvasElement) {
    this.doc = doc;
    this.renderer = new CanvasRenderer(canvas);
    this.activeLayerId = doc.layers[0].id;
  }

  get activeLayer(): Layer {
    return findLayer(this.doc, this.activeLayerId) ?? this.doc.layers[0];
  }

  get activeLayerIndex(): number {
    return Math.max(0, layerIndex(this.doc, this.activeLayerId));
  }

  selectLayer(layerId: string): void {
    const index = layerIndex(this.doc, layerId);
    if (index < 0) throw new Error(`Layer ${layerId} not found`);
    this.activeLayerId = layerId;
    this.activeIndexHint = index;
    this.notify();
  }

  setPrimaryIndex(index: number): void {
    this.primaryIndex = index;
    this.notify();
  }

  setTool(tool: ToolId): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.notify();
  }

  /**
   * Applies an edit and records it in history. No-op for null (constructors
   * return null for "no change") and while a gesture is in progress.
   */
  perform(edit: Edit | null): void {
    if (!edit || this.busy) return;
    applyEdit(this.doc, edit, 'redo');
    this.history.push(edit);
    this.documentChanged();
  }

  /**
   * Shows or hides a layer. Intentionally not undoable (as in most pixel art
   * editors): toggling visibility to compare shouldn't consume undo steps.
   */
  setLayerVisible(layerId: string, visible: boolean): void {
    const layer = findLayer(this.doc, layerId);
    if (!layer || layer.visible === visible) return;
    layer.visible = visible;
    this.requestRender();
    this.notify();
  }

  /**
   * Live opacity preview (e.g. while a slider is dragged). Not recorded:
   * follow up with `perform(layerPropsEdit(..., { opacity }, { opacity: start }))`.
   */
  previewLayerOpacity(layerId: string, opacity: number): void {
    const layer = findLayer(this.doc, layerId);
    if (!layer) return;
    layer.opacity = opacity;
    this.requestRender();
  }

  /**
   * Live selection preview (e.g. while dragging a marquee or a move). Not
   * recorded: follow up with `record(selectionChange(before, after, label))`.
   */
  previewSelection(selection: Rect | null): void {
    this.doc.selection = selection;
    this.requestRender();
  }

  /**
   * Starts recording pixel writes to the active layer as one undoable edit.
   * All UI pixel writes must go through a stroke so they land in history.
   * Writes are clipped to the selection unless `clipToSelection` is false.
   */
  beginStroke(label: string, { clipToSelection = true } = {}): PixelEditSession {
    this.endStroke();
    this.stroke = beginPixelEdit(this.doc, this.activeLayer, label, clipToSelection ? this.doc.selection : null);
    return this.stroke;
  }

  /** Commits the current stroke, if any, to history. */
  endStroke(): void {
    this.record(this.takeStroke());
  }

  /** Ends the current stroke and returns its edit without recording it, for combining with other edits. */
  takeStroke(): PixelEdit | null {
    if (!this.stroke) return null;
    const edit = this.stroke.finish();
    this.stroke = null;
    return edit;
  }

  /** Records an edit whose changes are already applied (strokes, previews). No-op for null. */
  record(edit: Edit | null): void {
    if (!edit) return;
    this.history.push(edit);
    this.documentChanged();
  }

  /** Whether a pointer gesture or stroke is in progress; undo/redo and `perform` wait until it ends. */
  get busy(): boolean {
    return this.stroke !== null || this.gestureActive;
  }

  /** Set by canvas input around tool gestures that don't use a stroke (e.g. marquee). */
  setGestureActive(active: boolean): void {
    this.gestureActive = active;
  }

  undo(): void {
    // Undoing underneath an in-progress gesture would interleave the two edits.
    if (this.busy || !this.history.undo(this.doc)) return;
    this.documentChanged();
  }

  redo(): void {
    if (this.busy || !this.history.redo(this.doc)) return;
    this.documentChanged();
  }

  /** Subscribes to editor state changes (not per-pixel edits). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Schedules a redraw on the next animation frame. Safe to call repeatedly. */
  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.doc, this.viewport);
    });
  }

  private documentChanged(): void {
    this.syncActiveLayer();
    this.requestRender();
    this.notify();
  }

  /** Keeps the active layer valid after layers are added, removed, or moved. */
  private syncActiveLayer(): void {
    let index = layerIndex(this.doc, this.activeLayerId);
    if (index < 0) {
      index = Math.min(this.activeIndexHint, this.doc.layers.length - 1);
      this.activeLayerId = this.doc.layers[index].id;
    }
    this.activeIndexHint = index;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function mountEditor(root: HTMLElement, doc: PixelDocument): Editor {
  root.replaceChildren();
  const layout = el('div', 'editor');
  const sidebar = el('aside', 'sidebar');
  const stage = el('main', 'stage');
  const canvas = el('canvas', 'stage-canvas');
  const title = el('h1', 'app-title');
  title.textContent = 'Pixgrind';

  const editor = new Editor(doc, canvas);
  stage.append(canvas);
  sidebar.append(title, createHistoryControls(editor), createPalettePanel(editor), createLayersPanel(editor));
  layout.append(sidebar, createToolbar(editor), stage);
  root.append(layout);
  attachCanvasInput(canvas, editor);
  attachShortcuts(window, editor);

  // Hidden layers can't be painted on; show that with the cursor.
  const syncStageLock = () =>
    stage.classList.toggle('is-locked', !editor.activeLayer.visible && getTool(editor.tool).paints);
  editor.onChange(syncStageLock);
  syncStageLock();

  let stageSize: { width: number; height: number } | null = null;
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    editor.renderer.resize(width, height);
    if (!stageSize) {
      editor.viewport = fitViewport(doc.width, doc.height, width, height);
    } else {
      // Keep the same point at the center of the stage as it resizes.
      editor.viewport = {
        ...editor.viewport,
        offsetX: editor.viewport.offsetX + (width - stageSize.width) / 2,
        offsetY: editor.viewport.offsetY + (height - stageSize.height) / 2,
      };
    }
    stageSize = { width, height };
    editor.requestRender();
  };
  new ResizeObserver(resize).observe(stage);
  watchDevicePixelRatio(resize);

  return editor;
}

/**
 * Calls `onChange` whenever `devicePixelRatio` changes, e.g. when the window
 * moves to a monitor with different scaling. ResizeObserver misses this case
 * because the element's CSS size stays the same.
 */
function watchDevicePixelRatio(onChange: () => void): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      onChange();
      watchDevicePixelRatio(onChange);
    },
    { once: true },
  );
}
