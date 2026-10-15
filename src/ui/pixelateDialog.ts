import { alpha, blue, green, red, toHex } from '../core/color.ts';
import type { RgbaImage } from '../core/image.ts';
import { BUILTIN_PALETTES, MAX_PALETTE_COLORS, type Palette } from '../core/palette.ts';
import { createPixelator, type PixelatedImage, type Pixelator, type Sampling } from '../core/pixelate.ts';
import { MAX_DOCUMENT_SIZE } from '../core/pixelDocument.ts';
import type { Dither } from '../core/quantize.ts';
import { placedRegion, type ReferencePlacement } from '../core/referencePlacement.ts';
import type { SourceRegion } from '../core/resample.ts';
import { decodeImageWithin } from '../io/imageCodec.ts';
import type { PaletteLibrary, SavedPalette } from '../io/paletteLibrary.ts';
import { checkbox, el, fieldRow, numberField, option, slider, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { addPixelatedLayer, openPixelatedImage } from './fileCommands.ts';
import { adaptiveThrottle } from './throttle.ts';

const SAMPLINGS: Record<Sampling, { label: string; note: string }> = {
  average: {
    label: 'Average',
    note: "Each pixel blends its patch of the image. Smooth; best for photos.",
  },
  dominant: {
    label: 'Dominant color',
    note: 'Each pixel takes the palette color covering most of its patch. Crisp edges and no blended colors, but small details can vanish.',
  },
  nearest: {
    label: 'Center pixel',
    note: "Each pixel takes the image pixel at its patch's center. Sharp but noisy; shrinks enlarged pixel art back exactly.",
  },
};

const DITHERS: Record<Dither, string> = {
  none: 'None',
  ordered: 'Ordered (Bayer)',
  diffusion: 'Error diffusion (Floyd–Steinberg)',
};

/** What the dialog starts with, and then remembers between images. */
interface Settings {
  /** The result's longer side, when the image is that large. */
  longSide: number;
  keepProportions: boolean;
  sampling: Sampling;
  /** `generate`, `current`, `builtin:<index>` or `saved:<id>`. */
  palette: string;
  colorCount: number;
  dither: Dither;
  /** 0–1. */
  ditherStrength: number;
}

const DEFAULT_SETTINGS: Settings = {
  longSide: 64,
  keepProportions: true,
  sampling: 'average',
  palette: 'generate',
  colorCount: 16,
  dither: 'none',
  ditherStrength: 0.5,
};

/** Size slider resolution. Its scale is logarithmic, so small sizes get as much travel as large ones. */
const SIZE_STEPS = 1000;
/** The size slider's smallest longer side (unless the image is smaller). */
const MIN_SLIDER_SIZE = 8;
/** The original's preview is drawn at most this large. */
const PREVIEW_SIZE = 1024;
/** Images no larger than this show crisp (pixelated) in the preview, as they're likely pixel art. */
const CRISP_PREVIEW_SIZE = 256;

/** Images with more pixels are shrunk smoothly first: still 4× the largest document across, and quicker. */
const MAX_SOURCE_PIXELS = 4096 * 4096;

/** An image being pixelated. */
interface PixelateSource {
  /** For the document or layer it becomes. */
  name: string;
  /** Its pixels, maybe shrunk (see `MAX_SOURCE_PIXELS`). */
  image: RgbaImage;
  /** Its size as stored. */
  width: number;
  height: number;
  placement?: ReferencePlacement;
}

export interface PixelateOpenOptions {
  /** Why the dialog opened, e.g. that the image was too large to open as is. */
  note?: string;
  /** Where the image sits on the canvas, for a reference image: it can be pixelated right there. */
  placement?: ReferencePlacement;
}

export interface PixelateDialog {
  element: HTMLDialogElement;
  /**
   * Decodes an image file (or a reference's) and shows the dialog for it.
   * Resolves once it closes: to a status message when the result was opened
   * or added, null when cancelled. Rejects when the image can't be read.
   */
  open(file: Blob, name: string, options?: PixelateOpenOptions): Promise<string | null>;
}

/**
 * Turns an image into pixel art: choose the size, how pixels sample the
 * image, the colors (a palette, or generated from the image) and dithering,
 * with a live preview beside the original. The result opens as a new image
 * or is added as a layer on the side being edited. A reference image can
 * also be pixelated where it sits on the canvas, at the canvas's size.
 */
export function createPixelateDialog(editor: Editor, library: PaletteLibrary): PixelateDialog {
  const settings: Settings = { ...DEFAULT_SETTINGS };

  const dialog = el('dialog', 'dialog pixelate-dialog');
  dialog.setAttribute('aria-labelledby', 'pixelate-title');
  const title = el('h2', 'dialog-title');
  title.id = 'pixelate-title';
  title.textContent = 'Pixelate image';
  const subtitle = el('p', 'dialog-subtitle');
  const header = el('header', 'dialog-header');
  header.append(title, subtitle);
  const note = el('p', 'dialog-note');

  const originalCanvas = el('canvas', 'preview-canvas');
  originalCanvas.setAttribute('aria-label', 'Original image');
  const resultCanvas = el('canvas', 'preview-canvas is-pixelated');
  resultCanvas.setAttribute('aria-label', 'Pixelated preview');
  const originalCaption = el('figcaption', 'preview-caption');
  const resultCaption = el('figcaption', 'preview-caption');
  const previews = el('div', 'pixelate-previews');
  previews.append(figure(originalCanvas, originalCaption), figure(resultCanvas, resultCaption));

  /* ---- Size ---- */

  let source: PixelateSource | null = null;
  let width = 1;
  let height = 1;
  /** Width over height of the result, kept when the size changes with proportions kept or from the slider. */
  let aspect = 1;

  const sourceAspect = () => (source ? source.width / source.height : 1);
  // No larger than the image (as decoded) nor than a document.
  const maxWidth = () => Math.min(MAX_DOCUMENT_SIZE, source?.image.width ?? 1);
  const maxHeight = () => Math.min(MAX_DOCUMENT_SIZE, source?.image.height ?? 1);
  /** The longest the longer side can be at the current proportions. */
  const maxLongSide = () =>
    Math.max(1, Math.floor(aspect >= 1 ? Math.min(maxWidth(), maxHeight() * aspect) : Math.min(maxHeight(), maxWidth() / aspect)));
  const isPlaced = () => placed.input.checked && source?.placement !== undefined;

  /** Sets the size, within limits, without updating the preview. */
  const resize = (w: number, h: number) => {
    width = clamp(Math.round(w), 1, maxWidth());
    height = clamp(Math.round(h), 1, maxHeight());
  };
  const resizeToLongSide = (long: number) => {
    const side = Math.min(long, maxLongSide());
    if (aspect >= 1) resize(side, side / aspect);
    else resize(side * aspect, side);
  };
  const sizeChanged = () => {
    settings.longSide = Math.max(width, height);
    syncSize();
    schedule();
  };

  const placed = checkbox('Where it is on the canvas', () => {
    if (!isPlaced()) {
      if (keep.input.checked) aspect = sourceAspect();
      resizeToLongSide(settings.longSide);
    }
    syncSize();
    schedule();
  });
  placed.label.title = "Pixelate the part of the reference under the canvas, at the canvas's size, so it lines up as a layer";

  const sliderRange = (): [number, number] => {
    const max = maxLongSide();
    return [Math.min(MIN_SLIDER_SIZE, max), max];
  };
  const sizeSlider = slider('Size', 0, SIZE_STEPS, (step) => {
    const [min, max] = sliderRange();
    resizeToLongSide(Math.round(min * (max / min) ** (step / SIZE_STEPS)));
    sizeChanged();
  });
  const sliderStep = (size: number) => {
    const [min, max] = sliderRange();
    return max === min ? SIZE_STEPS : clamp(Math.round((Math.log(size / min) / Math.log(max / min)) * SIZE_STEPS), 0, SIZE_STEPS);
  };

  const widthField = numberField('W', 1, MAX_DOCUMENT_SIZE, (w) => {
    if (keep.input.checked) {
      const fitting = Math.min(w, maxHeight() * aspect);
      resize(fitting, fitting / aspect);
    } else {
      resize(w, height);
      aspect = width / height;
    }
    sizeChanged();
  });
  widthField.input.setAttribute('aria-label', 'Width');
  const heightField = numberField('H', 1, MAX_DOCUMENT_SIZE, (h) => {
    if (keep.input.checked) {
      const fitting = Math.min(h, maxWidth() / aspect);
      resize(fitting * aspect, fitting);
    } else {
      resize(width, h);
      aspect = width / height;
    }
    sizeChanged();
  });
  heightField.input.setAttribute('aria-label', 'Height');
  const times = el('span', 'field-label size-times');
  times.textContent = '×';

  const keep = checkbox('Keep proportions', (on) => {
    settings.keepProportions = on;
    if (on) {
      aspect = sourceAspect();
      resizeToLongSide(Math.max(width, height));
      sizeChanged();
    } else {
      aspect = width / height;
    }
  });
  const fitButton = textButton('Fit side', () => {
    if (!source) return;
    const plane = editor.plane;
    keep.input.checked = settings.keepProportions = true;
    aspect = sourceAspect();
    const scale = Math.min(plane.width / source.width, plane.height / source.height);
    resize(source.width * scale, source.height * scale);
    sizeChanged();
  });
  const cellNote = el('p', 'panel-note');

  const syncSize = () => {
    const fixed = isPlaced();
    if (fixed) ({ width, height } = editor.plane);
    for (const field of [widthField, heightField]) {
      const value = field === widthField ? width : height;
      field.set(value);
      // Committed values may have been clamped further; show what's used.
      field.input.value = String(value);
    }
    sizeSlider.set(sliderStep(Math.max(width, height)), String(Math.max(width, height)));
    for (const control of [sizeSlider.input, widthField.input, heightField.input, keep.input, fitButton]) control.disabled = fixed;
    fitButton.title = `Fit the side being edited (${editor.plane.width}×${editor.plane.height})`;
    if (!source) return;
    cellNote.textContent = fixed
      ? `The canvas's ${width}×${height} pixels, over the reference where it is.`
      : `Each pixel covers ${formatCell(source.width / width)}×${formatCell(source.height / height)} pixels of the image.`;
  };

  /** The part of the image to pixelate, in its decoded pixels: all of it unless placed. */
  const region = (): SourceRegion | undefined => {
    if (!source?.placement || !isPlaced()) return undefined;
    const r = placedRegion(source.placement, width, height);
    const fx = source.image.width / source.width;
    const fy = source.image.height / source.height;
    return { x: r.x * fx, y: r.y * fy, width: r.width * fx, height: r.height * fy };
  };

  /* ---- Sampling, colors, dithering ---- */

  const samplingSelect = el('select', 'select');
  samplingSelect.setAttribute('aria-label', 'Sampling');
  for (const [value, { label }] of Object.entries(SAMPLINGS)) samplingSelect.append(option(value, label));
  samplingSelect.addEventListener('change', () => {
    settings.sampling = samplingSelect.value as Sampling;
    syncControls();
    schedule();
  });
  const samplingNote = el('p', 'panel-note');

  let saved: SavedPalette[] = [];
  const paletteSelect = el('select', 'select');
  paletteSelect.setAttribute('aria-label', 'Palette');
  paletteSelect.addEventListener('change', () => {
    settings.palette = paletteSelect.value;
    syncControls();
    schedule();
  });
  const fillPalettes = () => {
    const builtins = el('optgroup');
    builtins.label = 'Built-in';
    builtins.append(...BUILTIN_PALETTES.map((p, i) => option(`builtin:${i}`, `${p.name} (${p.colors.length})`)));
    const mine = el('optgroup');
    mine.label = 'Saved';
    mine.append(...saved.map((p) => option(`saved:${p.id}`, `${p.name} (${p.colors.length})`)));
    paletteSelect.replaceChildren(
      option('generate', 'Generate from the image'),
      option('current', `Current palette (${editor.doc.palette.colors.length})`),
      builtins,
      ...(saved.length > 0 ? [mine] : []),
    );
    paletteSelect.value = settings.palette;
    if (paletteSelect.value !== settings.palette) paletteSelect.value = 'generate';
  };
  const chosenPalette = (): Palette | null => {
    const value = paletteSelect.value;
    if (value === 'current') return editor.doc.palette;
    if (value.startsWith('builtin:')) return BUILTIN_PALETTES[Number(value.slice('builtin:'.length))] ?? null;
    if (value.startsWith('saved:')) return saved.find((p) => p.id === value.slice('saved:'.length)) ?? null;
    return null;
  };
  const countField = numberField('Colors', 2, MAX_PALETTE_COLORS, (count) => {
    settings.colorCount = count;
    schedule();
  });
  countField.label.title = 'How many colors to pick from the image';
  const countRow = fieldRow(countField.label);
  const swatches = el('div', 'palette-strip');
  const colorsNote = el('p', 'panel-note');

  const ditherSelect = el('select', 'select');
  ditherSelect.setAttribute('aria-label', 'Dithering');
  for (const [value, label] of Object.entries(DITHERS)) ditherSelect.append(option(value, label));
  ditherSelect.addEventListener('change', () => {
    settings.dither = ditherSelect.value as Dither;
    syncControls();
    schedule();
  });
  const strength = slider('Strength', 0, 100, (value) => {
    settings.ditherStrength = value / 100;
    strength.set(value, `${value}%`);
    schedule();
  });
  const ditherNote = el('p', 'panel-note');

  const syncControls = () => {
    samplingSelect.value = settings.sampling;
    samplingNote.textContent = SAMPLINGS[settings.sampling].note;
    countRow.hidden = paletteSelect.value !== 'generate';
    countField.set(settings.colorCount);
    const dominant = settings.sampling === 'dominant';
    ditherSelect.value = settings.dither;
    ditherSelect.disabled = dominant;
    strength.row.hidden = dominant || settings.dither === 'none';
    strength.set(Math.round(settings.ditherStrength * 100), `${Math.round(settings.ditherStrength * 100)}%`);
    ditherNote.textContent = dominant ? 'Dominant color sampling picks whole palette colors, so it isn’t dithered.' : '';
  };

  /* ---- Preview ---- */

  let pixelator: Pixelator | null = null;
  let result: PixelatedImage | null = null;

  const update = () => {
    if (!pixelator) return;
    const palette = chosenPalette();
    try {
      result = pixelator({
        width,
        height,
        region: region(),
        sampling: settings.sampling,
        colors: palette ? palette.colors : null,
        colorCount: settings.colorCount,
        dither: settings.dither,
        ditherStrength: settings.ditherStrength,
      });
      status.textContent = '';
    } catch (error) {
      result = null;
      status.textContent = messageOf(error);
    }
    drawResult(palette);
  };
  // Large images take a while to resample: don't let that make every slider move wait.
  const schedule = adaptiveThrottle(update);

  const drawResult = (palette: Palette | null) => {
    layerButton.disabled = openButton.disabled = !result;
    if (!result) {
      resultCaption.textContent = '';
      swatches.replaceChildren();
      colorsNote.textContent = '';
      return;
    }
    const { pixels, colors } = result;
    resultCanvas.width = result.width;
    resultCanvas.height = result.height;
    const ctx = resultCanvas.getContext('2d');
    if (ctx) {
      const image = ctx.createImageData(result.width, result.height);
      const used = new Uint8Array(256);
      for (let i = 0; i < pixels.length; i++) {
        const index = pixels[i];
        used[index] = 1;
        if (index === 0) continue;
        const color = colors[index - 1];
        const o = i * 4;
        image.data[o] = red(color);
        image.data[o + 1] = green(color);
        image.data[o + 2] = blue(color);
        image.data[o + 3] = alpha(color);
      }
      ctx.putImageData(image, 0, 0);
      const usedColors = colors.filter((_, i) => used[i + 1]);
      swatches.replaceChildren(
        ...usedColors.map((color) => {
          const swatch = el('span', 'strip-swatch');
          swatch.style.background = toHex(color);
          swatch.title = toHex(color);
          return swatch;
        }),
      );
      const count = `${usedColors.length} ${usedColors.length === 1 ? 'color' : 'colors'}`;
      resultCaption.textContent = `Pixelated · ${result.width}×${result.height} · ${count}`;
      colorsNote.textContent =
        palette && usedColors.length < colors.length ? `Uses ${usedColors.length} of the palette's ${colors.length} colors.` : '';
    }
  };

  /** Shows the original, scaled down by the browser without a canvas its full size (a photo's would take tens of MB). */
  const drawOriginal = async (image: RgbaImage) => {
    const scale = Math.min(1, PREVIEW_SIZE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    // Decoded through a canvas, so the bytes are plain (see `decodeImageWithin`).
    const data = image.data as Uint8ClampedArray<ArrayBuffer>;
    const bitmap = await createImageBitmap(new ImageData(data, image.width, image.height), {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    try {
      // Another image may have replaced this one meanwhile.
      if (source?.image !== image) return;
      const ctx = originalCanvas.getContext('2d');
      if (!ctx) return;
      originalCanvas.width = width;
      originalCanvas.height = height;
      ctx.drawImage(bitmap, 0, 0);
      // Small images are likely pixel art: enlarge them crisply.
      originalCanvas.classList.toggle('is-pixelated', Math.max(image.width, image.height) <= CRISP_PREVIEW_SIZE);
    } finally {
      bitmap.close();
    }
  };

  /* ---- Footer ---- */

  const status = el('p', 'dialog-status');
  status.setAttribute('role', 'status');
  /** What `open` resolves to when the dialog closes. */
  let outcome: string | null = null;
  const apply = (target: 'open' | 'layer') => {
    // The current settings' result, not one a throttled update has yet to replace.
    update();
    if (!result || !source) return;
    try {
      outcome =
        target === 'open'
          ? openPixelatedImage(editor, result, chosenPalette(), source.name)
          : addPixelatedLayer(editor, result, source.name);
      end();
    } catch (error) {
      status.textContent = messageOf(error);
    }
  };
  const cancelButton = textButton('Cancel', () => end());
  const layerButton = textButton('Add as layer', () => apply('layer'));
  layerButton.title = 'Add it as a layer on the side being edited, at its top-left; its colors join the palette';
  const openButton = textButton('Open as new image', () => apply('open'));
  openButton.classList.add('is-primary');
  openButton.title = 'Replace the document with it (undoable)';
  const footer = el('footer', 'dialog-footer');
  footer.append(status, cancelButton, layerButton, openButton);

  /* ---- Layout ---- */

  const section = (heading: string, ...children: HTMLElement[]) => {
    const element = el('section', 'panel dialog-section');
    const h = el('h3', 'panel-title');
    h.textContent = heading;
    element.append(h, ...children);
    return element;
  };
  const controls = el('div', 'dialog-controls');
  controls.append(
    section(
      'Size',
      placed.label,
      sizeSlider.row,
      fieldRow(widthField.label, times, heightField.label),
      fieldRow(keep.label, fitButton),
      cellNote,
    ),
    section('Sampling', samplingSelect, samplingNote),
    section('Colors', paletteSelect, countRow, swatches, colorsNote),
    section('Dithering', ditherSelect, strength.row, ditherNote),
  );
  const body = el('div', 'dialog-body');
  body.append(previews, controls);
  dialog.append(header, note, body, footer);

  let finish: ((message: string | null) => void) | null = null;
  /**
   * Closes the dialog, lets go of the image (photos take a lot of memory)
   * and resolves `open` with the outcome. Called directly, as well as on
   * `close` (Escape), since browsers fire that only at the next frame.
   */
  const end = () => {
    if (dialog.open) dialog.close();
    if (!finish) return;
    source = null;
    pixelator = null;
    result = null;
    originalCanvas.width = originalCanvas.height = resultCanvas.width = resultCanvas.height = 1;
    const resolve = finish;
    finish = null;
    resolve(outcome);
  };
  // A late `close` from an earlier image mustn't end the next one.
  dialog.addEventListener('close', () => {
    if (!dialog.open) end();
  });

  const show = (next: PixelateSource, noteText: string | undefined): Promise<string | null> => {
    source = next;
    pixelator = createPixelator(next.image);
    result = null;
    outcome = null;
    subtitle.textContent = `${next.name} · ${next.width}×${next.height}`;
    note.textContent = noteText ?? '';
    note.hidden = !noteText;
    originalCaption.textContent = `Original · ${next.width}×${next.height}`;
    resultCaption.textContent = 'Working…';
    status.textContent = '';

    // A reference starts where it is on the canvas.
    placed.label.hidden = !next.placement;
    placed.input.checked = next.placement !== undefined;
    keep.input.checked = settings.keepProportions;
    aspect = sourceAspect();
    resizeToLongSide(settings.longSide);
    fillPalettes();
    syncControls();
    syncSize();
    void drawOriginal(next.image).catch(() => {});
    dialog.showModal();
    // After the dialog shows: resampling a large image takes a moment.
    setTimeout(schedule);
    void library.list().then(
      (list) => {
        saved = list;
        if (!dialog.open) return;
        fillPalettes();
        syncControls();
        schedule();
      },
      () => {},
    );
    return new Promise((resolve) => (finish = resolve));
  };

  return {
    element: dialog,
    async open(file, name, { note: noteText, placement } = {}) {
      if (dialog.open) return null;
      const decoded = await decodeImageWithin(file, MAX_SOURCE_PIXELS);
      // Another image may have been opened while this one decoded.
      if (dialog.open) return null;
      return show({ name, ...decoded, placement }, noteText);
    },
  };
}

function figure(canvas: HTMLCanvasElement, caption: HTMLElement): HTMLElement {
  const frame = el('div', 'preview-frame');
  frame.append(canvas);
  const element = el('figure', 'preview');
  element.append(frame, caption);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 62.5 → "62.5", 4 → "4". */
function formatCell(size: number): string {
  return size >= 10 || Number.isInteger(size) ? String(Math.round(size)) : size.toFixed(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
