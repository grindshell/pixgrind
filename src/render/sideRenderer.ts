import { alpha, blue, green, red } from '../core/color.ts';
import { extrusionEnd, extrusionOffset, MAX_Z } from '../core/extrusion.ts';
import type { Layer } from '../core/layer.ts';
import { pixelRuns, seenFromRight, type Run, type VoxelModel } from '../core/model.ts';
import { colorForIndex, TRANSPARENT, type Palette } from '../core/palette.ts';
import type { PixelDocument } from '../core/pixelDocument.ts';
import { createChecker, get2dContext } from './canvasRenderer.ts';

/** The rest of the model, seen from the side behind the column, is drawn this faint. */
const PROJECTION_ALPHA = 0.25;
const GRID = 'rgba(255, 255, 255, 0.06)';
const PLANE = 'rgba(91, 140, 255, 0.9)';
const ACTIVE_OUTLINE = 'rgba(157, 187, 255, 0.95)';
/** Depth cells shown past the deepest box, so there's room to paint deeper. */
const SPARE_DEPTH = 8;
const MIN_DEPTH_SHOWN = 16;
/** Grid lines need this much zoom to be worth drawing. */
const MIN_GRID_ZOOM = 6;

/** Everything a side view render needs. */
export interface SideScene {
  doc: PixelDocument;
  /** The whole model, for the faint projection. May lag behind `doc` while it's being edited. */
  model: VoxelModel;
  /** Changes whenever the document's content may have, so cached images are redrawn. */
  version: number;
  /** The document column shown. */
  column: number;
  /** Its boxes in this column are outlined: they're what painting changes. Null to skip. */
  activeLayer: Layer | null;
  /** CSS px per cell; the same as the canvas's zoom, so rows line up with it. */
  zoom: number;
  /** Screen position (CSS px) of depth 0's left edge. */
  offsetX: number;
  /** Screen position (CSS px) of row 0's top edge; the canvas's, so rows line up with it. */
  offsetY: number;
  /** Cell under the pointer, outlined. */
  hover: { z: number; y: number } | null;
}

/**
 * Draws one column of the model from the side: depth runs left to right
 * from the picture plane, rows top to bottom as on the canvas. Looking from
 * the right, the front of the model is on the left. The rest of the model
 * shows faintly behind it.
 */
