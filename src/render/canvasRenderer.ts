import type { BrushMask } from '../core/brush.ts';
import { alpha, blue, green, red } from '../core/color.ts';
import { compositeRgba } from '../core/composite.ts';
import { extrusionDepth, extrusionOffset, extrusionShape, SQUARE } from '../core/extrusion.ts';
import type { Layer } from '../core/layer.ts';
import { maskOutline, type Mask, type OutlineRun } from '../core/mask.ts';
import { colorForIndex, TRANSPARENT, type Palette } from '../core/palette.ts';
import { findLayer, type FloatingPixels, type PixelDocument } from '../core/pixelDocument.ts';
import type { Point } from '../core/raster.ts';
import type { ReferenceImage } from './referenceImage.ts';
import type { Viewport } from './viewport.ts';

const CHECKER_SIZE = 8;
const CHECKER_LIGHT = '#3a3a44';
const CHECKER_DARK = '#2e2e37';
const SELECTION_LIGHT = '#ffffff';
const SELECTION_DARK = '#000000';
/** Length in device pixels of one black and one white stretch of the selection outline. */
const ANTS_PERIOD = 8;
/** Floating pixels off the document are drawn this faint, relative to their layer. */
const FLOATING_OVERHANG_ALPHA = 0.5;
const SLICE_FILL = 'rgba(91, 140, 255, 0.16)';
const SLICE_EDGE = 'rgba(91, 140, 255, 0.9)';
/** Depth labels need this much zoom (CSS px per pixel) to be readable. */
export const MIN_LABEL_ZOOM = 12;
/** Diagonal pixels' shapes need this much zoom to be seen. */
const MIN_SHAPE_ZOOM = 4;
const LABEL_DEPTH = '#ffffff';
const LABEL_OFFSET = '#9dbbff';
const LABEL_OUTLINE = 'rgba(0, 0, 0, 0.85)';
/** Over the corner a diagonal pixel cuts off, and along its cut. */
const CUT_SHADE = 'rgba(16, 16, 22, 0.6)';
const CUT_EDGE = 'rgba(255, 255, 255, 0.8)';

/** The brush footprint at a document pixel (the one under the pointer). */
export interface BrushCursor extends Point {
  mask: BrushMask;
}

/** Things drawn with the artwork that aren't part of the document. */
export interface RenderOverlays {
  reference?: ReferenceImage | null;
  brush?: BrushCursor | null;
  /** The path of a lasso being drawn, in document pixels. */
  lasso?: readonly Point[] | null;
  /** The column the side view shows, marked with a band. */
  slice?: number | null;
  /**
   * A layer whose extrusions are shown on its pixels: the corners diagonal
   * pixels cut off are shaded, and with `depths` each pixel's depth and
   * offset are written on it (when zoomed in enough to read).
   */
  extrusions?: { layer: Layer; depths: boolean } | null;
}

export interface RenderOptions {
  /**
   * The document's pixels, palette and layers haven't changed since the last
   * render (only the view or overlays have), so the layer composite can be
   * reused instead of recomputed.
   */
  reuseComposite?: boolean;
}

