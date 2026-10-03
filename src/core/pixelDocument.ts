import { cellExtrusion, cellIndex, DEFAULT_EXTRUSION, packCell, type Cell } from './extrusion.ts';
import { FACINGS, planeSize, type Facing, type Volume } from './facing.ts';
import { createLayer, inLayer, type Layer } from './layer.ts';
import type { Mask } from './mask.ts';
import { clonePalette, TRANSPARENT, type Palette } from './palette.ts';

/** Largest supported width, height or depth. Bigger documents make every redraw and edit slow. */
export const MAX_DOCUMENT_SIZE = 1024;

/**
 * A document is a model's volume (see `Volume`) with pixel art layers drawn
 * on its sides. `width` and `height` are the front's size, `depth` how far
 * back the volume goes.
 */
export interface PixelDocument extends Volume {
  /** Used for export file names and the window title. */
  name: string;
  palette: Palette;
  /**
   * Bottom to top, whatever their facing (upper layers win where their boxes
   * overlap in 3D). Every facing has at least one layer.
   */
  layers: Layer[];
  /**
   * Selected pixels per facing, always inside that facing's plane, or null
   * for none. Lives here (not in editor state) so selection changes go
   * through undo history with the pixel moves they accompany. Not part of
   * saved image data.
   */
  selections: Record<Facing, Mask | null>;
  /**
   * Selected pixels being moved, kept even where they hang off the plane.
   * Null when nothing floats. On its layer's facing.
   */
  floating: FloatingPixels | null;
}

/**
 * A floating selection: pixels lifted from a layer by the Move tool. They
 * stay stamped into the layer at `rect` (so everything else sees them as
 * ordinary layer pixels), and this record keeps what that loses: the pixels
 * that hang off the layer, and what each stamped pixel covers. Moving the
 * float puts back what it covered and stamps it again elsewhere. Dropping it
 * just forgets this record. Never mutated: moves make a new one.
 *
 * As a mask it's the float's selection shape, in the layer's coordinates; it
 * may extend past the layer.
 */
export interface FloatingPixels extends Mask {
  layerId: string;
  /**
   * The lifted palette indices, row-major over `rect`. Transparent ones,
   * which include every pixel outside the mask, don't cover anything.
   */
  pixels: Uint8Array;
  /** The lifted pixels' extrusions, parallel to `pixels`. */
  extrusion: Uint32Array;
  /**
   * The layer's cell (index and extrusion, see `Cell`) under each
   * non-transparent pixel on the layer, parallel to `pixels` (other entries
   * are unused). Right after lifting this is transparent: the hole the pixels
   * leave.
   */
  under: Uint32Array;
}

/** Throws a RangeError unless a document can be `width`×`height`×`depth`. */
export function checkDocumentSize(width: number, height: number, depth = 1): void {
  if (![width, height, depth].every((size) => Number.isInteger(size) && size >= 1)) {
    throw new RangeError(`Invalid document size ${width}×${height}×${depth}`);
  }
  if (width > MAX_DOCUMENT_SIZE || height > MAX_DOCUMENT_SIZE) {
    throw new RangeError(
      `${width}×${height} is too large; documents can be at most ${MAX_DOCUMENT_SIZE}×${MAX_DOCUMENT_SIZE}`,
    );
  }
  if (depth > MAX_DOCUMENT_SIZE) throw new RangeError(`Depth ${depth} is too large; it can be at most ${MAX_DOCUMENT_SIZE}`);
}

/** The depth a new document gets: as deep as it's wide or tall, so it can model a round thing. */
export function defaultDepth(width: number, height: number): number {
  return Math.max(width, height);
}

/** No selection on any facing. */
export function noSelections(): Record<Facing, Mask | null> {
  return { front: null, back: null, left: null, right: null, top: null, bottom: null };
}

/** A document with one empty layer per facing. */
export function createDocument(
  width: number,
  height: number,
  palette: Palette,
  name = 'Untitled',
  depth = defaultDepth(width, height),
): PixelDocument {
  checkDocumentSize(width, height, depth);
  const volume = { width, height, depth };
  return {
    name,
    width,
    height,
    depth,
    palette: clonePalette(palette),
    layers: FACINGS.map((facing) => createFacingLayer(volume, facing, 'Layer 1')),
    selections: noSelections(),
    floating: null,
  };
}

/** An empty layer on `facing` of a volume, sized to fit it. */
export function createFacingLayer(volume: Volume, facing: Facing, name: string): Layer {
  const { width, height } = planeSize(volume, facing);
  return createLayer(width, height, name, facing);
}

/** The layers of one facing, bottom to top. */
export function facingLayers(doc: PixelDocument, facing: Facing): Layer[] {
  return doc.layers.filter((layer) => layer.facing === facing);
}

/** Position of a layer in `doc.layers` (0 = bottom), or -1 if it isn't there. */
export function layerIndex(doc: PixelDocument, layerId: string): number {
  return doc.layers.findIndex((layer) => layer.id === layerId);
}

export function findLayer(doc: PixelDocument, layerId: string): Layer | undefined {
  return doc.layers.find((layer) => layer.id === layerId);
}

/** Palette index at (x, y), or transparent when off the layer. */
export function getPixel(layer: Layer, x: number, y: number): number {
  return inLayer(layer, x, y) ? layer.pixels[y * layer.width + x] : TRANSPARENT;
}

/**
 * Sets (x, y) to a palette index. Writes off the layer are ignored. Returns
 * whether the pixel changed. A pixel painted where there was none gets the
 * default extrusion, not whatever an erased pixel left there.
 */
export function setPixel(layer: Layer, x: number, y: number, index: number): boolean {
  if (!inLayer(layer, x, y)) return false;
  const i = y * layer.width + x;
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
