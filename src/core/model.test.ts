import { describe, expect, it } from 'vitest';
import { packExtrusion } from './extrusion.ts';
import { createLayer } from './layer.ts';
import { buildMesh, buildVoxelModel, pixelRuns, runAt, type MeshPart } from './model.ts';
import { createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const GLASS = 0x0000ff80;
const palette = createPalette('test', [RED, GREEN, GLASS, 0xffffff00]);

/** A document from rows of digits (palette indices), each pixel extruded per `extrude(x, y)` as [offset, depth]. */
function docFrom(rows: string[], extrude: (x: number, y: number) => [number, number] = () => [0, 1]): PixelDocument {
  const doc = createDocument(rows[0].length, rows.length, palette);
  const [layer] = doc.layers;
  layer.pixels.set(rows.join('').split('').map(Number));
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) layer.extrusion[y * doc.width + x] = packExtrusion(...extrude(x, y));
  }
  return doc;
}

const meshOf = (doc: PixelDocument) => buildMesh(buildVoxelModel(doc), doc.palette);

/** Each quad of a part as its normal and the box around its corners. */
function quads(part: MeshPart): Array<{ normal: number[]; min: number[]; max: number[] }> {
  const result = [];
  for (let v = 0; v < part.positions.length / 3; v += 4) {
    const corners = [0, 1, 2, 3].map((k) => Array.from(part.positions.slice((v + k) * 3, (v + k) * 3 + 3)));
    result.push({
      normal: Array.from(part.normals.slice(v * 3, v * 3 + 3)),
      min: [0, 1, 2].map((axis) => Math.min(...corners.map((c) => c[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((c) => c[axis]))),
    });
  }
  return result;
}

describe('buildVoxelModel', () => {
  it('extrudes each painted pixel from its offset', () => {
    const model = buildVoxelModel(docFrom(['10', '02'], (x) => (x === 0 ? [0, 3] : [2, 1])));
    expect(model.depth).toBe(3);
    expect(model.columns[0]).toEqual([{ start: 0, end: 3, index: 1 }]);
    expect(model.columns[1]).toBeUndefined();
    expect(model.columns[3]).toEqual([{ start: 2, end: 3, index: 2 }]);
  });

  it('stacks layers behind the same pixel, the upper winning overlaps', () => {
    const doc = docFrom(['1'], () => [0, 4]);
    const top = createLayer(1, 1, 'Top');
    top.pixels[0] = 2;
    top.extrusion[0] = packExtrusion(2, 4);
    doc.layers.push(top);
    expect(buildVoxelModel(doc).columns[0]).toEqual([
      { start: 0, end: 2, index: 1 },
      { start: 2, end: 6, index: 2 },
    ]);
    top.extrusion[0] = packExtrusion(6, 2);
    top.pixels[0] = 1;
    // A gap from 4 to 6; same-color runs that touch merge.
    expect(buildVoxelModel(doc).columns[0]).toEqual([
      { start: 0, end: 4, index: 1 },
      { start: 6, end: 8, index: 1 },
    ]);
    top.extrusion[0] = packExtrusion(4, 2);
    expect(buildVoxelModel(doc).columns[0]).toEqual([{ start: 0, end: 6, index: 1 }]);
    expect(runAt(buildVoxelModel(doc).columns[0], 5)?.index).toBe(1);
    expect(pixelRuns(doc, 0, 0)).toEqual(buildVoxelModel(doc).columns[0]);
  });

  it('leaves out hidden layers and fully transparent colors', () => {
    const doc = docFrom(['14']);
    expect(buildVoxelModel(doc).columns[1]).toBeUndefined();
    doc.layers[0].visible = false;
    expect(buildVoxelModel(doc).depth).toBe(0);
  });
});

describe('buildMesh', () => {
  it('makes a single pixel a unit cube facing +z, centered on x, standing on y = 0', () => {
    const mesh = meshOf(docFrom(['1']));
    expect(mesh.quads).toBe(6);
    expect(mesh.bounds).toEqual({ min: [-0.5, 0, -1], max: [0.5, 1, 0] });
    const front = quads(mesh.parts[0]).find((q) => q.normal[2] === 1);
    expect(front).toEqual({ normal: [0, 0, 1], min: [-0.5, 0, 0], max: [0.5, 1, 0] });
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    const mesh = meshOf(docFrom(['12', '01'], (x, y) => [x, y + 1]));
    for (const part of mesh.parts) {
      const at = (v: number) => Array.from(part.positions.slice(v * 3, v * 3 + 3));
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]].map(at);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const normal = Array.from(part.normals.slice(part.indices[t] * 3, part.indices[t] * 3 + 3));
        expect(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]).toBeGreaterThan(0);
      }
    }
  });

  it('drops faces between touching boxes, and spans deep sides with one quad', () => {
    const mesh = meshOf(docFrom(['11'], () => [0, 5]));
    // Two boxes: 12 faces less the 2 that touch.
    expect(mesh.quads).toBe(10);
    const right = quads(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(right).toEqual([{ normal: [1, 0, 0], min: [1, 0, -5], max: [1, 1, 0] }]);
  });

  it('cuts side faces where a neighbor covers only part of them', () => {
    // Left pixel 6 deep, right pixel from 2 to 4.
    const mesh = meshOf(docFrom(['12'], (x) => (x === 0 ? [0, 6] : [2, 2])));
    const red = quads(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(red.map((q) => [q.min[2], q.max[2]])).toEqual([
      [-2, 0],
      [-6, -4],
    ]);
  });

  it('shows faces behind translucent colors, but none inside one', () => {
    const behind = meshOf(docFrom(['13']));
    // The red box's right face shows through the glass; glass hides nothing.
    expect(quads(behind.parts[0]).some((q) => q.normal[0] === 1)).toBe(true);
    expect(quads(behind.parts[1]).some((q) => q.normal[0] === -1)).toBe(false);
    expect(meshOf(docFrom(['33'])).quads).toBe(10);
  });

  it('hides front and back faces between stacked runs', () => {
    const doc = docFrom(['1'], () => [0, 2]);
    const back = createLayer(1, 1, 'Back');
    back.pixels[0] = 2;
    back.extrusion[0] = packExtrusion(2, 2);
    doc.layers.unshift(back);
    const mesh = meshOf(doc);
    expect(mesh.quads).toBe(10);
    expect(mesh.parts.map((p) => p.index)).toEqual([1, 2]);
  });

  it('is empty for an empty document', () => {
    const mesh = meshOf(createDocument(3, 3, palette));
    expect(mesh).toEqual({ parts: [], quads: 0, bounds: null });
  });
});