/** Draws a document onto a screen canvas: checkerboard backdrop, reference image, layer composite, selection. */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Holds the composite at native resolution; scaled onto the screen canvas. */
  private readonly docCanvas: HTMLCanvasElement;
  private readonly docCtx: CanvasRenderingContext2D;
  private readonly checker: CanvasPattern;
  /** Diagonal black and white stripes in device pixels: lines drawn with it alternate every few pixels. */
  private readonly ants: CanvasPattern;
  private readonly outlines = new WeakMap<Uint8Array, readonly OutlineRun[]>();
  private imageData: ImageData | null = null;
  private floatingImage: { pixels: Uint8Array; palette: Palette; canvas: HTMLCanvasElement } | null = null;
  private labels: { canvas: HTMLCanvasElement; key: string; layer: Layer } | null = null;
  /** Content changed since the labels were drawn. */
  private labelsStale = true;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = get2dContext(canvas);
    this.docCanvas = document.createElement('canvas');
    this.docCtx = get2dContext(this.docCanvas);
    this.checker = createChecker(this.ctx);
    this.ants = createAnts(this.ctx);
  }

  /** The canvas's CSS size as of the last `resize`. */
  get viewSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** Matches the backing store to the canvas's CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  /**
   * Draws checkerboard, reference (if below), artwork, reference (if above),
   * depth labels, the side view's column, floating pixels off the document,
   * the selection outline, a lasso being drawn, then the brush outline.
   */
  render(
    doc: PixelDocument,
    viewport: Viewport,
    { reference = null, brush = null, lasso = null, slice = null, extrusions = null }: RenderOverlays = {},
    { reuseComposite = false }: RenderOptions = {},
  ): void {
    const { ctx } = this;
    const dpr = this.canvas.width / Math.max(1, this.cssWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    // Snap to device pixels so edges stay crisp. Differs from the viewport by
    // under one device pixel, which input mapping can safely ignore.
    const offsetX = Math.round(viewport.offsetX * dpr) / dpr;
    const offsetY = Math.round(viewport.offsetY * dpr) / dpr;
    const { zoom } = viewport;
    const width = doc.width * zoom;
    const height = doc.height * zoom;

    this.checker.setTransform(new DOMMatrix().translateSelf(offsetX, offsetY));
    ctx.fillStyle = this.checker;
    ctx.fillRect(offsetX, offsetY, width, height);

    const shownReference = reference?.visible && reference.opacity > 0 ? reference : null;
    if (shownReference && !shownReference.above) this.drawReference(shownReference, offsetX, offsetY, width, height, zoom);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.compositeCanvas(doc, reuseComposite), offsetX, offsetY, width, height);

    if (shownReference?.above) this.drawReference(shownReference, offsetX, offsetY, width, height, zoom);
    // Content can change while labels aren't shown; they're redrawn the next time they are.
    if (!reuseComposite) this.labelsStale = true;
    if (extrusions && zoom >= MIN_SHAPE_ZOOM) this.drawExtrusions(doc, extrusions, offsetX, offsetY, zoom, dpr);
    if (slice !== null && slice < doc.width) this.drawSlice(slice, offsetX, offsetY, height, zoom, dpr);
    if (doc.floating) this.drawFloatingOverhang(doc, doc.floating, offsetX, offsetY, width, height, zoom);
    // A float's outline shows all of it, including any part off the document.
    const outline = doc.floating ?? doc.selection;
    if (outline) this.drawSelection(outline, offsetX, offsetY, zoom, dpr);
    if (lasso) this.drawLasso(lasso, offsetX, offsetY, zoom, dpr);
    if (brush) this.drawBrush(brush, offsetX, offsetY, zoom, dpr);
  }

  /**
   * Floating pixels that hang off the document, at half their layer's
   * opacity, so it's clear they are kept. (Those on the document are already
   * in the layer.)
   */
  private drawFloatingOverhang(
    doc: PixelDocument,
    floating: FloatingPixels,
    offsetX: number,
    offsetY: number,
    docWidth: number,
    docHeight: number,
    zoom: number,
  ): void {
    const { rect } = floating;
    const layer = findLayer(doc, floating.layerId);
    const inside = rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= doc.width && rect.y + rect.height <= doc.height;
    if (inside || !layer?.visible) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.cssWidth, this.cssHeight);
    ctx.rect(offsetX, offsetY, docWidth, docHeight);
    ctx.clip('evenodd');
    ctx.globalAlpha = layer.opacity * FLOATING_OVERHANG_ALPHA;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.floatingCanvas(floating, doc.palette),
      offsetX + rect.x * zoom,
      offsetY + rect.y * zoom,
      rect.width * zoom,
      rect.height * zoom,
    );
    ctx.restore();
  }

  /** The float's pixels as an image, rebuilt only when its pixels or the palette change (moves share pixels). */
  private floatingCanvas(floating: FloatingPixels, palette: Palette): HTMLCanvasElement {
    const cached = this.floatingImage;
    if (cached?.pixels === floating.pixels && cached.palette === palette) return cached.canvas;
    const { width, height } = floating.rect;
    const canvas = cached?.canvas ?? document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = get2dContext(canvas);
    const image = ctx.createImageData(width, height);
    floating.pixels.forEach((index, i) => {
      const color = colorForIndex(palette, index);
      image.data.set([red(color), green(color), blue(color), alpha(color)], i * 4);
    });
    ctx.putImageData(image, 0, 0);
    this.floatingImage = { pixels: floating.pixels, palette, canvas };
    return canvas;
  }

  /**
   * The brush footprint's border, one device pixel outside it so the pixels
   * under the brush stay visible. Finer dashes than the selection, so the
   * two don't blend together.
   */
  private drawBrush({ x, y, mask }: BrushCursor, offsetX: number, offsetY: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    const deviceX = (docX: number) => Math.round((offsetX + (x + docX) * zoom) * dpr);
    const deviceY = (docY: number) => Math.round((offsetY + (y + docY) * zoom) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const run of mask.outline) traceRun(ctx, run, deviceX, deviceY, 'outside');
    ctx.lineWidth = 1;
    ctx.strokeStyle = SELECTION_LIGHT;
    ctx.stroke();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = SELECTION_DARK;
    ctx.stroke();
    ctx.restore();
  }

  /** A tinted band over one column, edged one device pixel inside it. */
  private drawSlice(column: number, offsetX: number, offsetY: number, height: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    const left = Math.round((offsetX + column * zoom) * dpr);
    const right = Math.round((offsetX + (column + 1) * zoom) * dpr);
    const top = Math.round(offsetY * dpr);
    const bottom = Math.round((offsetY + height) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SLICE_FILL;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.strokeStyle = SLICE_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);
    ctx.restore();
  }

  /**
   * The cut-off corners of diagonal pixels, and with `depths` each painted
   * pixel's depth in its middle and its offset in the corner when it isn't 0.
   * Text is slow to draw, so this is kept as an image until the content,
   * layer or view changes.
   */
  private drawExtrusions(
    doc: PixelDocument,
    { layer, depths }: { layer: Layer; depths: boolean },
    offsetX: number,
    offsetY: number,
    zoom: number,
    dpr: number,
  ): void {
    const { width, height } = this.canvas;
    const key = `${offsetX},${offsetY},${zoom},${width},${height},${depths}`;
    let cache = this.labels;
    if (!cache || this.labelsStale || cache.key !== key || cache.layer !== layer) {
      const canvas = cache?.canvas ?? document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const labels = depths && zoom >= MIN_LABEL_ZOOM;
      paintExtrusions(get2dContext(canvas), doc, layer, offsetX * dpr, offsetY * dpr, zoom * dpr, labels);
      cache = this.labels = { canvas, key, layer };
      this.labelsStale = false;
    }
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.canvas, 0, 0);
    ctx.restore();
  }

  /** The reference, clipped to the document area so it never spills over the stage. */
  private drawReference(
    reference: ReferenceImage,
    offsetX: number,
    offsetY: number,
    docWidth: number,
    docHeight: number,
    zoom: number,
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, docWidth, docHeight);
    ctx.clip();
    ctx.globalAlpha = reference.opacity;
    ctx.imageSmoothingEnabled = reference.smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      reference.bitmap,
      offsetX + reference.x * zoom,
      offsetY + reference.y * zoom,
      reference.width * reference.scale * zoom,
      reference.height * reference.scale * zoom,
    );
    ctx.restore();
  }

  /** Black-and-white striped outline just inside the selection's pixel edges, one device pixel wide. */
  private drawSelection(selection: Mask, offsetX: number, offsetY: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    const { rect } = selection;
    const deviceX = (x: number) => Math.round((offsetX + (rect.x + x) * zoom) * dpr);
    const deviceY = (y: number) => Math.round((offsetY + (rect.y + y) * zoom) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const run of this.outline(selection)) traceRun(ctx, run, deviceX, deviceY, 'inside');
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.ants;
    ctx.stroke();
    ctx.restore();
  }

  /** A mask's border. Kept per `bits` array, which moves share, so dragging a float doesn't recompute it. */
  private outline(mask: Mask): readonly OutlineRun[] {
    if (!mask.bits) return maskOutline(mask);
    let runs = this.outlines.get(mask.bits);
    if (!runs) {
      runs = maskOutline(mask);
      this.outlines.set(mask.bits, runs);
    }
    return runs;
  }

  /** The path of a lasso being drawn, through the centers of its pixels. */
  private drawLasso(points: readonly Point[], offsetX: number, offsetY: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const { x, y } of points) {
      // +0.5 keeps horizontal and vertical stretches on whole device pixels.
      ctx.lineTo(Math.round((offsetX + (x + 0.5) * zoom) * dpr) + 0.5, Math.round((offsetY + (y + 0.5) * zoom) * dpr) + 0.5);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.ants;
    ctx.stroke();
    ctx.restore();
  }

  /** The visible layers flattened at native size. Recomposited unless `reuse` and the size is unchanged. */
  private compositeCanvas(doc: PixelDocument, reuse: boolean): HTMLCanvasElement {
    if (this.imageData?.width !== doc.width || this.imageData.height !== doc.height) {
      this.docCanvas.width = doc.width;
      this.docCanvas.height = doc.height;
      this.imageData = this.docCtx.createImageData(doc.width, doc.height);
    } else if (reuse) {
      return this.docCanvas;
    }
    compositeRgba(doc, this.imageData.data);
    this.docCtx.putImageData(this.imageData, 0, 0);
    return this.docCanvas;
  }
}

