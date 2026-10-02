import { compositeRgba } from '../core/composite.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import type { Viewport } from './viewport.ts';

const CHECKER_SIZE = 8;
const CHECKER_LIGHT = '#3a3a44';
const CHECKER_DARK = '#2e2e37';

/** Draws a document onto a screen canvas: checkerboard backdrop, then the layer composite. */
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

  /** Matches the backing store to the canvas's CSS size and device pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  render(doc: PixelDocument, viewport: Viewport): void {
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

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.compositeCanvas(doc), offsetX, offsetY, width, height);
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
