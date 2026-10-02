import { createLayer, type Layer } from './layer.ts';
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
   * Selected area, always inside the document, or null for none. Lives here
   * (not in editor state) so selection changes go through undo history with
   * the pixel moves they accompany. Not part of saved image data.
   */
  selection: Rect | null;
}

export function createDocument(width: number, height: number, palette: Palette, name = 'Untitled'): PixelDocument {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid document size ${width}×${height}`);
  }
  if (width > MAX_DOCUMENT_SIZE || height > MAX_DOCUMENT_SIZE) {
    throw new RangeError(
      `${width}×${height} is too large; documents can be at most ${MAX_DOCUMENT_SIZE}×${MAX_DOCUMENT_SIZE}`,
    );
  }
  return {
    name,
    width,
    height,
    palette: clonePalette(palette),
    layers: [createLayer(width, height, 'Layer 1')],
    selection: null,
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

/** Sets (x, y) to a palette index. Out-of-bounds writes are ignored. Returns whether the pixel changed. */
export function setPixel(doc: PixelDocument, layer: Layer, x: number, y: number, index: number): boolean {
  if (!inBounds(doc, x, y)) return false;
  const i = y * doc.width + x;
  if (layer.pixels[i] === index) return false;
  layer.pixels[i] = index;
  return true;
}
