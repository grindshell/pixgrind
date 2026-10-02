import { createLayer, type Layer } from './layer.ts';
import { clonePalette, TRANSPARENT, type Palette } from './palette.ts';

export interface PixelDocument {
  width: number;
  height: number;
  palette: Palette;
  /** Bottom to top. */
  layers: Layer[];
}

export function createDocument(width: number, height: number, palette: Palette): PixelDocument {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid document size ${width}×${height}`);
  }
  return {
    width,
    height,
    palette: clonePalette(palette),
    layers: [createLayer(width, height, 'Layer 1')],
  };
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
