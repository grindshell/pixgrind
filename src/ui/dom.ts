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

export function setButtonLabel(button: HTMLButtonElement, label: string): void {
  button.title = label;
  button.setAttribute('aria-label', label);
}
