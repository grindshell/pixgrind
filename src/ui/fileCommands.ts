import type { Rgba } from '../core/color.ts';
import { importImageLayerEdit, openImageEdit, replaceDocumentEdit, type ImageColorMode } from '../core/documentEdits.ts';
import { documentImage, flattenImage, upscaleImage } from '../core/image.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import { downloadBlob, fileBaseName, formatFileSize, safeFileName } from '../io/files.ts';
import { decodeImage, encodeImage, IMAGE_FORMATS, type ImageFormat } from '../io/imageCodec.ts';
import { isProjectFile, parseProject, PROJECT_EXTENSION, serializeProject } from '../io/projectFile.ts';
import type { ReferenceImage } from '../render/referenceImage.ts';
import type { Editor } from './editor.ts';
import { referenceFromProject } from './referencePanel.ts';

/*
 * File commands. Each resolves to a status message for the UI and rejects
 * with a user-readable error. They take files rather than opening pickers,
 * so drag-and-drop and tests can call them directly.
 */

const BUSY = 'Finish drawing first, then try again.';

/** Opens a project file or an image, by file name. */
export function openFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  return isProjectFile(file) ? openProjectFile(editor, file) : openImageFile(editor, file, mode);
}

/** Replaces the document with an image file (undoable). */
export async function openImageFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  const image = await decodeImage(file);
  const name = fileBaseName(file.name);
  if (!editor.perform(openImageEdit(editor.doc, image, name, mode))) throw new Error(BUSY);
  const colors = editor.doc.palette.colors.length;
  const how = mode === 'image' ? `${colors} colors` : `mapped to the current ${colors}-color palette`;
  return `Opened ${file.name} (${image.width}×${image.height}, ${how}).`;
}

/** Adds an image file as a new layer above the active one, mapped to the current palette (undoable). */
export async function addImageLayer(editor: Editor, file: File): Promise<string> {
  const image = await decodeImage(file);
  const { doc } = editor;
  const edit = importImageLayerEdit(doc, image, fileBaseName(file.name), editor.activeLayerIndex + 1);
  if (!editor.perform(edit)) throw new Error(BUSY);
  editor.selectLayer(edit.layer.id);
  const cropped = image.width > doc.width || image.height > doc.height;
  return `Added ${file.name} as a layer${cropped ? `, cropped to ${doc.width}×${doc.height}` : ''}.`;
}

/**
 * Replaces the document with a project file (undoable). A reference image
 * saved in the project replaces the current one; otherwise the current one
 * stays, as when opening an image.
 */
export async function openProjectFile(editor: Editor, file: File): Promise<string> {
  const project = await parseProject(await file.text());
  // Decode the reference first, so the new document never shows with the old reference.
  let reference: ReferenceImage | null = null;
  let note = '';
  if (project.reference) {
    try {
      reference = await referenceFromProject(project.reference);
    } catch {
      note = ' Its reference image could not be read.';
    }
  }
  if (!editor.perform(replaceDocumentEdit(editor.doc, project.document, 'Open project'))) {
    reference?.bitmap.close();
    throw new Error(BUSY);
  }
  editor.markSaved();
  if (reference) editor.setReference(reference);
  const { width, height, layers } = editor.doc;
  const parts = [`${width}×${height}`, `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}`];
  if (reference) parts.push('with its reference image');
  return `Opened ${file.name} (${parts.join(', ')}).${note}`;
}

export interface SaveOptions {
  /** Embed the reference image (its original file) in the project. */
  includeReference: boolean;
}

export function projectFileName(doc: PixelDocument): string {
  return `${safeFileName(doc.name)}.${PROJECT_EXTENSION}`;
}

/** Downloads the document as a project file and marks it saved. */
export async function saveProject(editor: Editor, { includeReference }: SaveOptions): Promise<string> {
  // The document is copied synchronously at the start of serializing; it is saved as of now.
  const position = editor.history.position;
  const reference = includeReference ? editor.reference : null;
  const blob = new Blob([await serializeProject(editor.doc, reference)], { type: 'application/json' });
  const fileName = projectFileName(editor.doc);
  downloadBlob(blob, fileName);
  editor.markSaved(position);
  return `Saved ${fileName} (${formatFileSize(blob.size)}${reference ? ', with the reference image' : ''}).`;
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
