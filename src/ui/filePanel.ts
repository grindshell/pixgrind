import { parseHex } from '../core/color.ts';
import type { ImageColorMode } from '../core/documentEdits.ts';
import { chooseFile } from '../io/files.ts';
import { IMAGE_FORMATS, type ImageFormat } from '../io/imageCodec.ts';
import { isProjectFile, PROJECT_EXTENSION } from '../io/projectFile.ts';
import { checkbox, el, fieldRow, option, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { addImageLayer, exportImage, openFile, saveProject } from './fileCommands.ts';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
const OPEN_ACCEPT = `.${PROJECT_EXTENSION},${IMAGE_ACCEPT}`;
const SCALES = [1, 2, 4, 8, 16];
const DEFAULT_JPEG_BACKGROUND = '#ffffff';

export interface FilePanel {
  element: HTMLElement;
  /** Picks a project or image to open (Ctrl+O). */
  open(): void;
  /** Saves the project (Ctrl+S). */
  save(): void;
  /** Shows a message in the panel's status line (e.g. from the clipboard). */
  report(message: string): void;
}

/**
 * Open a project or an image, add an image as a layer, save the project, and
 * export the visible layers. Files dropped on `dropTarget` are opened too.
 */
export function createFilePanel(editor: Editor, dropTarget: HTMLElement): FilePanel {
  const panel = el('section', 'panel');
  const heading = el('h2', 'panel-title');
  heading.textContent = 'File';

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');
  const run = (task: Promise<string>) =>
    task.then(
      (message) => (status.textContent = message),
      (error: unknown) => (status.textContent = error instanceof Error ? error.message : String(error)),
    );

  const colorMode = el('select', 'select');
  colorMode.setAttribute('aria-label', 'Colors when opening an image');
  colorMode.append(option('image', "Use the image's colors"), option('palette', 'Match current palette'));
  colorMode.title =
    "How an opened image becomes indexed colors.\nUse the image's colors: exact, up to 255 colors.\nMatch current palette: each pixel takes the nearest palette color.";
  const openMode = () => colorMode.value as ImageColorMode;

  const open = () => {
    void chooseFile(OPEN_ACCEPT).then((file) => file && run(openFile(editor, file, openMode())));
  };
  const openButton = textButton('Open…', open);
  openButton.title = 'Open a Pixgrind project or an image (Ctrl+O). You can also drop one on the canvas.';
  const layerButton = textButton('Add as layer…', () => {
    void chooseFile(IMAGE_ACCEPT).then((file) => file && run(addImageLayer(editor, file)));
  });
  layerButton.title = 'Add an image as a new layer, using the nearest palette colors';

  const includeReference = checkbox('with reference', () => {});
  includeReference.input.checked = true;
  includeReference.label.title = "Embed the reference image in the project. Turn off to keep a large photo out of the file.";
  const save = () => {
    void run(saveProject(editor, { includeReference: includeReference.input.checked }));
  };
  const saveButton = textButton('Save', save);
  saveButton.title = `Download a .${PROJECT_EXTENSION} file with all layers and the palette (Ctrl+S)`;

  const format = el('select', 'select');
  format.setAttribute('aria-label', 'Export format');
  for (const [value, { label }] of Object.entries(IMAGE_FORMATS)) format.append(option(value, label));
  const scale = el('select', 'select');
  scale.setAttribute('aria-label', 'Export scale');
  for (const s of SCALES) scale.append(option(String(s), `${s}×`));
  const exportButton = textButton('Export', () => {
    void run(
      exportImage(editor, {
        format: format.value as ImageFormat,
        scale: Number(scale.value),
        background: parseHex(background.value),
      }),
    );
  });
  exportButton.title = 'Download the visible layers as an image';

  const background = el('input', 'color-picker');
  background.type = 'color';
  background.value = DEFAULT_JPEG_BACKGROUND;
  background.setAttribute('aria-label', 'JPEG background color');
  const backgroundLabel = el('span', 'field-label');
  backgroundLabel.textContent = 'Background';
  const jpegRow = fieldRow(backgroundLabel, background);
  const jpegNote = el('p', 'panel-note');
  jpegNote.textContent = 'JPEG has no transparency and is lossy: expect soft edges. PNG keeps pixels exact.';

  const syncFormat = () => {
    const isJpeg = format.value === 'jpeg';
    jpegRow.hidden = !isJpeg;
    jpegNote.hidden = !isJpeg;
  };
  format.addEventListener('change', syncFormat);
  syncFormat();

  // The reference option only matters when there is a reference.
  const syncReference = () => {
    includeReference.label.hidden = !editor.reference;
  };
  editor.onChange(syncReference);
  syncReference();

  attachFileDrop(dropTarget, (file) => void run(openFile(editor, file, openMode())));

  panel.append(
    heading,
    fieldRow(openButton, layerButton),
    colorMode,
    fieldRow(saveButton, includeReference.label),
    fieldRow(format, scale, exportButton),
    jpegRow,
    jpegNote,
    status,
  );
  return { element: panel, open, save, report: (message) => (status.textContent = message) };
}

/** Calls `onDrop` with the first project or image file dropped on `target`, highlighting it while dragging. */
function attachFileDrop(target: HTMLElement, onDrop: (file: File) => void): void {
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  target.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    target.classList.add('is-drop-target');
  });
  target.addEventListener('dragleave', (e) => {
    // Moving onto a child (the canvas) also fires dragleave; only clear when leaving the target.
    if (!(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))) {
      target.classList.remove('is-drop-target');
    }
  });
  target.addEventListener('drop', (e) => {
    target.classList.remove('is-drop-target');
    if (!hasFiles(e)) return;
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => isProjectFile(f) || f.type.startsWith('image/'));
    if (file) onDrop(file);
  });
}
