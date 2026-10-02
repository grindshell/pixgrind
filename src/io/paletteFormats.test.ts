import { describe, expect, it } from 'vitest';
import { createPalette } from '../core/palette.ts';
import {
  hasTranslucentColors,
  parseGpl,
  parseHexPalette,
  parseJascPal,
  parsePaletteText,
  serializePalette,
  uniqueColors,
} from './paletteFormats.ts';

const palette = createPalette('Test Palette', [0x000000ff, 0xff004dff, 0x29adffff]);

describe('round trips', () => {
  it.each(['hex', 'gpl', 'pal'] as const)('%s preserves colors', (format) => {
    const text = serializePalette(palette, format);
    const parsed = parsePaletteText(`file.${format}`, text, 'Fallback');
    expect(parsed.colors).toEqual(palette.colors);
  });

  it('keeps the name in GIMP files only', () => {
    expect(parsePaletteText('x.gpl', serializePalette(palette, 'gpl'), 'Fallback').name).toBe('Test Palette');
    expect(parsePaletteText('x.hex', serializePalette(palette, 'hex'), 'Fallback').name).toBe('Fallback');
  });
});

describe('serializePalette', () => {
  it('writes Lospec hex as bare lowercase rrggbb lines', () => {
    expect(serializePalette(palette, 'hex')).toBe('000000\nff004d\n29adff\n');
  });

  it('writes a GIMP header and padded channels', () => {
    const lines = serializePalette(palette, 'gpl').split('\n');
    expect(lines.slice(0, 4)).toEqual(['GIMP Palette', 'Name: Test Palette', 'Columns: 8', '#']);
    expect(lines[5]).toBe('255   0  77\t#ff004d');
  });

  it('writes JASC with CRLF and a color count', () => {
    expect(serializePalette(palette, 'pal')).toBe('JASC-PAL\r\n0100\r\n3\r\n0 0 0\r\n255 0 77\r\n41 173 255\r\n');
  });

  it('drops alpha in RGB-only formats', () => {
    const translucent = createPalette('t', [0xff000080]);
    expect(hasTranslucentColors(translucent)).toBe(true);
    expect(hasTranslucentColors(palette)).toBe(false);
    expect(serializePalette(translucent, 'hex')).toBe('ff0000\n');
  });
});

describe('parsers', () => {
  it('reads hex with #, alpha, blank lines and CRLF', () => {
    expect(parseHexPalette('#FF004D\r\n\r\n29adff80\n', 'x').colors).toEqual([0xff004dff, 0x29adff80]);
  });

  it('reads GIMP files with comments, names and tabs', () => {
    const text = 'GIMP Palette\nName: Sunset\nColumns: 4\n# a comment\n255 128   0\tOrange\n  0   0 0\n';
    const result = parseGpl(text, 'x');
    expect(result.name).toBe('Sunset');
    expect(result.colors).toEqual([0xff8000ff, 0x000000ff]);
  });

  it('reads JASC files, ignoring an optional alpha column', () => {
    expect(parseJascPal('JASC-PAL\n0100\n2\n255 0 0\n0 255 0 255\n', 'x').colors).toEqual([0xff0000ff, 0x00ff00ff]);
  });

  it.each([
    ['x.hex', 'ff004d\nnope\n', /Line 2/],
    ['x.hex', '\n\n', /no colors/],
    ['x.gpl', 'Not GIMP\n1 2 3\n', /GIMP Palette/],
    ['x.gpl', 'GIMP Palette\n1 2\n', /Line 2/],
    ['x.gpl', 'GIMP Palette\n256 0 0\n', /0–255/],
    ['x.pal', 'JASC-PAL\n0100\n3\n0 0 0\n', /Expected 3 colors, found 1/],
    ['x.pal', 'PAL\n', /JASC-PAL/],
    ['x.act', '', /Unsupported/],
  ])('rejects %s %j', (name, text, error) => {
    expect(() => parsePaletteText(name, text, 'x')).toThrow(error);
  });

  it('rejects more than 255 colors', () => {
    const text = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(6, '0')).join('\n');
    expect(() => parseHexPalette(text, 'x')).toThrow(/256 colors/);
  });
});

describe('uniqueColors', () => {
  it('collects distinct visible colors in reading order', () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 0, // fully transparent: skipped
      0, 255, 0, 255,
      255, 0, 0, 255, // duplicate
      0, 0, 255, 128, // translucent: kept with alpha
    ]);
    expect(uniqueColors(data)).toEqual([0xff0000ff, 0x00ff00ff, 0x0000ff80]);
  });

  it('throws past the limit, reporting the count', () => {
    const data = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255]);
    expect(() => uniqueColors(data, 2)).toThrow(/3 colors/);
  });
});
