import { cellExtrusion, cellIndex, DEFAULT_EXTRUSION, packCell, type Cell } from './extrusion.ts';
import { createLayer, type Layer } from './layer.ts';
import type { Mask } from './mask.ts';
import { clonePalette, TRANSPARENT, type Palette } from './palette.ts';
import type { Rect } from './rect.ts';

/** Largest supported width or height. Bigger documents make every redraw and edit slow. */
export const MAX_DOCUMENT_SIZE = 1024;

export interface PixelDocument {
  /** Used for export file names and the window title. */
  name: string;
  width: number;
  height: number;
  palette: Palette;
  /** Bottom to top. */
  layers: Layer[];
  /**
   * Selected pixels, always inside the document, or null for none. Lives
   * here (not in editor state) so selection changes go through undo history
   * with the pixel moves they accompany. Not part of saved image data.
   */
  selection: Mask | null;
  /** Selected pixels being moved, kept even where they hang off the document. Null when nothing floats. */
  floating: FloatingPixels | null;
}

/**
 * A floating selection: pixels lifted from a layer by the Move tool. They
 * stay stamped into the layer at `rect` (so everything else sees them as
 * ordinary layer pixels), and this record keeps what that loses: the pixels
 * that hang off the document, and what each stamped pixel covers. Moving
 * the float puts back what it covered and stamps it again elsewhere.
 * Dropping it just forgets this record. Never mutated: moves make a new one.
 *
 * As a mask it's the float's selection shape, in document coordinates; it
 * may extend past the document.
 */
export interface FloatingPixels extends Mask {
  layerId: string;
  /**
   * The lifted palette indices, row-major over `rect`. Transparent ones,
   * which include every pixel outside the mask, don't cover anything.
   */
  pixels: Uint8Array;
  /** The lifted pixels' extrusions, parallel to `pixels`. */
  extrusion: Uint16Array;
  /**
   * The layer's cell (index and extrusion, see `Cell`) under each
   * non-transparent pixel inside the document, parallel to `pixels` (other
   * entries are unused). Right after lifting this is transparent: the hole
   * the pixels leave.
   */
  under: Uint32Array;
}

/** Throws a RangeError unless a document can be `width`×`height`. */
export function checkDocumentSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid document size ${width}×${height}`);
  }
  if (width > MAX_DOCUMENT_SIZE || height > MAX_DOCUMENT_SIZE) {
    throw new RangeError(
      `${width}×${height} is too large; documents can be at most ${MAX_DOCUMENT_SIZE}×${MAX_DOCUMENT_SIZE}`,
    );
  }
}

export function createDocument(width: number, height: number, palette: Palette, name = 'Untitled'): PixelDocument {
  checkDocumentSize(width, height);
  return {
    name,
    width,
    height,
    palette: clonePalette(palette),
    layers: [createLayer(width, height, 'Layer 1')],
    selection: null,
    floating: null,
  };
}

/** The whole document as a rectangle. */
export function documentRect(doc: PixelDocument): Rect {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

/** Position of a layer in `doc.layers` (0 = bottom), or -1 if it isn't there. */
export function layerIndex(doc: PixelDocument, layerId: string): number {
  return doc.layers.findIndex((layer) => layer.id === layerId);
}

export function findLayer(doc: PixelDocument, layerId: string): Layer | undefined {
  return doc.layers.find((layer) => layer.id === layerId);
}

export function inBounds(doc: PixelDocument, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

/** Palette index at (x, y), or transparent when out of bounds. */
export function getPixel(doc: PixelDocument, layer: Layer, x: number, y: number): number {
  return inBounds(doc, x, y) ? layer.pixels[y * doc.width + x] : TRANSPARENT;
}

/**
 * Sets (x, y) to a palette index. Out-of-bounds writes are ignored. Returns
 * whether the pixel changed. A pixel painted where there was none gets the
 * default extrusion, not whatever an erased pixel left there.
 */
export function setPixel(doc: PixelDocument, layer: Layer, x: number, y: number, index: number): boolean {
  if (!inBounds(doc, x, y)) return false;
  const i = y * doc.width + x;
  if (layer.pixels[i] === index) return false;
  if (layer.pixels[i] === TRANSPARENT) layer.extrusion[i] = DEFAULT_EXTRUSION;
  layer.pixels[i] = index;
  return true;
}

/** The pixel's index and extrusion at `offset` (`y * width + x`) as one cell. */
export function cellAt(layer: Layer, offset: number): Cell {
  return packCell(layer.pixels[offset], layer.extrusion[offset]);
}

/**
 * Sets the pixel at `offset` to a cell: its index, and its extrusion unless
 * the cell is transparent. Returns whether anything changed.
 */
export function setCellAt(layer: Layer, offset: number, cell: Cell): boolean {
  const index = cellIndex(cell);
  const extrusion = index === TRANSPARENT ? layer.extrusion[offset] : cellExtrusion(cell);
  if (layer.pixels[offset] === index && layer.extrusion[offset] === extrusion) return false;
  layer.pixels[offset] = index;
  layer.extrusion[offset] = extrusion;
  return true;
}
