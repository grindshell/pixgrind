import { MAX_DEPTH, MAX_OFFSET, MIN_DEPTH, packExtrusion } from '../core/extrusion.ts';
import { setExtrusionEdit } from '../core/extrusionEdits.ts';
import { MIN_LABEL_ZOOM } from '../render/canvasRenderer.ts';
import { BUSY_MESSAGE } from './commands.ts';
import { checkbox, el, fieldRow, numberField, option, textButton } from './dom.ts';
import type { Editor, Pane } from './editor.ts';
import { exportModel } from './fileCommands.ts';

/** Meters per pixel offered for GLB export. */
const SCALES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '1 m/px' },
  { value: 0.1, label: '10 cm/px' },
  { value: 1 / 16, label: '1/16 m/px' },
  { value: 1 / 32, label: '1/32 m/px' },
  { value: 0.01, label: '1 cm/px' },
];

/**
 * 3D model controls: the side and 3D views, the depth and offset the
 * Extrude tool paints (also applied to the selection with a button), depth
 * labels on the canvas, and GLB export.
 */
export function createModelPanel(editor: Editor): HTMLElement {
  const panel = el('section', 'panel');
  const header = el('div', 'panel-header');
  const heading = el('h2', 'panel-title');
  heading.textContent = '3D model';

  const paneToggle = (pane: Pane, label: string, title: string) => {
    const button = textButton(label, () => editor.setPaneOpen(pane, !editor.panes[pane]));
    button.classList.add('toggle-text');
    button.title = title;
    return button;
  };
  const sideButton = paneToggle('side', 'Side', 'Show one column of the model from the side, to edit its depth');
  const modelButton = paneToggle('model', '3D', 'Show the model in 3D');
  const toggles = el('div', 'icon-group');
  toggles.append(sideButton, modelButton);
  header.append(heading, toggles);

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');

  const depth = numberField('Depth', MIN_DEPTH, MAX_DEPTH, (value) => editor.setExtrude({ depth: value }));
  depth.label.title = 'How many pixels deep the box is';
  const offset = numberField('Offset', 0, MAX_OFFSET, (value) => editor.setExtrude({ offset: value }));
  offset.label.title = 'How far behind the picture plane the box starts';

  const applyButton = textButton('Apply to selection', () => {
    const { doc, activeLayer } = editor;
    if (!activeLayer.visible) {
      status.textContent = "Can't extrude a hidden layer.";
      return;
    }
    const extrusion = packExtrusion(editor.extrude.offset, editor.extrude.depth);
    const edit = setExtrusionEdit(doc, activeLayer, doc.selection, extrusion, 'Extrude');
    if (!edit) status.textContent = 'Nothing to change: no painted pixels there, or they already have this extrusion.';
    else status.textContent = editor.perform(edit) ? '' : BUSY_MESSAGE;
  });

  const labels = checkbox('Show depth on canvas', (checked) => editor.setShowDepth(checked));
  labels.label.title = `Writes each pixel's depth on it (and its offset, in blue, when not 0). Needs zoom ${MIN_LABEL_ZOOM}× or more.`;
  const options = el('div', 'checkbox-row');
  options.append(labels.label);

  const scale = el('select', 'select');
  scale.setAttribute('aria-label', 'Size of one pixel in the exported model');
  scale.title = 'Size of one pixel in the exported model';
  for (const { value, label } of SCALES) scale.append(option(String(value), label));
  const exportButton = textButton('Export GLB', () => {
    void exportModel(editor, { scale: Number(scale.value) }).then(
      (message) => (status.textContent = message),
      (error: unknown) => (status.textContent = error instanceof Error ? error.message : String(error)),
    );
  });
  exportButton.title = 'Download the model of the visible layers as a .glb file';

  const note = el('p', 'panel-note');
  note.textContent =
    'Extrude tool (D): paint this depth and offset onto pixels; right-click resets them to 1 deep. Layers stack boxes behind the same pixel.';

  const render = () => {
    sideButton.setAttribute('aria-pressed', String(editor.panes.side));
    modelButton.setAttribute('aria-pressed', String(editor.panes.model));
    depth.set(editor.extrude.depth);
    offset.set(editor.extrude.offset);
    applyButton.textContent = editor.doc.selection ? 'Apply to selection' : 'Apply to layer';
    labels.input.checked = editor.showDepth;
  };
  editor.onChange(render);
  render();

  panel.append(
    header,
    fieldRow(depth.label, offset.label),
    fieldRow(applyButton),
    options,
    fieldRow(scale, exportButton),
    note,
    status,
  );
  return panel;
}
