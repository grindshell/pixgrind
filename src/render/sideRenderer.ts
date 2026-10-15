import { extrusionEnd, extrusionOffset } from '../core/extrusion.ts';
import { facingFrame, oppositeDirection, planeExtent, planeSize, type Axis, type Facing } from '../core/facing.ts';
import type { Layer } from '../core/layer.ts';
import { seenFrom, sliceOf, viewModel, type Slice, type VoxelModel } from '../core/model.ts';
import { clonePalette, palettesEqual, TRANSPARENT, type Palette } from '../core/palette.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import { createChecker, get2dContext, indexImageData } from './canvasRenderer.ts';

/** The rest of the model, seen from the side behind the column, is drawn this faint. */
const PROJECTION_ALPHA = 0.25;
const GRID = 'rgba(255, 255, 255, 0.06)';
const WALL = 'rgba(91, 140, 255, 0.9)';
const ACTIVE_OUTLINE = 'rgba(157, 187, 255, 0.95)';
/** Grid lines need this much zoom to be worth drawing. */
const MIN_GRID_ZOOM = 6;

/** A cell of the side view: `s` cells from its left edge (the camera's side), in row `v`. */
export interface SideCell {
  s: number;
  v: number;
}

/** Everything a side view render needs. */
export interface SideScene {
  doc: PixelDocument;
  /** The side being edited; the view looks at one of its columns from its right. */
  facing: Facing;
  /** The whole model, for the faint projection. May lag behind `doc` while it's being edited. */
  model: VoxelModel;
  /** Changes whenever the document's content may have, so cached images are redrawn. */
  version: number;
  /** The plane column shown. */
  column: number;
  /** Its boxes in this column are outlined: they're what painting changes. Null to skip. */
  activeLayer: Layer | null;
  /** CSS px per cell; the same as the canvas's zoom, so rows line up with it. */
  zoom: number;
  /** Screen position (CSS px) of the left edge, the camera's side. */
  offsetX: number;
  /** Screen position (CSS px) of row 0's top edge; the canvas's, so rows line up with it. */
  offsetY: number;
  /** Cell under the pointer, outlined. */
  hover: SideCell | null;
}

/**
 * Draws one column of a side's plane from that side's right: rows top to
 * bottom as on the canvas, and depth left to right from the camera's side
 * to the far side the boxes grow from (so seen from the front's right, the
 * front is on the left). The rest of the model shows faintly behind it.
 */
