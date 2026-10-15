import type { Rgba } from '../core/color.ts';
import {
  addIndexedLayerEdit,
  importImageLayerEdit,
  openImageEdit,
  openIndexedImageEdit,
  replaceDocumentEdit,
  type ImageColorMode,
} from '../core/documentEdits.ts';
import { planeSize, type Facing } from '../core/facing.ts';
import { documentImage, flattenImage, upscaleImage } from '../core/image.ts';
import { buildMesh, buildVoxelModel } from '../core/model.ts';
import { createPalette, type Palette } from '../core/palette.ts';
import type { PixelatedImage } from '../core/pixelate.ts';
import { checkDocumentSize, layerIndex, type PixelDocument } from '../core/pixelDocument.ts';
import { downloadBlob, fileBaseName, formatFileSize, safeFileName } from '../io/files.ts';
import { GLB_EXTENSION, meshToGlb } from '../io/glb.ts';
import {
  checkExportSize,
  decodeImageCropped,
  decodeImageExact,
  encodeImage,
  IMAGE_FORMATS,
  type ImageFormat,
} from '../io/imageCodec.ts';
import { parseProject, PROJECT_EXTENSION, serializeProject } from '../io/projectFile.ts';
import type { ReferenceImage } from '../render/referenceImage.ts';
import { BUSY_MESSAGE } from './commands.ts';
import type { Editor } from './editor.ts';
import { referenceFromProject } from './referencePanel.ts';

/*
 * File commands. Each returns (or resolves to) a status message for the UI
 * and throws (or rejects) with a user-readable error. They take files rather
 * than opening pickers, so drag-and-drop and tests can call them directly.
 */

/** Replaces the document with an image file (undoable). PNGs are read exactly (see `decodeImageExact`). */
export async function openImageFile(editor: Editor, file: File, mode: ImageColorMode): Promise<string> {
  const image = await decodeImageExact(file, (width, height) => checkDocumentSize(width, height));
  const name = fileBaseName(file.name);
  if (!editor.perform(openImageEdit(editor.doc, image, name, mode))) throw new Error(BUSY_MESSAGE);
  const colors = editor.doc.palette.colors.length;
  const how = mode === 'image' ? `${colors} colors` : `mapped to the current ${colors}-color palette`;
  return `Opened ${file.name} (${image.width}×${image.height}, ${how}).`;
}

/**
 * Adds an image file as a new layer above the active one, on the side being
 * edited, mapped to the current palette (undoable). Only the part that fits
 * the side is decoded: a photo can be far larger than any canvas allows.
 */
export async function addImageLayer(editor: Editor, file: File): Promise<string> {
  // As they are now: decoding takes a moment, in which the user may switch sides.
  const { doc, facing } = editor;
  const activeId = editor.activeLayer.id;
  const plane = planeSize(doc, facing);
  const { image, width, height } = await decodeImageCropped(file, plane.width, plane.height);
  const above = layerIndex(doc, activeId);
  const edit = importImageLayerEdit(doc, facing, image, fileBaseName(file.name), above < 0 ? doc.layers.length : above + 1);
  if (!editor.perform(edit)) throw new Error(BUSY_MESSAGE);
  editor.selectLayer(edit.layer.id);
  const cropped = width > edit.layer.width || height > edit.layer.height;
  return `Added ${file.name} as a layer${cropped ? `, cropped to ${edit.layer.width}×${edit.layer.height}` : ''}.`;
}

/**
 * Replaces the document with a project file (undoable). A reference image
 * saved in the project replaces the current one (clearing it when the saved
 * one can't be read, so an unrelated image doesn't show over the new
 * document); otherwise the current one stays, as when opening an image.
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
  if (project.reference) editor.setReference(reference);
  const { width, height, depth, layers } = editor.doc;
  const parts = [`${width}×${height}×${depth}`, `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}`];
  if (reference) parts.push('with its reference image');
  return `Opened ${file.name} (${parts.join(', ')}).${note}`;
}

/**
 * Replaces the document with a pixelated image (undoable). `palette` is the
 * palette it was mapped to, or null for its own generated colors.
 */
export function openPixelatedImage(editor: Editor, image: PixelatedImage, palette: Palette | null, name: string): string {
  const edit = openIndexedImageEdit(editor.doc, image, palette ?? createPalette(name, image.colors), name);
  if (!editor.perform(edit)) throw new Error(BUSY_MESSAGE);
  const colors = editor.doc.palette.colors.length;
  return `Opened ${name} pixelated to ${image.width}×${image.height} (${colors} colors).`;
}

/**
 * Adds a pixelated image as a layer above the active one, on the side being
 * edited, adding the colors it uses to the palette (undoable).
 */
export function addPixelatedLayer(editor: Editor, image: PixelatedImage, name: string): string {
  const { doc, facing } = editor;
  const colorsBefore = doc.palette.colors.length;
  const { edit, layer } = addIndexedLayerEdit(doc, facing, image, image.colors, name, editor.activeLayerIndex + 1);
  if (!editor.perform(edit)) throw new Error(BUSY_MESSAGE);
  editor.selectLayer(layer.id);
  const parts: string[] = [];
  if (image.width > layer.width || image.height > layer.height) {
    parts.push(`cropped to ${Math.min(image.width, layer.width)}×${Math.min(image.height, layer.height)}`);
  }
  const added = doc.palette.colors.length - colorsBefore;
  if (added > 0) parts.push(`${added} ${added === 1 ? 'color' : 'colors'} added to the palette`);
  return `Added ${name} as a layer${parts.length > 0 ? ` (${parts.join(', ')})` : ''}.`;
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
