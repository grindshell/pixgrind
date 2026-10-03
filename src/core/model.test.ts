import { describe, expect, it } from 'vitest';
import { alpha } from './color.ts';
import {
  CUT_BOTTOM_LEFT,
  CUT_TOP_LEFT,
  CUT_TOP_RIGHT,
  packExtrusion,
  SHAPES,
  SQUARE,
  type Shape,
} from './extrusion.ts';
import { createLayer } from './layer.ts';
import {
  BOTTOM,
  buildMesh,
  buildVoxelModel,
  LEFT,
  pixelRuns,
  quarterIndex,
  RIGHT,
  runAt,
  seenFromRight,
  solidQuarters,
  TOP,
  type MeshPart,
  type ModelMesh,
  type Quarter,
} from './model.ts';
import { colorForIndex, createPalette } from './palette.ts';
import { createDocument, type PixelDocument } from './pixelDocument.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const GLASS = 0x0000ff80;
const palette = createPalette('test', [RED, GREEN, GLASS, 0xffffff00]);

type Vec3 = [number, number, number];

/** A document from rows of digits (palette indices), each pixel extruded per `extrude(x, y)` as [offset, depth, shape]. */
function docFrom(
  rows: string[],
  extrude: (x: number, y: number) => [number, number, Shape?] = () => [0, 1],
): PixelDocument {
  const doc = createDocument(rows[0].length, rows.length, palette);
  const [layer] = doc.layers;
  layer.pixels.set(rows.join('').split('').map(Number));
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) layer.extrusion[y * doc.width + x] = packExtrusion(...extrude(x, y));
  }
  return doc;
}

const meshOf = (doc: PixelDocument) => buildMesh(buildVoxelModel(doc), doc.palette);
const run = (start: number, end: number, index: number) => ({ start, end, quarters: solidQuarters(index) });

interface Face {
  normal: number[];
  corners: Vec3[];
  min: number[];
  max: number[];
}

