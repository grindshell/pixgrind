import { describe, expect, it } from 'vitest';
import { packExtrusion } from '../core/extrusion.ts';
import { buildMesh, buildVoxelModel, type ModelMesh } from '../core/model.ts';
import { createPalette } from '../core/palette.ts';
import { createDocument } from '../core/pixelDocument.ts';
import { meshToGlb, srgbToLinear } from './glb.ts';

interface Gltf {
  asset: { version: string };
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{ name: string; mesh: number }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number; material: number }> }>;
  materials: Array<{ name: string; alphaMode?: string; pbrMetallicRoughness: { baseColorFactor: number[] } }>;
  accessors: Array<{ bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }>;
  bufferViews: Array<{ byteOffset: number; byteLength: number }>;
  buffers: Array<{ byteLength: number }>;
}

/** Splits a GLB into its JSON and binary chunk, checking the container as it goes. */
function readGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(data.getUint32(0, true)).toBe(0x46546c67);
  expect(data.getUint32(4, true)).toBe(2);
  expect(data.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = data.getUint32(12, true);
  expect(data.getUint32(16, true)).toBe(0x4e4f534a);
  expect(jsonLength % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binLength = data.getUint32(20 + jsonLength, true);
  expect(data.getUint32(24 + jsonLength, true)).toBe(0x004e4942);
  expect(28 + jsonLength + binLength).toBe(bytes.byteLength);
  return { json, bin: bytes.slice(28 + jsonLength, 28 + jsonLength + binLength) };
}

function accessorFloats(json: Gltf, bin: Uint8Array, index: number): Float32Array {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  return new Float32Array(bin.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

const palette = createPalette('test', [0xff0000ff, 0x0000ff80]);

function sampleMesh(): ModelMesh {
  const doc = createDocument(2, 1, palette);
  const [layer] = doc.layers;
  layer.pixels.set([1, 2]);
  layer.extrusion[0] = packExtrusion(0, 3);
  return buildMesh(buildVoxelModel(doc), doc.palette);
}

describe('meshToGlb', () => {
  it('writes a valid container with a primitive and material per color', () => {
    const mesh = sampleMesh();
    const { json, bin } = readGlb(meshToGlb(mesh, { name: 'hero', scale: 1 }));
    expect(json.asset.version).toBe('2.0');
    expect(json.nodes).toEqual([{ name: 'hero', mesh: 0 }]);
    expect(json.buffers[0].byteLength).toBe(bin.byteLength);
    const { primitives } = json.meshes[0];
    expect(primitives.map((p) => p.material)).toEqual([0, 1]);
    expect(json.materials.map((m) => m.name)).toEqual(['#ff0000', '#0000ff80']);
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 1]);
    expect(json.materials[1].alphaMode).toBe('BLEND');
    expect(json.materials[0].alphaMode).toBeUndefined();
    // Every view starts 4-byte aligned, inside the buffer.
    for (const view of json.bufferViews) {
      expect(view.byteOffset % 4).toBe(0);
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(bin.byteLength);
    }
  });

  it('stores positions scaled, with exact bounds, and small indices as 16-bit', () => {
    const mesh = sampleMesh();
    const { json, bin } = readGlb(meshToGlb(mesh, { name: 'hero', scale: 0.5 }));
    const primitive = json.meshes[0].primitives[0];
    const position = json.accessors[primitive.attributes.POSITION];
    expect(position).toMatchObject({ type: 'VEC3', componentType: 5126, count: mesh.parts[0].positions.length / 3 });
    expect(Array.from(accessorFloats(json, bin, primitive.attributes.POSITION))).toEqual(
      Array.from(mesh.parts[0].positions, (v) => v * 0.5),
    );
    expect(position.min).toEqual([-0.5, 0, -1.5]);
    expect(position.max).toEqual([0, 0.5, 0]);
    expect(json.accessors[primitive.indices]).toMatchObject({ componentType: 5123, count: mesh.parts[0].indices.length });
  });

  it('refuses an empty mesh', () => {
    expect(() => meshToGlb({ parts: [], quads: 0, bounds: null }, { name: 'x', scale: 1 })).toThrow(/empty/);
  });

  it('converts sRGB to linear', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });
});
