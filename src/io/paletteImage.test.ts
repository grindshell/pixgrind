import { describe, expect, it } from 'vitest';
import { packRgba } from '../core/color.ts';
import { createPalette } from '../core/palette.ts';
import { paletteFromImageFile, paletteToPng } from './paletteImage.ts';
import { decodePng } from './png.ts';

describe('paletteToPng / paletteFromImageFile', () => {
  it('round-trips translucent colors exactly, one pixel per color', async () => {
    // Alphas this low lose several levels per channel through a premultiplied canvas.
    const colors = [packRgba(128, 128, 128, 3), packRgba(200, 100, 50, 7), packRgba(1, 2, 3), packRgba(255, 0, 255, 0x80)];
    const palette = createPalette('Translucent', colors);
    const blob = await paletteToPng(palette);
    expect(blob.type).toBe('image/png');

    const image = await decodePng(new Uint8Array(await blob.arrayBuffer()), 1024);
    expect([image.width, image.height]).toEqual([4, 1]);
    expect(Array.from(image.data.subarray(0, 4))).toEqual([128, 128, 128, 3]);

    const back = await paletteFromImageFile(blob, 'Back');
    expect(back).toEqual({ name: 'Back', colors });
  });

  it('writes an empty palette as one transparent pixel', async () => {
    const image = await decodePng(new Uint8Array(await (await paletteToPng({ name: 'Empty', colors: [] })).arrayBuffer()), 16);
    expect([image.width, image.height, image.data[3]]).toEqual([1, 1, 0]);
  });

  it('skips duplicate colors and fully transparent pixels on import', async () => {
    const color = packRgba(10, 20, 30);
    const blob = await paletteToPng(createPalette('Dupes', [color, packRgba(0, 0, 0, 0), color]));
    expect((await paletteFromImageFile(blob, 'Dupes')).colors).toEqual([color]);
  });
});
