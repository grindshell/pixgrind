import type { Rgba } from '../core/color.ts';
import { importImageLayerEdit, openImageEdit, replaceDocumentEdit, type ImageColorMode } from '../core/documentEdits.ts';
import { planeSize, type Facing } from '../core/facing.ts';
import { documentImage, flattenImage, upscaleImage } from '../core/image.ts';
import { buildMesh, buildVoxelModel } from '../core/model.ts';
import { checkDocumentSize, type PixelDocument } from '../core/pixelDocument.ts';
import { downloadBlob, fileBaseName, formatFileSize, safeFileName } from '../io/files.ts';
import { GLB_EXTENSION, meshToGlb } from '../io/glb.ts';
import { checkExportSize, decodeImage, encodeImage, IMAGE_FORMATS, type ImageFormat } from '../io/imageCodec.ts';
import { isProjectFile, parseProject, PROJECT_EXTENSION, serializeProject } from '../io/projectFile.ts';
import type { ReferenceImage } from '../render/referenceImage.ts';
import { BUSY_MESSAGE } from './commands.ts';
import type { Editor } from './editor.ts';
import { referenceFromProject } from './referencePanel.ts';

/*
 * File commands. Each resolves to a status message for the UI and rejects
 * with a user-readable error. They take files rather than opening pickers,
 * so drag-and-drop and tests can call them directly.
 */

/** Opens a project file or an image, by file name. */
export function openFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  return isProjectFile(file) ? openProjectFile(editor, file) : openImageFile(editor, file, mode);
}

/** Replaces the document with an image file (undoable). */
export async function openImageFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  const image = await decodeImage(file, (width, height) => checkDocumentSize(width, height));
  const name = fileBaseName(file.name);
  if (!editor.perform(openImageEdit(editor.doc, image, name, mode))) throw new Error(BUSY_MESSAGE);
  const colors = editor.doc.palette.colors.length;
  const how = mode === 'image' ? `${colors} colors` : `mapped to the current ${colors}-color palette`;
  return `Opened ${file.name} (${image.width}×${image.height}, ${how}).`;
}

/** Adds an image file as a new layer above the active one, on the side being edited, mapped to the current palette (undoable). */
export async function addImageLayer(editor: Editor, file: File): Promise<string> {
  const image = await decodeImage(file);
  const { doc, facing } = editor;
  const edit = importImageLayerEdit(doc, facing, image, fileBaseName(file.name), editor.activeLayerIndex + 1);
  if (!editor.perform(edit)) throw new Error(BUSY_MESSAGE);
  editor.selectLayer(edit.layer.id);
  const { width, height } = edit.layer;
  const cropped = image.width > width || image.height > height;
  return `Added ${file.name} as a layer${cropped ? `, cropped to ${width}×${height}` : ''}.`;
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
    throw new Error(BUSY_MESSAGE);
  }
  editor.markSaved();
  if (reference) editor.setReference(reference);
  const { width, height, depth, layers } = editor.doc;
  const parts = [`${width}×${height}×${depth}`, `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}`];
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

/** Downloads the document as a project file and marks it saved. Refused mid-gesture. */
export async function saveProject(editor: Editor, { includeReference }: SaveOptions): Promise<string> {
  // A half-done stroke or move isn't any state in history, so it can't be marked saved.
  if (editor.busy) throw new Error(BUSY_MESSAGE);
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
  /** The side whose layers to export. */
  facing: Facing;
}

/** Encodes one side's visible layers as an image file. */
export async function renderExport(doc: PixelDocument, { format, scale, background, facing }: ExportOptions): Promise<Blob> {
  const { width, height } = planeSize(doc, facing);
  checkExportSize(width * scale, height * scale);
  let image = upscaleImage(documentImage(doc, facing), scale);
  if (format === 'jpeg') image = flattenImage(image, background);
  return encodeImage(image, format);
}

/** `<name>[-<side>][@<scale>x].<ext>`: the side is left out for the front. */
export function exportFileName(doc: PixelDocument, { format, scale, facing }: ExportOptions): string {
  const side = facing === 'front' ? '' : `-${facing}`;
  const suffix = scale > 1 ? `@${scale}x` : '';
  return `${safeFileName(doc.name)}${side}${suffix}.${IMAGE_FORMATS[format].extension}`;
}

/** Encodes and downloads the image. */
export async function exportImage(editor: Editor, options: ExportOptions): Promise<string> {
  const blob = await renderExport(editor.doc, options);
  const fileName = exportFileName(editor.doc, options);
  downloadBlob(blob, fileName);
  const { width, height } = planeSize(editor.doc, options.facing);
  return `Exported ${fileName} (${width * options.scale}×${height * options.scale}).`;
}

export interface ModelExportOptions {
  /** Meters per pixel. */
  scale: number;
  /** A closed, manifold shell per color (see `MeshOptions`), rather than the fewest faces. */
  watertight: boolean;
}

/** The 3D model of the visible layers as a GLB file, and how many faces it has. Throws for an empty model. */
export function renderModelExport(doc: PixelDocument, { scale, watertight }: ModelExportOptions): { blob: Blob; faces: number } {
  const mesh = buildMesh(buildVoxelModel(doc), doc.palette, { watertight });
  const blob = new Blob([meshToGlb(mesh, { name: doc.name, scale })], { type: 'model/gltf-binary' });
  return { blob, faces: mesh.faces };
}

export function modelFileName(doc: PixelDocument): string {
  return `${safeFileName(doc.name)}.${GLB_EXTENSION}`;
}

/** Builds and downloads the 3D model. */
export async function exportModel(editor: Editor, options: ModelExportOptions): Promise<string> {
  const { blob, faces } = renderModelExport(editor.doc, options);
  const fileName = modelFileName(editor.doc);
  downloadBlob(blob, fileName);
  return `Exported ${fileName} (${faces.toLocaleString()} faces, ${formatFileSize(blob.size)}).`;
}
