import { parseHex } from '../core/color.ts';
import type { ImageColorMode } from '../core/documentEdits.ts';
import { chooseFile } from '../io/files.ts';
import { IMAGE_FORMATS, type ImageFormat } from '../io/imageCodec.ts';
import { el, fieldRow, option, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { addImageLayer, exportImage, openImageFile } from './fileCommands.ts';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
const SCALES = [1, 2, 4, 8, 16];
const DEFAULT_JPEG_BACKGROUND = '#ffffff';

/**
 * Open an image as the document, add one as a layer, and export the visible
 * layers. Images dropped on `dropTarget` are opened too.
 */
export function createFilePanel(editor: Editor, dropTarget: HTMLElement): HTMLElement {
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
    "Use the image's colors: exact, up to 255 colors.\nMatch current palette: each pixel takes the nearest palette color.";
  const openMode = () => colorMode.value as ImageColorMode;

  const openButton = textButton('Open…', () => {
    void chooseFile(IMAGE_ACCEPT).then((file) => file && run(openImageFile(editor, file, openMode())));
  });
  openButton.title = 'Open an image as the document (undoable). You can also drop an image on the canvas.';
  const layerButton = textButton('Add as layer…', () => {
    void chooseFile(IMAGE_ACCEPT).then((file) => file && run(addImageLayer(editor, file)));
  });
  layerButton.title = 'Add an image as a new layer, using the nearest palette colors';

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

  attachImageDrop(dropTarget, (file) => void run(openImageFile(editor, file, openMode())));

  panel.append(
    heading,
    fieldRow(openButton, layerButton),
    colorMode,
    fieldRow(format, scale, exportButton),
    jpegRow,
    jpegNote,
    status,
  );
  return panel;
}

/** Calls `onDrop` with the first image file dropped on `target`, highlighting it while dragging. */
function attachImageDrop(target: HTMLElement, onDrop: (file: File) => void): void {
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
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) onDrop(file);
  });
}