export class SideRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly checker: CanvasPattern;
  private cssWidth = 1;
  private cssHeight = 1;
  private projection: { model: VoxelModel; extent: number; canvas: HTMLCanvasElement } | null = null;
  private slice: SliceRuns | null = null;
  /** Reused for each new slice image. */
  private sliceImage: HTMLCanvasElement | null = null;

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
    const { doc, zoom } = scene;
    const dpr = this.canvas.width / this.cssWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    const offsetX = Math.round(scene.offsetX * dpr) / dpr;
    const offsetY = Math.round(scene.offsetY * dpr) / dpr;
    const slice = this.sliceRuns(scene);
    // Depth cells shown: past the deepest box, with room to paint deeper.
    const extent = Math.min(MAX_Z, Math.max(MIN_DEPTH_SHOWN, Math.max(scene.model.depth, slice.end) + SPARE_DEPTH));
    const width = extent * zoom;
    const height = doc.height * zoom;

    this.checker.setTransform(new DOMMatrix().translateSelf(offsetX, offsetY));
    ctx.fillStyle = this.checker;
    ctx.fillRect(offsetX, offsetY, width, height);

    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = PROJECTION_ALPHA;
    ctx.drawImage(this.projectionCanvas(scene.model, doc.palette, extent), offsetX, offsetY, width, height);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.sliceCanvas(slice, doc.palette, extent), offsetX, offsetY, width, height);

    const deviceX = (z: number) => Math.round((offsetX + z * zoom) * dpr);
    const deviceY = (y: number) => Math.round((offsetY + y * zoom) * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (zoom >= MIN_GRID_ZOOM) this.drawGrid(extent, doc.height, deviceX, deviceY);
    if (scene.activeLayer) this.drawActiveBoxes(scene, deviceX, deviceY);
    // The picture plane: where depth 0 starts.
    ctx.fillStyle = PLANE;
    ctx.fillRect(deviceX(0) - 1, deviceY(0), 2, deviceY(doc.height) - deviceY(0));
    if (scene.hover && scene.hover.y >= 0 && scene.hover.y < doc.height && scene.hover.z >= 0) {
      const { z, y } = scene.hover;
      const left = deviceX(z);
      const top = deviceY(y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000000';
      ctx.strokeRect(left - 0.5, top - 0.5, deviceX(z + 1) - left + 1, deviceY(y + 1) - top + 1);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(left + 0.5, top + 0.5, deviceX(z + 1) - left - 1, deviceY(y + 1) - top - 1);
    }
    ctx.restore();
  }

  private drawGrid(extent: number, rows: number, deviceX: (z: number) => number, deviceY: (y: number) => number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let z = 1; z < extent; z++) {
      ctx.moveTo(deviceX(z) + 0.5, deviceY(0));
      ctx.lineTo(deviceX(z) + 0.5, deviceY(rows));
    }
    for (let y = 1; y < rows; y++) {
      ctx.moveTo(deviceX(0), deviceY(y) + 0.5);
      ctx.lineTo(deviceX(extent), deviceY(y) + 0.5);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.stroke();
  }

  /** Outlines the active layer's box in each row of the column, which may be partly hidden by other layers'. */
  private drawActiveBoxes(scene: SideScene, deviceX: (z: number) => number, deviceY: (y: number) => number): void {
    const { ctx } = this;
    const { doc, column } = scene;
    const layer = scene.activeLayer;
    if (!layer || column >= doc.width) return;
    ctx.beginPath();
    for (let y = 0; y < doc.height; y++) {
      const offset = y * doc.width + column;
      if (layer.pixels[offset] === TRANSPARENT) continue;
      const extrusion = layer.extrusion[offset];
      const left = deviceX(extrusionOffset(extrusion));
      const top = deviceY(y);
      ctx.rect(left + 0.5, top + 0.5, deviceX(extrusionEnd(extrusion)) - left - 1, deviceY(y + 1) - top - 1);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = ACTIVE_OUTLINE;
    ctx.stroke();
  }

  /** The whole model seen from the right, two image pixels per cell (its halves). Rebuilt when the model changes. */
  private projectionCanvas(model: VoxelModel, palette: Palette, extent: number): HTMLCanvasElement {
    const cached = this.projection;
    if (cached?.model === model && cached.extent === extent) return cached.canvas;
    const canvas = cached?.canvas ?? document.createElement('canvas');
    const { width, height, columns } = model;
    const image = new ImageData(extent, height * 2);
    for (let y = 0; y < height; y++) {
      // Left to right, so the rightmost box (nearest a viewer on the right) wins.
      for (let x = 0; x < width; x++) {
        const runs = columns[y * width + x];
        if (runs) for (const run of runs) fillRun(image, y, run, extent, palette);
      }
    }
    putImage(canvas, image);
    this.projection = { model, extent, canvas };
    return canvas;
  }

  /** The column's runs per row, and how deep they reach. Recomputed when the content or column changes. */
  private sliceRuns({ doc, column, version }: SideScene): SliceRuns {
    const key = `${version},${column}`;
    if (this.slice?.key === key) return this.slice;
    const rows = Array.from({ length: doc.height }, (_, y) => (column < doc.width ? pixelRuns(doc, column, y) : undefined));
    const end = Math.max(0, ...rows.map((runs) => runs?.[runs.length - 1].end ?? 0));
    this.slice = { key, rows, end, image: null };
    return this.slice;
  }

  /** The column's boxes, two image pixels per cell (its halves). */
  private sliceCanvas(slice: SliceRuns, palette: Palette, extent: number): HTMLCanvasElement {
    if (slice.image?.extent === extent) return slice.image.canvas;
    const canvas = slice.image?.canvas ?? this.sliceImage ?? document.createElement('canvas');
    const image = new ImageData(extent, slice.rows.length * 2);
    slice.rows.forEach((runs, y) => {
      if (runs) for (const run of runs) fillRun(image, y, run, extent, palette);
    });
    putImage(canvas, image);
    this.sliceImage = canvas;
    slice.image = { extent, canvas };
    return canvas;
  }
}

/** One column's runs, cached with the image drawn from them. */
interface SliceRuns {
  key: string;
  rows: ReadonlyArray<readonly Run[] | undefined>;
  end: number;
  image: { extent: number; canvas: HTMLCanvasElement } | null;
}

/**
 * Draws a run of row y into an image with two rows per document row: each
 * half shows what a viewer on the right sees there, which differs only for
 * diagonal pixels.
 */
function fillRun(image: ImageData, y: number, run: Run, extent: number, palette: Palette): void {
  for (const upper of [true, false]) {
    const index = seenFromRight(run.quarters, upper);
    if (!index) continue;
    const color = colorForIndex(palette, index);
    const row = y * 2 + (upper ? 0 : 1);
    for (let z = run.start; z < Math.min(run.end, extent); z++) {
      const o = (row * image.width + z) * 4;
      image.data[o] = red(color);
      image.data[o + 1] = green(color);
      image.data[o + 2] = blue(color);
      image.data[o + 3] = alpha(color);
    }
  }
}

function putImage(canvas: HTMLCanvasElement, image: ImageData): void {
  canvas.width = image.width;
  canvas.height = image.height;
  get2dContext(canvas).putImageData(image, 0, 0);
}
