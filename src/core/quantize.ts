import { alpha, blue, green, packRgba, red, type Rgba } from './color.ts';
import type { RgbaImage } from './image.ts';

/*
 * Reducing an image to a few colors: choosing them (`generatePalette`) and
 * mapping pixels to them, optionally dithered (`quantizeImage`).
 */

/** Pixels at least this opaque (0–255) get a palette color; fainter ones become transparent. */
export const ALPHA_THRESHOLD = 128;

/** How in-between colors are approximated with palette colors. */
export type Dither =
  /** Each pixel takes its nearest palette color. */
  | 'none'
  /** A fixed 8×8 pattern (Bayer) nudges pixels toward neighboring colors: regular, the classic pixel-art look. */
  | 'ordered'
  /** Each pixel's error is passed on to the pixels after it (Floyd–Steinberg): finer, but noisier. */
  | 'diffusion';

/** Finds the nearest palette color for opaque colors. */
export interface ColorMatcher {
  readonly colors: readonly Rgba[];
  /** The 1-based index of the color nearest (r, g, b) as an opaque color, by `colorDistance`. Ties go to the lower index. */
  nearest(r: number, g: number, b: number): number;
}

/**
 * A matcher for `colors`. It remembers every answer in a 16 MB table, since
 * images repeat colors and dithering revisits them; reuse one per palette.
 */
export function colorMatcher(colors: readonly Rgba[]): ColorMatcher {
  if (colors.length === 0) throw new Error('Palette has no colors');
  const count = colors.length;
  const pr = Float64Array.from(colors, red);
  const pg = Float64Array.from(colors, green);
  const pb = Float64Array.from(colors, blue);
  // The alpha term of `colorDistance` against an opaque color is the same for every candidate color's own alpha.
  const pa = Float64Array.from(colors, (c) => 3 * (255 - alpha(c)) ** 2);
  const answers = new Uint8Array(1 << 24);
  return {
    colors,
    nearest(r, g, b) {
      const key = (r << 16) | (g << 8) | b;
      const known = answers[key];
      if (known !== 0) return known;
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < count; i++) {
        // `colorDistance`, inlined.
        const redMean = (r + pr[i]) / 2;
        const dr = r - pr[i];
        const dg = g - pg[i];
        const db = b - pb[i];
        const distance =
          (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db + pa[i];
        if (distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
      answers[key] = best + 1;
      return best + 1;
    },
  };
}

/**
 * Maps an image to palette indices: transparent below `ALPHA_THRESHOLD`,
 * otherwise a palette color, dithered as `dither` says. `strength` (0–1)
 * scales the dithering.
 */
export function quantizeImage(image: RgbaImage, matcher: ColorMatcher, dither: Dither = 'none', strength = 1): Uint8Array {
  if (dither === 'diffusion' && strength > 0) return diffuse(image, matcher, strength);
  const { width, height, data } = image;
  const pixels = new Uint8Array(width * height);
  const spread = dither === 'ordered' ? paletteSpread(matcher.colors) * strength : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      if (data[o + 3] < ALPHA_THRESHOLD) continue;
      if (spread === 0) {
        pixels[i] = matcher.nearest(data[o], data[o + 1], data[o + 2]);
        continue;
      }
      const nudge = Math.round(BAYER[(y & 7) * 8 + (x & 7)] * spread);
      pixels[i] = matcher.nearest(clampByte(data[o] + nudge), clampByte(data[o + 1] + nudge), clampByte(data[o + 2] + nudge));
    }
  }
  return pixels;
}

/** The 8×8 Bayer matrix as thresholds evenly spread over (-0.5, 0.5). */
const BAYER: Float64Array = (() => {
  // Each level tiles the last in four, offset by 0, 2, 3 and 1 (the 2×2 matrix's order).
  let matrix = [0];
  for (let size = 1; size < 8; size *= 2) {
    const next = new Array<number>(size * size * 4);
    for (let y = 0; y < size * 2; y++) {
      for (let x = 0; x < size * 2; x++) {
        const quadrant = [0, 2, 3, 1][(y >= size ? 2 : 0) + (x >= size ? 1 : 0)];
        next[y * size * 2 + x] = matrix[(y % size) * size + (x % size)] * 4 + quadrant;
      }
    }
    matrix = next;
  }
  return Float64Array.from(matrix, (v) => (v + 0.5) / 64 - 0.5);
})();

/**
 * A typical gap between neighboring palette colors, per channel: how far
 * ordered dithering spreads a color so it lands on the colors around it.
 * The average distance from each color to its nearest other one.
 */
