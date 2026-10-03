import { parseHex, toHex } from '../core/color.ts';
import { DEFAULT_EXTRUSION, isExtrusion, isShape, packExtrusion, SQUARE, type Shape } from '../core/extrusion.ts';
import { FACINGS, isFacing, planeSize, type Facing, type Volume } from '../core/facing.ts';
import { createLayer, type Layer } from '../core/layer.ts';
import { createPalette, MAX_PALETTE_COLORS, TRANSPARENT, type Palette } from '../core/palette.ts';
import { checkDocumentSize, createFacingLayer, noSelections, type PixelDocument } from '../core/pixelDocument.ts';
import { clampReferenceScale, type ReferencePlacement } from '../core/referencePlacement.ts';
import { bytesToUint16, bytesToUint32, deflate, fromBase64, inflate, toBase64, uint32ToBytes } from './bytes.ts';

/*
 * Project files (`.pixgrind`): JSON holding everything needed to continue
 * editing: name, size, palette, layers and, optionally, the reference image.
 * Layer pixels are palette indices, zlib-compressed then base64-encoded, and
 * so are their extrusions for the 3D model. The reference is its original
 * image file, base64-encoded. Selection, history and the view aren't saved.
 *
 * Bump PROJECT_VERSION whenever the schema changes, and keep reading every
 * older version: migrate older JSON to the current shape before reading it.
 *
 * Versions:
 * 1. The first.
 * 2. Layers may have `extrusion`. Version 1 files are version 2 files
 *    without it, so they need no migration.
 * 3. Layers may have `shapes` (diagonal pixels). Version 2 files are
 *    version 3 files without it.
 * 4. The model has a `depth` and layers a `facing`, and boxes grow from the
 *    far side toward their layer's camera; `extrusion` holds whole packed
 *    extrusions (shapes included). Older files have front layers only, their
 *    boxes measured back from the picture plane: they become the front of a
 *    volume as deep as their deepest box, turned around so the model looks
 *    the same, with an empty layer on each other side.
 */

export const PROJECT_EXTENSION = 'pixgrind';
export const PROJECT_VERSION = 4;
const FORMAT = 'pixgrind';

/** A reference image as saved in a project: the original file plus its placement and settings. */
export interface ProjectReference extends ReferencePlacement {
  name: string;
  /** The original image file; re-decoded on load. */
  source: Blob;
  opacity: number;
  visible: boolean;
  above: boolean;
  smooth: boolean;
}

export interface Project {
  document: PixelDocument;
  reference: ProjectReference | null;
}

/** The file's JSON, version 4. */
interface ProjectFileV4 {
  format: typeof FORMAT;
  version: 4;
  name: string;
  /** The model's volume; the front is `width`×`height`. */
  width: number;
  height: number;
  depth: number;
  /** Colors as `#rrggbb` / `#rrggbbaa`; the first is pixel index 1. */
  palette: { name: string; colors: string[] };
  /**
   * Bottom to top, each the size of its facing's plane. `pixels`: base64 of
   * the zlib-compressed indices, row-major. `extrusion`: likewise for the
   * extrusions, as little-endian 32-bit `shape << 21 | offset << 11 | depth`
   * (transparent pixels' are the default); absent when every painted pixel
   * has the default.
   */
  layers: Array<{ name: string; visible: boolean; opacity: number; facing: Facing; pixels: string; extrusion?: string }>;
  reference?: {
    name: string;
    /** MIME type of the image file. */
    type: string;
    /** The image file, base64. */
    data: string;
    x: number;
    y: number;
    scale: number;
    opacity: number;
    visible: boolean;
    above: boolean;
    smooth: boolean;
  };
}