/**
 * Draws the extrusions of the pixels in view onto a transparent canvas the
 * size of the screen canvas: shapes, then (with `labels`) depth labels.
 * Coordinates and `scale` (device px per document pixel) are in device
 * pixels.
 */
function paintExtrusions(
  ctx: CanvasRenderingContext2D,
  doc: PixelDocument,
  layer: Layer,
  originX: number,
  originY: number,
  scale: number,
  labels: boolean,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const left = Math.max(0, Math.floor(-originX / scale));
  const right = Math.min(doc.width, Math.ceil((width - originX) / scale));
  const top = Math.max(0, Math.floor(-originY / scale));
  const bottom = Math.min(doc.height, Math.ceil((height - originY) / scale));

  // Diagonal pixels: shade the corner each cuts off and mark the cut. The
  // corners of a pixel go clockwise from the top left, the order of shapes.
  const shade = new Path2D();
  const cuts = new Path2D();
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = y * doc.width + x;
      const shape = extrusionShape(layer.extrusion[offset]);
      if (shape === SQUARE || layer.pixels[offset] === TRANSPARENT) continue;
      const px = Math.round(originX + x * scale);
      const py = Math.round(originY + y * scale);
      const size = Math.round(originX + (x + 1) * scale) - px;
      const corners = [
        [px, py],
        [px + size, py],
        [px + size, py + size],
        [px, py + size],
      ];
      const [cut, next, , previous] = [0, 1, 2, 3].map((k) => corners[(shape - 1 + k) % 4]);
      shade.moveTo(cut[0], cut[1]);
      shade.lineTo(next[0], next[1]);
      shade.lineTo(previous[0], previous[1]);
      shade.closePath();
      cuts.moveTo(next[0], next[1]);
      cuts.lineTo(previous[0], previous[1]);
    }
  }
  ctx.fillStyle = CUT_SHADE;
  ctx.fill(shade);
  ctx.lineWidth = Math.max(1, Math.round(scale / 16));
  ctx.strokeStyle = CUT_EDGE;
  ctx.stroke(cuts);
  if (!labels) return;

  const depthFont = Math.round(scale * 0.42);
  const offsetFont = Math.round(scale * 0.28);
  const font = (size: number) => `600 ${size}px ui-monospace, 'Cascadia Mono', Consolas, monospace`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = LABEL_OUTLINE;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = y * doc.width + x;
      if (layer.pixels[offset] === TRANSPARENT) continue;
      const extrusion = layer.extrusion[offset];
      const px = originX + x * scale;
      const py = originY + y * scale;
      label(ctx, String(extrusionDepth(extrusion)), px + scale / 2, py + scale / 2, font(depthFont), depthFont, LABEL_DEPTH, 'center');
      const front = extrusionOffset(extrusion);
      if (front > 0) {
        const inset = Math.max(2, scale * 0.08);
        label(ctx, String(front), px + inset, py + inset + offsetFont / 2, font(offsetFont), offsetFont, LABEL_OFFSET, 'left');
      }
    }
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  size: number,
  color: string,
  align: CanvasTextAlign,
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 4);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

