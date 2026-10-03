import { alpha, blue, green, red, type Rgba } from './color.ts';
import type { Edit } from './edits.ts';
import { defaultExtrusions } from './extrusion.ts';
import { indexImageToPalette, type RgbaImage } from './image.ts';
import type { Layer } from './layer.ts';
import { TRANSPARENT, type Palette } from './palette.ts';
import { nearestColorIndex } from './paletteEdits.ts';
import { MAX_DOCUMENT_SIZE, type PixelDocument } from './pixelDocument.ts';
import { rectMask, type Mask } from './mask.ts';
import type { Rect } from './rect.ts';
import { clearAreaEdit, deleteFloatingEdit, placeFloatingEdit, selectedExtrusion, selectedPixels } from './selection.ts';

/** A layer's size, or a plane's. */
type Size = Pick<Layer, 'width' | 'height'>;

/**
 * Copied pixels, independent of the document they came from. As a mask it's
 * the shape they were copied with, where they were copied from (layer
 * coordinates); pasting returns them there when it can.
 */
export interface PixelClip extends Mask {
  /** Palette indices, row-major over `rect`, transparent outside the mask. */
  pixels: Uint8Array;
  /** The pixels' extrusions, parallel to `pixels`. Absent (e.g. for images from other apps): all default. */
  extrusion?: Uint32Array;
  /** The palette's colors when copied, so a paste keeps the look even if the palette has changed since. */
  colors: readonly Rgba[];
}

/**
 * What a copy of `layer` takes: its floating pixels (including any off the
 * layer), else its facing's selection, else the whole layer.
 */
export function copyPixels(doc: PixelDocument, layer: Layer): PixelClip {
  const colors = [...doc.palette.colors];
  const { floating } = doc;
  if (floating?.layerId === layer.id) {
    const { rect, bits, pixels, extrusion } = floating;
    return { rect, bits, pixels: pixels.slice(), extrusion: extrusion.slice(), colors };
  }
  const area = copiedArea(doc, layer);
  return {
    rect: area.rect,
    bits: area.bits,
    pixels: selectedPixels(layer, area),
    extrusion: selectedExtrusion(layer, area),
    colors,
  };
}

/** Removes what `copyPixels` took (cut): the floating pixels, else the selection's or whole layer's. */
export function cutEdit(doc: PixelDocument, layer: Layer): Edit | null {
  if (doc.floating?.layerId === layer.id) return deleteFloatingEdit(doc, 'Cut');
  return clearAreaEdit(layer, copiedArea(doc, layer), 'Cut');
}

/** The selection on `layer`'s facing, else the whole layer. */
function copiedArea(doc: PixelDocument, layer: Layer): Mask {
  return doc.selections[layer.facing] ?? rectMask({ x: 0, y: 0, width: layer.width, height: layer.height });
}

/** Throws a RangeError unless an image `width`×`height` is small enough to paste. */
export function checkClipSize(width: number, height: number): void {
  if (width > MAX_DOCUMENT_SIZE || height > MAX_DOCUMENT_SIZE) {
    throw new RangeError(`${width}×${height} is too large to paste (max ${MAX_DOCUMENT_SIZE} per side)`);
  }
}

/** An image (e.g. from another app) as a clip, in nearest palette colors, centered on a plane `size`. */
export function clipFromImage(image: RgbaImage, palette: Palette, size: Size): PixelClip {
  checkClipSize(image.width, image.height);
  return {
    rect: centeredRect(size, image.width, image.height),
    bits: null,
    pixels: indexImageToPalette(image.data, palette),
    colors: [...palette.colors],
  };
}

/** The clip as RGBA, in its own colors (e.g. to put on the system clipboard). */
export function clipImage(clip: PixelClip): RgbaImage {
  const { width, height } = clip.rect;
  const data = new Uint8ClampedArray(width * height * 4);
  clip.pixels.forEach((index, i) => {
    const color = clip.colors[index - 1];
    if (index === TRANSPARENT || color === undefined) return;
    data.set([red(color), green(color), blue(color), alpha(color)], i * 4);
  });
  return { width, height, data };
}

/**
 * Whether `image` is the clip after a trip through the system clipboard as
 * PNG: the same size and alpha, and colors equal up to the rounding that
 * browsers' premultiplied canvases add to translucent pixels.
 */
export function clipMatchesImage(clip: PixelClip, image: RgbaImage): boolean {
  const own = clipImage(clip);
  if (own.width !== image.width || own.height !== image.height) return false;
  for (let o = 0; o < own.data.length; o += 4) {
    const a = own.data[o + 3];
    if (image.data[o + 3] !== a) return false;
    if (a === 0) continue;
    // Each premultiplied round trip can be off by about 255 / alpha; encoding and decoding make two.
    const tolerance = a === 255 ? 0 : Math.ceil(510 / a);
    for (let c = 0; c < 3; c++) if (Math.abs(image.data[o + c] - own.data[o + c]) > tolerance) return false;
  }
  return true;
}

/**
 * The clip's indices for `palette`: kept where the palette still has the
 * same color at that index, else the nearest color. Transparent stays
 * transparent, as do indices that had no color when copied.
 */
export function clipIndices(clip: PixelClip, palette: Palette): Uint8Array {
  const mapped = new Map<number, number>();
  return clip.pixels.map((index) => {
    if (index === TRANSPARENT) return TRANSPARENT;
    let target = mapped.get(index);
    if (target === undefined) {
      const color = clip.colors[index - 1];
      target =
        color === undefined ? TRANSPARENT : palette.colors[index - 1] === color ? index : nearestColorIndex(palette, color);
      mapped.set(index, target);
    }
    return target;
  });
}

/** Where a paste goes on a layer `size`: where it was copied from when that's on it, else centered. */
export function pasteRect(size: Size, clip: PixelClip): Rect {
  const { x, y, width, height } = clip.rect;
  const fits = x >= 0 && y >= 0 && x + width <= size.width && y + height <= size.height;
  return fits ? clip.rect : centeredRect(size, width, height);
}

/**
 * Pastes a clip onto `layer` as a floating selection (replacing any current
 * one), ready to be moved. One undoable edit.
 */
export function pasteEdit(doc: PixelDocument, layer: Layer, clip: PixelClip, label = 'Paste'): Edit | null {
  const area = { rect: pasteRect(layer, clip), bits: clip.bits };
  const extrusion = clip.extrusion?.slice() ?? defaultExtrusions(clip.pixels.length);
  return placeFloatingEdit(doc, layer, clipIndices(clip, doc.palette), extrusion, area, label);
}

function centeredRect(size: Size, width: number, height: number): Rect {
  return { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height };
}
