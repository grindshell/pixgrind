import { inLayer, type Layer } from './layer.ts';
import { maskHas, type Mask } from './mask.ts';
import { clipRect } from './rect.ts';

/**
 * Offsets (`y * width + x`) of the 4-connected region of pixels on `layer`
 * that share the palette index at (x, y), including (x, y) itself. With
 * `bounds`, the region never extends outside those pixels (e.g. filling
 * within a selection). Empty when (x, y) is off the layer or the bounds.
 *
 * 4-connectivity is deliberate: with 8-connectivity a fill leaks through
 * one-pixel diagonal outlines, which are everywhere in pixel art.
 */
export function floodRegion(layer: Layer, x: number, y: number, bounds: Mask | null = null): Uint32Array {
  const { width, height, pixels } = layer;
  const area = clipRect(bounds?.rect ?? { x: 0, y: 0, width, height }, width, height);
  if (!area || !inLayer(layer, x, y) || (bounds && !maskHas(bounds, x, y))) return new Uint32Array(0);

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

  // Pixels the bounds leave out block the fill, as if already visited.
  if (bounds?.bits) {
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        if (!maskHas(bounds, column, row)) visited[row * width + column] = 1;
      }
    }
  }

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

/** Offsets of every pixel on `layer` with the palette index at (x, y), touching or not. Empty off the layer. */
export function colorRegion(layer: Layer, x: number, y: number): Uint32Array {
  if (!inLayer(layer, x, y)) return new Uint32Array(0);
  const { pixels } = layer;
  const target = pixels[y * layer.width + x];
  const region = new Uint32Array(pixels.length);
  let size = 0;
  for (let offset = 0; offset < pixels.length; offset++) {
    if (pixels[offset] === target) region[size++] = offset;
  }
  return region.slice(0, size);
}
