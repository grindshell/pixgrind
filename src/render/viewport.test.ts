import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToPixel,
  stepZoom,
  zoomAt,
  type Viewport,
} from './viewport.ts';

describe('screenToPixel', () => {
  const vp: Viewport = { zoom: 10, offsetX: 100, offsetY: 50 };

  it('maps screen points inside a pixel to that pixel', () => {
    expect(screenToPixel(vp, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenToPixel(vp, 109.9, 59.9)).toEqual({ x: 0, y: 0 });
    expect(screenToPixel(vp, 110, 60)).toEqual({ x: 1, y: 1 });
  });

  it('floors to negative pixels left of and above the document', () => {
    expect(screenToPixel(vp, 99, 49)).toEqual({ x: -1, y: -1 });
  });
});

describe('fitViewport', () => {
  it('picks the largest integer zoom that fits and centers', () => {
    const vp = fitViewport(32, 16, 864, 600, 32);
    expect(vp.zoom).toBe(25);
    expect(vp.offsetX).toBe(32);
    expect(vp.offsetY).toBe(100);
  });

  it('never goes below the minimum zoom', () => {
    expect(fitViewport(4096, 4096, 800, 600).zoom).toBe(MIN_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the pixel under the cursor fixed', () => {
    const vp: Viewport = { zoom: 4, offsetX: 20, offsetY: 30 };
    const before = screenToPixel(vp, 117, 93);
    for (const zoom of [1, 2, 8, 16, 33]) {
      expect(screenToPixel(zoomAt(vp, zoom, 117, 93), 117, 93)).toEqual(before);
    }
  });
});

describe('zoom steps', () => {
  it('clamps to integer zoom within range', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(3.4)).toBe(3);
  });

  it('always moves at least one level and stops at the limits', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(2, -1)).toBe(1);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(32, 1)).toBe(40);
  });
});
