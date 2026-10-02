import type { BrushMask } from '../core/brush.ts';
import { alpha, blue, green, red } from '../core/color.ts';
import { compositeRgba } from '../core/composite.ts';
import { maskOutline, type Mask, type OutlineRun } from '../core/mask.ts';
import { colorForIndex, type Palette } from '../core/palette.ts';
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
   * floating pixels off the document, the selection outline, a lasso being
   * drawn, then the brush outline.
   */
  render(
    doc: PixelDocument,
    viewport: Viewport,
    { reference = null, brush = null, lasso = null }: RenderOverlays = {},
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
    ctx.drawImage(this.compositeCanvas(doc), offsetX, offsetY, width, height);

    if (shownReference?.above) this.drawReference(shownReference, offsetX, offsetY, width, height, zoom);
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

  private compositeCanvas(doc: PixelDocument): HTMLCanvasElement {
    if (this.imageData?.width !== doc.width || this.imageData.height !== doc.height) {
      this.docCanvas.width = doc.width;
      this.docCanvas.height = doc.height;
      this.imageData = this.docCtx.createImageData(doc.width, doc.height);
    }
    compositeRgba(doc, this.imageData.data);
    this.docCtx.putImageData(this.imageData, 0, 0);
    return this.docCanvas;
  }
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx;
}

function createChecker(ctx: CanvasRenderingContext2D): CanvasPattern {
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
