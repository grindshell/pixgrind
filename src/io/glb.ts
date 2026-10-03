import { alpha, blue, green, red, toHex, type Rgba } from '../core/color.ts';
import type { ModelMesh } from '../core/model.ts';

/*
 * Binary glTF 2.0 (`.glb`) export of a model mesh: one mesh with a
 * primitive per palette color, each with its own material, so colors can be
 * swapped or restyled per material in other tools. Pure: bytes out.
 */

export const GLB_EXTENSION = 'glb';

export interface GlbOptions {
  /** Names the scene, node and mesh. */
  name: string;
  /** Meters per pixel. */
  scale: number;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Encodes the mesh as a GLB file. Throws for an empty mesh, which glTF can't hold as a mesh. */
export function meshToGlb(mesh: ModelMesh, { name, scale }: GlbOptions): Uint8Array<ArrayBuffer> {
  if (mesh.parts.length === 0) throw new Error('The model is empty: paint some pixels on a visible layer first');
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  /** Appends bytes to the binary chunk (4-byte aligned) as a buffer view. Returns its number. */
  const view = (bytes: Uint8Array, target: number) => {
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      byteLength += padding;
    }
    return bufferViews.length - 1;
  };
  const accessor = (fields: object) => accessors.push(fields) - 1;

  const primitives = mesh.parts.map((part, material) => {
    const positions = part.positions.map((value) => value * scale);
    const count = positions.length / 3;
    const { min, max } = vectorBounds(positions);
    const position = accessor({
      bufferView: view(bytesOf(positions), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: 'VEC3',
      min,
      max,
    });
    const normal = accessor({
      bufferView: view(bytesOf(part.normals), ARRAY_BUFFER),
      componentType: FLOAT,
      count,
      type: 'VEC3',
    });
    const small = count <= 0xffff;
    const indices = accessor({
      bufferView: view(bytesOf(small ? Uint16Array.from(part.indices) : part.indices), ELEMENT_ARRAY_BUFFER),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: part.indices.length,
      type: 'SCALAR',
    });
    return { attributes: { POSITION: position, NORMAL: normal }, indices, material };
  });

  const json = {
    asset: { version: '2.0', generator: 'Pixgrind' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials: mesh.parts.map((part) => material(part.color)),
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  return assembleGlb(new TextEncoder().encode(JSON.stringify(json)), concat(chunks, byteLength));
}

/** A matte material in a palette color; translucent colors blend. */
function material(color: Rgba): object {
  const opacity = alpha(color) / 255;
  return {
    name: toHex(color),
    pbrMetallicRoughness: {
      // glTF colors are linear; palette colors are sRGB.
      baseColorFactor: [red(color), green(color), blue(color)].map((c) => round(srgbToLinear(c / 255))).concat(round(opacity)),
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    ...(opacity < 1 && { alphaMode: 'BLEND' }),
  };
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Six decimal places: plenty for colors, and keeps the JSON readable. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The 12-byte header, then the JSON chunk (space-padded) and the binary chunk (zero-padded). */
function assembleGlb(json: Uint8Array, bin: Uint8Array): Uint8Array<ArrayBuffer> {
  const jsonLength = align4(json.byteLength);
  const binLength = align4(bin.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const bytes = new Uint8Array(total);
  const data = new DataView(bytes.buffer);
  data.setUint32(0, GLB_MAGIC, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, total, true);
  data.setUint32(12, jsonLength, true);
  data.setUint32(16, CHUNK_JSON, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binStart = 20 + jsonLength;
  data.setUint32(binStart, binLength, true);
  data.setUint32(binStart + 4, CHUNK_BIN, true);
  bytes.set(bin, binStart + 8);
  return bytes;
}

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

/** A typed array's bytes in little-endian order (what glTF requires; every platform browsers run on uses it). */
function bytesOf(values: Float32Array | Uint16Array | Uint32Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function vectorBounds(values: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], values[i]);
    max[axis] = Math.max(max[axis], values[i]);
  }
  return { min, max };
}
