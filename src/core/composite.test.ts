import { describe, expect, it } from 'vitest';
import { compositeRgba, layerThumbnailRgba, visibleIndexAt } from './composite.ts';
import { createLayer } from './layer.ts';
import { createPalette } from './palette.ts';
import { createDocument, setPixel, type PixelDocument } from './pixelDocument.ts';

const RED = 1;
const BLUE = 2;
const HALF_GREEN = 3;
const palette = createPalette('test', [0xff0000ff, 0x0000ffff, 0x00ff0080]);

/** A document whose first two layers are front layers, the second above the first. */
function twoLayerDoc(): PixelDocument {
  const doc = createDocument(2, 1, palette);
  doc.layers.splice(1, 0, createLayer(2, 1, 'Top'));
  return doc;
}

function pixel(rgba: Uint8ClampedArray, i: number): number[] {
  return Array.from(rgba.subarray(i * 4, i * 4 + 4));
}

describe('compositeRgba', () => {
  it('is fully transparent for an empty document', () => {
    const out = compositeRgba(createDocument(3, 2, palette), 'front');
    expect(out).toHaveLength(3 * 2 * 4);
    expect(out.every((b) => b === 0)).toBe(true);
  });

  it('draws opaque upper layers over lower ones', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(bottom, 1, 0, RED);
    setPixel(top, 1, 0, BLUE);
    const out = compositeRgba(doc, 'front');
    expect(pixel(out, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 1)).toEqual([0, 0, 255, 255]);
  });

  it('skips hidden layers', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(top, 0, 0, BLUE);
    top.visible = false;
    expect(pixel(compositeRgba(doc, 'front'), 0)).toEqual([255, 0, 0, 255]);
  });

  it('blends layer opacity over an opaque pixel', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(top, 0, 0, BLUE);
    top.opacity = 0.5;
    const [r, g, b, a] = pixel(compositeRgba(doc, 'front'), 0);
    expect(r).toBeCloseTo(128, -1);
    expect(g).toBe(0);
    expect(b).toBeCloseTo(128, -1);
    expect(a).toBe(255);
  });

  it('keeps straight alpha for translucent colors over transparency', () => {
    const doc = createDocument(1, 1, palette);
    setPixel(doc.layers[0], 0, 0, HALF_GREEN);
    expect(pixel(compositeRgba(doc, 'front'), 0)).toEqual([0, 255, 0, 128]);
  });

  it('treats indices missing from the palette as transparent', () => {
    const doc = createDocument(1, 1, palette);
    setPixel(doc.layers[0], 0, 0, 200);
    expect(pixel(compositeRgba(doc, 'front'), 0)).toEqual([0, 0, 0, 0]);
  });

  it('draws only the given side’s layers, at its size', () => {
    // 2 wide, 1 tall, 3 deep: the top is 2×3.
    const doc = createDocument(2, 1, palette, 'test', 3);
    setPixel(doc.layers[0], 0, 0, RED);
    const top = doc.layers.find((layer) => layer.facing === 'top')!;
    setPixel(top, 1, 2, BLUE);
    const out = compositeRgba(doc, 'top');
    expect(out).toHaveLength(2 * 3 * 4);
    expect(pixel(out, 5)).toEqual([0, 0, 255, 255]);
    expect(pixel(out, 0)).toEqual([0, 0, 0, 0]);
    expect(visibleIndexAt(doc, 'top', 1, 2)).toBe(BLUE);
    expect(visibleIndexAt(doc, 'front', 1, 0)).toBe(0);
  });

  it('reuses and clears a provided buffer', () => {
    const doc = createDocument(1, 1, palette);
    const out = new Uint8ClampedArray(4).fill(99);
    expect(compositeRgba(doc, 'front', out)).toBe(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    expect(() => compositeRgba(doc, 'front', new Uint8ClampedArray(8))).toThrow(RangeError);
  });
});

describe('layerThumbnailRgba', () => {
  it('draws the layer alone, at full opacity, in its own colors', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(top, 1, 0, HALF_GREEN);
    top.opacity = 0.5;
    top.visible = false;
    const out = layerThumbnailRgba(doc.palette, top, 2, 1);
    expect(pixel(out, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, 1)).toEqual([0, 255, 0, 128]);
  });

  it('samples the nearest pixel when scaled down', () => {
    const doc = createDocument(4, 4, palette);
    const [layer] = doc.layers;
    // Pixel centers of a 2×2 thumbnail land on (1, 1), (3, 1), (1, 3) and (3, 3).
    setPixel(layer, 3, 1, RED);
    setPixel(layer, 1, 3, BLUE);
    setPixel(layer, 0, 0, BLUE);
    const out = layerThumbnailRgba(doc.palette, layer, 2, 2);
    expect([0, 1, 2, 3].map((i) => pixel(out, i))).toEqual([
      [0, 0, 0, 0],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 0, 0],
    ]);
  });
});

describe('visibleIndexAt', () => {
  it('returns the topmost visible non-transparent index', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(top, 0, 0, BLUE);
    setPixel(bottom, 1, 0, RED);
    expect(visibleIndexAt(doc, 'front', 0, 0)).toBe(BLUE);
    expect(visibleIndexAt(doc, 'front', 1, 0)).toBe(RED);
  });

  it('skips hidden and fully transparent layers', () => {
    const doc = twoLayerDoc();
    const [bottom, top] = doc.layers;
    setPixel(bottom, 0, 0, RED);
    setPixel(top, 0, 0, BLUE);
    top.visible = false;
    expect(visibleIndexAt(doc, 'front', 0, 0)).toBe(RED);
    top.visible = true;
    top.opacity = 0;
    expect(visibleIndexAt(doc, 'front', 0, 0)).toBe(RED);
  });

  it('ignores indices with no palette color, and out-of-bounds points', () => {
    const doc = twoLayerDoc();
    setPixel(doc.layers[1], 0, 0, 200);
    expect(visibleIndexAt(doc, 'front', 0, 0)).toBe(0);
    expect(visibleIndexAt(doc, 'front', 5, 0)).toBe(0);
  });
});
