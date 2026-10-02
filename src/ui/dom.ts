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

export function option(value: string, label: string): HTMLOptionElement {
  const opt = el('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

/** Whether an event target edits text, so keyboard shortcuts and clipboard commands should leave it alone. */
export function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}
