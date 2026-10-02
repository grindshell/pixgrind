export interface Viewport {
  /** Screen (CSS) pixels per document pixel. Always an integer. */
  zoom: number;
  /** Screen position (CSS px, may be fractional), relative to the canvas, of document pixel (0, 0)'s top-left corner. */
  offsetX: number;
  offsetY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/**
 * Screen → document pixel coordinates. This is the only place that conversion
 * should happen; the result is always integer.
 */
export function screenToPixel(viewport: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: Math.floor((screenX - viewport.offsetX) / viewport.zoom),
    y: Math.floor((screenY - viewport.offsetY) / viewport.zoom),
  };
}

/** The largest integer zoom that fits the document in the view, centered. */
export function fitViewport(
  docWidth: number,
  docHeight: number,
  viewWidth: number,
  viewHeight: number,
  margin = 32,
): Viewport {
  const zoom = clampZoom(
    Math.floor(Math.min((viewWidth - margin * 2) / docWidth, (viewHeight - margin * 2) / docHeight)),
  );
  return {
    zoom,
    offsetX: Math.round((viewWidth - docWidth * zoom) / 2),
    offsetY: Math.round((viewHeight - docHeight * zoom) / 2),
  };
}

/**
 * Changes zoom while keeping the document point under (screenX, screenY) in
 * place. Offsets are left unrounded: rounding here could shift that point into
 * a neighboring pixel. The renderer snaps to device pixels when drawing.
 */
export function zoomAt(viewport: Viewport, zoom: number, screenX: number, screenY: number): Viewport {
  const next = clampZoom(zoom);
  const scale = next / viewport.zoom;
  return {
    zoom: next,
    offsetX: screenX - (screenX - viewport.offsetX) * scale,
    offsetY: screenY - (screenY - viewport.offsetY) * scale,
  };
}

/** Next zoom level in `direction` (+1 in, -1 out): +1 steps when small, ~25% steps when large. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(direction > 0 ? Math.max(zoom + 1, zoom * 1.25) : Math.min(zoom - 1, zoom / 1.25));
}
