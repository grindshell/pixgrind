import './style.css';
import { DEFAULT_PALETTE } from './core/palette.ts';
import { createDocument } from './core/pixelDocument.ts';
import { mountEditor } from './ui/editor.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app element not found');

const editor = mountEditor(root, createDocument(32, 32, DEFAULT_PALETTE));

// Dev-only handle for inspecting state from the browser console or automation.
if (import.meta.env.DEV) Object.assign(window, { pixgrind: editor });

// Ask before closing the tab with unsaved changes. Not in dev, where Vite's
// full-page reloads after every source edit would trigger it.
if (!import.meta.env.DEV) {
  window.addEventListener('beforeunload', (e) => {
    if (editor.dirty) e.preventDefault();
  });
}
