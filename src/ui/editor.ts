import { brushMask, clampBrushSize, DEFAULT_BRUSH, type Brush } from '../core/brush.ts';
import type { Rgba } from '../core/color.ts';
import {
  applyEdit,
  beginPixelEdit,
  editedSide,
  editSetsFloating,
  followIndex,
  type Edit,
  type EditDirection,
  type PixelEdit,
  type PixelEditSession,
} from '../core/edits.ts';
import { MAX_DEPTH, MAX_OFFSET, MIN_DEPTH, type Shape } from '../core/extrusion.ts';
import { planeExtent, planeSize, type Facing } from '../core/facing.ts';
import { History } from '../core/history.ts';
import type { Layer } from '../core/layer.ts';
import type { Mask, SelectionMode } from '../core/mask.ts';
import { buildVoxelModel, otherSidesView, type IndexImage, type VoxelModel } from '../core/model.ts';
import { TRANSPARENT } from '../core/palette.ts';
import { facingLayers, findLayer, layerIndex, type FloatingPixels, type PixelDocument } from '../core/pixelDocument.ts';
import type { Point } from '../core/raster.ts';
import { CanvasRenderer, type BrushCursor } from '../render/canvasRenderer.ts';
import type { ReferenceImage, ReferenceSettings } from '../render/referenceImage.ts';
import { fitViewport, type Viewport } from '../render/viewport.ts';
import { attachCanvasInput } from './canvasInput.ts';
import { attachClipboard } from './clipboard.ts';
import { el, watchDevicePixelRatio } from './dom.ts';
import { createFilePanel } from './filePanel.ts';
import { createHistoryControls } from './historyControls.ts';
import { createLayersPanel } from './layersPanel.ts';
import { createModelPane } from './modelPane.ts';
import { createModelPanel } from './modelPanel.ts';
import { createPerspectiveBar } from './perspectiveBar.ts';
import { createPaletteLibraryPanel, openPaletteLibrary } from './paletteLibraryPanel.ts';
import { createBrushPanel } from './brushPanel.ts';
import { createPalettePanel } from './palettePanel.ts';
import { createReferencePanel } from './referencePanel.ts';
import { createSelectionPanel } from './selectionPanel.ts';
import { attachShortcuts } from './shortcuts.ts';
import { createSidePane } from './sidePane.ts';
import { createToolbar } from './toolbar.ts';
import { getTool, type ToolId } from './tools.ts';

/** The two paint colors: the left mouse button uses the primary, the right the secondary. */
export type ColorSlot = 'primary' | 'secondary';

/** Views that open beside the canvas: the side view of one column, and the 3D model. */
export type Pane = 'side' | 'model';

/** What the Extrude tool paints: boxes `depth` deep, starting `offset` out from the far side toward the camera. */
export interface ExtrudeSettings {
  offset: number;
  depth: number;
}

