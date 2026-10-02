import { alpha, parseHex, toHex, type Rgba } from '../core/color.ts';
import { addColorEdit, canAddColor, canRemoveColor, removeColorEdit, setColorEdit } from '../core/paletteEdits.ts';
import { el, iconButton, setButtonLabel } from './dom.ts';
import type { Editor } from './editor.ts';

/**
 * The document palette: a swatch grid (click to select the primary color, +
 * to add one) and an editor for the selected color (picker, hex field,
 * delete). Every change is undoable; picker drags preview live and record
 * one edit when the picker closes.
 */
export function createPalettePanel(editor: Editor): HTMLElement {
  const { doc } = editor;
  const panel = el('section', 'panel');
  const heading = el('h2', 'panel-title');

  const swatches = el('div', 'swatches');
  swatches.setAttribute('role', 'group');
  const addButton = iconButton('plus', 'Add color', () => {
    editor.perform(addColorEdit(doc, selectedColor()));
    editor.setPrimaryIndex(doc.palette.colors.length);
  });
  addButton.classList.add('swatch', 'swatch-add');

  const picker = el('input', 'color-picker');
  picker.type = 'color';
  picker.setAttribute('aria-label', 'Selected color');
  const hexInput = el('input', 'text-input hex-input');
  hexInput.type = 'text';
  hexInput.spellcheck = false;
  hexInput.maxLength = 9;
  hexInput.setAttribute('aria-label', 'Selected color as hex');
  const deleteButton = iconButton('trash', 'Delete color', () => {
    editor.perform(removeColorEdit(doc, editor.primaryIndex));
  });
  const colorRow = el('div', 'color-row');
  colorRow.append(picker, hexInput, deleteButton);

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');

  const selectedColor = (): Rgba => doc.palette.colors[editor.primaryIndex - 1] ?? 0xff;

  /** Color under the picker, keeping the existing alpha (the native picker is RGB only). */
  const pickerColor = (keepAlphaOf: Rgba): Rgba => ((parseHex(picker.value) & 0xffffff00) | alpha(keepAlphaOf)) >>> 0;

  let previewStart: Rgba | null = null;
  picker.addEventListener('input', () => {
    previewStart ??= selectedColor();
    const color = pickerColor(previewStart);
    editor.previewPaletteColor(editor.primaryIndex, color);
    hexInput.value = toHex(color);
    const swatch = swatches.children[editor.primaryIndex - 1];
    if (swatch instanceof HTMLElement) swatch.style.backgroundColor = toHex(color);
  });
  picker.addEventListener('change', () => {
    const before = previewStart ?? selectedColor();
    previewStart = null;
    const color = pickerColor(before);
    // Apply first in case the browser fired `change` without any `input`.
    editor.previewPaletteColor(editor.primaryIndex, color);
    editor.record(setColorEdit(doc, editor.primaryIndex, color, before));
    render();
  });

  hexInput.addEventListener('change', () => {
    let color: Rgba;
    try {
      color = parseHex(hexInput.value);
    } catch {
      status.textContent = `"${hexInput.value}" is not a color. Use #rrggbb or #rrggbbaa.`;
      render();
      return;
    }
    status.textContent = '';
    editor.perform(setColorEdit(doc, editor.primaryIndex, color));
    render();
  });

  const render = () => {
    const { colors, name } = doc.palette;
    heading.textContent = `Palette · ${name}`;
    swatches.setAttribute('aria-label', `${name} palette`);

    // Rebuild only when the number of colors changes, so keyboard focus survives selection changes.
    if (swatches.children.length !== colors.length + 1) {
      swatches.replaceChildren(
        ...colors.map((_, i) => {
          const swatch = el('button', 'swatch');
          swatch.type = 'button';
          swatch.addEventListener('click', () => editor.setPrimaryIndex(i + 1));
          return swatch;
        }),
        addButton,
      );
    }
    colors.forEach((color, i) => {
      const swatch = swatches.children[i];
      if (!(swatch instanceof HTMLButtonElement)) return;
      const hex = toHex(color);
      swatch.style.backgroundColor = hex;
      setButtonLabel(swatch, `${hex} (index ${i + 1})`);
      swatch.setAttribute('aria-pressed', String(i + 1 === editor.primaryIndex));
    });

    const add = canAddColor(doc);
    addButton.disabled = !add.ok;
    setButtonLabel(addButton, add.ok ? 'Add color (copy of selected)' : add.reason);

    const color = selectedColor();
    if (previewStart === null) {
      picker.value = toHex(color).slice(0, 7);
      if (document.activeElement !== hexInput) hexInput.value = toHex(color);
    }
    const remove = canRemoveColor(doc, editor.primaryIndex);
    deleteButton.disabled = !remove.ok;
    setButtonLabel(deleteButton, remove.ok ? 'Delete color' : `Can't delete: ${remove.reason}`);
  };

  editor.onChange(render);
  render();
  panel.append(heading, swatches, colorRow, status);
  return panel;
}