/** A part's faces (quads and triangles, as `PartBuilder` writes them), each with its normal and bounding box. */
function faces(part: MeshPart): Face[] {
  const { indices, positions, normals } = part;
  const at = (v: number): Vec3 => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const result: Face[] = [];
  for (let i = 0; i < indices.length; ) {
    const v = indices[i];
    const quad = indices[i + 3] === v && indices[i + 4] === v + 2 && indices[i + 5] === v + 3;
    const corners = (quad ? [v, v + 1, v + 2, v + 3] : [v, v + 1, v + 2]).map(at);
    result.push({
      normal: Array.from(normals.slice(v * 3, v * 3 + 3)),
      corners,
      min: [0, 1, 2].map((axis) => Math.min(...corners.map((c) => c[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((c) => c[axis]))),
    });
    i += quad ? 6 : 3;
  }
  return result;
}

const box = ({ normal, min, max }: Face) => ({ normal, min, max });

/** A pseudo-random number generator (mulberry32) giving numbers in [0, 1). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small document of up to three layers, with colors (including glass and
 * the fully transparent one), shapes, and extrusions that often repeat a
 * neighbor's, so there's plenty to merge and plenty of edges.
 */
function randomDoc(random: () => number): PixelDocument {
  const pick = (count: number) => Math.floor(random() * count);
  const doc = createDocument(1 + pick(6), 1 + pick(6), palette);
  for (let n = pick(3); n > 0; n--) doc.layers.push(createLayer(doc.width, doc.height, 'Layer'));
  for (const layer of doc.layers) {
    for (let i = 0; i < layer.pixels.length; i++) {
      const copy = i > 0 && random() < 0.6;
      layer.pixels[i] = copy ? layer.pixels[i - 1] : pick(5);
      const shape = random() < 0.5 ? SQUARE : SHAPES[pick(SHAPES.length)];
      layer.extrusion[i] = copy && random() < 0.7 ? layer.extrusion[i - 1] : packExtrusion(pick(4), 1 + pick(4), shape);
    }
  }
  return doc;
}

/**
 * A piece of the model's surface that should show or not: one quarter of a
 * voxel's front or back, the side its quarter touches, or the half-diagonal
 * it shares with a neighboring quarter.
 */
interface Slot {
  color: number;
  exposed: boolean;
  normal: Vec3;
  corners: Vec3[];
}

/** Every slot of every filled quarter of every voxel, worked out voxel by voxel, in mesh coordinates. */
function slots(doc: PixelDocument): Slot[] {
  const { width, height, depth, columns } = buildVoxelModel(doc);
  const color = (x: number, y: number, z: number, q: number) => {
    const found = x >= 0 && y >= 0 && x < width && y < height ? runAt(columns[y * width + x], z) : undefined;
    return found ? quarterIndex(found.quarters, q as Quarter) : 0;
  };
  const hides = (cover: number, face: number) => cover !== 0 && (alpha(colorForIndex(doc.palette, cover)) === 255 || cover === face);
  // Document steps to the neighbor each quarter's side faces.
  const steps = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const result: Slot[] = [];
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = x - width / 2;
        const top = height - y;
        const front = -z;
        const back = -z - 1;
        // Corners clockwise from the top left; quarter q lies between corners q and q + 1.
        const corner = [
          [x0, top],
          [x0 + 1, top],
          [x0 + 1, top - 1],
          [x0, top - 1],
        ];
        const center = [x0 + 0.5, top - 0.5];
        const at = ([px, py]: number[], pz: number): Vec3 => [px, py, pz];
        const centroid = (q: number) => [0, 1].map((k) => (center[k] + corner[q][k] + corner[(q + 1) % 4][k]) / 3);
        for (let q = 0; q < 4; q++) {
          const index = color(x, y, z, q);
          if (!index) continue;
          const a = corner[q];
          const b = corner[(q + 1) % 4];
          const slot = (cover: number, normal: Vec3, corners: Vec3[]) =>
            result.push({ color: index, exposed: !hides(cover, index), normal, corners });
          slot(color(x, y, z - 1, q), [0, 0, 1], [at(center, front), at(a, front), at(b, front)]);
          slot(color(x, y, z + 1, q), [0, 0, -1], [at(center, back), at(b, back), at(a, back)]);
          const [dx, dy] = steps[q];
          slot(color(x + dx, y + dy, z, (q + 2) % 4), [dx, -dy, 0], [at(a, front), at(b, front), at(b, back), at(a, back)]);
          for (const n of [(q + 1) % 4, (q + 3) % 4]) {
            const shared = n === (q + 1) % 4 ? b : a;
            const [nx, ny] = [0, 1].map((k) => centroid(n)[k] - centroid(q)[k]);
            const length = Math.hypot(nx, ny);
            slot(color(x, y, z, n), [nx / length, ny / length, 0], [
              at(center, front),
              at(shared, front),
              at(shared, back),
              at(center, back),
            ]);
          }
        }
      }
    }
  }
  return result;
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const normalKey = (normal: readonly number[]) => normal.map((v) => Math.round(v * 1000) / 1000 + 0).join(',');

/** Area of a convex polygon. */
function area(corners: Vec3[]): number {
  let sum = 0;
  for (let k = 1; k + 1 < corners.length; k++) {
    sum += Math.hypot(...cross(sub(corners[k], corners[0]), sub(corners[k + 1], corners[0]))) / 2;
  }
  return sum;
}

