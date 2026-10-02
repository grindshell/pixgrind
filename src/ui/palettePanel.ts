import { alpha, parseHex, toHex, type Rgba } from '../core/color.ts';
import {
  addColorEdit,
  canAddColor,
  canRemoveColor,
  colorUsage,
  removeColorEdit,
  setColorEdit,
} from '../core/paletteEdits.ts';
import { colorForIndex, TRANSPARENT } from '../core/palette.ts';
import { el, iconButton, setButtonLabel } from './dom.ts';
import type { ColorSlot, Editor } from './editor.ts';

/**
 * The document palette: a swatch grid (click for the primary color,
 * right-click for the secondary, + to add one), the primary and secondary
 * colors with swap and transparent, and an editor for the primary color
 * (picker, hex field, delete). Every palette change is undoable; picker
 * drags preview live and record one edit when the picker closes.
 */
export function createPalettePanel(editor: Editor): HTMLElement {
  const { doc } = editor;
  const panel = el('section', 'panel');
  const heading = el('h2', 'panel-title');

  /** Left-click picks the primary color and right-click the secondary (also from the keyboard's context menu key). */
  const pickOnClick = (button: HTMLButtonElement, index: number) => {
    button.addEventListener('click', () => editor.setColorIndex('primary', index));
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      editor.setColorIndex('secondary', index);
    });
  };

  const swatches = el('div', 'swatches');
  swatches.setAttribute('role', 'group');
  const addButton = iconButton('plus', 'Add color', () => {
    if (editor.perform(addColorEdit(doc, selectedColor()))) editor.setColorIndex('primary', doc.palette.colors.length);
  });
  addButton.classList.add('swatch', 'swatch-add');

  const primaryWell = el('span', 'color-well is-primary');
  const secondaryWell = el('span', 'color-well is-secondary');
  const wells = el('div', 'color-wells');
  wells.setAttribute('role', 'img');
  wells.append(secondaryWell, primaryWell);
  const swapButton = iconButton('swap', 'Swap primary and secondary colors (X)', () => editor.swapColors());
  const transparentButton = el('button', 'swatch swatch-transparent');
  transparentButton.type = 'button';
  setButtonLabel(transparentButton, 'Transparent: click to erase with the left button, right-click for the right');
  pickOnClick(transparentButton, TRANSPARENT);
  const slotHint = el('span', 'field-label slot-hint');
  slotHint.textContent = 'Right-click a swatch for the right button';
  const slotRow = el('div', 'color-row');
  slotRow.append(wells, swapButton, transparentButton, slotHint);

  const picker = el('input', 'color-picker');
  picker.type = 'color';
  picker.setAttribute('aria-label', 'Primary color');
  const hexInput = el('input', 'text-input hex-input');
  hexInput.type = 'text';
  hexInput.spellcheck = false;
  hexInput.maxLength = 9;
  hexInput.setAttribute('aria-label', 'Primary color as hex');
  const deleteButton = iconButton('trash', 'Delete color', () => {
    editor.perform(removeColorEdit(doc, editor.primaryIndex));
  });
  const colorRow = el('div', 'color-row');
  colorRow.append(picker, hexInput, deleteButton);

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');

  /** The primary color, or opaque black when it's transparent (e.g. as the color a new swatch copies). */
  const selectedColor = (): Rgba =>
    editor.primaryIndex === TRANSPARENT ? 0xff : colorForIndex(doc.palette, editor.primaryIndex);

  /** Pixel counts per index, for the delete button. Counting scans every pixel, so only redo it after document changes. */
  let usage: { revision: number; counts: Uint32Array } | null = null;
  const colorCounts = (): Uint32Array => {
    if (usage?.revision !== editor.revision) usage = { revision: editor.revision, counts: colorUsage(doc) };
    return usage.counts;
  };

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
          pickOnClick(swatch, i + 1);
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
      markSlots(swatch, `${hex} (index ${i + 1})`, i + 1);
    });
    markSlots(transparentButton, 'Transparent', TRANSPARENT);

    const add = canAddColor(doc);
    addButton.disabled = !add.ok;
    setButtonLabel(addButton, add.ok ? 'Add color (copy of primary)' : add.reason);

    renderWell(primaryWell, editor.primaryIndex);
    renderWell(secondaryWell, editor.secondaryIndex);
    wells.setAttribute(
      'aria-label',
      `Left button: ${describe(editor.primaryIndex)}. Right button: ${describe(editor.secondaryIndex)}.`,
    );

    // The editor below edits the primary color, which can't be done to transparent.
    const editable = editor.primaryIndex !== TRANSPARENT;
    picker.disabled = !editable;
    hexInput.disabled = !editable;
    const color = selectedColor();
    if (previewStart === null) {
      picker.value = editable ? toHex(color).slice(0, 7) : '#000000';
      if (document.activeElement !== hexInput) hexInput.value = editable ? toHex(color) : '';
    }
    hexInput.placeholder = editable ? '' : 'transparent';
    const remove = editable
      ? canRemoveColor(doc, editor.primaryIndex, colorCounts())
      : { ok: false, reason: "transparent isn't a palette color" };
    deleteButton.disabled = !remove.ok;
    setButtonLabel(deleteButton, remove.ok ? 'Delete color' : `Can't delete: ${remove.reason}`);
  };

  /** Marks which buttons use a swatch's color: pressed for the left (primary), a corner mark for the right. */
  const markSlots = (swatch: HTMLButtonElement, name: string, index: number) => {
    const slots = (['primary', 'secondary'] as const).filter((slot) => editor.colorIndex(slot) === index);
    swatch.setAttribute('aria-pressed', String(slots.includes('primary')));
    swatch.classList.toggle('is-secondary', slots.includes('secondary'));
    setButtonLabel(swatch, slots.length ? `${name}, ${slots.map(slotName).join(' and ')} button` : name);
  };

  const describe = (index: number) => (index === TRANSPARENT ? 'transparent' : toHex(colorForIndex(doc.palette, index)));

  const renderWell = (well: HTMLElement, index: number) => {
    well.classList.toggle('is-transparent', index === TRANSPARENT);
    well.style.backgroundColor = index === TRANSPARENT ? '' : describe(index);
  };

  editor.onChange(render);
  render();
  panel.append(heading, swatches, slotRow, colorRow, status);
  return panel;
}

function slotName(slot: ColorSlot): string {
  return slot === 'primary' ? 'left' : 'right';
}
