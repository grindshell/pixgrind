import { alpha, blue, green, red, type Rgba } from './color.ts';
import type { Edit } from './edits.ts';
import { indexImageToPalette, type RgbaImage } from './image.ts';
import type { Layer } from './layer.ts';
import { TRANSPARENT, type Palette } from './palette.ts';
import { nearestColorIndex } from './paletteEdits.ts';
import { documentRect, MAX_DOCUMENT_SIZE, type PixelDocument } from './pixelDocument.ts';
import type { Rect } from './rect.ts';
import { clearAreaEdit, deleteFloatingEdit, layerPixelsIn, placeFloatingEdit } from './selection.ts';

/** Copied pixels, independent of the document they came from. */
export interface PixelClip {
  /** Where they were copied from, in document coordinates; pasting returns them there when it can. */
  rect: Rect;
  /** Palette indices, row-major over `rect`. */
  pixels: Uint8Array;
  /** The palette's colors when copied, so a paste keeps the look even if the palette has changed since. */
  colors: readonly Rgba[];
}

/**
 * What a copy of `layer` takes: its floating pixels (including any off the
 * document), else the selection, else the whole layer.
 */
export function copyPixels(doc: PixelDocument, layer: Layer): PixelClip {
  const colors = [...doc.palette.colors];
  const { floating } = doc;
  if (floating?.layerId === layer.id) return { rect: floating.rect, pixels: floating.pixels.slice(), colors };
  const rect = doc.selection ?? documentRect(doc);
  return { rect, pixels: layerPixelsIn(doc, layer, rect), colors };
}

/** Removes what `copyPixels` took (cut): the floating pixels, else the selection's or whole layer's. */
export function cutEdit(doc: PixelDocument, layer: Layer): Edit | null {
  if (doc.floating?.layerId === layer.id) return deleteFloatingEdit(doc, 'Cut');
  return clearAreaEdit(doc, layer, doc.selection ?? documentRect(doc), 'Cut');
}

/** An image (e.g. from another app) as a clip, in nearest palette colors, centered on the document. */
export function clipFromImage(image: RgbaImage, doc: PixelDocument): PixelClip {
  if (image.width > MAX_DOCUMENT_SIZE || image.height > MAX_DOCUMENT_SIZE) {
    throw new RangeError(`${image.width}×${image.height} is too large to paste (max ${MAX_DOCUMENT_SIZE} per side)`);
  }
  return {
    rect: centeredRect(doc, image.width, image.height),
    pixels: indexImageToPalette(image.data, doc.palette),
    colors: [...doc.palette.colors],
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

/** Where a paste goes: where it was copied from when that's inside the document, else centered on it. */
export function pasteRect(doc: PixelDocument, clip: PixelClip): Rect {
  const { x, y, width, height } = clip.rect;
  const fits = x >= 0 && y >= 0 && x + width <= doc.width && y + height <= doc.height;
  return fits ? clip.rect : centeredRect(doc, width, height);
}

/**
 * Pastes a clip onto `layer` as a floating selection (replacing any current
 * one), ready to be moved. One undoable edit.
 */
export function pasteEdit(doc: PixelDocument, layer: Layer, clip: PixelClip, label = 'Paste'): Edit | null {
  return placeFloatingEdit(doc, layer, clipIndices(clip, doc.palette), pasteRect(doc, clip), label);
}

function centeredRect(doc: PixelDocument, width: number, height: number): Rect {
  return { x: Math.floor((doc.width - width) / 2), y: Math.floor((doc.height - height) / 2), width, height };
}