function inTriangle(p: Vec3, [a, b, c]: Vec3[], normal: Vec3): boolean {
  if (Math.abs(dot(sub(p, a), normal)) > 1e-6) return false;
  const v0 = sub(c, a);
  const v1 = sub(b, a);
  const v2 = sub(p, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d02 = dot(v0, v2);
  const d11 = dot(v1, v1);
  const d12 = dot(v1, v2);
  const inverse = 1 / (d00 * d11 - d01 * d01);
  const u = (d11 * d02 - d01 * d12) * inverse;
  const v = (d00 * d12 - d01 * d02) * inverse;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9;
}

/**
 * Checks the mesh against the voxel-by-voxel slots: every exposed slot is
 * covered by exactly one triangle of its color facing its way, no hidden one
 * is covered, and the mesh has no more area than the exposed slots.
 */
function expectMeshMatches(doc: PixelDocument, mesh: ModelMesh): void {
  const triangles = new Map<string, Array<{ color: number; corners: Vec3[]; normal: Vec3 }>>();
  const meshArea = new Map<string, number>();
  for (const part of mesh.parts) {
    const at = (v: number): Vec3 => [part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]];
    for (let t = 0; t < part.indices.length; t += 3) {
      const corners = [part.indices[t], part.indices[t + 1], part.indices[t + 2]].map(at);
      const normal = at(part.indices[t]).map((_, k) => part.normals[part.indices[t] * 3 + k]) as Vec3;
      const key = normalKey(normal);
      if (!triangles.has(key)) triangles.set(key, []);
      triangles.get(key)!.push({ color: part.index, corners, normal });
      meshArea.set(`${key} ${part.index}`, (meshArea.get(`${key} ${part.index}`) ?? 0) + area(corners));
    }
  }
  const slotArea = new Map<string, number>();
  for (const slot of slots(doc)) {
    const key = normalKey(slot.normal);
    if (slot.exposed) slotArea.set(`${key} ${slot.color}`, (slotArea.get(`${key} ${slot.color}`) ?? 0) + area(slot.corners));
    // Points inside the slot, nudged off the lines mesh edges could lie on.
    const middle = [0, 1, 2].map((k) => slot.corners.reduce((sum, c) => sum + c[k], 0) / slot.corners.length) as Vec3;
    const e1 = sub(slot.corners[1], slot.corners[0]).map((v) => v / Math.hypot(...sub(slot.corners[1], slot.corners[0]))) as Vec3;
    const e2 = cross(slot.normal, e1);
    const nudge = (p: Vec3): Vec3 => [0, 1, 2].map((k) => p[k] + e1[k] * 0.005 * Math.SQRT2 + e2[k] * 0.005 * Math.E) as Vec3;
    const points = [middle, ...slot.corners.map((c) => [0, 1, 2].map((k) => middle[k] + (c[k] - middle[k]) * 0.6) as Vec3)].map(nudge);
    for (const point of points) {
      const covering = (triangles.get(key) ?? []).filter((triangle) => inTriangle(point, triangle.corners, triangle.normal));
      const where = `${key} slot of color ${slot.color} at ${slot.corners.map((c) => c.join(' ')).join(' / ')}`;
      expect(covering.length, where).toBe(slot.exposed ? 1 : 0);
      if (slot.exposed) expect(covering[0].color, where).toBe(slot.color);
    }
  }
  for (const [key, value] of meshArea) expect(value, `area of ${key}`).toBeCloseTo(slotArea.get(key) ?? 0, 6);
}

