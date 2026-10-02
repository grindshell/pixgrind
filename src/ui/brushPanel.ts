import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, type BrushShape } from '../core/brush.ts';
import { el, iconButton, slider } from './dom.ts';
import type { Editor } from './editor.ts';
import type { IconName } from './icons.ts';

const SHAPES: ReadonlyArray<{ shape: BrushShape; icon: IconName; label: string }> = [
  { shape: 'round', icon: 'brushRound', label: 'Round brush' },
  { shape: 'square', icon: 'brushSquare', label: 'Square brush' },
];

/** Brush size and shape, shared by the pencil, eraser, line and rectangle tools. */
export function createBrushPanel(editor: Editor): HTMLElement {
  const panel = el('section', 'panel');
  const header = el('div', 'panel-header');
  const heading = el('h2', 'panel-title');
  heading.textContent = 'Brush';

  const shapes = el('div', 'icon-group');
  shapes.setAttribute('role', 'group');
  shapes.setAttribute('aria-label', 'Brush shape');
  const shapeButtons = SHAPES.map(({ shape, icon, label }) => {
    const button = iconButton(icon, label, () => editor.setBrush({ shape }));
    button.classList.add('toggle-button');
    return { shape, button };
  });
  shapes.append(...shapeButtons.map(({ button }) => button));
  header.append(heading, shapes);

  const size = slider('Size', MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, (value) => editor.setBrush({ size: value }));
  size.row.title = 'Brush size. [ and ] step it down and up.';

  const render = () => {
    const { brush } = editor;
    for (const { shape, button } of shapeButtons) button.setAttribute('aria-pressed', String(shape === brush.shape));
    size.set(brush.size, `${brush.size} px`);
  };

  editor.onChange(render);
  render();
  panel.append(header, size.row);
  return panel;
}
