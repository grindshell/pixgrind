import { parseHex, toHex } from '../core/color.ts';
import { createLayer, type Layer } from '../core/layer.ts';
import { createPalette, MAX_PALETTE_COLORS, TRANSPARENT } from '../core/palette.ts';
import { createDocument, type PixelDocument } from '../core/pixelDocument.ts';
import { clampReferenceScale, type ReferencePlacement } from '../core/referencePlacement.ts';
import { deflate, fromBase64, inflate, toBase64 } from './bytes.ts';

/*
 * Project files (`.pixgrind`): JSON holding everything needed to continue
 * editing: name, size, palette, layers and, optionally, the reference image.
 * Layer pixels are palette indices, zlib-compressed then base64-encoded. The
 * reference is its original image file, base64-encoded. Selection, history
 * and the view aren't saved.
 *
 * Bump PROJECT_VERSION whenever the schema changes, and keep reading every
 * older version: migrate older JSON to the current shape before reading it.
 */

export const PROJECT_EXTENSION = 'pixgrind';
export const PROJECT_VERSION = 1;
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

/** The file's JSON, version 1. */
interface ProjectFileV1 {
  format: typeof FORMAT;
  version: 1;
  name: string;
  width: number;
  height: number;
  /** Colors as `#rrggbb` / `#rrggbbaa`; the first is pixel index 1. */
  palette: { name: string; colors: string[] };
  /** Bottom to top. `pixels`: base64 of the zlib-compressed indices, row-major. */
  layers: Array<{ name: string; visible: boolean; opacity: number; pixels: string }>;
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
  const layers = doc.layers.map(({ name, visible, opacity, pixels }) => ({ name, visible, opacity, pixels: pixels.slice() }));
  const header: Omit<ProjectFileV1, 'layers' | 'reference'> = {
    format: FORMAT,
    version: PROJECT_VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    palette: { name: doc.palette.name, colors: doc.palette.colors.map(toHex) },
  };
  const ref = reference && { ...reference };

  const file: ProjectFileV1 = {
    ...header,
    layers: await Promise.all(layers.map(async ({ pixels, ...props }) => ({ ...props, pixels: toBase64(await deflate(pixels)) }))),
  };
  if (ref) {
    const { name, source, x, y, scale, opacity, visible, above, smooth } = ref;
    const data = toBase64(new Uint8Array(await source.arrayBuffer()));
    file.reference = { name, type: source.type, data, x, y, scale, opacity, visible, above, smooth };
  }
  return JSON.stringify(file, null, 2) + '\n';
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
  return readV1(json);
}

type Json = Record<string, unknown>;

async function readV1(file: Json): Promise<Project> {
  const name = text(file, 'name', 'name');
  const width = num(file, 'width', 'width');
  const height = num(file, 'height', 'height');

  const paletteJson = record(file.palette, 'palette');
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

  let doc: PixelDocument;
  try {
    doc = createDocument(width, height, createPalette(paletteName, colors), name);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }

  const layers = list(file.layers, 'layers');
  if (layers.length === 0) throw invalid('it has no layers');
  doc.layers = await Promise.all(
    layers.map((value, i) => readLayer(value, `layer ${i + 1}`, width, height, colors.length)),
  );

  return { document: doc, reference: readReference(file.reference) };
}

async function readLayer(
  value: unknown,
  where: string,
  width: number,
  height: number,
  colorCount: number,
): Promise<Layer> {
  const json = record(value, where);
  const layer = createLayer(width, height, text(json, 'name', `${where} name`));
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
