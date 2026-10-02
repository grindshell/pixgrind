import { el, iconButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { TOOLS } from './tools.ts';

/** Vertical tool strip beside the canvas. */
export function createToolbar(editor: Editor): HTMLElement {
  const bar = el('nav', 'tool-strip');
  bar.setAttribute('aria-label', 'Tools');

  const buttons = TOOLS.map((tool) => {
    const shortcut = tool.shortcut === tool.shortcut.toLowerCase() ? tool.shortcut.toUpperCase() : `Shift+${tool.shortcut}`;
    const button = iconButton(tool.icon, `${tool.label} (${shortcut})`, () => editor.setTool(tool.id));
    button.classList.add('tool-button');
    return { tool, button };
  });

  const render = () => {
    for (const { tool, button } of buttons) button.setAttribute('aria-pressed', String(tool.id === editor.tool));
  };

  editor.onChange(render);
  render();
  bar.append(...buttons.map(({ button }) => button));
  return bar;
}
