import type { RgbaImage } from './image.ts';

/*
 * Resizing images to a grid of pixels (usually shrinking a photo). Each
 * output pixel covers a cell of the source, `source / size` pixels across on
 * each axis and usually fractional: pixels on a cell's edge count by how
 * much of them it covers.
 */

/**
 * The part of a source image to resample, in its pixels: fractional, and
 * free to reach past the image, where it's transparent. A reference image
 * placed on the canvas covers the canvas with such a region.
 */
export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which source pixels each output pixel's cell covers along one axis, and by how much. */
interface AxisCover {
  /** The first source pixel in each output pixel's cell. */
  first: Int32Array;
  /** Where each output pixel's weights start in `weights`, and end at the next one's start. */
  starts: Int32Array;
  /**
   * The share of its cell each covered source pixel takes, in order. A
   * cell's add up to 1, less what of it lies off the source.
   */
  weights: Float64Array;
  /** How much of each cell lies on the source: the sum of its weights. */
  covered: Float64Array;
}

/** Cells of `size` output pixels over `extent` source pixels from `origin`, on an axis `source` pixels long. */
function axisCover(source: number, size: number, origin: number, extent: number): AxisCover {
  const first = new Int32Array(size);
  const starts = new Int32Array(size + 1);
  const covered = new Float64Array(size);
  const weights: number[] = [];
  for (let i = 0; i < size; i++) {
    // Integer products divided once, so cells that end on a pixel boundary end exactly there.
    const lo = origin + (i * extent) / size;
    const hi = origin + ((i + 1) * extent) / size;
    const from = Math.max(0, Math.floor(lo));
    first[i] = from;
    starts[i] = weights.length;
    for (let j = from; j < Math.min(source, Math.ceil(hi)); j++) {
      const weight = (Math.min(hi, j + 1) - Math.max(lo, j)) / (hi - lo);
      weights.push(weight);
      covered[i] += weight;
    }
  }
  starts[size] = weights.length;
  return { first, starts, weights: Float64Array.from(weights), covered };
}