export class SideRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly checker: CanvasPattern;
  private cssWidth = 1;
  private cssHeight = 1;
  private projection: { model: VoxelModel; facing: Facing; palette: Palette; canvas: HTMLCanvasElement } | null = null;
  private slice: { key: string; slice: Slice; canvas: HTMLCanvasElement } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = get2dContext(canvas);
    this.checker = createChecker(this.ctx);
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  render(scene: SideScene): void {
    const { ctx } = this;
    const { doc, facing, zoom } = scene;
    const dpr = this.canvas.width / this.cssWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const offsetX = Math.round(scene.offsetX * dpr) / dpr;
    const offsetY = Math.round(scene.offsetY * dpr) / dpr;
    const extent = planeExtent(doc, facing);
    const rows = planeSize(doc, facing).height;
    const width = extent * zoom;
    const height = rows * zoom;

    this.checker.setTransform(new DOMMatrix().translateSelf(offsetX, offsetY));
    ctx.fillStyle = this.checker;
    ctx.fillRect(offsetX, offsetY, width, height);

    ctx.imageSmoothingEnabled = false;
    const projection = this.projectionCanvas(scene.model, facing, doc.palette);
    // The projection is the model's size; it matches only once the model has caught up with a resize.
    if (projection.width === extent && projection.height === rows * 2) {
      ctx.globalAlpha = PROJECTION_ALPHA;
      ctx.drawImage(projection, offsetX, offsetY, width, height);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.sliceCanvas(scene), offsetX, offsetY, width, height);

    const deviceX = (s: number) => Math.round((offsetX + s * zoom) * dpr);
    const deviceY = (v: number) => Math.round((offsetY + v * zoom) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (zoom >= MIN_GRID_ZOOM) this.drawGrid(extent, rows, deviceX, deviceY);
    if (scene.activeLayer) this.drawActiveBoxes(scene, extent, deviceX, deviceY);
    // The far side, which boxes grow from.
    ctx.fillStyle = WALL;
    ctx.fillRect(deviceX(extent) - 1, deviceY(0), 2, deviceY(rows) - deviceY(0));
    const { hover } = scene;
    if (hover && hover.v >= 0 && hover.v < rows && hover.s >= 0 && hover.s < extent) {
      const left = deviceX(hover.s);
      const top = deviceY(hover.v);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(left - 0.5, top - 0.5, deviceX(hover.s + 1) - left + 1, deviceY(hover.v + 1) - top + 1);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(left + 0.5, top + 0.5, deviceX(hover.s + 1) - left - 1, deviceY(hover.v + 1) - top - 1);
    }
    ctx.restore();
  }

  private drawGrid(extent: number, rows: number, deviceX: (s: number) => number, deviceY: (v: number) => number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let s = 1; s < extent; s++) {
      ctx.moveTo(deviceX(s) + 0.5, deviceY(0));
      ctx.lineTo(deviceX(s) + 0.5, deviceY(rows));
    }
    for (let v = 1; v < rows; v++) {
      ctx.moveTo(deviceX(0), deviceY(v) + 0.5);
      ctx.lineTo(deviceX(extent), deviceY(v) + 0.5);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.stroke();
  }

  /** Outlines the active layer's box in each row of the column, which may be partly hidden by other layers'. */
  private drawActiveBoxes(
    { activeLayer: layer, column }: SideScene,
    extent: number,
    deviceX: (s: number) => number,
    deviceY: (v: number) => number,
  ): void {
    const { ctx } = this;
    if (!layer || column >= layer.width) return;
    ctx.beginPath();
    for (let v = 0; v < layer.height; v++) {
      const offset = v * layer.width + column;
      if (layer.pixels[offset] === TRANSPARENT) continue;
      const extrusion = layer.extrusion[offset];
      // Cells counted from the far side; the view counts from the camera's.
      const left = deviceX(Math.max(0, extent - extrusionEnd(extrusion)));
      const right = deviceX(Math.max(0, extent - extrusionOffset(extrusion)));
      const top = deviceY(v);
      if (right > left) ctx.rect(left + 0.5, top + 0.5, right - left - 1, deviceY(v + 1) - top - 1);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = ACTIVE_OUTLINE;
    ctx.stroke();
  }

  /**
   * The whole model seen from the plane's right, two image pixels per cell
   * (its halves). Rebuilt when the model or the palette's colors change
   * (compared by content: color previews change the palette in place).
   */
  private projectionCanvas(model: VoxelModel, facing: Facing, palette: Palette): HTMLCanvasElement {
    const cached = this.projection;
    if (cached?.model === model && cached.facing === facing && palettesEqual(cached.palette, palette)) return cached.canvas;
    const { right, down, toward } = facingFrame(facing);
    const canvas = cached?.canvas ?? document.createElement('canvas');
    putImage(canvas, indexImageData(viewModel(model, right, oppositeDirection(toward), down), palette));
    this.projection = { model, facing, palette: clonePalette(palette), canvas };
    return canvas;
  }

  /** The column's voxels, two image pixels per cell (its halves). Recomputed when the content or column changes. */
  private sliceCanvas({ doc, facing, column, version }: SideScene): HTMLCanvasElement {
    const key = `${version},${facing},${column}`;
    if (this.slice?.key === key) return this.slice.canvas;
    const slice = sliceOf(doc, facing, column);
    const { right, down } = facingFrame(facing);
    const up = oppositeDirection(down);
    const { width, height } = slice;
    const pixels = new Uint8Array(width * height * 2);
    for (let v = 0; v < height; v++) {
      for (let w = 0; w < width; w++) {
        const quarters = slice.quarters[v * width + w];
        if (!quarters) continue;
        const content = { axis: slice.axes[v * width + w] as Axis, quarters };
        // The camera's side is on the left.
        const s = width - 1 - w;
        pixels[v * 2 * width + s] = seenFrom(content, right, up, true);
        pixels[(v * 2 + 1) * width + s] = seenFrom(content, right, up, false);
      }
    }
    const canvas = this.slice?.canvas ?? document.createElement('canvas');
    putImage(canvas, indexImageData({ width, height: height * 2, pixels }, doc.palette));
    this.slice = { key, slice, canvas };
    return canvas;
  }
}

function putImage(canvas: HTMLCanvasElement, image: ImageData): void {
  canvas.width = image.width;
  canvas.height = image.height;
  get2dContext(canvas).putImageData(image, 0, 0);
}
