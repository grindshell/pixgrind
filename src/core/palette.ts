import { packRgba, parseHex, type Rgba } from './color.ts';

/** Pixel index reserved for transparency. It never maps to a palette color. */
export const TRANSPARENT = 0;

/** Pixel indices are `Uint8` and index 0 is transparent, leaving 255 colors. */
export const MAX_PALETTE_COLORS = 255;

export interface Palette {
  name: string;
  /** `colors[i]` is the color of pixel index `i + 1`. */
  colors: Rgba[];
}

export function createPalette(name: string, colors: readonly Rgba[]): Palette {
  if (colors.length > MAX_PALETTE_COLORS) {
    throw new RangeError(`A palette holds at most ${MAX_PALETTE_COLORS} colors, got ${colors.length}`);
  }
  return { name, colors: [...colors] };
}

export function clonePalette(palette: Palette): Palette {
  return createPalette(palette.name, palette.colors);
}

export function palettesEqual(a: Palette, b: Palette): boolean {
  return a.name === b.name && a.colors.length === b.colors.length && a.colors.every((color, i) => color === b.colors[i]);
}

/**
 * The color a pixel index renders as. Index 0, and any index past the end of
 * the palette, is fully transparent.
 */
export function colorForIndex(palette: Palette, index: number): Rgba {
  if (index === TRANSPARENT) return 0;
  return palette.colors[index - 1] ?? 0;
}

export const DEFAULT_PALETTE: Palette = createPalette(
  'PICO-8',
  [
    '#000000', '#1d2b53', '#7e2553', '#008751',
    '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436',
    '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ].map(parseHex),
);

/** Read-only presets offered alongside the user's saved palettes. */
export const BUILTIN_PALETTES: readonly Palette[] = [
  DEFAULT_PALETTE,
  createPalette('Game Boy', ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(parseHex)),
  createPalette('1-bit', ['#000000', '#ffffff'].map(parseHex)),
  createPalette(
    'Grayscale 8',
    Array.from({ length: 8 }, (_, i) => {
      const level = Math.round((i * 255) / 7);
      return packRgba(level, level, level);
    }),
  ),
];
