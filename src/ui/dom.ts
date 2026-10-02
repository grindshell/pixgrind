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

export function option(value: string, label: string): HTMLOptionElement {
  const opt = el('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}
