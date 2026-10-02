import { alpha, blue, green, packRgba, parseHex, red, toHex, type Rgba } from '../core/color.ts';
import { indexImageColors } from '../core/image.ts';
import { createPalette, MAX_PALETTE_COLORS, type Palette } from '../core/palette.ts';

/*
 * Text palette formats. Pure functions: no DOM, so they're unit-tested in
 * Node. All of these formats are RGB only; a translucent palette color loses
 * its alpha on export (PNG swatches keep it).
 */

export type PaletteTextFormat = 'hex' | 'gpl' | 'pal';

export const PALETTE_TEXT_FORMATS: Record<PaletteTextFormat, { label: string; extension: string }> = {
  hex: { label: 'Lospec HEX (.hex)', extension: 'hex' },
  gpl: { label: 'GIMP palette (.gpl)', extension: 'gpl' },
  pal: { label: 'JASC palette (.pal)', extension: 'pal' },
};

/** Parses a palette file by extension. `fallbackName` names palettes whose format has no name field. */
export function parsePaletteText(fileName: string, text: string, fallbackName: string): Palette {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'hex':
      return parseHexPalette(text, fallbackName);
    case 'gpl':
      return parseGpl(text, fallbackName);
    case 'pal':
      return parseJascPal(text, fallbackName);
    default:
      throw new Error(`Unsupported palette file type ".${extension ?? ''}"`);
  }
}

export function serializePalette(palette: Palette, format: PaletteTextFormat): string {
  switch (format) {
    case 'hex':
      return palette.colors.map((color) => toHex(color).slice(1, 7)).join('\n') + '\n';
    case 'gpl': {
      const name = palette.name.replace(/[\r\n]+/g, ' ');
      const rows = palette.colors.map((c) => `${pad(red(c))} ${pad(green(c))} ${pad(blue(c))}\t${toHex(c).slice(0, 7)}`);
      return ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#', ...rows].join('\n') + '\n';
    }
    case 'pal': {
      // JASC files traditionally use CRLF line endings.
      const rows = palette.colors.map((c) => `${red(c)} ${green(c)} ${blue(c)}`);
      return ['JASC-PAL', '0100', String(palette.colors.length), ...rows].join('\r\n') + '\r\n';
    }
  }
}

/** Lospec `.hex`: one `rrggbb` per line (a leading `#` and `rrggbbaa` are accepted too). */
export function parseHexPalette(text: string, name: string): Palette {
  const colors = lines(text).map((line, i) => {
    try {
      return parseHex(line);
    } catch {
      throw new Error(`Line ${i + 1}: "${line}" is not a hex color`);
    }
  });
  return paletteOf(name, colors);
}

/** GIMP `.gpl`: a "GIMP Palette" header, optional Name/Columns, `#` comments, then "r g b [name]" rows. */
export function parseGpl(text: string, fallbackName: string): Palette {
  const rows = text.split(/\r?\n/);
  if (rows[0]?.trim() !== 'GIMP Palette') throw new Error('Not a GIMP palette (missing "GIMP Palette" header)');
  let name = fallbackName;
  const colors: Rgba[] = [];
  rows.slice(1).forEach((row, i) => {
    const line = row.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('Columns:')) return;
    if (line.startsWith('Name:')) {
      name = line.slice(5).trim() || fallbackName;
      return;
    }
    const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s|$)/.exec(line);
    if (!match) throw new Error(`Line ${i + 2}: expected "red green blue", got "${line}"`);
    colors.push(channelsToColor(match[1], match[2], match[3], i + 2));
  });
  return paletteOf(name, colors);
}

/** JASC `.pal`: "JASC-PAL", a version line, a color count, then that many "r g b" rows. */
export function parseJascPal(text: string, name: string): Palette {
  const rows = lines(text);
  if (rows[0] !== 'JASC-PAL') throw new Error('Not a JASC palette (missing "JASC-PAL" header)');
  const count = Number(rows[2]);
  if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid color count "${rows[2] ?? ''}"`);
  const colorRows = rows.slice(3, 3 + count);
  if (colorRows.length < count) throw new Error(`Expected ${count} colors, found ${colorRows.length}`);
  const colors = colorRows.map((row, i) => {
    const match = /^(\d+)\s+(\d+)\s+(\d+)(?:\s+\d+)?$/.exec(row);
    if (!match) throw new Error(`Line ${i + 4}: expected "red green blue", got "${row}"`);
    return channelsToColor(match[1], match[2], match[3], i + 4);
  });
  return paletteOf(name, colors);
}

/**
 * Distinct colors of RGBA pixel data in reading order, skipping fully
 * transparent pixels. Throws when there are more than `limit`.
 */
export function uniqueColors(data: Uint8ClampedArray, limit = MAX_PALETTE_COLORS): Rgba[] {
  return indexImageColors(data, limit).colors;
}

function paletteOf(name: string, colors: Rgba[]): Palette {
  if (colors.length === 0) throw new Error('The file contains no colors');
  if (colors.length > MAX_PALETTE_COLORS) {
    throw new RangeError(`The file has ${colors.length} colors; a palette holds at most ${MAX_PALETTE_COLORS}`);
  }
  return createPalette(name, colors);
}

function channelsToColor(r: string, g: string, b: string, line: number): Rgba {
  const channels = [r, g, b].map(Number);
  if (channels.some((c) => c > 255)) throw new Error(`Line ${line}: color channels must be 0–255`);
  return packRgba(channels[0], channels[1], channels[2]);
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function pad(channel: number): string {
  return String(channel).padStart(3, ' ');
}

/** Opacity is not representable in these formats; exported for callers that want to warn. */
export function hasTranslucentColors(palette: Palette): boolean {
  return palette.colors.some((color) => alpha(color) !== 255);
}
