import { layerThumbnailRgba } from '../core/composite.ts';
import type { Layer } from '../core/layer.ts';
import {
  addLayerEdit,
  canMergeDown,
  canRemoveLayer,
  duplicateLayerEdit,
  layerPropsEdit,
  mergeDownEdit,
  moveLayerEdit,
  neighborLayerIndex,
  removeLayerEdit,
} from '../core/layerEdits.ts';
import type { Palette } from '../core/palette.ts';
import { facingLayers } from '../core/pixelDocument.ts';
import { el, iconButton, setButtonLabel } from './dom.ts';
import type { Editor } from './editor.ts';
import { icon } from './icons.ts';
import { facingName } from './perspectiveBar.ts';

/**
 * Thumbnails are drawn at most this many pixels across, enough for their CSS
 * size on high-DPI screens. They're redrawn on every change, so large
 * documents mustn't draw them at full size.
 */
const THUMBNAIL_SIZE = 64;

/**
 * Layer list of the side being edited (top layer first) with
 * add/duplicate/delete, reorder, merge down, visibility, rename
 * (double-click a name), and opacity for the active layer.
 */
export function createLayersPanel(editor: Editor): HTMLElement {
  const { doc } = editor;
  const panel = el('section', 'panel');

  const heading = el('h2', 'panel-title');

  // `perform` refuses edits mid-gesture, so only follow up on ones it applied.
  const addButton = iconButton('plus', 'Add layer', () => {
    const edit = addLayerEdit(doc, editor.facing, editor.activeLayerIndex + 1);
    if (editor.perform(edit)) editor.selectLayer(edit.layer.id);
  });
  const duplicateButton = iconButton('duplicate', 'Duplicate layer', () => {
    const edit = duplicateLayerEdit(doc, editor.activeLayer.id);
    if (editor.perform(edit)) editor.selectLayer(edit.layer.id);
  });
  const deleteButton = iconButton('trash', 'Delete layer', () => {
    const { id } = editor.activeLayer;
    // The layer below on this side takes over, else the one above.
    const below = neighborLayerIndex(doc, id, -1);
    const next = doc.layers[below >= 0 ? below : neighborLayerIndex(doc, id, 1)];
    if (editor.perform(removeLayerEdit(doc, id))) editor.selectLayer(next.id);
  });

  const header = el('div', 'panel-header');
  const headerActions = el('div', 'icon-group');
  headerActions.append(addButton, duplicateButton, deleteButton);
  header.append(heading, headerActions);

  const list = el('ul', 'layer-list');
  list.setAttribute('aria-label', 'Layers');

  // Past the next layer of the same side, whatever lies between on others.
  const moveButton = (step: 1 | -1) => () => {
    const { id } = editor.activeLayer;
    const to = neighborLayerIndex(doc, id, step);
    if (to >= 0) editor.perform(moveLayerEdit(doc, id, to));
  };
  const moveUpButton = iconButton('arrowUp', 'Move layer up', moveButton(1));
  const moveDownButton = iconButton('arrowDown', 'Move layer down', moveButton(-1));
  const mergeButton = iconButton('mergeDown', 'Merge down', () => {
    const { id } = editor.activeLayer;
    const lower = doc.layers[neighborLayerIndex(doc, id, -1)];
    if (editor.perform(mergeDownEdit(doc, id))) editor.selectLayer(lower.id);
  });

  const footer = el('div', 'icon-group layer-footer');
  footer.append(moveUpButton, moveDownButton, mergeButton);

  const opacity = createOpacityControl(editor);

  let rows = new Map<string, LayerRow>();
  let rowsSignature = '';

  const render = () => {
    const active = editor.activeLayer;
    const layers = facingLayers(doc, editor.facing);
    heading.textContent = `Layers · ${facingName(editor.facing)}`;

    // Rebuild rows only when the list itself changed. Selection and pixel
    // changes update rows in place, so focus and double-clicks survive.
    const signature = layers
      .map((l) => `${l.id}\u0000${l.name}\u0000${l.visible}\u0000${l.opacity}\u0000${l.width}x${l.height}`)
      .join('\n');
    if (signature !== rowsSignature) {
      const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusKey : undefined;
      rows = new Map(layers.map((layer) => [layer.id, createLayerRow(editor, layer, render)]));
      list.replaceChildren(...layers.toReversed().map((layer) => rows.get(layer.id)?.row ?? ''));
      rowsSignature = signature;
      if (focusKey) list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
    }
    for (const layer of layers) {
      const parts = rows.get(layer.id);
      if (!parts) continue;
      const isActive = layer.id === active.id;
      parts.row.classList.toggle('is-active', isActive);
      parts.name.setAttribute('aria-pressed', String(isActive));
      drawThumbnail(parts.thumbnail, doc.palette, layer);
    }

    deleteButton.disabled = !canRemoveLayer(doc, active.id);
    moveUpButton.disabled = neighborLayerIndex(doc, active.id, 1) < 0;
    moveDownButton.disabled = neighborLayerIndex(doc, active.id, -1) < 0;
    const merge = canMergeDown(doc, active.id);
    mergeButton.disabled = !merge.ok;
    setButtonLabel(mergeButton, merge.ok ? 'Merge down' : `Merge down: ${merge.reason}`);
    opacity.sync();
  };

  editor.onChange(render);
  render();
  panel.append(header, list, footer, opacity.element);
  return panel;
}

