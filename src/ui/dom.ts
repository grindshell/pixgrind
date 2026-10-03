import { icon, type IconName } from './icons.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

export function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** An icon-only button. `label` becomes its accessible name and tooltip. */
export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'icon-button');
  button.type = 'button';
  button.append(icon(name));
  setButtonLabel(button, label);
  button.addEventListener('click', onClick);
  return button;
}

/** A horizontal row of form controls. */
export function fieldRow(...children: HTMLElement[]): HTMLDivElement {
  const row = el('div', 'field-row');
  row.append(...children);
  return row;
}

/** A labeled checkbox. */
export function checkbox(text: string, onChange: (checked: boolean) => void): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = el('label', 'checkbox');
  const input = el('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  label.append(input, text);
  return { label, input };
}

/** A labeled range input with a value readout. `set` leaves the value alone while the user is dragging it. */
export function slider(
  text: string,
  min: number,
  max: number,
  onInput: (value: number) => void,
): { row: HTMLDivElement; input: HTMLInputElement; set: (value: number, readout: string) => void } {
  const caption = el('span', 'field-label slider-label');
  caption.textContent = text;
  const input = el('input', 'slider');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.setAttribute('aria-label', text);
  const value = el('span', 'slider-value');
  input.addEventListener('input', () => onInput(Number(input.value)));
  const set = (next: number, readout: string) => {
    if (document.activeElement !== input) input.value = String(next);
    value.textContent = readout;
  };
  return { row: fieldRow(caption, input, value), input, set };
}

/**
 * A labeled whole-number input. `onChange` gets the value clamped to
 * [min, max] when it's committed (Enter, leaving the field, or the arrows).
 * `set` leaves the field alone while it has focus.
 */
export function numberField(
  text: string,
  min: number,
  max: number,
  onChange: (value: number) => void,
): { label: HTMLLabelElement; input: HTMLInputElement; set: (value: number) => void } {
  const label = el('label', 'number-field');
  const caption = el('span', 'field-label');
  caption.textContent = text;
  const input = el('input', 'text-input number-input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  label.append(caption, input);
  let current = min;
  const set = (value: number) => {
    current = value;
    if (document.activeElement !== input) input.value = String(value);
  };
  input.addEventListener('change', () => {
    const value = Number(input.value);
    const clamped = input.value.trim() !== '' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : current;
    input.value = String(clamped);
    onChange(clamped);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return { label, input, set };
}

export function option(value: string, label: string): HTMLOptionElement {
  const opt = el('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

/** Input types that don't edit text, so shortcuts still work while they have focus. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether an event target edits text, so keyboard shortcuts and clipboard commands should leave it alone. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/**
 * Takes focus from a text field so its change handlers commit what was typed
 * (a layer name, a hex color) now. Pointer gestures call this before they
 * start: otherwise the field would blur only after the press, when the
 * editor is already busy and refuses the edit.
 */
export function commitTextEntry(): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && isTextEntry(focused)) focused.blur();
}

/** Whether a focused control uses the arrow keys itself (sliders, radio buttons). */
export function usesArrowKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'radio');
}

/**
 * Calls `onChange` whenever `devicePixelRatio` changes, e.g. when the window
 * moves to a monitor with different scaling. ResizeObserver misses this case
 * because the element's CSS size stays the same.
 */
export function watchDevicePixelRatio(onChange: () => void): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      onChange();
      watchDevicePixelRatio(onChange);
    },
    { once: true },
  );
}

export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}
