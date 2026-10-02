import type { Layer } from './layer.ts';
import { inBounds, type PixelDocument } from './pixelDocument.ts';
import { clipRect, rectContains, type Rect } from './rect.ts';

/**
 * Offsets (`y * width + x`) of the 4-connected region of pixels on `layer`
 * that share the palette index at (x, y), including (x, y) itself. With
 * `bounds`, the region never extends outside it (e.g. filling within a
 * selection). Empty when (x, y) is outside the document or the bounds.
 *
 * 4-connectivity is deliberate: with 8-connectivity a fill leaks through
 * one-pixel diagonal outlines, which are everywhere in pixel art.
 */
export function floodRegion(
  doc: PixelDocument,
  layer: Layer,
  x: number,
  y: number,
  bounds: Rect | null = null,
): Uint32Array {
  const area = clipRect(bounds ?? { x: 0, y: 0, width: doc.width, height: doc.height }, doc.width, doc.height);
  if (!area || !inBounds(doc, x, y) || !rectContains(area, x, y)) return new Uint32Array(0);

  const { width } = doc;
  const { pixels } = layer;
  const target = pixels[y * width + x];
  const left = area.x;
  const right = area.x + area.width - 1;
  const top = area.y;
  const bottom = area.y + area.height - 1;

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
    const row = (offset - column) / width;
    if (column > left) visit(offset - 1);
    if (column < right) visit(offset + 1);
    if (row > top) visit(offset - width);
    if (row < bottom) visit(offset + width);
  }
  return region.slice(0, regionSize);
}
