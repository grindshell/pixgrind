import type { Rgba } from '../core/color.ts';
import { importImageLayerEdit, openImageEdit, type ImageColorMode } from '../core/documentEdits.ts';
import { documentImage, flattenImage, upscaleImage } from '../core/image.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import { downloadBlob, fileBaseName, safeFileName } from '../io/files.ts';
import { decodeImage, encodeImage, IMAGE_FORMATS, type ImageFormat } from '../io/imageCodec.ts';
import type { Editor } from './editor.ts';

/*
 * Image file commands. Each resolves to a status message for the UI and
 * rejects with a user-readable error. They take files rather than opening
 * pickers, so drag-and-drop and tests can call them directly.
 */

/** Replaces the document with an image file (undoable). */
export async function openImageFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  const image = await decodeImage(file);
  const name = fileBaseName(file.name);
  editor.perform(openImageEdit(editor.doc, image, name, mode));
  const colors = editor.doc.palette.colors.length;
  const how = mode === 'image' ? `${colors} colors` : `mapped to the current ${colors}-color palette`;
  return `Opened ${file.name} (${image.width}×${image.height}, ${how}).`;
}

/** Adds an image file as a new layer above the active one, mapped to the current palette (undoable). */
export async function addImageLayer(editor: Editor, file: File): Promise<string> {
  const image = await decodeImage(file);
  const { doc } = editor;
  const edit = importImageLayerEdit(doc, image, fileBaseName(file.name), editor.activeLayerIndex + 1);
  editor.perform(edit);
  editor.selectLayer(edit.layer.id);
  const cropped = image.width > doc.width || image.height > doc.height;
  return `Added ${file.name} as a layer${cropped ? `, cropped to ${doc.width}×${doc.height}` : ''}.`;
}

export interface ExportOptions {
  format: ImageFormat;
  /** Whole-number upscale, nearest-neighbor. */
  scale: number;
  /** Fills transparency for formats without it (JPEG). */
  background: Rgba;
}

/** Encodes the visible layers as an image file. */
export async function renderExport(doc: PixelDocument, { format, scale, background }: ExportOptions): Promise<Blob> {
  let image = upscaleImage(documentImage(doc), scale);
  if (format === 'jpeg') image = flattenImage(image, background);
  return encodeImage(image, format);
}

export function exportFileName(doc: PixelDocument, { format, scale }: ExportOptions): string {
  const suffix = scale > 1 ? `@${scale}x` : '';
  return `${safeFileName(doc.name)}${suffix}.${IMAGE_FORMATS[format].extension}`;
}

/** Encodes and downloads the image. */
export async function exportImage(editor: Editor, options: ExportOptions): Promise<string> {
  const blob = await renderExport(editor.doc, options);
  const fileName = exportFileName(editor.doc, options);
  downloadBlob(blob, fileName);
  const { width, height } = editor.doc;
  return `Exported ${fileName} (${width * options.scale}×${height * options.scale}).`;
}
