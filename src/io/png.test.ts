import { describe, expect, it } from 'vitest';
import { packRgba } from '../core/color.ts';
import { deflate } from './bytes.ts';
import { decodePng, encodeIndexedPng } from './png.ts';

/* ---- Building test PNGs by hand, independently of the encoder ---- */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: ArrayLike<number>): number[] {
  const body = [...type].map((c) => c.charCodeAt(0)).concat(Array.from(data));
  const u32 = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Scanline bytes with `filter` applied, as an encoder would write them. */
function filterRow(filter: number, row: number[], prev: number[] | null, bpp: number): number[] {
  return [
    filter,
    ...row.map((v, x) => {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      return (v - predicted) & 0xff;
    }),
  ];
}

interface PngSpec {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace?: number;
  /** Unfiltered scanline bytes. */
  rows: number[][];
  bpp: number;
  /** The filter for row `y`; all 0 when absent. */
  filters?: (y: number) => number;
  /** Chunks placed between the header and the image data. */
  extra?: number[][];
}

async function buildPng(spec: PngSpec): Promise<Uint8Array> {
  const { width, height, depth, colorType, rows, bpp } = spec;
  const header = [width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff, 0, 0, 0, height, depth, colorType, 0, 0, spec.interlace ?? 0];
  const raw = rows.flatMap((row, y) => filterRow(spec.filters?.(y) ?? 0, row, y > 0 ? rows[y - 1] : null, bpp));
  const idat = await deflate(Uint8Array.from(raw));
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', header),
    ...(spec.extra ?? []).flat(),
    ...chunk('IDAT', idat),
    ...chunk('IEND', []),
  ]);
}

const MAX = 1 << 20;

describe('decodePng', () => {
  it('undoes every row filter', async () => {
    const width = 32;
    const height = 40;
    // Pseudo-random bytes, enough for Paeth's tie-breaks to matter.
    let seed = 1;
    const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    const rows = Array.from({ length: height }, () => Array.from({ length: width * 4 }, next));
    const png = await buildPng({ width, height, depth: 8, colorType: 6, rows, bpp: 4, filters: (y) => y % 5 });
    const image = await decodePng(png, MAX);
    expect(image.width).toBe(width);
    expect(image.height).toBe(height);
    expect([...image.data]).toEqual(rows.flat());
  });

  it('scales 16-bit samples and applies an RGB transparency key', async () => {
    const pixel = (r: number, g: number, b: number) => [r >> 8, r & 0xff, g >> 8, g & 0xff, b >> 8, b & 0xff];
    const rows = [[...pixel(0xffff, 0x8080, 0x0000), ...pixel(0x1234, 0x5678, 0x9abc)]];
    const png = await buildPng({ width: 2, height: 1, depth: 16, colorType: 2, rows, bpp: 6, extra: [chunk('tRNS', pixel(0x1234, 0x5678, 0x9abc))] });
    const { data } = await decodePng(png, MAX);
    expect([...data.subarray(0, 4)]).toEqual([255, 128, 0, 255]);
    expect(data[7]).toBe(0);
  });

  it('scales sub-byte gray to the full range', async () => {
    // Four 2-bit pixels in one byte: 0, 1, 2, 3.
    const png = await buildPng({ width: 4, height: 1, depth: 2, colorType: 0, rows: [[0b00011011]], bpp: 1 });
    const { data } = await decodePng(png, MAX);
    expect([data[0], data[4], data[8], data[12]]).toEqual([0, 85, 170, 255]);
    expect([data[3], data[15]]).toEqual([255, 255]);
  });

  it('reads palette colors with their alpha', async () => {
    const extra = [chunk('PLTE', [10, 20, 30, 40, 50, 60]), chunk('tRNS', [128])];
    const png = await buildPng({ width: 2, height: 1, depth: 8, colorType: 3, rows: [[1, 0]], bpp: 1, extra });
    const { data } = await decodePng(png, MAX);
    expect([...data]).toEqual([40, 50, 60, 255, 10, 20, 30, 128]);
  });

  it('refuses what it cannot read', async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3]), MAX)).rejects.toThrow('Not a PNG');
    const rgba = { width: 1, height: 1, depth: 8, colorType: 6, rows: [[1, 2, 3, 4]], bpp: 4 };
    const png = await buildPng(rgba);
    const corrupt = png.slice();
    corrupt[20]++;
    await expect(decodePng(corrupt, MAX)).rejects.toThrow('corrupt');
    await expect(decodePng(png, 0)).rejects.toThrow('too large');
    await expect(decodePng(await buildPng({ ...rgba, interlace: 1 }), MAX)).rejects.toThrow('Interlaced');
  });

  it('lets checkSize refuse by the header, before the pixel cap', async () => {
    const png = await buildPng({ width: 3, height: 2, depth: 8, colorType: 6, rows: [[], []].map(() => Array(12).fill(0)), bpp: 4 });
    const seen: number[][] = [];
    const check = (width: number, height: number) => {
      seen.push([width, height]);
      throw new RangeError('refused by size');
    };
    await expect(decodePng(png, 0, check)).rejects.toThrow('refused by size');
    expect(seen).toEqual([[3, 2]]);
    expect((await decodePng(png, MAX, () => {})).width).toBe(3);
  });
});

describe('encodeIndexedPng', () => {
  it('round-trips indices, with index 0 transparent and translucent colors kept', async () => {
    const colors = [packRgba(255, 0, 0), packRgba(0, 0, 255, 100), packRgba(1, 2, 3)];
    const image = { width: 3, height: 2, pixels: Uint8Array.from([0, 1, 2, 3, 3, 0]) };
    const { width, height, data } = await decodePng(await encodeIndexedPng(image, colors), MAX);
    expect([width, height]).toEqual([3, 2]);
    expect([...data]).toEqual([
      0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 100,
      1, 2, 3, 255, 1, 2, 3, 255, 0, 0, 0, 0,
    ]);
  });

  it('refuses indices past the colors', async () => {
    await expect(encodeIndexedPng({ width: 1, height: 1, pixels: Uint8Array.from([2]) }, [packRgba(0, 0, 0)])).rejects.toThrow('past');
  });
});
