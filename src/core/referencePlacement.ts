import type { SourceRegion } from './resample.ts';

/**
 * Where a reference image sits over the document, in document pixel
 * coordinates. Fractional values are fine: references are guides, not pixels.
 */
export interface ReferencePlacement {
  /** Document position of the image's top-left corner. */
  x: number;
  y: number;
  /** Document pixels per image pixel. */
  scale: number;
}

export const MIN_REFERENCE_SCALE = 0.01;
export const MAX_REFERENCE_SCALE = 64;

export function clampReferenceScale(scale: number): number {
  return Math.min(MAX_REFERENCE_SCALE, Math.max(MIN_REFERENCE_SCALE, scale));
}

/** The largest scale at which the image fits inside the document, centered. */
export function fitPlacement(imageWidth: number, imageHeight: number, docWidth: number, docHeight: number): ReferencePlacement {
  const scale = clampReferenceScale(Math.min(docWidth / imageWidth, docHeight / imageHeight));
  return {
    x: (docWidth - imageWidth * scale) / 2,
    y: (docHeight - imageHeight * scale) / 2,
    scale,
  };
}

/** Changes scale while keeping the document point (anchorX, anchorY) fixed on the image. */
export function scaleAround(placement: ReferencePlacement, scale: number, anchorX: number, anchorY: number): ReferencePlacement {
  const next = clampReferenceScale(scale);
  const ratio = next / placement.scale;
  return {
    x: anchorX - (anchorX - placement.x) * ratio,
    y: anchorY - (anchorY - placement.y) * ratio,
    scale: next,
  };
}

/** The document point at the image's center. */
export function placementCenter(placement: ReferencePlacement, imageWidth: number, imageHeight: number): { x: number; y: number } {
  return {
    x: placement.x + (imageWidth * placement.scale) / 2,
    y: placement.y + (imageHeight * placement.scale) / 2,
  };
}

/**
 * The part of the image under a `docWidth`×`docHeight` document, in image
 * pixels (it may reach past the image): what the reference shows on the
 * canvas, for pixelating it where it is.
 */
export function placedRegion(placement: ReferencePlacement, docWidth: number, docHeight: number): SourceRegion {
  return {
    x: (0 - placement.x) / placement.scale,
    y: (0 - placement.y) / placement.scale,
    width: docWidth / placement.scale,
    height: docHeight / placement.scale,
  };
}

/**
 * Maps a 0–1 slider position to a scale, logarithmically, so small scales get
 * as much slider travel as large ones. `scaleToSlider` is its inverse.
 */
export function sliderToScale(position: number): number {
  return clampReferenceScale(MIN_REFERENCE_SCALE * (MAX_REFERENCE_SCALE / MIN_REFERENCE_SCALE) ** position);
}

export function scaleToSlider(scale: number): number {
  return Math.log(clampReferenceScale(scale) / MIN_REFERENCE_SCALE) / Math.log(MAX_REFERENCE_SCALE / MIN_REFERENCE_SCALE);
}
