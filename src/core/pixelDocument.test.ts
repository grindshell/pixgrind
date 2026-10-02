import { describe, expect, it } from 'vitest';
import { createPalette, TRANSPARENT } from './palette.ts';
import { createDocument, getPixel, inBounds, setPixel } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff]);

describe('createDocument', () => {
  it('starts with one empty layer of the right size', () => {
    const doc = createDocument(4, 3, palette);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].pixels).toHaveLength(12);
    expect(doc.layers[0].pixels.every((p) => p === TRANSPARENT)).toBe(true);
  });

  it('owns a copy of the palette', () => {
    const doc = createDocument(1, 1, palette);
    doc.palette.colors[0] = 0;
    expect(palette.colors[0]).toBe(0xff0000ff);
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 4],
    [1.5, 2],
  ])('rejects size %d×%d', (w, h) => {
    expect(() => createDocument(w, h, palette)).toThrow(RangeError);
  });
});

describe('pixel access', () => {
  it('writes and reads row-major', () => {
    const doc = createDocument(4, 3, palette);
    const [layer] = doc.layers;
    expect(setPixel(doc, layer, 2, 1, 1)).toBe(true);
    expect(getPixel(doc, layer, 2, 1)).toBe(1);
    expect(layer.pixels[1 * 4 + 2]).toBe(1);
  });

  it('reports unchanged writes', () => {
    const doc = createDocument(2, 2, palette);
    const [layer] = doc.layers;
    setPixel(doc, layer, 0, 0, 2);
    expect(setPixel(doc, layer, 0, 0, 2)).toBe(false);
  });

  it('ignores out-of-bounds writes and reads as transparent', () => {
    const doc = createDocument(2, 2, palette);
    const [layer] = doc.layers;
    for (const [x, y] of [[-1, 0], [0, -1], [2, 0], [0, 2]]) {
      expect(inBounds(doc, x, y)).toBe(false);
      expect(setPixel(doc, layer, x, y, 1)).toBe(false);
      expect(getPixel(doc, layer, x, y)).toBe(TRANSPARENT);
    }
    expect(layer.pixels.every((p) => p === TRANSPARENT)).toBe(true);
  });
});
