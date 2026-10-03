import { FACINGS, type Facing } from '../core/facing.ts';
import { el, textButton } from './dom.ts';
import type { Editor } from './editor.ts';

const NAMES: Readonly<Record<Facing, string>> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
};

/** A side's name, for labels ("Front", "Top", …). */
export function facingName(facing: Facing): string {
  return NAMES[facing];
}

/**
 * The bar over the canvas's top edge that picks which side of the model the
 * canvas edits (keys 1–6, in its order), shows that side's size, and turns
 * the guide (the other sides' model, faintly) on and off.
 */
export function createPerspectiveBar(editor: Editor): HTMLElement {
  const bar = el('div', 'pane-bar perspective-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Side being edited');
  const buttons = FACINGS.map((facing, i) => {
    const button = textButton(NAMES[facing], () => editor.setFacing(facing));
    button.classList.add('pane-button');
    button.title = `Draw on the ${facing} of the model (${i + 1})`;
    return { facing, button };
  });
  const size = el('span', 'pane-readout pane-hint');
  const guide = textButton('Guide', () => editor.setShowGuide(!editor.showGuide));
  guide.classList.add('pane-button');
  guide.title = 'Show the other sides of the model faintly, as seen from this one';
  bar.append(...buttons.map(({ button }) => button), size, guide);

  const sync = () => {
    for (const { facing, button } of buttons) button.setAttribute('aria-pressed', String(facing === editor.facing));
    const { width, height } = editor.plane;
    size.textContent = `${width}×${height}, ${editor.extent} deep`;
    guide.setAttribute('aria-pressed', String(editor.showGuide));
  };
  editor.onChange(sync);
  sync();
  return bar;
}