describe('buildVoxelModel', () => {
  it('extrudes each painted pixel from its offset', () => {
    const model = buildVoxelModel(docFrom(['10', '02'], (x) => (x === 0 ? [0, 3] : [2, 1])));
    expect(model.depth).toBe(3);
    expect(model.columns[0]).toEqual([run(0, 3, 1)]);
    expect(model.columns[1]).toBeUndefined();
    expect(model.columns[3]).toEqual([run(2, 3, 2)]);
  });

  it('stacks layers behind the same pixel, the upper winning overlaps', () => {
    const doc = docFrom(['1'], () => [0, 4]);
    const top = createLayer(1, 1, 'Top');
    top.pixels[0] = 2;
    top.extrusion[0] = packExtrusion(2, 4);
    doc.layers.push(top);
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(0, 2, 1), run(2, 6, 2)]);
    top.extrusion[0] = packExtrusion(6, 2);
    top.pixels[0] = 1;
    // A gap from 4 to 6; same-color runs that touch merge.
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(0, 4, 1), run(6, 8, 1)]);
    top.extrusion[0] = packExtrusion(4, 2);
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(0, 6, 1)]);
    expect(runAt(buildVoxelModel(doc).columns[0], 5)?.quarters).toBe(solidQuarters(1));
    expect(pixelRuns(doc, 0, 0)).toEqual(buildVoxelModel(doc).columns[0]);
  });

  it('fills only the quarters of a diagonal pixel, showing a lower layer in the rest', () => {
    const doc = docFrom(['1'], () => [0, 4]);
    const top = createLayer(1, 1, 'Top');
    top.pixels[0] = 2;
    // Cutting the top right leaves the bottom and left quarters.
    top.extrusion[0] = packExtrusion(1, 4, CUT_TOP_RIGHT);
    doc.layers.push(top);
    const [below, mixed, behind] = buildVoxelModel(doc).columns[0]!;
    expect([below, behind]).toEqual([run(0, 1, 1), { start: 4, end: 5, quarters: 2 * 0x01000000 + 2 * 0x10000 }]);
    expect(mixed.start).toBe(1);
    expect(mixed.end).toBe(4);
    expect([TOP, RIGHT, BOTTOM, LEFT].map((q) => quarterIndex(mixed.quarters, q))).toEqual([1, 1, 2, 2]);
    // From the right, the right quarter shows in both halves; behind, the
    // run has only bottom and left, so the upper half shows the left quarter.
    expect([seenFromRight(mixed.quarters, true), seenFromRight(mixed.quarters, false)]).toEqual([1, 1]);
    expect([seenFromRight(behind.quarters, true), seenFromRight(behind.quarters, false)]).toEqual([2, 2]);
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
    expect(mesh.faces).toBe(6);
    expect(mesh.bounds).toEqual({ min: [-0.5, 0, -1], max: [0.5, 1, 0] });
    const front = faces(mesh.parts[0]).find((q) => q.normal[2] === 1)!;
    expect(box(front)).toEqual({ normal: [0, 0, 1], min: [-0.5, 0, 0], max: [0.5, 1, 0] });
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    const mesh = meshOf(docFrom(['12', '01'], (x, y) => [x, y + 1, x === y ? CUT_TOP_RIGHT : SQUARE]));
    for (const part of mesh.parts) {
      const at = (v: number): Vec3 => [part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]];
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]].map(at);
        const normal = at(part.indices[t]).map((_, k) => part.normals[part.indices[t] * 3 + k]) as Vec3;
        expect(dot(cross(sub(b, a), sub(c, a)), normal)).toBeGreaterThan(0);
      }
    }
  });

  it('drops faces between touching boxes, and spans deep sides with one quad', () => {
    const mesh = meshOf(docFrom(['11'], () => [0, 5]));
    // Two boxes, merged into one.
    expect(mesh.faces).toBe(6);
    const right = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(right.map(box)).toEqual([{ normal: [1, 0, 0], min: [1, 0, -5], max: [1, 1, 0] }]);
  });

  it('merges a filled rectangle of one color into a single box', () => {
    const mesh = meshOf(docFrom(['111', '111'], () => [1, 3]));
    expect(mesh.faces).toBe(6);
    expect(box(faces(mesh.parts[0]).find((q) => q.normal[2] === 1)!)).toEqual({ normal: [0, 0, 1], min: [-1.5, 0, -1], max: [1.5, 2, -1] });
    expect(mesh.bounds).toEqual({ min: [-1.5, 0, -4], max: [1.5, 2, -1] });
  });

  it('merges only faces of one color', () => {
    const mesh = meshOf(docFrom(['1211']));
    const [red, green] = mesh.parts.map(faces);
    expect(red.filter((q) => q.normal[2] === 1).map((q) => [q.min[0], q.max[0]])).toEqual([
      [-2, -1],
      [0, 2],
    ]);
    // Front, back, top and bottom twice, and each end.
    expect(red.length).toBe(10);
    expect(green.length).toBe(4);
  });

  it('merges side faces across rows only where they span the same depths', () => {
    const mesh = meshOf(docFrom(['1', '1', '1'], (_, y) => [0, y < 2 ? 2 : 3]));
    const right = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(right.map(box)).toEqual([
      { normal: [1, 0, 0], min: [0.5, 1, -2], max: [0.5, 3, 0] },
      { normal: [1, 0, 0], min: [0.5, 0, -3], max: [0.5, 1, 0] },
    ]);
  });

  it('cuts side faces where a neighbor covers only part of them', () => {
    // Left pixel 6 deep, right pixel from 2 to 4.
    const mesh = meshOf(docFrom(['12'], (x) => (x === 0 ? [0, 6] : [2, 2])));
    const red = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(red.map((q) => [q.min[2], q.max[2]])).toEqual([
      [-2, 0],
      [-6, -4],
    ]);
  });

  it('shows faces behind translucent colors, but none inside one', () => {
    const behind = meshOf(docFrom(['13']));
    // The red box's right face shows through the glass; glass hides nothing.
    expect(faces(behind.parts[0]).some((q) => q.normal[0] === 1)).toBe(true);
    expect(faces(behind.parts[1]).some((q) => q.normal[0] === -1)).toBe(false);
    expect(meshOf(docFrom(['33'])).faces).toBe(6);
  });

  it('hides front and back faces between stacked runs', () => {
    const doc = docFrom(['1'], () => [0, 2]);
    const back = createLayer(1, 1, 'Back');
    back.pixels[0] = 2;
    back.extrusion[0] = packExtrusion(2, 2);
    doc.layers.unshift(back);
    const mesh = meshOf(doc);
    expect(mesh.faces).toBe(10);
    expect(mesh.parts.map((p) => p.index)).toEqual([1, 2]);
  });

  it('makes a diagonal pixel a wedge: triangles front and back, two sides and a slope', () => {
    const mesh = meshOf(docFrom(['1'], () => [0, 2, CUT_TOP_RIGHT]));
    const all = faces(mesh.parts[0]);
    expect(mesh.faces).toBe(5);
    expect(all.filter((f) => f.corners.length === 3).map((f) => f.normal)).toEqual([
      [0, 0, 1],
      [0, 0, -1],
    ]);
    // The front keeps the bottom left half.
    expect(all.find((f) => f.normal[2] === 1)!.corners).toEqual([
      [-0.5, 1, 0],
      [-0.5, 0, 0],
      [0.5, 0, 0],
    ]);
    const slope = all.find((f) => f.normal[0] > 0 && f.normal[1] > 0)!;
    expect(box(slope).min).toEqual([-0.5, 0, -2]);
    expect(box(slope).max).toEqual([0.5, 1, 0]);
    expect(Math.hypot(...slope.normal)).toBeCloseTo(1, 6);
    expect(all.filter((f) => f.normal[0] === 1 || f.normal[1] === 1)).toEqual([]);
  });

  it('merges the slopes of a staircase into one quad', () => {
    const steps = ['0001', '0011', '0111', '1111'];
    const doc = docFrom(steps, (x, y) => [0, 1, x + y === 3 ? CUT_TOP_LEFT : SQUARE]);
    const slopes = faces(meshOf(doc).parts[0]).filter((f) => f.normal[0] < 0 && f.normal[1] > 0);
    expect(slopes.map(box)).toEqual([{ normal: slopes[0].normal, min: [-2, 0, -1], max: [2, 4, 0] }]);
  });

  it('fills the cut-off half of a diagonal pixel with a lower layer, inside a closed box', () => {
    const doc = docFrom(['1']);
    const top = createLayer(1, 1, 'Top');
    top.pixels[0] = 2;
    top.extrusion[0] = packExtrusion(0, 1, CUT_BOTTOM_LEFT);
    doc.layers.push(top);
    const mesh = meshOf(doc);
    // Two triangles front and back, four sides, and no slope between opaque colors.
    expect(mesh.faces).toBe(8);
    expect(mesh.parts.flatMap(faces).every((f) => f.normal.every((v) => Number.isInteger(v)))).toBe(true);
    expectMeshMatches(doc, mesh);
  });

  it('covers exactly the faces a voxel-by-voxel check finds, once each', () => {
    const random = seeded(7);
    for (let n = 0; n < 30; n++) {
      const doc = randomDoc(random);
      expectMeshMatches(doc, meshOf(doc));
    }
  });

  it('is empty for an empty document', () => {
    const mesh = meshOf(createDocument(3, 3, palette));
    expect(mesh).toEqual({ parts: [], faces: 0, bounds: null });
  });
});
