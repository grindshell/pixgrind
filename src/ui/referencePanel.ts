import {
  fitPlacement,
  placementCenter,
  scaleAround,
  scaleToSlider,
  sliderToScale,
} from '../core/referencePlacement.ts';
import { chooseFile, fileBaseName } from '../io/files.ts';
import type { ProjectReference } from '../io/projectFile.ts';
import type { ReferenceImage, ReferenceSettings } from '../render/referenceImage.ts';
import { checkbox, el, fieldRow, slider, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import type { ToolId } from './tools.ts';

const IMAGE_ACCEPT = 'image/*';
const DEFAULT_OPACITY = 0.5;
/** Slider resolution for the logarithmic scale control. */
const SCALE_STEPS = 1000;

/**
 * Loads an image file as the reference, fitted to the document and shown
 * under the artwork at half opacity. Replaces any current reference.
 */
export async function loadReferenceFile(editor: Editor, file: Blob & { name?: string }): Promise<string> {
  const bitmap = await decodeReference(file);
  const name = file.name ? fileBaseName(file.name) : 'Reference';
  const reference: ReferenceImage = {
    name,
    bitmap,
    source: file,
    width: bitmap.width,
    height: bitmap.height,
    ...fitPlacement(bitmap.width, bitmap.height, editor.doc.width, editor.doc.height),
    opacity: DEFAULT_OPACITY,
    visible: true,
    above: false,
    smooth: true,
  };
  editor.setReference(reference);
  return `Loaded ${file.name ?? 'reference'} (${bitmap.width}×${bitmap.height}).`;
}

/** Decodes a reference saved in a project, keeping its saved placement and settings. */
export async function referenceFromProject(saved: ProjectReference): Promise<ReferenceImage> {
  const bitmap = await decodeReference(saved.source);
  return { ...saved, bitmap, width: bitmap.width, height: bitmap.height };
}

async function decodeReference(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('The file is not an image this browser can read');
  }
}

/**
 * Reference image controls: load/remove, show, above/below the artwork,
 * smoothing, opacity, scale, fit, and a Move mode for dragging it on the
 * canvas (wheel scales it there).
 */
export function createReferencePanel(editor: Editor): HTMLElement {
  const panel = el('section', 'panel');
  const heading = el('h2', 'panel-title');
  heading.textContent = 'Reference';

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');
  const info = el('p', 'panel-note');

  const loadButton = textButton('Load…', () => {
    void chooseFile(IMAGE_ACCEPT).then(
      (file) =>
        file &&
        loadReferenceFile(editor, file).then(
          (message) => (status.textContent = message),
          (error: unknown) => (status.textContent = error instanceof Error ? error.message : String(error)),
        ),
    );
  });
  const removeButton = textButton('Remove', () => {
    editor.setReference(null);
    status.textContent = '';
  });

  /** Tool to return to when Move mode ends. */
  let toolBeforeMove: ToolId = 'pencil';
  const moveButton = textButton('Move', () => {
    if (editor.tool === 'reference') {
      editor.setTool(toolBeforeMove);
    } else {
      toolBeforeMove = editor.tool;
      editor.setTool('reference');
    }
  });
  moveButton.title = 'Drag the reference on the canvas; the wheel scales it around the pointer';

  const show = checkbox('Show', (checked) => editor.updateReference({ visible: checked }));
  const above = checkbox('Above artwork', (checked) => editor.updateReference({ above: checked }));
  const smooth = checkbox('Smooth', (checked) => editor.updateReference({ smooth: checked }));
  smooth.label.title = 'Smooth scaling suits photos. Turn it off to see a pixel-art reference as crisp squares.';
  const toggles = el('div', 'checkbox-row');
  toggles.append(show.label, above.label, smooth.label);

  const opacity = slider('Opacity', 0, 100, (value) => {
    editor.updateReference({ opacity: value / 100 });
  });
  const scale = slider('Scale', 0, SCALE_STEPS, (value) => {
    const ref = editor.reference;
    if (!ref) return;
    const center = placementCenter(ref, ref.width, ref.height);
    editor.updateReference(scaleAround(ref, sliderToScale(value / SCALE_STEPS), center.x, center.y));
  });
  const fitButton = textButton('Fit', () => {
    const ref = editor.reference;
    if (ref) editor.updateReference(fitPlacement(ref.width, ref.height, editor.doc.width, editor.doc.height));
  });
  fitButton.title = 'Fit the reference inside the canvas';
  scale.row.append(fitButton);

  const controls: Array<HTMLInputElement | HTMLButtonElement> = [
    removeButton,
    moveButton,
    show.input,
    above.input,
    smooth.input,
    opacity.input,
    scale.input,
    fitButton,
  ];

  const render = () => {
    const ref = editor.reference;
    for (const control of controls) control.disabled = !ref;
    moveButton.setAttribute('aria-pressed', String(editor.tool === 'reference'));
    if (!ref) {
      info.textContent = 'Load an image to trace over. It is never painted on or exported.';
      return;
    }
    info.textContent = `${ref.name} · ${ref.width}×${ref.height}`;
    sync(ref);
  };

  const sync = (ref: ReferenceSettings) => {
    show.input.checked = ref.visible;
    above.input.checked = ref.above;
    smooth.input.checked = ref.smooth;
    opacity.set(Math.round(ref.opacity * 100), `${Math.round(ref.opacity * 100)}%`);
    scale.set(Math.round(scaleToSlider(ref.scale) * SCALE_STEPS), formatScale(ref.scale));
  };

  editor.onChange(render);
  render();
  panel.append(
    heading,
    fieldRow(loadButton, removeButton, moveButton),
    info,
    toggles,
    opacity.row,
    scale.row,
    status,
  );
  return panel;
}

function formatScale(scale: number): string {
  const percent = scale * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

