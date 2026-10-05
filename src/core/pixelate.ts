import type { Rgba } from './color.ts';
import type { IndexedImage, RgbaImage } from './image.ts';
import { checkDocumentSize } from './pixelDocument.ts';
import { ALPHA_THRESHOLD, colorMatcher, generatePalette, quantizeImage, type ColorMatcher, type Dither } from './quantize.ts';
import { averageResample, dominantResample, nearestResample, type SourceRegion } from './resample.ts';

/*
 * Pixelating: turning an image (typically a large photo) into pixel art, a
 * small grid of pixels in a few colors. Resample to the size, choose or
 * generate the colors, then map pixels to them, dithered or not.
 */

/** How each pixel samples its cell of the source image. */
export type Sampling =
  /** The cell's colors averaged: smooth, best for photos. */
  | 'average'
  /** The palette color covering the most of the cell: crisp edges and no blended colors. Never dithered. */
  | 'dominant'
  /** The source pixel at the cell's center: sharp but noisy. Shrinks enlarged pixel art back exactly. */
  | 'nearest';

export interface PixelateOptions {
  width: number;
  height: number;
  /** The part of the source to pixelate (see `SourceRegion`); all of it when absent. */
  region?: SourceRegion;
  sampling: Sampling;
  /** The colors to use, or null to generate `colorCount` from the image (see `generatePalette`). */
  colors: readonly Rgba[] | null;
  colorCount: number;
  dither: Dither;
  /** 0–1. */
  ditherStrength: number;
}

/** A pixelated image: indices into `colors`. Generated colors include only those used. */
export interface PixelatedImage extends IndexedImage {
  colors: Rgba[];
}

/** Pixelates one source image with any options. */
export type Pixelator = (options: PixelateOptions) => PixelatedImage;

/**
 * A pixelator for `source` that keeps each step's result while its inputs
 * stay the same, so a live preview redoes only what an option change
 * affects: changing the dithering, say, doesn't resample the photo again.
 */
export function createPixelator(source: RgbaImage): Pixelator {
  let sampled: { key: string; image: RgbaImage } | null = null;
  let generated: { key: string; colors: Rgba[] } | null = null;
  let matcher: { key: string; matcher: ColorMatcher } | null = null;

  return (options) => {
    const { width, height, sampling } = options;
    checkDocumentSize(width, height);
    const region = options.region ?? { x: 0, y: 0, width: source.width, height: source.height };
    // Dominant sampling votes with source pixels, but generates colors from the averages.
    const sampleKey = [width, height, region.x, region.y, region.width, region.height, sampling === 'nearest'].join();
    const resampled = () => {
      const resample = sampling === 'nearest' ? nearestResample : averageResample;
      if (sampled?.key !== sampleKey) sampled = { key: sampleKey, image: resample(source, width, height, region) };
      return sampled.image;
    };

    let colors: readonly Rgba[];
    if (options.colors) {
      colors = options.colors;
    } else {
      const key = `${sampleKey} ${options.colorCount}`;
      if (generated?.key !== key) generated = { key, colors: generatePalette(resampled(), options.colorCount) };
      colors = generated.colors;
    }
    // Only when no pixel is opaque enough to have a color.
    if (colors.length === 0) return { width, height, colors: [], pixels: new Uint8Array(width * height) };

    const colorsKey = colors.join();
    if (matcher?.key !== colorsKey) matcher = { key: colorsKey, matcher: colorMatcher(colors) };
    const match = matcher.matcher;
    const pixels =
      sampling === 'dominant'
        ? dominantResample(
            source,
            width,
            height,
            (o) => {
              const { data } = source;
              return data[o + 3] < ALPHA_THRESHOLD ? 0 : match.nearest(data[o], data[o + 1], data[o + 2]);
            },
            region,
          )
        : quantizeImage(resampled(), match, options.dither, options.ditherStrength);
    const image = { width, height, colors: [...colors], pixels };
    return options.colors ? image : usedColorsOnly(image);
  };
}

/** Pixelates an image once. For repeated runs on one image, keep a `createPixelator`. */
export function pixelateImage(source: RgbaImage, options: PixelateOptions): PixelatedImage {
  return createPixelator(source)(options);
}

/** The image with the colors no pixel uses dropped, and its pixels renumbered to match. Same order otherwise. */
export function usedColorsOnly(image: PixelatedImage): PixelatedImage {
  const used = new Uint8Array(256);
  for (let i = 0; i < image.pixels.length; i++) used[image.pixels[i]] = 1;
  const mapping = new Uint8Array(256);
  const colors: Rgba[] = [];
  image.colors.forEach((color, i) => {
    if (used[i + 1]) {
      colors.push(color);
      mapping[i + 1] = colors.length;
    }
  });
  if (colors.length === image.colors.length) return image;
  return { ...image, colors, pixels: image.pixels.map((index) => mapping[index]) };
}

/** How many of the image's colors its pixels use. */
export function countUsedColors(image: IndexedImage): number {
  const used = new Uint8Array(256);
  for (let i = 0; i < image.pixels.length; i++) used[image.pixels[i]] = 1;
  let count = 0;
  for (let i = 1; i < 256; i++) count += used[i];
  return count;
}