export function paletteSpread(colors: readonly Rgba[]): number {
  let total = 0;
  let counted = 0;
  for (const a of colors) {
    let nearest = Infinity;
    for (const b of colors) {
      const d = (red(a) - red(b)) ** 2 + (green(a) - green(b)) ** 2 + (blue(a) - blue(b)) ** 2;
      if (d > 0 && d < nearest) nearest = d;
    }
    if (nearest === Infinity) continue;
    total += Math.sqrt(nearest);
    counted++;
  }
  return counted === 0 ? 0 : total / counted / Math.sqrt(3);
}

/**
 * Floyd–Steinberg error diffusion, alternating direction each row so errors
 * don't drift one way. Transparent pixels neither take nor pass on error.
 */
function diffuse(image: RgbaImage, matcher: ColorMatcher, strength: number): Uint8Array {
  const { width, height, data } = image;
  const pixels = new Uint8Array(width * height);
  const { colors } = matcher;
  // Error carried to this row and the next, RGB per pixel, with a pixel of
  // padding at each end for what falls off the edges.
  let current = new Float64Array((width + 2) * 3);
  let below = new Float64Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const reverse = y % 2 === 1;
    const ahead = reverse ? -3 : 3;
    /** Passes on one channel's error from entry `e`: 7/16 ahead, 3/16 below behind, 5/16 below, 1/16 below ahead. */
    const spread = (e: number, error: number) => {
      current[e + ahead] += (error * 7) / 16;
      below[e - ahead] += (error * 3) / 16;
      below[e] += (error * 5) / 16;
      below[e + ahead] += error / 16;
    };
    for (let n = 0; n < width; n++) {
      const x = reverse ? width - 1 - n : n;
      const i = y * width + x;
      const o = i * 4;
      if (data[o + 3] < ALPHA_THRESHOLD) continue;
      const e = (x + 1) * 3;
      const r = Math.min(255, Math.max(0, data[o] + current[e]));
      const g = Math.min(255, Math.max(0, data[o + 1] + current[e + 1]));
      const b = Math.min(255, Math.max(0, data[o + 2] + current[e + 2]));
      const index = matcher.nearest(Math.round(r), Math.round(g), Math.round(b));
      pixels[i] = index;
      const color = colors[index - 1];
      spread(e, (r - red(color)) * strength);
      spread(e + 1, (g - green(color)) * strength);
      spread(e + 2, (b - blue(color)) * strength);
    }
    [current, below] = [below, current];
    below.fill(0);
  }
  return pixels;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/* ---- Choosing colors ---- */

/** Up to this many distinct colors are clustered exactly; past it, similar colors are grouped first. */
const MAX_EXACT_COLORS = 8192;
/** Rounds of k-means at most, fewer for large inputs (see `KMEANS_BUDGET`). */
const KMEANS_ROUNDS = 8;
/** Color comparisons k-means may spend in total, so many colors and points stay quick for live previews. */
const KMEANS_BUDGET = 30_000_000;

/** Distinct colors with how many pixels have each (or a group's average color and size). */
interface ColorPoints {
  length: number;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  weight: Float64Array;
}

/**
 * Up to `count` opaque colors representing the image's pixels that are
 * opaque enough (see `ALPHA_THRESHOLD`): median cut splits the colors into
 * groups, then k-means moves each color to the middle of the pixels nearest
 * it. Sorted dark to light. Fewer when the image has fewer colors; none when
 * no pixel is opaque enough.
 */
