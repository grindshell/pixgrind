import { describe, expect, it } from 'vitest';
import {
  clampReferenceScale,
  fitPlacement,
  MAX_REFERENCE_SCALE,
  MIN_REFERENCE_SCALE,
  placementCenter,
  scaleAround,
  scaleToSlider,
  sliderToScale,
} from './referencePlacement.ts';

describe('fitPlacement', () => {
  it('shrinks a large image to fit and centers it', () => {
    // 640×320 into 32×32: limited by width → scale 0.05, 32×16, centered vertically.
    expect(fitPlacement(640, 320, 32, 32)).toEqual({ x: 0, y: 8, scale: 0.05 });
  });

  it('enlarges a small image to fit', () => {
    expect(fitPlacement(8, 16, 32, 32)).toEqual({ x: 8, y: 0, scale: 2 });
  });

  it('respects the scale limits', () => {
    expect(fitPlacement(100_000, 1, 32, 32).scale).toBe(MIN_REFERENCE_SCALE);
    expect(fitPlacement(1, 1, 1024, 1024).scale).toBe(MAX_REFERENCE_SCALE);
  });
});

describe('scaleAround', () => {
  it('keeps the anchor point on the same spot of the image', () => {
    const before = { x: 2, y: 4, scale: 0.5 };
    const after = scaleAround(before, 2, 10, 10);
    // The image point under (10, 10) is ((10-2)/0.5, (10-4)/0.5) = (16, 12) both times.
    expect(((10 - after.x) / after.scale)).toBeCloseTo(16);
    expect(((10 - after.y) / after.scale)).toBeCloseTo(12);
    expect(after.scale).toBe(2);
  });

  it('clamps the scale', () => {
    expect(scaleAround({ x: 0, y: 0, scale: 1 }, 1000, 0, 0).scale).toBe(MAX_REFERENCE_SCALE);
    expect(clampReferenceScale(0)).toBe(MIN_REFERENCE_SCALE);
  });
});

describe('placementCenter', () => {
  it('finds the document point at the image center', () => {
    expect(placementCenter({ x: 1, y: 2, scale: 0.5 }, 20, 10)).toEqual({ x: 6, y: 4.5 });
  });
});

describe('scale slider mapping', () => {
  it('spans the scale range logarithmically and round-trips', () => {
    expect(sliderToScale(0)).toBeCloseTo(MIN_REFERENCE_SCALE);
    expect(sliderToScale(1)).toBeCloseTo(MAX_REFERENCE_SCALE);
    for (const scale of [0.05, 0.5, 1, 3, 20]) expect(sliderToScale(scaleToSlider(scale))).toBeCloseTo(scale);
    // Logarithmic: 1× sits well past the middle of a 0.01×–64× range.
    expect(scaleToSlider(1)).toBeGreaterThan(0.5);
  });
});
