import { alpha, blue, green, red, type Rgba } from '../core/color.ts';
import type { IndexedImage, RgbaImage } from '../core/image.ts';
import { MAX_PALETTE_COLORS } from '../core/palette.ts';
import { deflate, inflate } from './bytes.ts';

/*
 * PNG reading and writing without a canvas, so tools outside the browser
 * (the pixelate command line) can use them, and they're unit-tested in Node.
 * Reading takes any non-interlaced PNG, its colors as stored (no color
 * management); writing makes indexed PNGs.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Samples per pixel for each color type, and the bit depths it allows. */
const COLOR_TYPES: Record<number, { channels: number; depths: readonly number[] }> = {
  /** Gray. */
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  /** RGB. */
  2: { channels: 3, depths: [8, 16] },
  /** Palette indices. */
  3: { channels: 1, depths: [1, 2, 4, 8] },
  /** Gray and alpha. */
  4: { channels: 2, depths: [8, 16] },
  /** RGBA. */
  6: { channels: 4, depths: [8, 16] },
};

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
}

/**
 * Decodes a PNG to RGBA. Throws on files that aren't PNGs, are corrupt or
 * interlaced, or have more than `maxPixels` pixels (checked before their
 * pixels take memory). `checkSize` sees the size first and can throw its
 * own, more specific refusal.
 */
export async function decodePng(
  bytes: Uint8Array,
  maxPixels: number,
  checkSize?: (width: number, height: number) => void,
): Promise<RgbaImage> {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let o = SIGNATURE.length; ; ) {
    if (o + 12 > bytes.length) throw new Error('The PNG is truncated');
    const length = view.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const end = o + 12 + length;
    if (end > bytes.length) throw new Error('The PNG is truncated');
    if (crc32(bytes.subarray(o + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error(`The PNG's ${type} chunk is corrupt`);
    const data = bytes.subarray(o + 8, end - 4);
    o = end;
    if (type === 'IEND') break;
    if (type === 'IHDR') header = readHeader(data, maxPixels, checkSize);
    else if (!header) throw new Error('The PNG has no header');
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    // Ancillary chunks (lowercase first letter) are safe to skip; critical ones aren't.
    else if ((type.charCodeAt(0) & 0x20) === 0) throw new Error(`The PNG has an unknown ${type} chunk`);
  }
  if (!header) throw new Error('The PNG has no header');
  if (header.colorType === 3 && !palette) throw new Error('The PNG has no palette');

  const { width, height, depth, colorType } = header;
  const { channels } = COLOR_TYPES[colorType];
  const stride = Math.ceil((width * channels * depth) / 8);
  const rows = unfilter(await inflate(concat(idat), height * (stride + 1)), height, stride, Math.max(1, (channels * depth) >> 3));

  const max = (1 << depth) - 1;
  const sample = (row: number, i: number): number => {
    const o = row + ((i * depth) >> 3);
    if (depth === 16) return (rows[o] << 8) | rows[o + 1];
    if (depth === 8) return rows[o];
    return (rows[o] >> (8 - depth - ((i * depth) & 7))) & max;
  };
  /** A gray or color sample as 0–255. */
  const scale = depth === 16 ? (v: number) => Math.round(v / 257) : depth === 8 ? (v: number) => v : (v: number) => Math.round((v * 255) / max);
  const key = (i: number) => (transparency && transparency.length >= i * 2 + 2 ? (transparency[i * 2] << 8) | transparency[i * 2 + 1] : -1);
  const [keyR, keyG, keyB] = colorType === 0 ? [key(0), -1, -1] : colorType === 2 ? [key(0), key(1), key(2)] : [-1, -1, -1];
  const plte = palette ?? new Uint8Array(0);
  const colorCount = Math.floor(plte.length / 3);

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      switch (colorType) {
        case 0: {
          const v = sample(row, s);
          data[o] = data[o + 1] = data[o + 2] = scale(v);
          data[o + 3] = v === keyR ? 0 : 255;
          break;
        }
        case 2: {
          const r = sample(row, s);
          const g = sample(row, s + 1);
          const b = sample(row, s + 2);
          data[o] = scale(r);
          data[o + 1] = scale(g);
          data[o + 2] = scale(b);
          data[o + 3] = r === keyR && g === keyG && b === keyB ? 0 : 255;
          break;
        }
        case 3: {
          const index = sample(row, s);
          if (index >= colorCount) throw new Error(`The PNG uses color ${index} of a ${colorCount}-color palette`);
          data[o] = plte[index * 3];
          data[o + 1] = plte[index * 3 + 1];
          data[o + 2] = plte[index * 3 + 2];
          data[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
          break;
        }
        case 4: {
          data[o] = data[o + 1] = data[o + 2] = scale(sample(row, s));
          data[o + 3] = scale(sample(row, s + 1));
          break;
        }
        default: {
          data[o] = scale(sample(row, s));
          data[o + 1] = scale(sample(row, s + 1));
          data[o + 2] = scale(sample(row, s + 2));
          data[o + 3] = scale(sample(row, s + 3));
        }
      }
    }
  }
  return { width, height, data };
}

function readHeader(data: Uint8Array, maxPixels: number, checkSize?: (width: number, height: number) => void): Header {
  if (data.length !== 13) throw new Error('The PNG header is corrupt');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [depth, colorType, compression, filter, interlace] = data.subarray(8);
  if (width < 1 || height < 1 || compression !== 0 || filter !== 0 || interlace > 1) throw new Error('The PNG header is corrupt');
  if (!COLOR_TYPES[colorType]?.depths.includes(depth)) throw new Error(`The PNG has an invalid format (color type ${colorType}, ${depth}-bit)`);
  if (interlace === 1) throw new Error("Interlaced PNGs aren't supported");
  checkSize?.(width, height);
  if (width * height > maxPixels) throw new RangeError(`${width}×${height} is too large (max ${maxPixels} pixels)`);
  return { width, height, depth, colorType };
}

/** Undoes each scanline's filter. `bpp` is whole bytes per pixel, at least 1. */
function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  if (raw.length !== height * (stride + 1)) throw new Error("The PNG's image data is truncated");
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const out = y * stride;
    const up = out - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[out + x - bpp] : 0;
      const b = y > 0 ? rows[up + x] : 0;
      const c = x >= bpp && y > 0 ? rows[up + x - bpp] : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = a;
          break;
        case 2:
          predicted = b;
          break;
        case 3:
          predicted = (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`The PNG has an unknown row filter ${filter}`);
      }
      rows[out + x] = raw[line + x] + predicted;
    }
  }
  return rows;
}

