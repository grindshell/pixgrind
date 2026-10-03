import { colorDistance, type Rgba } from './color.ts';
import { combineEdits, pixelEditFromArray, type Edit, type PaletteEdit, type PixelEdit } from './edits.ts';
import { clonePalette, createPalette, MAX_PALETTE_COLORS, palettesEqual, TRANSPARENT, type Palette } from './palette.ts';
import type { PixelDocument } from './pixelDocument.ts';

/*
 * Constructors for palette edits. Like the layer edits, each validates
 * against the current document and returns an unapplied edit (or null for no
 * change).
 */

export type PaletteCheck = { ok: true } | { ok: false; reason: string };

/** How many pixels, across all layers, use each palette index (0–255). */
export function colorUsage(doc: PixelDocument): Uint32Array {
  const counts = new Uint32Array(256);
  for (const { pixels } of doc.layers) {
    // An indexed loop: iterating a typed array with for…of is several times slower.
    for (let i = 0; i < pixels.length; i++) counts[pixels[i]]++;
  }
  return counts;
}

/** The 1-based palette index of the color closest to `color`. Ties go to the lower index. */
export function nearestColorIndex(palette: Palette, color: Rgba): number {
  if (palette.colors.length === 0) throw new Error('Palette has no colors');
  let best = 1;
  let bestDistance = Infinity;
  palette.colors.forEach((candidate, i) => {
    const distance = colorDistance(color, candidate);
    if (distance < bestDistance) {
      best = i + 1;
      bestDistance = distance;
    }
  });
  return best;
}

/** Replaces the palette. `before` defaults to the current one; pass it after a live preview. */
export function paletteEdit(doc: PixelDocument, after: Palette, label: string, before = doc.palette): PaletteEdit | null {
  if (palettesEqual(before, after)) return null;
  return { kind: 'palette', label, before: clonePalette(before), after: clonePalette(after) };
}

/** Changes the color at a 1-based palette index. `previous` is its color before any live preview. */
export function setColorEdit(
  doc: PixelDocument,
  index: number,
  color: Rgba,
  previous = doc.palette.colors[index - 1],
): PaletteEdit | null {
  requireColorIndex(doc, index);
  const before = clonePalette(doc.palette);
  before.colors[index - 1] = previous;
  const after = clonePalette(doc.palette);
  after.colors[index - 1] = color;
  return paletteEdit(doc, after, 'Change color', before);
}

export function canAddColor(doc: PixelDocument): PaletteCheck {
  return doc.palette.colors.length < MAX_PALETTE_COLORS
    ? { ok: true }
    : { ok: false, reason: `A palette holds at most ${MAX_PALETTE_COLORS} colors` };
}

/** Appends a color; it gets index `colors.length + 1`. */
export function addColorEdit(doc: PixelDocument, color: Rgba): PaletteEdit | null {
  const check = canAddColor(doc);
  if (!check.ok) throw new RangeError(check.reason);
  return paletteEdit(doc, createPalette(doc.palette.name, [...doc.palette.colors, color]), 'Add color');
}

/**
 * Whether a color can be deleted. Only unused colors can: deleting a used one
 * would have to recolor pixels behind the user's back. Pass `usage` (from
 * `colorUsage`) to reuse a count instead of scanning every pixel again.
 */
export function canRemoveColor(doc: PixelDocument, index: number, usage = colorUsage(doc)): PaletteCheck {
  if (!Number.isInteger(index) || index < 1 || index > doc.palette.colors.length) {
    return { ok: false, reason: 'No such color' };
  }
  if (doc.palette.colors.length <= 1) return { ok: false, reason: 'A palette needs at least one color' };
  const uses = usage[index];
  if (uses > 0) return { ok: false, reason: `Used by ${uses} pixel${uses === 1 ? '' : 's'}` };
  return { ok: true };
}

/** Deletes an unused color. Later colors shift down one index, and pixels using them are renumbered to match. */
export function removeColorEdit(doc: PixelDocument, index: number): Edit | null {
  const check = canRemoveColor(doc, index);
  if (!check.ok) throw new Error(`Cannot delete color: ${check.reason}`);
  const label = 'Delete color';
  const mapping = identityMapping();
  for (let i = index + 1; i < 256; i++) mapping[i] = i - 1;
  // Reverting shifts them back up. (Index 255 can't be in use after a deletion.)
  const restore = identityMapping();
  for (let i = index; i < 255; i++) restore[i] = i + 1;
  const colors = doc.palette.colors.filter((_, i) => i !== index - 1);
  const palette = paletteEdit(doc, createPalette(doc.palette.name, colors), label);
  if (palette) palette.renumber = { redo: mapping, undo: restore };
  return combineEdits(label, [palette, ...remapPixels(doc, mapping, label)]);
}

/**
 * Palette swap: switches to `palette` keeping every pixel's index, so each
 * pixel takes the new palette's color at that position. Used indices the new
 * palette doesn't have are remapped to the nearest new color instead of
 * turning invisible. Indices that already had no color become transparent,
 * which looks the same as before.
 */
export function swapPaletteEdit(doc: PixelDocument, palette: Palette): Edit | null {
  requireColors(palette);
  const old = doc.palette.colors;
  const mapping = identityMapping();
  for (let i = 1; i < 256; i++) {
    if (i > old.length) mapping[i] = TRANSPARENT;
    else if (i > palette.colors.length) mapping[i] = nearestColorIndex(palette, old[i - 1]);
  }
  return paletteChange(doc, palette, mapping, 'Swap palette');
}

/**
 * Switches to `palette`, moving every pixel to the new color closest to its
 * current color. Use when the palettes are ordered differently.
 */
export function remapToPaletteEdit(doc: PixelDocument, palette: Palette): Edit | null {
  requireColors(palette);
  const old = doc.palette.colors;
  const mapping = identityMapping();
  for (let i = 1; i < 256; i++) {
    mapping[i] = i <= old.length ? nearestColorIndex(palette, old[i - 1]) : TRANSPARENT;
  }
  return paletteChange(doc, palette, mapping, 'Remap palette');
}

function paletteChange(doc: PixelDocument, palette: Palette, mapping: Uint8Array, label: string): Edit | null {
  return combineEdits(label, [paletteEdit(doc, palette, label), ...remapPixels(doc, mapping, label)]);
}

/** Pixel edits applying an index → index mapping to every layer. */
function remapPixels(doc: PixelDocument, mapping: Uint8Array, label: string): PixelEdit[] {
  const edits: PixelEdit[] = [];
  for (const layer of doc.layers) {
    const { pixels } = layer;
    const after = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) after[i] = mapping[pixels[i]];
    const edit = pixelEditFromArray(layer, label, after);
    if (edit) edits.push(edit);
  }
  return edits;
}

function identityMapping(): Uint8Array {
  return Uint8Array.from({ length: 256 }, (_, i) => i);
}

function requireColorIndex(doc: PixelDocument, index: number): void {
  if (!Number.isInteger(index) || index < 1 || index > doc.palette.colors.length) {
    throw new RangeError(`No palette color at index ${index}`);
  }
}

function requireColors(palette: Palette): void {
  if (palette.colors.length === 0) throw new Error('Palette has no colors');
}
