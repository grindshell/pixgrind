import type { Layer } from './layer.ts';
import { inBounds, type PixelDocument } from './pixelDocument.ts';

/**
 * Offsets (`y * width + x`) of the 4-connected region of pixels on `layer`
 * that share the palette index at (x, y), including (x, y) itself. Empty when
 * (x, y) is out of bounds.
 *
 * 4-connectivity is deliberate: with 8-connectivity a fill leaks through
 * one-pixel diagonal outlines, which are everywhere in pixel art.
 */
export function floodRegion(doc: PixelDocument, layer: Layer, x: number, y: number): Uint32Array {
  if (!inBounds(doc, x, y)) return new Uint32Array(0);
  const { width } = doc;
  const { pixels } = layer;
  const target = pixels[y * width + x];
  const lastRowStart = pixels.length - width;

  // Each pixel is pushed at most once, so the stack never exceeds the pixel count.
  const visited = new Uint8Array(pixels.length);
  const stack = new Uint32Array(pixels.length);
  const region = new Uint32Array(pixels.length);
  let stackSize = 0;
  let regionSize = 0;

  const visit = (offset: number) => {
    if (visited[offset] || pixels[offset] !== target) return;
    visited[offset] = 1;
    stack[stackSize++] = offset;
  };

  visit(y * width + x);
  while (stackSize > 0) {
    const offset = stack[--stackSize];
    region[regionSize++] = offset;
    const column = offset % width;
    if (column > 0) visit(offset - 1);
    if (column < width - 1) visit(offset + 1);
    if (offset >= width) visit(offset - width);
    if (offset < lastRowStart) visit(offset + width);
  }
  return region.slice(0, regionSize);
}
