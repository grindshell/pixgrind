import {
  autoShape,
  CUT_BOTTOM_LEFT,
  CUT_BOTTOM_RIGHT,
  CUT_TOP_LEFT,
  CUT_TOP_RIGHT,
  MAX_DEPTH,
  MAX_OFFSET,
  MIN_DEPTH,
  SQUARE,
  withBox,
  withShape,
  type Extrusion,
} from '../core/extrusion.ts';
import { updateExtrusionsEdit } from '../core/extrusionEdits.ts';
import { MIN_LABEL_ZOOM } from '../render/canvasRenderer.ts';
import { BUSY_MESSAGE } from './commands.ts';
import { checkbox, el, fieldRow, iconButton, numberField, option, textButton } from './dom.ts';
import type { DiagonalChoice, Editor, Pane } from './editor.ts';
import { exportModel } from './fileCommands.ts';
import type { IconName } from './icons.ts';

/** The shapes the Diagonal tool can paint, as the panel offers them. */
const SHAPE_CHOICES: ReadonlyArray<{ choice: DiagonalChoice; icon: IconName; label: string }> = [
  { choice: 'auto', icon: 'diagonal', label: "Auto: cut the corner between a pixel's two empty sides (staircase steps)" },
  { choice: CUT_TOP_LEFT, icon: 'cutTopLeft', label: 'Cut off the top left corner' },
  { choice: CUT_TOP_RIGHT, icon: 'cutTopRight', label: 'Cut off the top right corner' },
  { choice: CUT_BOTTOM_RIGHT, icon: 'cutBottomRight', label: 'Cut off the bottom right corner' },
  { choice: CUT_BOTTOM_LEFT, icon: 'cutBottomLeft', label: 'Cut off the bottom left corner' },
  { choice: SQUARE, icon: 'shapeSquare', label: 'Square (not diagonal)' },
];

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

  /** Changes the extrusions of the selection (or the whole active layer), reporting in the status line. */
  const apply = (update: (extrusion: Extrusion, x: number, y: number) => Extrusion, label: string, unchanged: string) => {
    const { doc, activeLayer } = editor;
    if (!activeLayer.visible) {
      status.textContent = "Can't change a hidden layer.";
      return;
    }
    const edit = updateExtrusionsEdit(doc, activeLayer, doc.selection, update, label);
    if (!edit) status.textContent = unchanged;
    else status.textContent = editor.perform(edit) ? '' : BUSY_MESSAGE;
  };

  const applyButton = textButton('Apply depth', () => {
    const { offset, depth } = editor.extrude;
    apply(
      (extrusion) => withBox(extrusion, offset, depth),
      'Extrude',
      'Nothing to change: no painted pixels there, or they already have this depth and offset.',
    );
  });

  const shapes = el('div', 'icon-group');
  shapes.setAttribute('role', 'group');
  shapes.setAttribute('aria-label', 'Diagonal shape');
  const shapeButtons = SHAPE_CHOICES.map(({ choice, icon, label }) => {
    const button = iconButton(icon, label, () => editor.setDiagonal(choice));
    button.classList.add('toggle-button');
    return { choice, button };
  });
  shapes.append(...shapeButtons.map(({ button }) => button));

  const applyShapeButton = textButton('Apply shape', () => {
    const choice = editor.diagonal;
    const { doc, activeLayer } = editor;
    apply(
      (extrusion, x, y) => {
        const shape = choice === 'auto' ? autoShape(activeLayer.pixels, doc.width, doc.height, x, y) : choice;
        return shape === null ? extrusion : withShape(extrusion, shape);
      },
      choice === SQUARE ? 'Square' : 'Diagonal',
      choice === 'auto'
        ? 'Nothing to change: no staircase steps there (pixels with two empty sides meeting at a corner), or they already are diagonal.'
        : 'Nothing to change: no painted pixels there, or they already have this shape.',
    );
  });

  const labels = checkbox('Show depth on canvas', (checked) => editor.setShowDepth(checked));
  labels.label.title =
    `Writes each pixel's depth on it (and its offset, in blue, when not 0), at zoom ${MIN_LABEL_ZOOM}× or more, ` +
    'and shades the corners diagonal pixels cut off (also shown while the Diagonal tool is in use).';
  const options = el('div', 'checkbox-row');
  options.append(labels.label);

  const scale = el('select', 'select');
  scale.setAttribute('aria-label', 'Size of one pixel in the exported model');
  scale.title = 'Size of one pixel in the exported model';
  for (const { value, label } of SCALES) scale.append(option(String(value), label));
  const watertight = checkbox('Watertight', () => {});
  watertight.input.checked = true;
  watertight.label.title =
    'Each color a closed, manifold solid with shared vertices, for 3D printing and modeling tools ' +
    '(adds hidden faces where colors touch, and leaves out normals: viewers shade it flat). ' +
    'Off: the fewest faces, as the 3D view shows, for game engines.';
  const exportOptions = el('div', 'checkbox-row');
  exportOptions.append(watertight.label);

  const exportButton = textButton('Export GLB', () => {
    void exportModel(editor, { scale: Number(scale.value), watertight: watertight.input.checked }).then(
      (message) => (status.textContent = message),
      (error: unknown) => (status.textContent = error instanceof Error ? error.message : String(error)),
    );
  });
  exportButton.title = 'Download the model of the visible layers as a .glb file';

  const note = el('p', 'panel-note');
  note.textContent =
    'Extrude tool (D): paint this depth and offset onto pixels; right-click resets them to 1 deep. ' +
    'Diagonal tool (Shift+D): paint the shape above (Auto cuts staircase steps into slopes); right-click makes pixels square. ' +
    'Layers stack boxes behind the same pixel.';

  const render = () => {
    sideButton.setAttribute('aria-pressed', String(editor.panes.side));
    modelButton.setAttribute('aria-pressed', String(editor.panes.model));
    depth.set(editor.extrude.depth);
    offset.set(editor.extrude.offset);
    const where = editor.doc.selection ? 'selection' : 'layer';
    applyButton.textContent = `Apply depth to ${where}`;
    applyShapeButton.textContent = `Apply shape to ${where}`;
    for (const { choice, button } of shapeButtons) button.setAttribute('aria-pressed', String(choice === editor.diagonal));
    labels.input.checked = editor.showDepth;
  };
  editor.onChange(render);
  render();

  panel.append(
    header,
    fieldRow(depth.label, offset.label),
    fieldRow(applyButton),
    fieldRow(shapes),
    fieldRow(applyShapeButton),
    options,
    fieldRow(scale, exportButton),
    exportOptions,
    note,
    status,
  );
  return panel;
}
