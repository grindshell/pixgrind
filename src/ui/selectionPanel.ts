import type { SelectionMode } from '../core/mask.ts';
import { deselect, invertSelection, selectAll } from './commands.ts';
import { checkbox, el, fieldRow, iconButton, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import type { IconName } from './icons.ts';

const MODES: ReadonlyArray<{ mode: SelectionMode; icon: IconName; label: string }> = [
  { mode: 'replace', icon: 'selectReplace', label: 'New selection' },
  { mode: 'add', icon: 'selectAdd', label: 'Add to the selection (or hold Shift)' },
  { mode: 'subtract', icon: 'selectSubtract', label: 'Subtract from the selection (or hold Ctrl)' },
  { mode: 'intersect', icon: 'selectIntersect', label: 'Intersect with the selection (or hold Ctrl+Shift)' },
];

/**
 * Select all / none / invert (also on the keyboard, but this works on touch
 * screens too), how the selection tools combine with the selection, and
 * how the magic wand picks pixels.
 */
export function createSelectionPanel(editor: Editor): HTMLElement {
  const panel = el('section', 'panel');
  const header = el('div', 'panel-header');
  const heading = el('h2', 'panel-title');
  heading.textContent = 'Selection';

  const modes = el('div', 'icon-group');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Selection mode');
  const modeButtons = MODES.map(({ mode, icon, label }) => {
    const button = iconButton(icon, label, () => editor.setSelectionMode(mode));
    button.classList.add('toggle-button');
    return { mode, button };
  });
  modes.append(...modeButtons.map(({ button }) => button));
  header.append(heading, modes);

  const all = textButton('All', () => selectAll(editor));
  all.title = 'Select all (Ctrl+A)';
  const none = textButton('None', () => deselect(editor));
  none.title = 'Deselect (Ctrl+D)';
  const invert = textButton('Invert', () => invertSelection(editor));
  invert.title = 'Select the unselected pixels instead (Ctrl+I)';

  const wandLabel = el('span', 'field-label');
  wandLabel.textContent = 'Magic wand';
  const contiguous = checkbox('Contiguous', (checked) => editor.setWandContiguous(checked));
  contiguous.label.title =
    'Select only the touching pixels of the clicked color. Off: every pixel of that color on the layer.';

  const render = () => {
    for (const { mode, button } of modeButtons) button.setAttribute('aria-pressed', String(mode === editor.selectionMode));
    contiguous.input.checked = editor.wandContiguous;
    none.disabled = !editor.doc.selection && !editor.doc.floating;
  };

  editor.onChange(render);
  render();
  panel.append(header, fieldRow(all, none, invert), fieldRow(wandLabel, contiguous.label));
  return panel;
}
