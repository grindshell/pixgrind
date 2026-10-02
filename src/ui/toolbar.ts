import { el, iconButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { TOOLS, type Tool } from './tools.ts';

/** Vertical tool strip beside the canvas. Hidden tools (e.g. the reference tool) are activated elsewhere. */
export function createToolbar(editor: Editor): HTMLElement {
  const bar = el('nav', 'tool-strip');
  bar.setAttribute('aria-label', 'Tools');

  const buttons = TOOLS.filter((tool) => !tool.hidden).map((tool) => {
    const button = iconButton(tool.icon, toolLabel(tool), () => editor.setTool(tool.id));
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

/** "Pencil (B)", "Filled rectangle (Shift+R)". */
function toolLabel({ label, shortcut }: Tool): string {
  if (!shortcut) return label;
  const keys = shortcut === shortcut.toLowerCase() ? shortcut.toUpperCase() : `Shift+${shortcut}`;
  return `${label} (${keys})`;
}