/** What the Diagonal tool paints: a shape, or `auto` for each pixel's own (see `autoShape`). */
export type DiagonalChoice = Shape | 'auto';

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
  /** Pixel-perfect freehand strokes: drop the corners of L-shaped turns. Only with a 1px brush. */
  pixelPerfect = false;
  /** How selection tools combine with the selection, unless Shift/Ctrl say otherwise. Change via `setSelectionMode`. */
  selectionMode: SelectionMode = 'replace';
  /** The magic wand selects only touching pixels of the color; otherwise all of them on the layer. */
  wandContiguous = true;
  /** Document pixel under the pointer, or null when it's off the canvas. Drives the brush outline. */
  pointer: Point | null = null;
  /** Tracing guide shown with the artwork; never part of the document. Change via `setReference`/`updateReference`. */
  reference: ReferenceImage | null = null;
  /** What the Extrude tool and "Apply" paint. Change via `setExtrude`. */
  extrude: ExtrudeSettings = { offset: 0, depth: 2 };
  /** What the Diagonal tool and its "Apply" paint. Change via `setDiagonal`. */
  diagonal: DiagonalChoice = 'auto';
  /** The column of the side being edited that the side view shows. Change via `setSliceColumn`. */
  sliceColumn = 0;
  /** Label the active layer's pixels with their depth on the canvas. Change via `setShowDepth`. */
  showDepth = false;
  /** Show the rest of the model, seen from the side being edited, faintly under its layers. Change via `setShowGuide`. */
  showGuide = true;
  /** Which panes are open beside the canvas. Change via `setPaneOpen`. */
  readonly panes: Record<Pane, boolean> = { side: false, model: false };
  /**
   * The side of the model the canvas shows and edits (see `Facing`): its
   * layers, selection and size. Change via `setFacing`.
   */
  facing: Facing = 'front';
  /** The active layer per side. */
  private readonly activeLayerIds: Partial<Record<Facing, string>> = {};
  /** Last known position of each side's active layer among that side's layers; used to pick a neighbor if it disappears. */
  private readonly activeIndexHints: Partial<Record<Facing, number>> = {};
  private stroke: PixelEditSession | null = null;
  private gestureActive = false;
  /** Path of a lasso being drawn, shown until it's released. */
  private lasso: readonly Point[] | null = null;
  /** Plane size the viewport was last fitted to. */
  private fittedSize: { width: number; height: number };
  /** The guide for the side being edited, built for `stamp`. */
  private guideCache: { facing: Facing; stamp: number; image: IndexImage } | null = null;
  /** Goes up whenever other sides may have changed, so the guide is rebuilt. Strokes on one side don't change it. */
  private guideStamp = 0;
  /** History position when the document was last saved or opened as a project. */
  private savedPosition: object;
  /** Layer visibility is saved in projects but changes outside history, so it's tracked separately. */
  private visibilityChanged = false;
  private renderQueued = false;
  /** Whether document content may have changed since the last render, so the layer composite must be redone. */
  private compositeStale = true;
  private documentRevision = 0;
  /** Goes up whenever content may have changed (every `requestRender('content')`), even mid-stroke. */
  private contentChanges = 0;
  private modelCache: { version: number; model: VoxelModel } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly renderListeners = new Set<(contentChanged: boolean) => void>();

  constructor(doc: PixelDocument, canvas: HTMLCanvasElement) {
    this.doc = doc;
    this.renderer = new CanvasRenderer(canvas);
    this.fittedSize = this.plane;
    this.savedPosition = this.history.position;
  }

  /** The size of the side being edited. */
  get plane(): { width: number; height: number } {
    return planeSize(this.doc, this.facing);
  }

  /** How far boxes on the side being edited can reach: the volume's size toward its camera. */
  get extent(): number {
    return planeExtent(this.doc, this.facing);
  }

  /** The selection on the side being edited. */
  get selection(): Mask | null {
    return this.doc.selections[this.facing];
  }

  /**
   * Switches the canvas to another side of the model: its layers, selection
   * and active layer. Unfinished multi-click work (a polygon) is dropped. A
   * floating selection stays with its layer. Ignored mid-gesture.
   */
  setFacing(facing: Facing): void {
    if (facing === this.facing || this.busy) return;
    getTool(this.tool).deactivate?.(this);
    this.facing = facing;
    this.sliceColumn = Math.min(this.sliceColumn, this.plane.width - 1);
    this.fitIfResized();
    this.requestRender();
    this.notify();
  }

  setShowGuide(on: boolean): void {
    if (this.showGuide === on) return;
    this.showGuide = on;
    this.requestRender('view');
    this.notify();
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

  /**
   * Goes up with every recorded edit, undo and redo, so panels can cache
   * what they derive from the document (e.g. color usage) between changes.
   */
  get revision(): number {
    return this.documentRevision;
  }

  /**
   * Goes up whenever the document's content may have changed, including
   * during strokes and live previews, for views that cache what they draw.
   */
  get contentVersion(): number {
    return this.contentChanges;
  }

  /** The layer being edited, on the side being edited. */
  get activeLayer(): Layer {
    const id = this.activeLayerIds[this.facing];
    const layer = id === undefined ? undefined : findLayer(this.doc, id);
    if (layer?.facing === this.facing) return layer;
    // Every side has a layer; until one is chosen, it's the topmost.
    return facingLayers(this.doc, this.facing).at(-1)!;
  }

  /** The active layer's position in `doc.layers` (all sides). */
  get activeLayerIndex(): number {
    return Math.max(0, layerIndex(this.doc, this.activeLayer.id));
  }

  /** Makes a layer the active one, switching to its side. */
  selectLayer(layerId: string): void {
    const layer = findLayer(this.doc, layerId);
    if (!layer) throw new Error(`Layer ${layerId} not found`);
    this.activeLayerIds[layer.facing] = layerId;
    this.activeIndexHints[layer.facing] = facingLayers(this.doc, layer.facing).indexOf(layer);
    if (layer.facing !== this.facing) {
      this.setFacing(layer.facing);
      return;
    }
    // The brush outline hides over hidden layers.
    this.requestRender('view');
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
    getTool(this.tool).deactivate?.(this);
    this.tool = tool;
    this.requestRender('view');
    this.notify();
  }

  setBrush(changes: Partial<Brush>): void {
    const brush = { ...this.brush, ...changes };
    brush.size = clampBrushSize(brush.size);
    if (brush.size === this.brush.size && brush.shape === this.brush.shape) return;
    this.brush = brush;
    this.requestRender('view');
    this.notify();
  }

  setPixelPerfect(on: boolean): void {
    if (this.pixelPerfect === on) return;
    this.pixelPerfect = on;
    this.notify();
  }

  setSelectionMode(mode: SelectionMode): void {
    if (this.selectionMode === mode) return;
    this.selectionMode = mode;
    this.notify();
  }

  setWandContiguous(on: boolean): void {
    if (this.wandContiguous === on) return;
    this.wandContiguous = on;
    this.notify();
  }

  setExtrude(changes: Partial<ExtrudeSettings>): void {
    const offset = clampInteger(changes.offset ?? this.extrude.offset, 0, MAX_OFFSET);
    const depth = clampInteger(changes.depth ?? this.extrude.depth, MIN_DEPTH, MAX_DEPTH);
    if (offset === this.extrude.offset && depth === this.extrude.depth) return;
    this.extrude = { offset, depth };
    this.notify();
  }

  setDiagonal(choice: DiagonalChoice): void {
    if (this.diagonal === choice) return;
    this.diagonal = choice;
    this.notify();
  }

  /** Shows column `x` (of the side being edited) in the side view, clamped to it. */
  setSliceColumn(x: number): void {
    const column = clampInteger(x, 0, this.plane.width - 1);
    if (column === this.sliceColumn) return;
    this.sliceColumn = column;
    this.requestRender('view');
    this.notify();
  }

  setShowDepth(on: boolean): void {
    if (this.showDepth === on) return;
    this.showDepth = on;
    this.requestRender('view');
    this.notify();
  }

  setPaneOpen(pane: Pane, open: boolean): void {
    if (this.panes[pane] === open) return;
    this.panes[pane] = open;
    // The canvas marks the side view's column.
    this.requestRender('view');
    this.notify();
  }

  /**
   * The 3D model of the document as it is now (see `buildVoxelModel`).
   * Built on demand and kept until content changes, so views can share it.
   */
  get voxelModel(): VoxelModel {
    if (this.modelCache?.version !== this.contentChanges) {
      this.modelCache = { version: this.contentChanges, model: buildVoxelModel(this.doc) };
    }
    return this.modelCache.model;
  }

  /**
   * Called after each canvas render, with whether document content may have
   * changed since the last one. Views that follow the canvas (the side and
   * 3D views) redraw from here. Returns an unsubscribe function.
   */
  onRender(listener: (contentChanged: boolean) => void): () => void {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  /** Called by canvas input as the pointer moves over (or leaves) the canvas. */
  setPointer(pointer: Point | null): void {
    if (pointer?.x === this.pointer?.x && pointer?.y === this.pointer?.y) return;
    this.pointer = pointer;
    if (getTool(this.tool).brush) this.requestRender('view');
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
    this.requestRender('view');
    this.notify();
  }

  /** Changes reference settings. `silent` skips listeners, for per-pointer-move updates. */
  updateReference(settings: Partial<ReferenceSettings>, { silent = false } = {}): void {
    if (!this.reference) return;
    Object.assign(this.reference, settings);
    this.requestRender('view');
    if (!silent) this.notify();
  }

  /**
   * Applies an edit and records it in history. No-op for null (constructors
   * return null for "no change") and while a gesture is in progress. Returns
   * whether the edit was applied.
   */
  perform(edit: Edit | null): boolean {
    if (!edit || this.busy) return false;
    const full = this.droppingFloat(edit);
    applyEdit(this.doc, full, 'redo');
    this.history.push(full);
    this.documentChanged(full, 'redo');
    return true;
  }

  /**
   * Any edit that doesn't manage the floating selection itself drops it
   * first, in the same history entry, so undo brings the float back. This is
   * safe for edits built while the float existed: dropping changes no pixels.
   */
  private droppingFloat(edit: Edit): Edit {
    const { floating } = this.doc;
    if (!floating || editSetsFloating(edit)) return edit;
    const drop: Edit = { kind: 'floating', label: edit.label, before: floating, after: null };
    return { kind: 'batch', label: edit.label, edits: [drop, edit] };
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
    this.guideStamp++;
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
    // A layer at 0% isn't modeled.
    this.guideStamp++;
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
  previewSelection(selection: Mask | null): void {
    this.doc.selections[this.facing] = selection;
    this.requestRender('view');
  }

  /** Shows the path of a lasso being drawn (null to hide it). Not document state. */
  previewLasso(points: readonly Point[] | null): void {
    this.lasso = points;
    this.requestRender('view');
  }

  /**
   * Live floating-selection preview (e.g. while dragging it). Not recorded:
   * follow up with `record(...)` including `floatingChange(before, after, label)`.
   */
  previewFloating(floating: FloatingPixels | null): void {
    this.doc.floating = floating;
    // Its pixels are in the layer, written (and rendered) separately.
    this.requestRender('view');
  }

  /**
   * Starts recording pixel writes to the active layer as one undoable edit.
   * All UI pixel writes must go through a stroke so they land in history.
   * Writes are clipped to the selection unless `clipToSelection` is false.
   */
  beginStroke(label: string, { clipToSelection = true } = {}): PixelEditSession {
    this.endStroke();
    this.stroke = beginPixelEdit(this.activeLayer, label, clipToSelection ? this.selection : null);
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
    const full = this.droppingFloat(edit);
    // A drop added here isn't applied yet, and this is all it does.
    if (full !== edit) this.doc.floating = null;
    this.history.push(full);
    this.documentChanged(full, 'redo');
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
    if (!edit) return;
    this.documentChanged(edit, 'undo');
    this.showEditedSide(edit);
  }

  redo(): void {
    if (this.busy) return;
    const edit = this.history.redo(this.doc);
    if (!edit) return;
    this.documentChanged(edit, 'redo');
    this.showEditedSide(edit);
  }

  /** After undo or redo: switches to the side the edit changed, if it's another, so the change shows. */
  private showEditedSide(edit: Edit): void {
    const where = editedSide(this.doc, edit);
    if (!where || where.facing === this.facing) return;
    if (where.layerId) this.selectLayer(where.layerId);
    else this.setFacing(where.facing);
  }

  /** Subscribes to editor state changes (not per-pixel edits). Returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Schedules a redraw on the next animation frame. Safe to call repeatedly.
   * `view` says only the view or overlays changed (zoom, pan, brush outline,
   * selection, lasso, reference), not pixels, palette or layers, so the layer
   * composite is reused. When in doubt, leave the default.
   */
  requestRender(change: 'content' | 'view' = 'content'): void {
    if (change === 'content') {
      this.compositeStale = true;
      this.contentChanges++;
    }
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      const reuseComposite = !this.compositeStale;
      this.compositeStale = false;
      this.renderer.render(
        this.doc,
        this.facing,
        this.viewport,
        {
          reference: this.reference,
          guide: this.showGuide ? this.guide() : null,
          brush: this.brushCursor(),
          lasso: this.lasso,
          slice: this.panes.side ? this.sliceColumn : null,
          // The Diagonal tool shows what it paints.
          extrusions:
            this.showDepth || this.tool === 'diagonal' ? { layer: this.activeLayer, depths: this.showDepth } : null,
        },
        { reuseComposite },
      );
      for (const listener of this.renderListeners) listener(!reuseComposite);
    });
  }

  /** The brush outline to draw under the pointer, when the current tool paints with the brush. */
  private brushCursor(): BrushCursor | null {
    const tool = getTool(this.tool);
    if (!this.pointer || !tool.brush || !this.activeLayer.visible) return null;
    return { ...this.pointer, mask: brushMask(this.brush) };
  }

  /** The guide for the side being edited, rebuilt only when other sides may have changed. */
  private guide(): IndexImage {
    const cached = this.guideCache;
    if (cached?.facing === this.facing && cached.stamp === this.guideStamp) return cached.image;
    const image = otherSidesView(this.doc, this.facing);
    this.guideCache = { facing: this.facing, stamp: this.guideStamp, image };
    return image;
  }

  /** Fits the side being edited in view at the largest whole-number zoom. */
  fitToView(): void {
    const { width, height } = this.renderer.viewSize;
    const plane = this.plane;
    if (width > 0 && height > 0) this.viewport = fitViewport(plane.width, plane.height, width, height);
    this.requestRender('view');
  }

  /** Refits the view when the side being edited has a different size than it was fitted to (e.g. an opened image). */
  private fitIfResized(): void {
    const plane = this.plane;
    if (plane.width === this.fittedSize.width && plane.height === this.fittedSize.height) return;
    this.fittedSize = plane;
    this.fitToView();
    this.sliceColumn = Math.min(this.sliceColumn, plane.width - 1);
  }

  private documentChanged(edit: Edit, direction: EditDirection): void {
    this.documentRevision++;
    this.guideStamp++;
    this.fitIfResized();
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
    const layers = facingLayers(this.doc, this.facing);
    let index = layers.findIndex((layer) => layer.id === this.activeLayerIds[this.facing]);
    if (index < 0) {
      index = Math.min(this.activeIndexHints[this.facing] ?? layers.length - 1, layers.length - 1);
      this.activeLayerIds[this.facing] = layers[index].id;
    }
    this.activeIndexHints[this.facing] = index;
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
  stage.append(canvas, createPerspectiveBar(editor));
  sidebar.append(
    title,
    createHistoryControls(editor),
    filePanel.element,
    createBrushPanel(editor),
    createSelectionPanel(editor),
    createPalettePanel(editor),
    createPaletteLibraryPanel(editor, openPaletteLibrary()),
    createReferencePanel(editor),
    createLayersPanel(editor),
    createModelPanel(editor),
  );
  // The side and 3D views open beside the canvas, sharing its height so the
  // side view's rows line up with the canvas's.
  const workspace = el('div', 'workspace');
  workspace.append(stage, createSidePane(editor), createModelPane(editor));
  layout.append(sidebar, createToolbar(editor), workspace);
  root.append(layout);
  attachCanvasInput(canvas, editor);
  attachShortcuts(window, editor, filePanel);
  attachClipboard(document, editor, filePanel.report);

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
    editor.requestRender('view');
  };
  new ResizeObserver(resize).observe(stage);
  watchDevicePixelRatio(resize);

  return editor;
}

function clampInteger(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}