/**
 * Encodes palette indices as an 8-bit indexed PNG. Its palette is the
 * image's, as in a layer: entry 0 is transparent and entry `i` is
 * `colors[i - 1]`, translucent colors keeping their alpha.
 */
export async function encodeIndexedPng(image: IndexedImage, colors: readonly Rgba[]): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height, pixels } = image;
  if (colors.length > MAX_PALETTE_COLORS) throw new RangeError(`${colors.length} colors is too many for a PNG palette`);
  if (pixels.length !== width * height) throw new RangeError(`Expected ${width * height} pixels, got ${pixels.length}`);
  for (const index of pixels) {
    if (index > colors.length) throw new RangeError(`Pixel index ${index} is past the ${colors.length} colors`);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);

  const entries = [0, ...colors];
  const plte = new Uint8Array(entries.length * 3);
  entries.forEach((color, i) => plte.set([red(color), green(color), blue(color)], i * 3));
  // Alpha up to the last translucent entry; the rest are opaque. Entry 0 always is translucent.
  let translucent = entries.length;
  while (alpha(entries[translucent - 1]) === 255) translucent--;
  const trns = Uint8Array.from(entries.slice(0, translucent), alpha);

  // Every row unfiltered (filter 0): indices rarely predict well from their neighbors.
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);

  return concat([
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

let crcTable: Uint32Array | null = null;

/** The CRC-32 PNG chunks end with. */
function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