interface LayerRow {
  row: HTMLLIElement;
  name: HTMLButtonElement;
  thumbnail: HTMLCanvasElement;
}

function createLayerRow(editor: Editor, layer: Layer, rerender: () => void): LayerRow {
  const row = el('li', 'layer-row');
  row.classList.toggle('is-hidden', !layer.visible);

  const visibility = el('button', 'icon-button');
  visibility.type = 'button';
  visibility.dataset.focusKey = `${layer.id}:visibility`;
  visibility.append(icon(layer.visible ? 'eye' : 'eyeOff'));
  visibility.setAttribute('aria-pressed', String(layer.visible));
  setButtonLabel(visibility, `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
  visibility.addEventListener('click', () => editor.setLayerVisible(layer.id, !layer.visible));

  const thumbnail = el('canvas', 'layer-thumb');
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(layer.width, layer.height));
  thumbnail.width = Math.max(1, Math.round(layer.width * scale));
  thumbnail.height = Math.max(1, Math.round(layer.height * scale));

  const name = el('button', 'layer-name');
  name.type = 'button';
  name.dataset.focusKey = `${layer.id}:name`;
  name.textContent = layer.name;
  name.title = 'Double-click to rename';
  name.addEventListener('click', () => {
    if (editor.activeLayer.id !== layer.id) editor.selectLayer(layer.id);
  });
  name.addEventListener('dblclick', () => startRename(editor, layer, name, rerender));

  row.append(visibility, thumbnail, name);

  if (layer.opacity < 1) {
    const badge = el('span', 'layer-opacity');
    badge.textContent = `${Math.round(layer.opacity * 100)}%`;
    row.append(badge);
  }
  return { row, name, thumbnail };
}

function startRename(editor: Editor, layer: Layer, nameButton: HTMLButtonElement, rerender: () => void): void {
  const input = el('input', 'layer-name-input');
  input.value = layer.name;
  input.maxLength = 64;
  input.setAttribute('aria-label', 'Layer name');
  // Same key as the name button, so focus returns to it when the row rebuilds.
  input.dataset.focusKey = nameButton.dataset.focusKey;
  nameButton.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    const edit = commit && name ? layerPropsEdit(editor.doc, layer.id, { name }) : null;
    // A rename changes the name, so the panel rebuilds this row.
    if (editor.perform(edit)) return;
    input.replaceWith(nameButton);
    rerender();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/** Draws the layer alone, at full opacity, at the canvas's size (CSS scales it to fit). */
function drawThumbnail(canvas: HTMLCanvasElement, palette: Palette, layer: Layer): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.putImageData(new ImageData(layerThumbnailRgba(palette, layer, width, height), width, height), 0, 0);
}

/** Opacity slider for the active layer: previews live while dragging, records one edit on release. */
function createOpacityControl(editor: Editor): { element: HTMLElement; sync: () => void } {
  const element = el('label', 'opacity-row');
  const caption = el('span');
  caption.textContent = 'Opacity';
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  const value = el('span', 'opacity-value');
  element.append(caption, slider, value);

  /** Opacity when the current drag began; null when not dragging. */
  let dragStart: number | null = null;
  const percent = () => Number(slider.value);

  slider.addEventListener('input', () => {
    const layer = editor.activeLayer;
    dragStart ??= layer.opacity;
    editor.previewLayerOpacity(layer.id, percent() / 100);
    value.textContent = `${percent()}%`;
  });
  slider.addEventListener('change', () => {
    const layer = editor.activeLayer;
    const before = dragStart ?? layer.opacity;
    dragStart = null;
    const edit = layerPropsEdit(editor.doc, layer.id, { opacity: percent() / 100 }, { opacity: before });
    if (editor.perform(edit)) return;
    // Nothing recorded: don't leave the preview applied outside history.
    editor.previewLayerOpacity(layer.id, before);
    sync();
  });

  const sync = () => {
    if (dragStart !== null) return;
    const opacityPercent = Math.round(editor.activeLayer.opacity * 100);
    slider.value = String(opacityPercent);
    value.textContent = `${opacityPercent}%`;
  };

  return { element, sync };
}
