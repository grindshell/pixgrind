import type { BrushMask } from '../core/brush.ts';
import { compositeRgba } from '../core/composite.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import type { Point } from '../core/raster.ts';
import type { Rect } from '../core/rect.ts';
import type { ReferenceImage } from './referenceImage.ts';
import type { Viewport } from './viewport.ts';

const CHECKER_SIZE = 8;
const CHECKER_LIGHT = '#3a3a44';
const CHECKER_DARK = '#2e2e37';
const SELECTION_LIGHT = '#ffffff';
const SELECTION_DARK = '#000000';

/** The brush footprint at a document pixel (the one under the pointer). */
export interface BrushCursor extends Point {
  mask: BrushMask;
}

/** Things drawn with the artwork that aren't part of the document. */
export interface RenderOverlays {
  reference?: ReferenceImage | null;
  brush?: BrushCursor | null;
}

/** Draws a document onto a screen canvas: checkerboard backdrop, reference image, layer composite, selection. */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Holds the composite at native resolution; scaled onto the screen canvas. */
  private readonly docCanvas: HTMLCanvasElement;
  private readonly docCtx: CanvasRenderingContext2D;
  private readonly checker: CanvasPattern;
  private imageData: ImageData | null = null;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = get2dContext(canvas);
    this.docCanvas = document.createElement('canvas');
    this.docCtx = get2dContext(this.docCanvas);
    this.checker = createChecker(this.ctx);
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
   * the selection outline, then the brush outline.
   */
  render(doc: PixelDocument, viewport: Viewport, { reference = null, brush = null }: RenderOverlays = {}): void {
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
    if (doc.selection) this.drawSelection(doc.selection, offsetX, offsetY, zoom, dpr);
    if (brush) this.drawBrush(brush, offsetX, offsetY, zoom, dpr);
  }

  /**
   * The brush footprint's border, one device pixel outside it so the pixels
   * under the brush stay visible. Same dashed black-on-white as the selection.
   */
  private drawBrush({ x, y, mask }: BrushCursor, offsetX: number, offsetY: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    const deviceX = (docX: number) => Math.round((offsetX + (x + docX) * zoom) * dpr);
    const deviceY = (docY: number) => Math.round((offsetY + (y + docY) * zoom) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const run of mask.outline) {
      // Runs reach one device pixel past each end, so convex corners close.
      if (run.horizontal) {
        const lineY = deviceY(run.at) + run.out * 0.5;
        ctx.moveTo(deviceX(run.from) - 1, lineY);
        ctx.lineTo(deviceX(run.to) + 1, lineY);
      } else {
        const lineX = deviceX(run.at) + run.out * 0.5;
        ctx.moveTo(lineX, deviceY(run.from) - 1);
        ctx.lineTo(lineX, deviceY(run.to) + 1);
      }
    }
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

  /** Dashed black-on-white outline along the selection's pixel edges, one device pixel wide. */
  private drawSelection(selection: Rect, offsetX: number, offsetY: number, zoom: number, dpr: number): void {
    const { ctx } = this;
    // Work in device pixels; +0.5 centers the 1px line on a pixel row so it stays sharp.
    const left = Math.round((offsetX + selection.x * zoom) * dpr) + 0.5;
    const top = Math.round((offsetY + selection.y * zoom) * dpr) + 0.5;
    const right = Math.round((offsetX + (selection.x + selection.width) * zoom) * dpr) - 0.5;
    const bottom = Math.round((offsetY + (selection.y + selection.height) * zoom) * dpr) - 0.5;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = SELECTION_LIGHT;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = SELECTION_DARK;
    ctx.strokeRect(left, top, right - left, bottom - top);
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