/** The checkerboard drawn behind transparent pixels. */
export function createChecker(ctx: CanvasRenderingContext2D): CanvasPattern {
  const tile = document.createElement('canvas');
  tile.width = tile.height = CHECKER_SIZE * 2;
  const tileCtx = get2dContext(tile);
  tileCtx.fillStyle = CHECKER_LIGHT;
  tileCtx.fillRect(0, 0, tile.width, tile.height);
  tileCtx.fillStyle = CHECKER_DARK;
  tileCtx.fillRect(CHECKER_SIZE, 0, CHECKER_SIZE, CHECKER_SIZE);
  tileCtx.fillRect(0, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) throw new Error('Could not create checkerboard pattern');
  return pattern;
}

/**
 * Stripes for the selection outline. Unlike a dash pattern, they're fixed to
 * the canvas, so they stay even across corners and the many short runs of a
 * jagged outline.
 */
function createAnts(ctx: CanvasRenderingContext2D): CanvasPattern {
  const tile = document.createElement('canvas');
  tile.width = tile.height = ANTS_PERIOD;
  const tileCtx = get2dContext(tile);
  tileCtx.fillStyle = SELECTION_LIGHT;
  tileCtx.fillRect(0, 0, ANTS_PERIOD, ANTS_PERIOD);
  tileCtx.fillStyle = SELECTION_DARK;
  for (let y = 0; y < ANTS_PERIOD; y++) {
    for (let x = 0; x < ANTS_PERIOD; x++) {
      if ((x + y) % ANTS_PERIOD < ANTS_PERIOD / 2) tileCtx.fillRect(x, y, 1, 1);
    }
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) throw new Error('Could not create selection pattern');
  return pattern;
}

/**
 * Adds an outline run to the current path (in device pixels) as a
 * one-device-pixel line just inside or outside the pixels' edge. The line
 * reaches one device pixel past an end where the corner would otherwise be
 * left open: convex corners for lines outside, concave ones for lines
 * inside.
 */
function traceRun(
  ctx: CanvasRenderingContext2D,
  run: OutlineRun,
  deviceX: (x: number) => number,
  deviceY: (y: number) => number,
  side: 'inside' | 'outside',
): void {
  const outside = side === 'outside';
  const shift = (outside ? run.out : -run.out) * 0.5;
  const before = outside !== run.concaveFrom ? 1 : 0;
  const after = outside !== run.concaveTo ? 1 : 0;
  if (run.horizontal) {
    const y = deviceY(run.at) + shift;
    ctx.moveTo(deviceX(run.from) - before, y);
    ctx.lineTo(deviceX(run.to) + after, y);
  } else {
    const x = deviceX(run.at) + shift;
    ctx.moveTo(x, deviceY(run.from) - before);
    ctx.lineTo(x, deviceY(run.to) + after);
  }
}
