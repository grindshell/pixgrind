import { brushMask, clampBrushSize, DEFAULT_BRUSH, type Brush } from '../core/brush.ts';
import type { Rgba } from '../core/color.ts';
import {
  applyEdit,
  beginPixelEdit,
  followIndex,
  type Edit,
  type EditDirection,
  type PixelEdit,
  type PixelEditSession,
} from '../core/edits.ts';
import { History } from '../core/history.ts';
import type { Layer } from '../core/layer.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { findLayer, layerIndex, type PixelDocument } from '../core/pixelDocument.ts';
import type { Point } from '../core/raster.ts';
import type { Rect } from '../core/rect.ts';
import { CanvasRenderer, type BrushCursor } from '../render/canvasRenderer.ts';
import type { ReferenceImage, ReferenceSettings } from '../render/referenceImage.ts';
import { fitViewport, type Viewport } from '../render/viewport.ts';
import { attachCanvasInput } from './canvasInput.ts';
import { el } from './dom.ts';
import { createFilePanel } from './filePanel.ts';
import { createHistoryControls } from './historyControls.ts';
import { createLayersPanel } from './layersPanel.ts';
import { createPaletteLibraryPanel, openPaletteLibrary } from './paletteLibraryPanel.ts';
import { createBrushPanel } from './brushPanel.ts';
import { createPalettePanel } from './palettePanel.ts';
import { createReferencePanel } from './referencePanel.ts';
import { attachShortcuts } from './shortcuts.ts';
import { createToolbar } from './toolbar.ts';
import { getTool, type ToolId } from './tools.ts';

