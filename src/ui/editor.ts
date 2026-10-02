import { beginPixelEdit, type PixelEditSession } from '../core/edits.ts';
import { History } from '../core/history.ts';
import type { Layer } from '../core/layer.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import { CanvasRenderer } from '../render/canvasRenderer.ts';
import { fitViewport, type Viewport } from '../render/viewport.ts';
import { attachCanvasInput } from './canvasInput.ts';
import { createHistoryControls } from './historyControls.ts';
import { createPalettePanel } from './palettePanel.ts';
import { attachShortcuts } from './shortcuts.ts';

/** Editor session state: the document plus everything about how it is being edited. */
export class Editor {
  readonly doc: PixelDocument;
  readonly renderer: CanvasRenderer;
  readonly history = new History();
  viewport: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
  activeLayerIndex = 0;
  /** Palette index the primary (left) button paints with. */
  primaryIndex = 1;
  private stroke: PixelEditSession | null = null;
  private renderQueued = false;
  private readonly listeners = new Set<() => void>();

  constructor(doc: PixelDocument, canvas: HTMLCanvasElement) {
    this.doc = doc;
    this.renderer = new CanvasRenderer(canvas);
  }

  get activeLayer(): Layer {
    return this.doc.layers[this.activeLayerIndex];
  }

  setPrimaryIndex(index: number): void {
    this.primaryIndex = index;
    this.notify();
  }

  /**
   * Starts recording pixel writes to the active layer as one undoable edit.
   * All UI pixel writes must go through a stroke so they land in history.
   */
  beginStroke(label: string): PixelEditSession {
    this.endStroke();
    this.stroke = beginPixelEdit(this.doc, this.activeLayer, label);
    return this.stroke;
  }

  /** Commits the current stroke, if any, to history. */
  endStroke(): void {
    if (!this.stroke) return;
    const edit = this.stroke.finish();
    this.stroke = null;
    if (edit) {
      this.history.push(edit);
      this.notify();
    }
  }

  undo(): void {
    // Undoing underneath an in-progress stroke would interleave the two edits.
    if (this.stroke || !this.history.undo(this.doc)) return;
    this.requestRender();
    this.notify();
  }

  redo(): void {
    if (this.stroke || !this.history.redo(this.doc)) return;
    this.requestRender();
    this.notify();
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

  stage.append(canvas);
  layout.append(sidebar, stage);
  root.append(layout);

  const editor = new Editor(doc, canvas);
  sidebar.append(title, createHistoryControls(editor), createPalettePanel(editor));
  attachCanvasInput(canvas, editor);
  attachShortcuts(window, editor);

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}