function checkSize(width: number, height: number, region: SourceRegion): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid size ${width}×${height}`);
  }
  if (!(region.width > 0 && region.height > 0 && Number.isFinite(region.x) && Number.isFinite(region.y))) {
    throw new RangeError('Invalid source region');
  }
}

function wholeImage(image: RgbaImage): SourceRegion {
  return { x: 0, y: 0, width: image.width, height: image.height };
}

/** sRGB channel value (0–255) → linear light (0–1). */
let toLinearTable: Float64Array | null = null;
/** Linear light in `LINEAR_STEPS` steps → sRGB channel value, fine enough that every value survives the round trip. */
let toSrgbTable: Uint8Array | null = null;
const LINEAR_STEPS = 65535;

function linearTables(): { toLinear: Float64Array; toSrgb: Uint8Array } {
  toLinearTable ??= Float64Array.from({ length: 256 }, (_, v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  toSrgbTable ??= Uint8Array.from({ length: LINEAR_STEPS + 1 }, (_, i) => {
    const c = i / LINEAR_STEPS;
    return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  });
  return { toLinear: toLinearTable, toSrgb: toSrgbTable };
}

/**
 * Resizes an image (or a region of it) to `width`×`height`, each pixel the
 * average of its cell. Colors mix in linear light, as light itself does (so
 * black and white make a light gray, not a dark one), and by alpha, so
 * transparent pixels don't tint their neighbors. Alpha is the cell's
 * average, counting what lies off the image as transparent.
 */
export function averageResample(image: RgbaImage, width: number, height: number, region = wholeImage(image)): RgbaImage {
  checkSize(width, height, region);
  const { toLinear, toSrgb } = linearTables();
  const columns = axisCover(image.width, width, region.x, region.width);
  const rows = axisCover(image.height, height, region.y, region.height);
  const source = image.data;
  const data = new Uint8ClampedArray(width * height * 4);
  // One row of cells at a time: alpha-weighted linear RGB, and alpha (0–255).
  const sums = new Float64Array(width * 4);
  for (let y = 0; y < height; y++) {
    sums.fill(0);
    for (let k = rows.starts[y], sy = rows.first[y]; k < rows.starts[y + 1]; k++, sy++) {
      const wy = rows.weights[k];
      const row = sy * image.width;
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let j = columns.starts[x], sx = columns.first[x]; j < columns.starts[x + 1]; j++, sx++) {
          const o = (row + sx) * 4;
          const w = columns.weights[j] * source[o + 3];
          if (w === 0) continue;
          r += toLinear[source[o]] * w;
          g += toLinear[source[o + 1]] * w;
          b += toLinear[source[o + 2]] * w;
          a += w;
        }
        const s = x * 4;
        sums[s] += r * wy;
        sums[s + 1] += g * wy;
        sums[s + 2] += b * wy;
        sums[s + 3] += a * wy;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * 4;
      const a = sums[s + 3];
      if (a === 0) continue;
      const o = (y * width + x) * 4;
      data[o] = toSrgb[Math.round((sums[s] / a) * LINEAR_STEPS)];
      data[o + 1] = toSrgb[Math.round((sums[s + 1] / a) * LINEAR_STEPS)];
      data[o + 2] = toSrgb[Math.round((sums[s + 2] / a) * LINEAR_STEPS)];
      data[o + 3] = Math.round(a);
    }
  }
  return { width, height, data };
}

/**
 * Resizes an image (or a region of it) to `width`×`height`, each pixel the
 * source pixel at its cell's center, or transparent where that's off the image.
 */
export function nearestResample(image: RgbaImage, width: number, height: number, region = wholeImage(image)): RgbaImage {
  checkSize(width, height, region);
  const data = new Uint8ClampedArray(width * height * 4);
  const columns = Int32Array.from({ length: width }, (_, x) => centerOf(x, image.width, width, region.x, region.width));
  for (let y = 0; y < height; y++) {
    const sy = centerOf(y, image.height, height, region.y, region.height);
    if (sy < 0) continue;
    for (let x = 0; x < width; x++) {
      if (columns[x] < 0) continue;
      const from = (sy * image.width + columns[x]) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** The source pixel at the center of cell `i` (see `axisCover`), or -1 when it's off the source. */
function centerOf(i: number, source: number, size: number, origin: number, extent: number): number {
  const center = Math.floor(origin + ((2 * i + 1) * extent) / (2 * size));
  return center >= 0 && center < source ? center : -1;
}

/**
 * Resizes an image (or a region of it) to `width`×`height` palette indices,
 * each pixel taking the index that covers the most of its cell. `indexAt`
 * gives a source pixel's index (0 for transparent, which takes part like
 * any other, as does what lies off the image) from its offset in
 * `image.data`. Ties go to the lower index.
 */
export function dominantResample(
  image: RgbaImage,
  width: number,
  height: number,
  indexAt: (offset: number) => number,
  region = wholeImage(image),
): Uint8Array {
  checkSize(width, height, region);
  const columns = axisCover(image.width, width, region.x, region.width);
  const rows = axisCover(image.height, height, region.y, region.height);
  const indices = new Uint8Array(width * height);
  // One row of cells at a time: how much of each cell each index covers, and
  // which indices each cell has seen, so only those need checking and clearing.
  const votes = new Float64Array(width * 256);
  const seen = new Uint8Array(width * 256);
  const seenCount = new Uint16Array(width);
  const vote = (x: number, index: number, weight: number) => {
    const cell = x * 256;
    if (votes[cell + index] === 0) seen[cell + seenCount[x]++] = index;
    votes[cell + index] += weight;
  };
  for (let y = 0; y < height; y++) {
    for (let k = rows.starts[y], sy = rows.first[y]; k < rows.starts[y + 1]; k++, sy++) {
      const wy = rows.weights[k];
      const row = sy * image.width;
      for (let x = 0; x < width; x++) {
        for (let j = columns.starts[x], sx = columns.first[x]; j < columns.starts[x + 1]; j++, sx++) {
          vote(x, indexAt((row + sx) * 4), columns.weights[j] * wy);
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const off = 1 - rows.covered[y] * columns.covered[x];
      if (off > 1e-9) vote(x, 0, off);
      const cell = x * 256;
      let best = 0;
      let bestVotes = -1;
      for (let n = 0; n < seenCount[x]; n++) {
        const index = seen[cell + n];
        const v = votes[cell + index];
        if (v > bestVotes || (v === bestVotes && index < best)) {
          best = index;
          bestVotes = v;
        }
        votes[cell + index] = 0;
      }
      seenCount[x] = 0;
      indices[y * width + x] = best;
    }
  }
  return indices;
}
