import { documentState, type DocumentEdit, type LayerAddEdit } from './edits.ts';
import { extrusionEnd, extrusionOffset, fitExtrusion, withBox } from './extrusion.ts';
import { planeSize, type Facing } from './facing.ts';
import { indexImageColors, indexImageToPalette, type RgbaImage } from './image.ts';
import { createLayer, type Layer } from './layer.ts';
import { clonePalette, createPalette, TRANSPARENT } from './palette.ts';
import { checkDocumentSize, createDocument, type PixelDocument } from './pixelDocument.ts';

/** How an opened image's colors become palette indices. */
export type ImageColorMode =
  /** The image's own distinct colors become the palette (exact; at most 255 colors). */
  | 'image'
  /** Every pixel maps to the nearest color of the current palette. */
  | 'palette';

/**
 * Replaces the document with an image: its size, the image as the front's
 * layer, and a palette chosen by `mode`. Undoable like any edit. Throws when
 * the image is too large or (in `image` mode) has too many colors.
 */
export function openImageEdit(doc: PixelDocument, image: RgbaImage, name: string, mode: ImageColorMode): DocumentEdit {
  // Before counting colors: a photo that's too large shouldn't be reported as having too many.
  checkDocumentSize(image.width, image.height);
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
 * Adds an image as a new layer on `facing` at `index`, mapped to the nearest
 * colors of the current palette and placed at the top-left. Parts off the
 * facing's plane are cropped.
 */
export function importImageLayerEdit(
  doc: PixelDocument,
  facing: Facing,
  image: RgbaImage,
  name: string,
  index: number,
): LayerAddEdit {
  if (!Number.isInteger(index) || index < 0 || index > doc.layers.length) {
    throw new RangeError(`Invalid layer position ${index}`);
  }
  const plane = planeSize(doc, facing);
  const layer = createLayer(plane.width, plane.height, name, facing);
  const width = Math.min(image.width, plane.width);
  const height = Math.min(image.height, plane.height);
  // Crop before matching colors: a photo can be far bigger than the side.
  const cropped = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * image.width * 4;
    cropped.set(image.data.subarray(row, row + width * 4), y * width * 4);
  }
  const indices = indexImageToPalette(cropped, doc.palette);
  for (let y = 0; y < height; y++) layer.pixels.set(indices.subarray(y * width, (y + 1) * width), y * plane.width);
  return { kind: 'layer-add', label: 'Add image as layer', layer, index };
}

/**
 * Makes the volume `depth` deep, growing or shrinking it at the front so the
 * model stays where it is: the front's boxes start from the back and keep
 * their offsets, the back's move out by the change, the top, bottom and side
 * layers gain or lose rows or columns at the front, and boxes that would
 * reach past the front are cut short there. Selections on the resized sides
 * and any float are dropped. Null when the depth doesn't change.
 */
export function setDepthEdit(doc: PixelDocument, depth: number): DocumentEdit | null {
  checkDocumentSize(doc.width, doc.height, depth);
  if (depth === doc.depth) return null;
  const change = depth - doc.depth;
  const next: PixelDocument = {
    ...doc,
    depth,
    layers: doc.layers.map((layer) => resizedLayer(layer, change, depth)),
    selections: { ...doc.selections, left: null, right: null, top: null, bottom: null },
    floating: null,
  };
  return replaceDocumentEdit(doc, next, 'Change depth');
}

/** A layer after the volume's depth changes by `change` at the front, to `depth`. */
function resizedLayer(layer: Layer, change: number, depth: number): Layer {
  switch (layer.facing) {
    case 'front':
      return mapExtrusions(layer, (extrusion) => fitExtrusion(extrusion, depth));
    case 'back':
      // Counted from the front, which moves.
      return mapExtrusions(layer, (extrusion) => {
        const start = Math.max(0, extrusionOffset(extrusion) + change);
        const end = Math.max(start + 1, extrusionEnd(extrusion) + change);
        return fitExtrusion(withBox(extrusion, start, end - start), depth);
      });
    // The top's rows and the left side's columns run back to front, so the
    // front is at their end. The bottom's rows and the right side's columns
    // run front to back, so they shift by the change.
    case 'top':
      return cropped(layer, layer.width, depth, 0, 0);
    case 'bottom':
      return cropped(layer, layer.width, depth, 0, change);
    case 'left':
      return cropped(layer, depth, layer.height, 0, 0);
    case 'right':
      return cropped(layer, depth, layer.height, change, 0);
  }
}

/** A copy of `layer` with each painted pixel's extrusion mapped. The same layer when nothing changes. */
function mapExtrusions(layer: Layer, map: (extrusion: number) => number): Layer {
  let extrusion: Uint32Array | null = null;
  for (let i = 0; i < layer.pixels.length; i++) {
    if (layer.pixels[i] === TRANSPARENT) continue;
    const mapped = map(layer.extrusion[i]);
    if (mapped === layer.extrusion[i]) continue;
    extrusion ??= layer.extrusion.slice();
    extrusion[i] = mapped;
  }
  return extrusion ? { ...layer, pixels: layer.pixels.slice(), extrusion } : layer;
}

/** A copy of `layer` resized to `width`×`height`, its pixels moved by (dx, dy); what falls off is lost. */
function cropped(layer: Layer, width: number, height: number, dx: number, dy: number): Layer {
  const copy = { ...createLayer(width, height, layer.name, layer.facing), id: layer.id };
  copy.visible = layer.visible;
  copy.opacity = layer.opacity;
  for (let y = Math.max(0, dy); y < Math.min(height, layer.height + dy); y++) {
    for (let x = Math.max(0, dx); x < Math.min(width, layer.width + dx); x++) {
      const from = (y - dy) * layer.width + (x - dx);
      copy.pixels[y * width + x] = layer.pixels[from];
      copy.extrusion[y * width + x] = layer.extrusion[from];
    }
  }
  return copy;
}
