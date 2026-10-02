import { documentState, type DocumentEdit, type LayerAddEdit } from './edits.ts';
import { indexImageColors, indexImageToPalette, type RgbaImage } from './image.ts';
import { createLayer } from './layer.ts';
import { clonePalette, createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';

/** How an opened image's colors become palette indices. */
export type ImageColorMode =
  /** The image's own distinct colors become the palette (exact; at most 255 colors). */
  | 'image'
  /** Every pixel maps to the nearest color of the current palette. */
  | 'palette';

/**
 * Replaces the document with an image: its size, one layer, and a palette
 * chosen by `mode`. Undoable like any edit. Throws when the image is too
 * large or (in `image` mode) has too many colors.
 */
export function openImageEdit(doc: PixelDocument, image: RgbaImage, name: string, mode: ImageColorMode): DocumentEdit {
  const indexed = mode === 'image' ? indexImageColors(image.data) : null;
  // A fully transparent image has no colors of its own; keep the current palette then.
  const palette =
    indexed && indexed.colors.length > 0 ? createPalette(name, indexed.colors) : clonePalette(doc.palette);
  const next = createDocument(image.width, image.height, palette, name);
  next.layers[0].pixels.set(indexed ? indexed.pixels : indexImageToPalette(image.data, doc.palette));
  return replaceDocumentEdit(doc, next, 'Open image');
}

/** Replaces `doc` with the contents of `next` (e.g. an opened project). Undoable like any edit. */
export function replaceDocumentEdit(doc: PixelDocument, next: PixelDocument, label: string): DocumentEdit {
  return { kind: 'document', label, before: documentState(doc), after: documentState(next) };
}

/**
 * Adds an image as a new layer at `index`, mapped to the nearest colors of
 * the current palette and placed at the top-left. Parts outside the document
 * are cropped.
 */
export function importImageLayerEdit(doc: PixelDocument, image: RgbaImage, name: string, index: number): LayerAddEdit {
  if (!Number.isInteger(index) || index < 0 || index > doc.layers.length) {
    throw new RangeError(`Invalid layer position ${index}`);
  }
  const indices = indexImageToPalette(image.data, doc.palette);
  const layer = createLayer(doc.width, doc.height, name);
  const width = Math.min(image.width, doc.width);
  const height = Math.min(image.height, doc.height);
  for (let y = 0; y < height; y++) {
    layer.pixels.set(indices.subarray(y * image.width, y * image.width + width), y * doc.width);
  }
  return { kind: 'layer-add', label: 'Add image as layer', layer, index };
}
