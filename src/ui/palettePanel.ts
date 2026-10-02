import { toHex } from '../core/color.ts';
import type { Editor } from './editor.ts';

/** Swatch grid for the document palette. Clicking a swatch selects it as the primary color. */
export function createPalettePanel(editor: Editor): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';

  const heading = document.createElement('h2');
  heading.className = 'panel-title';

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  swatches.setAttribute('role', 'group');

  const render = () => {
    const { palette } = editor.doc;
    heading.textContent = `Palette · ${palette.name}`;
    swatches.setAttribute('aria-label', `${palette.name} palette`);
    swatches.replaceChildren(
      ...palette.colors.map((color, i) => {
        const index = i + 1;
        const hex = toHex(color);
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'swatch';
        swatch.style.backgroundColor = hex;
        swatch.title = hex;
        swatch.setAttribute('aria-label', hex);
        swatch.setAttribute('aria-pressed', String(index === editor.primaryIndex));
        swatch.addEventListener('click', () => editor.setPrimaryIndex(index));
        return swatch;
      }),
    );
  };

  editor.onChange(render);
  render();
  panel.append(heading, swatches);
  return panel;
}
