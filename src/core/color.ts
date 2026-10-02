/** A color packed into an unsigned 32-bit integer as `0xRRGGBBAA`. */
export type Rgba = number;

export function packRgba(r: number, g: number, b: number, a = 255): Rgba {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

export function red(color: Rgba): number {
  return color >>> 24;
}

export function green(color: Rgba): number {
  return (color >>> 16) & 0xff;
}

export function blue(color: Rgba): number {
  return (color >>> 8) & 0xff;
}

export function alpha(color: Rgba): number {
  return color & 0xff;
}

const HEX_PATTERN = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses `#rrggbb` or `#rrggbbaa`. The leading `#` is optional. */
export function parseHex(hex: string): Rgba {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) throw new Error(`Invalid hex color: "${hex}"`);
  const digits = match[1].length === 6 ? `${match[1]}ff` : match[1];
  return Number.parseInt(digits, 16) >>> 0;
}

/**
 * Perceptual-ish squared distance between two colors ("redmean" weighted
 * RGB, plus alpha). Only meaningful for comparing distances.
 */
export function colorDistance(a: Rgba, b: Rgba): number {
  const redMean = (red(a) + red(b)) / 2;
  const dr = red(a) - red(b);
  const dg = green(a) - green(b);
  const db = blue(a) - blue(b);
  const da = alpha(a) - alpha(b);
  return (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db + 3 * da * da;
}

/** Formats as `#rrggbb` when opaque, otherwise `#rrggbbaa`. */
export function toHex(color: Rgba): string {
  const hex = (color >>> 0).toString(16).padStart(8, '0');
  return alpha(color) === 0xff ? `#${hex.slice(0, 6)}` : `#${hex}`;
}
