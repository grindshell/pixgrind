import { describe, expect, it } from 'vitest';
import { createPalette, TRANSPARENT } from './palette.ts';
import { inLayer } from './layer.ts';
import { createDocument, getPixel, MAX_DOCUMENT_SIZE, setPixel } from './pixelDocument.ts';

const palette = createPalette('test', [0xff0000ff, 0x00ff00ff]);

describe('createDocument', () => {
  it('starts with one empty layer per side, each the size of its side', () => {
    const doc = createDocument(4, 3, palette, 'box', 2);
    expect(doc.layers.map((l) => [l.facing, l.width, l.height])).toEqual([
      ['front', 4, 3],
      ['back', 4, 3],
      ['left', 2, 3],
      ['right', 2, 3],
      ['top', 4, 2],
      ['bottom', 4, 2],
    ]);
    expect(doc.layers[0].pixels).toHaveLength(12);
    expect(doc.layers.every((l) => l.pixels.every((p) => p === TRANSPARENT))).toBe(true);
    // As deep as it's wide or tall, unless given.
    expect(createDocument(4, 3, palette).depth).toBe(4);
  });

  it('owns a copy of the palette', () => {
    const doc = createDocument(1, 1, palette);
    doc.palette.colors[0] = 0;
    expect(palette.colors[0]).toBe(0xff0000ff);
  });

  it('is named "Untitled" unless given a name', () => {
    expect(createDocument(1, 1, palette).name).toBe('Untitled');
    expect(createDocument(1, 1, palette, 'Hero').name).toBe('Hero');
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 4],
    [1.5, 2],
    [MAX_DOCUMENT_SIZE + 1, 1],
    [1, MAX_DOCUMENT_SIZE + 1],
  ])('rejects size %d×%d', (w, h) => {
    expect(() => createDocument(w, h, palette)).toThrow(RangeError);
  });
});

describe('pixel access', () => {
  it('writes and reads row-major', () => {
    const doc = createDocument(4, 3, palette);
    const [layer] = doc.layers;
    expect(setPixel(layer, 2, 1, 1)).toBe(true);
    expect(getPixel(layer, 2, 1)).toBe(1);
    expect(layer.pixels[1 * 4 + 2]).toBe(1);
  });

  it('reports unchanged writes', () => {
    const doc = createDocument(2, 2, palette);
    const [layer] = doc.layers;
    setPixel(layer, 0, 0, 2);
    expect(setPixel(layer, 0, 0, 2)).toBe(false);
  });

  it('ignores out-of-bounds writes and reads as transparent', () => {
    const doc = createDocument(2, 2, palette);
    const [layer] = doc.layers;
    for (const [x, y] of [[-1, 0], [0, -1], [2, 0], [0, 2]]) {
      expect(inLayer(layer, x, y)).toBe(false);
      expect(setPixel(layer, x, y, 1)).toBe(false);
      expect(getPixel(layer, x, y)).toBe(TRANSPARENT);
    }
    expect(layer.pixels.every((p) => p === TRANSPARENT)).toBe(true);
  });
});
