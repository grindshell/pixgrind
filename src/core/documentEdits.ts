import type { Rgba } from './color.ts';
import { combineEdits, documentState, type DocumentEdit, type Edit, type LayerAddEdit } from './edits.ts';
import { extrusionEnd, extrusionOffset, fitExtrusion, withBox } from './extrusion.ts';
import { planeSize, type Facing } from './facing.ts';
import { indexImageColors, indexImageToPalette, type IndexedImage, type RgbaImage } from './image.ts';
import { createLayer, type Layer } from './layer.ts';
import { createPalette, MAX_PALETTE_COLORS, TRANSPARENT, type Palette } from './palette.ts';
import { paletteEdit } from './paletteEdits.ts';
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
  const { width, height } = image;
  if (mode === 'palette') {
    return openIndexedImageEdit(doc, { width, height, pixels: indexImageToPalette(image.data, doc.palette) }, doc.palette, name);
  }
  const { colors, pixels } = indexImageColors(image.data);
  return openIndexedImageEdit(doc, { width, height, pixels }, createPalette(name, colors), name);
}

/**
 * Replaces the document with an indexed image (e.g. a pixelated photo) and
 * its palette, as `openImageEdit` does. A palette with no colors (an image
 * with nothing visible) keeps the current palette instead.
 */
export function openIndexedImageEdit(doc: PixelDocument, image: IndexedImage, palette: Palette, name: string): DocumentEdit {
  checkDocumentSize(image.width, image.height);
  const next = createDocument(image.width, image.height, palette.colors.length > 0 ? palette : doc.palette, name);
  next.layers[0].pixels.set(image.pixels);
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
  checkLayerPosition(doc, index);
  const plane = planeSize(doc, facing);
  const width = Math.min(image.width, plane.width);
  const height = Math.min(image.height, plane.height);
  // Crop before matching colors: a photo can be far bigger than the side.
  const cropped = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * image.width * 4;
    cropped.set(image.data.subarray(row, row + width * 4), y * width * 4);
  }
  const layer = layerWithImage(doc, facing, name, { width, height, pixels: indexImageToPalette(cropped, doc.palette) });
  return { kind: 'layer-add', label: 'Add image as layer', layer, index };
}

/**
 * Adds an indexed image as a new layer on `facing` at `index`, placed at the
 * top-left and cropped to the facing's plane. Its colors (`colors[i]` is
 * index `i + 1`) stay exact: each pixel takes the first palette color equal
 * to its own, and the colors the palette lacks are added to it in the same
 * edit. Throws a RangeError when that would make the palette too large.
 */
export function addIndexedLayerEdit(
  doc: PixelDocument,
  facing: Facing,
  image: IndexedImage,
  colors: readonly Rgba[],
  name: string,
  index: number,
): { edit: Edit; layer: Layer } {
  checkLayerPosition(doc, index);
  const plane = planeSize(doc, facing);
  const width = Math.min(image.width, plane.width);
  const height = Math.min(image.height, plane.height);
  const cropped = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) cropped.set(image.pixels.subarray(y * image.width, y * image.width + width), y * width);

  // Only the colors left after cropping need a place in the palette.
  const used = new Uint8Array(256);
  for (let i = 0; i < cropped.length; i++) used[cropped[i]] = 1;
  const paletteColors = [...doc.palette.colors];
  const mapping = new Uint8Array(256);
  for (let i = 1; i < 256; i++) {
    if (!used[i] || i > colors.length) continue;
    let at = paletteColors.indexOf(colors[i - 1]);
    if (at < 0) at = paletteColors.push(colors[i - 1]) - 1;
    mapping[i] = at + 1;
  }
  if (paletteColors.length > MAX_PALETTE_COLORS) {
    const added = paletteColors.length - doc.palette.colors.length;
    throw new RangeError(
      `The image needs ${added} more palette colors, ${paletteColors.length} in all; a palette holds at most ${MAX_PALETTE_COLORS}`,
    );
  }

  const label = 'Add image as layer';
  const layer = layerWithImage(doc, facing, name, { width, height, pixels: cropped.map((i) => mapping[i]) });
  const palette = paletteEdit(doc, createPalette(doc.palette.name, paletteColors), label);
  const add: LayerAddEdit = { kind: 'layer-add', label, layer, index };
  return { edit: combineEdits(label, [palette, add]) ?? add, layer };
}

function checkLayerPosition(doc: PixelDocument, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > doc.layers.length) {
    throw new RangeError(`Invalid layer position ${index}`);
  }
}

/** A new layer on `facing` with an image no larger than the facing's plane at its top-left. */
function layerWithImage(doc: PixelDocument, facing: Facing, name: string, image: IndexedImage): Layer {
  const plane = planeSize(doc, facing);
  const layer = createLayer(plane.width, plane.height, name, facing);
  for (let y = 0; y < image.height; y++) {
    layer.pixels.set(image.pixels.subarray(y * image.width, (y + 1) * image.width), y * plane.width);
  }
  return layer;
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
