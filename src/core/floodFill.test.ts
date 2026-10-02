import { describe, expect, it } from 'vitest';
import { colorRegion, floodRegion } from './floodFill.ts';
import { rectMask } from './mask.ts';
import { createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff]);

/** Builds a one-layer document from rows of digits (palette indices). */
function docFrom(rows: string[]): PixelDocument {
  const doc = createDocument(rows[0].length, rows.length, palette);
  doc.layers[0].pixels.set(rows.join('').split('').map(Number));
  return doc;
}

/** Renders a region back to rows, marking members with "#". */
function show(doc: PixelDocument, region: Uint32Array): string[] {
  const cells = Array.from(doc.layers[0].pixels, String);
  for (const offset of region) cells[offset] = '#';
  const rows: string[] = [];
  for (let y = 0; y < doc.height; y++) rows.push(cells.slice(y * doc.width, (y + 1) * doc.width).join(''));
  return rows;
}

describe('floodRegion', () => {
  it('collects the contiguous region of the starting index', () => {
    const doc = docFrom([
      '00100',
      '00100',
      '11100',
      '00000',
    ]);
    const region = floodRegion(doc, doc.layers[0], 0, 0);
    expect(show(doc, region)).toEqual([
      '##100',
      '##100',
      '11100',
      '00000',
    ]);
  });

  it('does not leak through diagonal gaps (4-connected)', () => {
    const doc = docFrom([
      '0001',
      '0010',
      '0100',
      '1000',
    ]);
    const region = floodRegion(doc, doc.layers[0], 0, 0);
    expect(show(doc, region)).toEqual([
      '###1',
      '##10',
      '#100',
      '1000',
    ]);
  });

  it('fills regions of non-zero indices too', () => {
    const doc = docFrom([
      '22',
      '12',
    ]);
    expect(Array.from(floodRegion(doc, doc.layers[0], 1, 1)).sort()).toEqual([0, 1, 3]);
  });

  it('covers the whole layer when uniform', () => {
    const doc = createDocument(7, 5, palette);
    expect(floodRegion(doc, doc.layers[0], 3, 2)).toHaveLength(35);
  });

  it('stays inside the bounds rectangle', () => {
    const doc = docFrom([
      '0000',
      '0000',
      '0000',
    ]);
    const bounds = rectMask({ x: 1, y: 0, width: 2, height: 2 });
    expect(show(doc, floodRegion(doc, doc.layers[0], 1, 1, bounds))).toEqual([
      '0##0',
      '0##0',
      '0000',
    ]);
    expect(floodRegion(doc, doc.layers[0], 0, 0, bounds)).toHaveLength(0);
  });

  it('stays inside a non-rectangular mask', () => {
    const doc = docFrom([
      '000',
      '000',
      '000',
    ]);
    // A ring with the middle left out, open at the bottom-right corner.
    const bounds = { rect: { x: 0, y: 0, width: 3, height: 3 }, bits: Uint8Array.of(1, 1, 1, 1, 0, 1, 1, 1, 0) };
    expect(show(doc, floodRegion(doc, doc.layers[0], 0, 2, bounds))).toEqual([
      '###',
      '#0#',
      '##0',
    ]);
    expect(floodRegion(doc, doc.layers[0], 1, 1, bounds)).toHaveLength(0);
  });
});

describe('colorRegion', () => {
  it('collects every pixel of the index, touching or not', () => {
    const doc = docFrom([
      '101',
      '010',
    ]);
    expect(show(doc, colorRegion(doc, doc.layers[0], 2, 0))).toEqual([
      '#0#',
      '0#0',
    ]);
    expect(colorRegion(doc, doc.layers[0], 3, 0)).toHaveLength(0);
  });

  it('is empty outside the document', () => {
    const doc = createDocument(2, 2, palette);
    expect(floodRegion(doc, doc.layers[0], 2, 0)).toHaveLength(0);
    expect(floodRegion(doc, doc.layers[0], 0, -1)).toHaveLength(0);
  });
});