export function generatePalette(image: RgbaImage, count: number): Rgba[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Invalid color count ${count}`);
  const points = colorPoints(image.data);
  if (points.length === 0) return [];
  const centers = refine(points, medianCut(points, count));
  const unique = new Map<Rgba, number>();
  for (const [r, g, b] of centers) {
    const color = packRgba(Math.round(r), Math.round(g), Math.round(b));
    unique.set(color, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  return [...unique].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([color]) => color);
}

function colorPoints(data: Uint8ClampedArray): ColorPoints {
  const exact = new Map<number, number>();
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] < ALPHA_THRESHOLD) continue;
    const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
    exact.set(key, (exact.get(key) ?? 0) + 1);
    if (exact.size > MAX_EXACT_COLORS) return groupedPoints(data);
  }
  const points = allocatePoints(exact.size);
  let n = 0;
  for (const [key, weight] of exact) {
    points.r[n] = key >>> 16;
    points.g[n] = (key >>> 8) & 0xff;
    points.b[n] = key & 0xff;
    points.weight[n++] = weight;
  }
  return points;
}

/** Colors grouped by their top 5 bits per channel, each group at its pixels' average color. */
function groupedPoints(data: Uint8ClampedArray): ColorPoints {
  const weight = new Float64Array(1 << 15);
  const r = new Float64Array(1 << 15);
  const g = new Float64Array(1 << 15);
  const b = new Float64Array(1 << 15);
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] < ALPHA_THRESHOLD) continue;
    const key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
    weight[key]++;
    r[key] += data[o];
    g[key] += data[o + 1];
    b[key] += data[o + 2];
  }
  let length = 0;
  for (const w of weight) if (w > 0) length++;
  const points = allocatePoints(length);
  let n = 0;
  for (let key = 0; key < weight.length; key++) {
    const w = weight[key];
    if (w === 0) continue;
    points.r[n] = r[key] / w;
    points.g[n] = g[key] / w;
    points.b[n] = b[key] / w;
    points.weight[n++] = w;
  }
  return points;
}

function allocatePoints(length: number): ColorPoints {
  return {
    length,
    r: new Float64Array(length),
    g: new Float64Array(length),
    b: new Float64Array(length),
    weight: new Float64Array(length),
  };
}

/** How much each channel's differences count, roughly as in `colorDistance`. */
const CHANNEL_WEIGHTS = [2.5, 4, 2.5];

/** Points `order[start..end)`, with their spread: weighted squared error, and the channel it's widest on. */
interface Box {
  start: number;
  end: number;
  error: number;
  channel: number;
}

/** Splits the points into up to `count` boxes, always splitting the one with the most error, at its weighted median. Returns each box's center. */
function medianCut(points: ColorPoints, count: number): number[][] {
  const order = Int32Array.from({ length: points.length }, (_, i) => i);
  const channels = [points.r, points.g, points.b];
  const measure = (start: number, end: number): Box => {
    let total = 0;
    const sums = [0, 0, 0];
    const squares = [0, 0, 0];
    for (let n = start; n < end; n++) {
      const p = order[n];
      const w = points.weight[p];
      total += w;
      for (let c = 0; c < 3; c++) {
        sums[c] += channels[c][p] * w;
        squares[c] += channels[c][p] ** 2 * w;
      }
    }
    const spreads = [0, 1, 2].map((c) => Math.max(0, squares[c] - sums[c] ** 2 / total) * CHANNEL_WEIGHTS[c]);
    const channel = spreads.indexOf(Math.max(...spreads));
    return { start, end, error: spreads[0] + spreads[1] + spreads[2], channel };
  };

  const boxes = [measure(0, points.length)];
  while (boxes.length < count) {
    let widest = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.end - box.start > 1 && box.error > 0 && (widest < 0 || box.error > boxes[widest].error)) widest = i;
    }
    if (widest < 0) break;
    const { start, end, channel } = boxes[widest];
    const values = channels[channel];
    order.subarray(start, end).sort((a, b) => values[a] - values[b]);
    let half = 0;
    for (let n = start; n < end; n++) half += points.weight[order[n]];
    half /= 2;
    // The first point past half the weight starts the second box, keeping both non-empty.
    let split = start + 1;
    for (let sum = points.weight[order[start]]; split < end - 1 && sum + points.weight[order[split]] <= half; split++) {
      sum += points.weight[order[split]];
    }
    boxes.splice(widest, 1, measure(start, split), measure(split, end));
  }

  return boxes.map(({ start, end }) => {
    let total = 0;
    const center = [0, 0, 0];
    for (let n = start; n < end; n++) {
      const p = order[n];
      total += points.weight[p];
      for (let c = 0; c < 3; c++) center[c] += channels[c][p] * points.weight[p];
    }
    return center.map((sum) => sum / total);
  });
}

/** Moves each center to the weighted middle of the points nearest it (by `colorDistance`), until they settle. */
function refine(points: ColorPoints, initial: number[][]): number[][] {
  const k = initial.length;
  const centers = Float64Array.from(initial.flat());
  const rounds = Math.max(1, Math.min(KMEANS_ROUNDS, Math.floor(KMEANS_BUDGET / (points.length * k))));
  const sums = new Float64Array(k * 4);
  for (let round = 0; round < rounds; round++) {
    sums.fill(0);
    for (let p = 0; p < points.length; p++) {
      const r = points.r[p];
      const g = points.g[p];
      const b = points.b[p];
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < k; i++) {
        const dr = r - centers[i * 3];
        const dg = g - centers[i * 3 + 1];
        const db = b - centers[i * 3 + 2];
        const redMean = (r + centers[i * 3]) / 2;
        const distance = (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db;
        if (distance < bestDistance) {
          best = i;
          bestDistance = distance;
        }
      }
      const w = points.weight[p];
      sums[best * 4] += r * w;
      sums[best * 4 + 1] += g * w;
      sums[best * 4 + 2] += b * w;
      sums[best * 4 + 3] += w;
    }
    let moved = false;
    for (let i = 0; i < k; i++) {
      const total = sums[i * 4 + 3];
      // A center no point is nearest stays where it is.
      if (total === 0) continue;
      for (let c = 0; c < 3; c++) {
        const next = sums[i * 4 + c] / total;
        if (Math.abs(next - centers[i * 3 + c]) > 0.25) moved = true;
        centers[i * 3 + c] = next;
      }
    }
    if (!moved) break;
  }
  return initial.map((_, i) => [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]]);
}