/** The two paint colors: the left mouse button uses the primary, the right the secondary. */
export type ColorSlot = 'primary' | 'secondary';

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
  /** Palette index the left button paints with; `TRANSPARENT` erases. Change via `setColorIndex`. */
  primaryIndex = 1;
  /** Palette index the right button paints with. Transparent by default, so right-click erases. */
  secondaryIndex = TRANSPARENT;
  /** Size and shape for the brush tools, shared by all of them. Change via `setBrush`. */
  brush: Brush = { ...DEFAULT_BRUSH };
  /** Document pixel under the pointer, or null when it's off the canvas. Drives the brush outline. */
  pointer: Point | null = null;
  /** Tracing guide shown with the artwork; never part of the document. Change via `setReference`/`updateReference`. */
  reference: ReferenceImage | null = null;
  private activeLayerId: string;
  /** Last known position of the active layer; used to pick a neighbor if it disappears. */
  private activeIndexHint = 0;
  private stroke: PixelEditSession | null = null;
  private gestureActive = false;
  /** Document size the viewport was last fitted to. */
  private fittedSize: { width: number; height: number };
  /** History position when the document was last saved or opened as a project. */
  private savedPosition: object;
  /** Layer visibility is saved in projects but changes outside history, so it's tracked separately. */
  private visibilityChanged = false;
  private renderQueued = false;
  private readonly listeners = new Set<() => void>();

  constructor(doc: PixelDocument, canvas: HTMLCanvasElement) {
    this.doc = doc;
    this.renderer = new CanvasRenderer(canvas);
    this.activeLayerId = doc.layers[0].id;
    this.fittedSize = { width: doc.width, height: doc.height };
    this.savedPosition = this.history.position;
  }

  /**
   * Whether the document has changes since it was last saved (or since it was
   * opened from a project). Undoing back to the saved state makes it clean
   * again. The reference image doesn't count: it's a guide, not artwork.
   */
  get dirty(): boolean {
    return this.visibilityChanged || this.history.position !== this.savedPosition;
  }

  /** Marks the document saved as of `position` (default: now), e.g. after saving a project. */
  markSaved(position: object = this.history.position): void {
    this.savedPosition = position;
    this.visibilityChanged = false;
    this.notify();
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
    // The brush outline hides over hidden layers.
    this.requestRender();
    this.notify();
  }

  colorIndex(slot: ColorSlot): number {
    return slot === 'primary' ? this.primaryIndex : this.secondaryIndex;
  }

  /** Sets the palette index a button paints with: 1–n for a palette color, `TRANSPARENT` to erase. */
  setColorIndex(slot: ColorSlot, index: number): void {
    if (!Number.isInteger(index) || index < TRANSPARENT || index > this.doc.palette.colors.length) {
      throw new RangeError(`No palette color ${index}`);
    }
    if (slot === 'primary') this.primaryIndex = index;
    else this.secondaryIndex = index;
    this.notify();
  }

  /** Exchanges the primary and secondary colors. */
  swapColors(): void {
    [this.primaryIndex, this.secondaryIndex] = [this.secondaryIndex, this.primaryIndex];
    this.notify();
  }

  setTool(tool: ToolId): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.requestRender();
    this.notify();
  }

  setBrush(changes: Partial<Brush>): void {
    const brush = { ...this.brush, ...changes };
    brush.size = clampBrushSize(brush.size);
    if (brush.size === this.brush.size && brush.shape === this.brush.shape) return;
    this.brush = brush;
    this.requestRender();
    this.notify();
  }

  /** Called by canvas input as the pointer moves over (or leaves) the canvas. */
  setPointer(pointer: Point | null): void {
    if (pointer?.x === this.pointer?.x && pointer?.y === this.pointer?.y) return;
    this.pointer = pointer;
    if (getTool(this.tool).brush) this.requestRender();
  }

  /**
   * Sets or clears the reference image. Like layer visibility, reference
   * changes aren't undoable: adjusting a tracing guide shouldn't consume undo
   * steps.
   */
  setReference(reference: ReferenceImage | null): void {
    if (this.reference && this.reference !== reference) this.reference.bitmap.close();
    this.reference = reference;
    if (!reference && this.tool === 'reference') this.tool = 'pencil';
    this.requestRender();
    this.notify();
  }

  /** Changes reference settings. `silent` skips listeners, for per-pointer-move updates. */
  updateReference(settings: Partial<ReferenceSettings>, { silent = false } = {}): void {
    if (!this.reference) return;
    Object.assign(this.reference, settings);
    this.requestRender();
    if (!silent) this.notify();
  }

  /**
   * Applies an edit and records it in history. No-op for null (constructors
   * return null for "no change") and while a gesture is in progress. Returns
   * whether the edit was applied.
   */
  perform(edit: Edit | null): boolean {
    if (!edit || this.busy) return false;
    applyEdit(this.doc, edit, 'redo');
    this.history.push(edit);
    this.documentChanged(edit, 'redo');
    return true;
  }

  /**
   * Shows or hides a layer. Intentionally not undoable (as in most pixel art
   * editors): toggling visibility to compare shouldn't consume undo steps.
   */
  setLayerVisible(layerId: string, visible: boolean): void {
    const layer = findLayer(this.doc, layerId);
    if (!layer || layer.visible === visible) return;
    layer.visible = visible;
    this.visibilityChanged = true;
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
   * Live palette color preview (e.g. while a color picker is dragged). Not
   * recorded: follow up with `record(setColorEdit(doc, index, color, previous))`.
   */
  previewPaletteColor(index: number, color: Rgba): void {
    if (index < 1 || index > this.doc.palette.colors.length) return;
    this.doc.palette.colors[index - 1] = color;
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
    this.documentChanged(edit, 'redo');
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
    if (this.busy) return;
    const edit = this.history.undo(this.doc);
    if (edit) this.documentChanged(edit, 'undo');
  }

  redo(): void {
    if (this.busy) return;
    const edit = this.history.redo(this.doc);
    if (edit) this.documentChanged(edit, 'redo');
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
      this.renderer.render(this.doc, this.viewport, { reference: this.reference, brush: this.brushCursor() });
    });
  }

  /** The brush outline to draw under the pointer, when the current tool paints with the brush. */
  private brushCursor(): BrushCursor | null {
    const tool = getTool(this.tool);
    if (!this.pointer || !tool.brush || !this.activeLayer.visible) return null;
    return { ...this.pointer, mask: brushMask(this.brush) };
  }

  /** Fits the whole document in view at the largest whole-number zoom. */
  fitToView(): void {
    const { width, height } = this.renderer.viewSize;
    if (width > 0 && height > 0) this.viewport = fitViewport(this.doc.width, this.doc.height, width, height);
    this.requestRender();
  }

  private documentChanged(edit: Edit, direction: EditDirection): void {
    // A different size (e.g. an opened image) needs a fresh view.
    if (this.doc.width !== this.fittedSize.width || this.doc.height !== this.fittedSize.height) {
      this.fittedSize = { width: this.doc.width, height: this.doc.height };
      this.fitToView();
    }
    this.syncActiveLayer();
    // The paint colors follow their colors when they're renumbered, and stay
    // valid when the palette shrinks.
    const last = this.doc.palette.colors.length;
    this.primaryIndex = Math.min(followIndex(edit, this.primaryIndex, direction), last);
    this.secondaryIndex = Math.min(followIndex(edit, this.secondaryIndex, direction), last);
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
  const filePanel = createFilePanel(editor, stage);
  stage.append(canvas);
  sidebar.append(
    title,
    createHistoryControls(editor),
    filePanel.element,
    createBrushPanel(editor),
    createPalettePanel(editor),
    createPaletteLibraryPanel(editor, openPaletteLibrary()),
    createReferencePanel(editor),
    createLayersPanel(editor),
  );
  layout.append(sidebar, createToolbar(editor), stage);
  root.append(layout);
  attachCanvasInput(canvas, editor);
  attachShortcuts(window, editor, filePanel);

  // Hidden layers can't be painted on; show that with the cursor. The tool id
  // lets CSS pick a cursor per tool.
  const syncStageLock = () => {
    stage.classList.toggle('is-locked', !editor.activeLayer.visible && getTool(editor.tool).paints);
    stage.dataset.tool = editor.tool;
  };
  editor.onChange(syncStageLock);
  syncStageLock();

  const syncTitle = () => {
    document.title = `${editor.dirty ? '• ' : ''}${doc.name} · Pixgrind`;
  };
  editor.onChange(syncTitle);
  syncTitle();

  let stageSize: { width: number; height: number } | null = null;
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    editor.renderer.resize(width, height);
    if (!stageSize) {
      editor.fitToView();
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