export function isProjectFile(file: { name: string }): boolean {
  return file.name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`);
}

/** Serializes a document, and optionally a reference image, as project file text. */
export async function serializeProject(doc: PixelDocument, reference: ProjectReference | null = null): Promise<string> {
  // Copy everything before the first await, so edits made while compressing can't leak into the file.
  const layers = doc.layers.map(({ name, visible, opacity, facing, pixels, extrusion }) => ({
    name,
    visible,
    opacity,
    facing,
    pixels: pixels.slice(),
    extrusion: savedExtrusion(pixels, extrusion),
  }));
  const header: Omit<ProjectFileV4, 'layers' | 'reference'> = {
    format: FORMAT,
    version: PROJECT_VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    depth: doc.depth,
    palette: { name: doc.palette.name, colors: doc.palette.colors.map(toHex) },
  };
  const ref = reference && { ...reference };

  const file: ProjectFileV4 = {
    ...header,
    layers: await Promise.all(
      layers.map(async ({ pixels, extrusion, ...props }) => ({
        ...props,
        pixels: toBase64(await deflate(pixels)),
        ...(extrusion && { extrusion: toBase64(await deflate(uint32ToBytes(extrusion))) }),
      })),
    ),
  };
  if (ref) {
    const { name, source, x, y, scale, opacity, visible, above, smooth } = ref;
    const data = toBase64(new Uint8Array(await source.arrayBuffer()));
    file.reference = { name, type: source.type, data, x, y, scale, opacity, visible, above, smooth };
  }
  return JSON.stringify(file, null, 2) + '\n';
}

/**
 * The extrusions to save, with transparent pixels' set to the default (they
 * mean nothing, and this compresses better). Null when every pixel has the
 * default.
 */
function savedExtrusion(pixels: Uint8Array, extrusion: Uint32Array): Uint32Array | null {
  const saved = extrusion.slice();
  let custom = false;
  for (let i = 0; i < saved.length; i++) {
    if (pixels[i] === TRANSPARENT) saved[i] = DEFAULT_EXTRUSION;
    else if (saved[i] !== DEFAULT_EXTRUSION) custom = true;
  }
  return custom ? saved : null;
}

/** Reads project file text. Throws a user-readable error for anything that isn't a valid project. */
export async function parseProject(text: string): Promise<Project> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Not a Pixgrind project: the file is not JSON');
  }
  if (!isRecord(json) || json.format !== FORMAT) throw new Error('Not a Pixgrind project');
  const { version } = json;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw invalid('missing version');
  if (version > PROJECT_VERSION) {
    throw new Error(
      `This project was saved by a newer version of Pixgrind (file format ${version}; this version reads up to ${PROJECT_VERSION})`,
    );
  }
  return version < 4 ? readV3(json) : readV4(json);
}

type Json = Record<string, unknown>;

async function readV4(file: Json): Promise<Project> {
  const name = text(file, 'name', 'name');
  const volume = { width: num(file, 'width', 'width'), height: num(file, 'height', 'height'), depth: num(file, 'depth', 'depth') };
  try {
    checkDocumentSize(volume.width, volume.height, volume.depth);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const palette = readPalette(file.palette);
  const layers = list(file.layers, 'layers');
  if (layers.length === 0) throw invalid('it has no layers');
  const read = await Promise.all(
    layers.map(async (value, i) => {
      const where = `layer ${i + 1}`;
      const json = record(value, where);
      const facing = json.facing;
      if (!isFacing(facing)) throw invalid(`${where} facing must be one of ${FACINGS.join(', ')}`);
      const layer = await readLayer(json, where, planeSize(volume, facing), facing, palette.colors.length);
      if (json.extrusion !== undefined) await readExtrusion(layer, text(json, 'extrusion', `${where} extrusion`), where);
      return layer;
    }),
  );
  return { document: documentOf(name, volume, palette, read), reference: readReference(file.reference) };
}

/**
 * Versions 1–3: front layers, each pixel's box `offset << 8 | depth` (16-bit)
 * measured back from the picture plane, and its shape a byte.
 */
async function readV3(file: Json): Promise<Project> {
  const name = text(file, 'name', 'name');
  const width = num(file, 'width', 'width');
  const height = num(file, 'height', 'height');
  try {
    checkDocumentSize(width, height);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const palette = readPalette(file.palette);
  const layers = list(file.layers, 'layers');
  if (layers.length === 0) throw invalid('it has no layers');
  const read = await Promise.all(
    layers.map(async (value, i) => {
      const where = `layer ${i + 1}`;
      const json = record(value, where);
      const layer = await readLayer(json, where, { width, height }, 'front', palette.colors.length);
      const boxes =
        json.extrusion === undefined ? null : await readBoxes(layer, text(json, 'extrusion', `${where} extrusion`), where);
      const shapes = json.shapes === undefined ? null : await readShapes(layer, text(json, 'shapes', `${where} shapes`), where);
      return { layer, boxes, shapes };
    }),
  );

  // The picture plane becomes the volume's front, and boxes grow toward it
  // from the back, which is as deep as the deepest box: art that was flat
  // stays at the default extrusion, like pixels painted from now on.
  let depth = 1;
  for (const { layer, boxes } of read) {
    for (let i = 0; boxes && i < boxes.length; i++) {
      if (layer.pixels[i] !== TRANSPARENT) depth = Math.max(depth, (boxes[i] >> 8) + (boxes[i] & 0xff));
    }
  }
  for (const { layer, boxes, shapes } of read) {
    for (let i = 0; i < layer.pixels.length; i++) {
      if (layer.pixels[i] === TRANSPARENT) continue;
      const [offset, boxDepth] = boxes ? [boxes[i] >> 8, boxes[i] & 0xff] : [0, 1];
      layer.extrusion[i] = packExtrusion(depth - offset - boxDepth, boxDepth, (shapes?.[i] ?? SQUARE) as Shape);
    }
  }
  const volume = { width, height, depth };
  return { document: documentOf(name, volume, palette, read.map(({ layer }) => layer)), reference: readReference(file.reference) };
}

/** A document of the layers read, with an empty one added for each facing the file has none on. */
function documentOf(name: string, volume: Volume, palette: Palette, layers: Layer[]): PixelDocument {
  const missing = FACINGS.filter((facing) => !layers.some((layer) => layer.facing === facing));
  return {
    name,
    ...volume,
    palette,
    layers: [...missing.map((facing) => createFacingLayer(volume, facing, 'Layer 1')), ...layers],
    selections: noSelections(),
    floating: null,
  };
}

function readPalette(value: unknown): Palette {
  const paletteJson = record(value, 'palette');
  const paletteName = text(paletteJson, 'name', 'palette name');
  const colors = list(paletteJson.colors, 'palette colors').map((value, i) => {
    try {
      if (typeof value !== 'string') throw new Error();
      return parseHex(value);
    } catch {
      throw invalid(`palette color ${i + 1} is not a hex color`);
    }
  });
  if (colors.length === 0 || colors.length > MAX_PALETTE_COLORS) {
    throw invalid(`the palette has ${colors.length} colors; it must have 1–${MAX_PALETTE_COLORS}`);
  }
  return createPalette(paletteName, colors);
}

/** A layer's name, visibility, opacity and pixels (extrusions are read separately). */
async function readLayer(
  json: Json,
  where: string,
  { width, height }: { width: number; height: number },
  facing: Facing,
  colorCount: number,
): Promise<Layer> {
  const layer = createLayer(width, height, text(json, 'name', `${where} name`), facing);
  layer.visible = bool(json, 'visible', `${where} visibility`);
  layer.opacity = fraction(json, 'opacity', `${where} opacity`);
  const encoded = text(json, 'pixels', `${where} pixels`);
  let pixels: Uint8Array;
  try {
    pixels = await inflate(fromBase64(encoded), layer.pixels.length);
  } catch {
    throw invalid(`${where} pixel data is corrupted`);
  }
  if (pixels.length !== layer.pixels.length) {
    throw invalid(`${where} has ${pixels.length} pixels; a ${width}×${height} layer has ${layer.pixels.length}`);
  }
  layer.pixels.set(pixels);
  // Indices past the palette render transparent; make them transparent, or
  // they'd appear as soon as the palette grows (e.g. Add color).
  for (let i = 0; i < layer.pixels.length; i++) {
    if (layer.pixels[i] > colorCount) layer.pixels[i] = TRANSPARENT;
  }
  return layer;
}

/** Reads a layer's saved extrusions (after its pixels). */
async function readExtrusion(layer: Layer, encoded: string, where: string): Promise<void> {
  let extrusion: Uint32Array;
  try {
    extrusion = bytesToUint32(await inflate(fromBase64(encoded), layer.pixels.length * 4));
  } catch {
    throw invalid(`${where} extrusion data is corrupted`);
  }
  if (extrusion.length !== layer.pixels.length) {
    throw invalid(`${where} has ${extrusion.length} extrusions for ${layer.pixels.length} pixels`);
  }
  for (let i = 0; i < extrusion.length; i++) {
    if (layer.pixels[i] === TRANSPARENT) continue;
    if (!isExtrusion(extrusion[i])) throw invalid(`${where} has a pixel with an invalid extrusion`);
    layer.extrusion[i] = extrusion[i];
  }
}

/** Reads a version 1–3 layer's saved boxes (after its pixels). */
async function readBoxes(layer: Layer, encoded: string, where: string): Promise<Uint16Array> {
  let boxes: Uint16Array;
  try {
    boxes = bytesToUint16(await inflate(fromBase64(encoded), layer.pixels.length * 2));
  } catch {
    throw invalid(`${where} extrusion data is corrupted`);
  }
  if (boxes.length !== layer.pixels.length) {
    throw invalid(`${where} has ${boxes.length} extrusions for ${layer.pixels.length} pixels`);
  }
  for (let i = 0; i < boxes.length; i++) {
    if (layer.pixels[i] !== TRANSPARENT && (boxes[i] & 0xff) === 0) throw invalid(`${where} has a pixel extruded 0 deep`);
  }
  return boxes;
}

/** Reads a version 3 layer's saved shapes (after its pixels). */
async function readShapes(layer: Layer, encoded: string, where: string): Promise<Uint8Array> {
  let shapes: Uint8Array;
  try {
    shapes = await inflate(fromBase64(encoded), layer.pixels.length);
  } catch {
    throw invalid(`${where} shape data is corrupted`);
  }
  if (shapes.length !== layer.pixels.length) {
    throw invalid(`${where} has ${shapes.length} shapes for ${layer.pixels.length} pixels`);
  }
  for (let i = 0; i < shapes.length; i++) {
    if (layer.pixels[i] !== TRANSPARENT && !isShape(shapes[i])) {
      throw invalid(`${where} has a pixel of unknown shape ${shapes[i]}`);
    }
  }
  return shapes;
}

function readReference(value: unknown): ProjectReference | null {
  if (value === undefined || value === null) return null;
  const json = record(value, 'reference');
  const encoded = text(json, 'data', 'reference data');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(encoded);
  } catch {
    throw invalid('the reference image data is corrupted');
  }
  return {
    name: text(json, 'name', 'reference name'),
    source: new Blob([bytes], { type: text(json, 'type', 'reference type') }),
    x: num(json, 'x', 'reference position'),
    y: num(json, 'y', 'reference position'),
    scale: clampReferenceScale(num(json, 'scale', 'reference scale')),
    opacity: fraction(json, 'opacity', 'reference opacity'),
    visible: bool(json, 'visible', 'reference visibility'),
    above: bool(json, 'above', 'reference "above"'),
    smooth: bool(json, 'smooth', 'reference smoothing'),
  };
}

function invalid(detail: string): Error {
  return new Error(`Invalid project file: ${detail}`);
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Json {
  if (!isRecord(value)) throw invalid(`${where} is missing`);
  return value;
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${where} is missing`);
  return value;
}

function text(json: Json, key: string, where: string): string {
  const value = json[key];
  if (typeof value !== 'string') throw invalid(`${where} must be text`);
  return value;
}

function num(json: Json, key: string, where: string): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${where} must be a number`);
  return value;
}

function fraction(json: Json, key: string, where: string): number {
  const value = num(json, key, where);
  if (value < 0 || value > 1) throw invalid(`${where} must be between 0 and 1`);
  return value;
}

function bool(json: Json, key: string, where: string): boolean {
  const value = json[key];
  if (typeof value !== 'boolean') throw invalid(`${where} must be true or false`);
  return value;
}
