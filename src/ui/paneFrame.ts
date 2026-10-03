import { el, iconButton, watchDevicePixelRatio } from './dom.ts';
import type { Editor, Pane } from './editor.ts';

/** Narrowest a pane can be dragged. */
const MIN_PANE_WIDTH = 160;
/** Room a pane leaves for the canvas beside it. */
const MIN_STAGE_WIDTH = 200;

export interface PaneFrame {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The bar over the pane's top edge; controls go in after the title. */
  bar: HTMLElement;
}

/**
 * The frame shared by the panes beside the canvas: a canvas filling the
 * pane, a bar over its top edge with a short title and a close button, and a
 * handle on its left edge to drag it wider or narrower. Shown while
 * `editor.panes[pane]` is open. `onResize` gets the canvas's CSS size
 * whenever it changes (also when the screen's pixel ratio does).
 */
export function createPaneFrame(
  editor: Editor,
  pane: Pane,
  title: string,
  /** What the pane is, for screen readers and the close button: e.g. "side view". */
  name: string,
  onResize: (width: number, height: number) => void,
): PaneFrame {
  const element = el('section', `view-pane ${pane}-pane`);
  element.setAttribute('aria-label', name);
  const canvas = el('canvas', 'pane-canvas');
  const bar = el('div', 'pane-bar');
  const heading = el('span', 'pane-title');
  heading.textContent = title;
  const close = iconButton('close', `Close the ${name}`, () => editor.setPaneOpen(pane, false));
  close.classList.add('pane-close');
  bar.append(heading, close);
  const splitter = el('div', 'pane-splitter');
  splitter.title = 'Drag to resize';
  element.append(canvas, bar, splitter);
  attachSplitter(splitter, element);

  const sync = () => {
    element.hidden = !editor.panes[pane];
  };
  editor.onChange(sync);
  sync();

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (width > 0 && height > 0) onResize(width, height);
  };
  new ResizeObserver(resize).observe(canvas);
  watchDevicePixelRatio(resize);

  return { element, canvas, bar };
}

/** Puts a control in the pane bar, before the close button. */
export function addToBar(frame: PaneFrame, ...controls: HTMLElement[]): void {
  frame.bar.lastElementChild?.before(...controls);
}

/** Dragging the handle sets the pane's width, keeping some room for the canvas. */
function attachSplitter(splitter: HTMLElement, pane: HTMLElement): void {
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;
  splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { pointerId: e.pointerId, startX: e.clientX, startWidth: pane.getBoundingClientRect().width };
    splitter.setPointerCapture(e.pointerId);
  });
  splitter.addEventListener('pointermove', (e) => {
    if (drag?.pointerId !== e.pointerId) return;
    const workspace = pane.parentElement?.getBoundingClientRect().width ?? Infinity;
    const others = [...(pane.parentElement?.children ?? [])]
      .filter((child) => child !== pane && child.classList.contains('view-pane') && !(child as HTMLElement).hidden)
      .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
    const max = Math.max(MIN_PANE_WIDTH, workspace - others - MIN_STAGE_WIDTH);
    const width = Math.min(max, Math.max(MIN_PANE_WIDTH, drag.startWidth - (e.clientX - drag.startX)));
    pane.style.width = `${Math.round(width)}px`;
  });
  const end = (e: PointerEvent) => {
    if (drag?.pointerId === e.pointerId) drag = null;
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
}
