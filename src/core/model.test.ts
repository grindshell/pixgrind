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
import {
  AXIS_X,
  AXIS_Y,
  AXIS_Z,
  directionAxis,
  directionVector,
  FACINGS,
  facingVoxel,
  NEG_Y,
  NEG_Z,
  oppositeDirection,
  POS_X,
  POS_Y,
  POS_Z,
  planeExtent,
  planeSize,
  type Direction,
  type Facing,
} from './facing.ts';
import { createLayer, type Layer } from './layer.ts';
import {
  buildMesh,
  buildVoxelModel,
  otherSidesView,
  QUARTER_DIRECTIONS,
  quarterIndex,
  quarterToward,
  runAt,
  seenFrom,
  sliceOf,
  solidQuarters,
  viewModel,
  voxelSampler,
  type Content,
  type MeshPart,
  type ModelMesh,
} from './model.ts';
import { colorForIndex, createPalette } from './palette.ts';
import { createDocument, createFacingLayer, type PixelDocument } from './pixelDocument.ts';

const RED = 0xff0000ff;
const GREEN = 0x00ff00ff;
const GLASS = 0x0000ff80;
const palette = createPalette('test', [RED, GREEN, GLASS, 0xffffff00]);

type Vec3 = [number, number, number];

/**
 * A document `depth` deep whose front layer is rows of digits (palette
 * indices), each pixel extruded per `extrude(x, y)` as [offset, depth, shape].
 */
function docFrom(
  rows: string[],
  extrude: (x: number, y: number) => [number, number, Shape?] = () => [0, 1],
  depth = 1,
): PixelDocument {
  const doc = createDocument(rows[0].length, rows.length, palette, 'test', depth);
  const [layer] = doc.layers;
  layer.pixels.set(rows.join('').split('').map(Number));
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) layer.extrusion[y * doc.width + x] = packExtrusion(...extrude(x, y));
  }
  return doc;
}

/** A layer on `facing` of `doc`, added on top, with pixel (u, v) of color `index` extruded as given. */
function addPixel(doc: PixelDocument, facing: Facing, u: number, v: number, index: number, extrusion: number): Layer {
  const layer = createFacingLayer(doc, facing, 'Layer');
  layer.pixels[v * layer.width + u] = index;
  layer.extrusion[v * layer.width + u] = extrusion;
  doc.layers.push(layer);
  return layer;
}

const meshOf = (doc: PixelDocument) => buildMesh(buildVoxelModel(doc), doc.palette);
const run = (start: number, end: number, index: number) => ({ start, end, axis: AXIS_Z, quarters: solidQuarters(index) });

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
      normal: Array.from(normals!.slice(v * 3, v * 3 + 3)),
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
 * A small document with layers on random sides, colors (including glass and
 * the fully transparent one), shapes, and extrusions that often repeat a
 * neighbor's, so there's plenty to merge and plenty of edges. Some boxes
 * reach past the volume, which cuts them.
 */
function randomDoc(random: () => number, facings: readonly Facing[] = FACINGS): PixelDocument {
  const pick = (count: number) => Math.floor(random() * count);
  const doc = createDocument(1 + pick(5), 1 + pick(5), palette, 'random', 1 + pick(5));
  doc.layers = [];
  for (let n = 1 + pick(3); n > 0; n--) {
    const facing = facings[pick(facings.length)];
    const layer = createFacingLayer(doc, facing, 'Layer');
    const extent = planeExtent(doc, facing);
    for (let i = 0; i < layer.pixels.length; i++) {
      const copy = i > 0 && random() < 0.6;
      layer.pixels[i] = copy ? layer.pixels[i - 1] : pick(5);
      const shape = random() < 0.5 ? SQUARE : SHAPES[pick(SHAPES.length)];
      layer.extrusion[i] = copy && random() < 0.7 ? layer.extrusion[i - 1] : packExtrusion(pick(extent), 1 + pick(4), shape);
    }
    doc.layers.push(layer);
  }
  return doc;
}

/**
 * A piece of the model's surface that should show or not: a quarter of one
 * side of a voxel (a triangle along one edge), or a half-diagonal between
 * two of its quarters.
 */
interface Slot {
  color: number;
  exposed: boolean;
  normal: Vec3;
  corners: Vec3[];
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const plus = (p: readonly number[], q: readonly number[], scale = 1): Vec3 => [p[0] + q[0] * scale, p[1] + q[1] * scale, p[2] + q[2] * scale];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const normalKey = (normal: readonly number[]) => normal.map((v) => Math.round(v * 1000) / 1000 + 0).join(',');
const unit = (p: Vec3): Vec3 => p.map((v) => v / Math.hypot(...p)) as Vec3;

/**
 * Every slot of every voxel, worked out voxel by voxel from the model's
 * content, in mesh coordinates. A side's triangle belongs to the quarter
 * touching it, or to the quarter along its edge when the voxel is split
 * across that side. Watertight, only the same color hides a face.
 */
function slots(doc: PixelDocument, watertight: boolean): Slot[] {
  const { width, height, depth, columns } = buildVoxelModel(doc);
  const content = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? runAt(columns[y * width + x], z) : undefined;
  const hides = (cover: number, face: number) =>
    cover !== 0 && (cover === face || (!watertight && alpha(colorForIndex(doc.palette, cover)) === 255));
  const toMesh = (p: Vec3): Vec3 => [p[0] - width / 2, height - p[1], depth / 2 - p[2]];
  const meshNormal = (v: Vec3): Vec3 => unit([v[0], 0 - v[1], 0 - v[2]]);
  /** The color of a side's triangle along edge `edge` (numbered as the side's axis's quarters). */
  const sideColor = (c: Content | undefined, side: Direction, edge: number) => {
    if (!c) return 0;
    if (c.axis === directionAxis(side)) return quarterIndex(c.quarters, edge);
    return quarterIndex(c.quarters, quarterToward(c.axis, side));
  };
  const result: Slot[] = [];
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = content(x, y, z);
        if (!c) continue;
        const center: Vec3 = [x + 0.5, y + 0.5, z + 0.5];
        const slot = (color: number, cover: number, normal: Vec3, corners: Vec3[]) =>
          result.push({ color, exposed: !hides(cover, color), normal: meshNormal(normal), corners: corners.map(toMesh) });
        for (let side = 0; side < 6; side++) {
          const d = side as Direction;
          const n = directionVector(d);
          const neighbor = content(x + n[0], y + n[1], z + n[2]);
          const edges = QUARTER_DIRECTIONS[directionAxis(d)];
          const middle = plus(center, n, 0.5);
          for (let e = 0; e < 4; e++) {
            const color = sideColor(c, d, e);
            if (!color) continue;
            const along = plus(middle, directionVector(edges[e]), 0.5);
            const beside = directionVector(edges[(e + 1) % 4]);
            slot(color, sideColor(neighbor, oppositeDirection(d), e), n, [middle, plus(along, beside, 0.5), plus(along, beside, -0.5)]);
          }
        }
        const sides = QUARTER_DIRECTIONS[c.axis];
        const axis = directionVector((c.axis * 2) as Direction);
        for (let q = 0; q < 4; q++) {
          const next = (q + 1) % 4;
          const toCorner = plus(directionVector(sides[q]), directionVector(sides[next]));
          const corners = [plus(center, axis, -0.5), plus(plus(center, toCorner, 0.5), axis, -0.5), plus(plus(center, toCorner, 0.5), axis, 0.5), plus(center, axis, 0.5)];
          for (const [a, b] of [
            [q, next],
            [next, q],
          ]) {
            const color = quarterIndex(c.quarters, a);
            if (color) slot(color, quarterIndex(c.quarters, b), sub(directionVector(sides[b]), directionVector(sides[a])), corners);
          }
        }
      }
    }
  }
  return result;
}

/** A part's triangles as corner positions. */
function trianglesOf(part: MeshPart): Vec3[][] {
  const at = (v: number): Vec3 => [part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]];
  const result: Vec3[][] = [];
  for (let t = 0; t < part.indices.length; t += 3) result.push([part.indices[t], part.indices[t + 1], part.indices[t + 2]].map(at));
  return result;
}

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
function expectMeshMatches(doc: PixelDocument, mesh: ModelMesh, watertight = false): void {
  const triangles = new Map<string, Array<{ color: number; corners: Vec3[]; normal: Vec3 }>>();
  const meshArea = new Map<string, number>();
  for (const part of mesh.parts) {
    for (const corners of trianglesOf(part)) {
      // From the winding, so meshes without normals check the same way.
      const normal = unit(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
      const key = normalKey(normal);
      if (!triangles.has(key)) triangles.set(key, []);
      triangles.get(key)!.push({ color: part.index, corners, normal });
      meshArea.set(`${key} ${part.index}`, (meshArea.get(`${key} ${part.index}`) ?? 0) + area(corners));
    }
  }
  const slotArea = new Map<string, number>();
  for (const slot of slots(doc, watertight)) {
    const key = normalKey(slot.normal);
    if (slot.exposed) slotArea.set(`${key} ${slot.color}`, (slotArea.get(`${key} ${slot.color}`) ?? 0) + area(slot.corners));
    // Points inside the slot, nudged off the lines mesh edges could lie on.
    const middle = [0, 1, 2].map((k) => slot.corners.reduce((sum, c) => sum + c[k], 0) / slot.corners.length) as Vec3;
    const e1 = unit(sub(slot.corners[1], slot.corners[0]));
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

/**
 * Checks a part is a closed 2-manifold: each edge is used once each way (so
 * by exactly two triangles, wound oppositely), each vertex's triangles form
 * a single fan, and no triangle is flat.
 */
function expectManifold(part: MeshPart): void {
  const { indices } = part;
  const directed = new Set<string>();
  // Per vertex: for each of its triangles, the next corner → the previous one.
  const fans = new Map<number, Map<number, number>>();
  for (let t = 0; t < indices.length; t += 3) {
    const corners = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const [a, b, c] = [corners[k], corners[(k + 1) % 3], corners[(k + 2) % 3]];
      expect(directed.has(`${a},${b}`), `edge ${a}→${b} used twice`).toBe(false);
      directed.add(`${a},${b}`);
      if (!fans.has(a)) fans.set(a, new Map());
      fans.get(a)!.set(b, c);
    }
  }
  for (const corners of trianglesOf(part)) expect(area(corners)).toBeGreaterThan(1e-9);
  for (const key of directed) {
    const [a, b] = key.split(',');
    expect(directed.has(`${b},${a}`), `edge ${key} has no twin`).toBe(true);
  }
  for (const [vertex, fan] of fans) {
    // Going around the vertex, triangle by triangle, must visit them all.
    const [start] = fan.keys();
    let at = start;
    let steps = 0;
    do {
      at = fan.get(at)!;
      steps++;
    } while (at !== start && steps <= fan.size);
    expect(steps, `vertex ${vertex} has ${fan.size} triangles in more than one fan`).toBe(fan.size);
  }
}

/** Volume enclosed by a part's triangles (positive when they face out). */
function volumeOf(part: MeshPart): number {
  return trianglesOf(part).reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)) / 6, 0);
}

/** Each color's volume in the model, from its runs: a quarter of a unit per quarter per voxel. */
function colorVolumes(doc: PixelDocument): Map<number, number> {
  const volumes = new Map<number, number>();
  for (const runs of buildVoxelModel(doc).columns) {
    for (const { start, end, quarters } of runs ?? []) {
      for (let q = 0; q < 4; q++) {
        const index = quarterIndex(quarters, q);
        if (index) volumes.set(index, (volumes.get(index) ?? 0) + (end - start) / 4);
      }
    }
  }
  return volumes;
}

const quartersOf = (content: Content | undefined) => [0, 1, 2, 3].map((q) => quarterIndex(content?.quarters ?? 0, q));

describe('buildVoxelModel', () => {
  it('extrudes each front pixel from the back toward the front', () => {
    // 4 deep: z runs front (0) to back (3).
    const model = buildVoxelModel(docFrom(['10', '02'], (x) => (x === 0 ? [0, 3] : [2, 1]), 4));
    expect(model.depth).toBe(4);
    expect(model.columns[0]).toEqual([run(1, 4, 1)]);
    expect(model.columns[1]).toBeUndefined();
    expect(model.columns[3]).toEqual([run(1, 2, 2)]);
  });

  it('stacks layers behind the same pixel, the upper winning overlaps', () => {
    const doc = docFrom(['1'], () => [0, 4], 8);
    const top = addPixel(doc, 'front', 0, 0, 2, packExtrusion(2, 4));
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(2, 6, 2), run(6, 8, 1)]);
    top.extrusion[0] = packExtrusion(6, 2);
    top.pixels[0] = 1;
    // A gap from 2 to 4; same-color runs that touch merge.
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(0, 2, 1), run(4, 8, 1)]);
    top.extrusion[0] = packExtrusion(4, 2);
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(2, 8, 1)]);
  });

  it('fills only the quarters of a diagonal pixel, showing a lower layer in the rest', () => {
    const doc = docFrom(['1'], () => [0, 4], 5);
    // Cutting the top right leaves the bottom and left quarters.
    addPixel(doc, 'front', 0, 0, 2, packExtrusion(1, 4, CUT_TOP_RIGHT));
    const [front, mixed, behind] = buildVoxelModel(doc).columns[0]!;
    expect(front).toMatchObject({ start: 0, end: 1, axis: AXIS_Z });
    expect(quartersOf(front)).toEqual([0, 0, 2, 2]);
    expect(mixed).toMatchObject({ start: 1, end: 4 });
    expect(quartersOf(mixed)).toEqual([1, 1, 2, 2]);
    expect(behind).toEqual(run(4, 5, 1));
  });

  it('runs boxes on the top and bottom up and down, and on the sides across', () => {
    // 2 wide, 3 tall, 2 deep.
    const doc = createDocument(2, 3, palette, 'test', 2);
    // The top's row 0 is the back; its boxes grow up from the floor.
    addPixel(doc, 'top', 1, 0, 1, packExtrusion(0, 2));
    const model = buildVoxelModel(doc);
    expect(model.columns[1 * 2 + 1]).toEqual([run(1, 2, 1)]);
    expect(model.columns[2 * 2 + 1]).toEqual([run(1, 2, 1)]);
    expect(model.columns.filter(Boolean)).toHaveLength(2);
    // The right side's column 0 is the front; its boxes grow from the left wall.
    addPixel(doc, 'right', 0, 0, 2, packExtrusion(1, 1));
    expect(buildVoxelModel(doc).columns[1]).toEqual([run(0, 1, 2)]);
    // The back is mirrored: its column 0 is the right, and boxes grow from the front.
    addPixel(doc, 'back', 0, 2, 2, packExtrusion(1, 1));
    expect(buildVoxelModel(doc).columns[2 * 2 + 1]).toEqual([run(1, 2, 2)]);
  });

  it('cuts diagonal pixels across their own axis', () => {
    const doc = createDocument(1, 1, palette, 'test', 1);
    // From above, the top left is the back left.
    addPixel(doc, 'top', 0, 0, 1, packExtrusion(0, 1, CUT_TOP_LEFT));
    let [content] = buildVoxelModel(doc).columns[0]!;
    expect(content.axis).toBe(AXIS_Y);
    expect(quarterIndex(content.quarters, quarterToward(AXIS_Y, POS_Z))).toBe(0);
    expect(quarterIndex(content.quarters, quarterToward(AXIS_Y, POS_X))).toBe(1);
    // From the right, its left is the front and its top is up.
    doc.layers.push(createFacingLayer(doc, 'right', 'Layer'));
    doc.layers.at(-1)!.pixels[0] = 2;
    doc.layers.at(-1)!.extrusion[0] = packExtrusion(0, 1, CUT_BOTTOM_LEFT);
    [content] = buildVoxelModel(doc).columns[0]!;
    expect(content.axis).toBe(AXIS_X);
    // Split across different axes, the lower layer keeps only its quarter on
    // a side both split alike (the front, along z), not the bottom.
    expect([NEG_Y, POS_Z, POS_Y, NEG_Z].map((side) => quarterIndex(content.quarters, quarterToward(AXIS_X, side)))).toEqual([
      2, 2, 0, 1,
    ]);
  });

  it('cuts boxes at the side of the volume', () => {
    const doc = docFrom(['1'], () => [1, 5], 3);
    expect(buildVoxelModel(doc).columns[0]).toEqual([run(0, 2, 1)]);
  });

  it('leaves out hidden layers and fully transparent colors', () => {
    const doc = docFrom(['14']);
    expect(buildVoxelModel(doc).columns[1]).toBeUndefined();
    doc.layers[0].visible = false;
    expect(buildVoxelModel(doc).columns.some(Boolean)).toBe(false);
  });

  it('agrees with sampling voxels one at a time', () => {
    const random = seeded(3);
    for (let n = 0; n < 30; n++) {
      const doc = randomDoc(random);
      const { columns } = buildVoxelModel(doc);
      const sample = voxelSampler(doc);
      for (let z = 0; z < doc.depth; z++) {
        for (let y = 0; y < doc.height; y++) {
          for (let x = 0; x < doc.width; x++) {
            const found = runAt(columns[y * doc.width + x], z);
            const sampled = sample(x, y, z);
            expect(sampled && { axis: sampled.axis, quarters: sampled.quarters }).toEqual(found ? { axis: found.axis, quarters: found.quarters } : null);
          }
        }
      }
    }
  });
});

describe('views of the model', () => {
  it('slice the volume behind a column as the model has it', () => {
    const random = seeded(23);
    for (let n = 0; n < 20; n++) {
      const doc = randomDoc(random);
      const sample = voxelSampler(doc);
      for (const facing of FACINGS) {
        const { width, height } = planeSize(doc, facing);
        for (let u = 0; u < width; u++) {
          const slice = sliceOf(doc, facing, u);
          expect([slice.width, slice.height]).toEqual([planeExtent(doc, facing), height]);
          for (let v = 0; v < height; v++) {
            for (let w = 0; w < slice.width; w++) {
              const content = sample(...facingVoxel(doc, facing, u, v, w));
              const cell = v * slice.width + w;
              expect(slice.quarters[cell] ? { axis: slice.axes[cell], quarters: slice.quarters[cell] } : null).toEqual(content);
            }
          }
        }
      }
    }
  });

  it('show the nearest voxel seen from a side, per half', () => {
    // From the front: a red box at the back, a green one in front of it on the right.
    const doc = docFrom(['11'], () => [0, 1], 3);
    addPixel(doc, 'front', 1, 0, 2, packExtrusion(2, 1, CUT_TOP_LEFT));
    const model = buildVoxelModel(doc);
    const front = viewModel(model, NEG_Z, POS_X, POS_Y);
    expect([front.width, front.height]).toEqual([2, 2]);
    // Looking along the cut, the upper half sees past it to the red behind.
    expect(Array.from(front.pixels)).toEqual([1, 1, 1, 2]);
    const top = viewModel(model, NEG_Y, POS_X, NEG_Z);
    // From above, rows run back to front: the reds at the back, the green at the front right.
    expect([top.width, top.height]).toEqual([2, 6]);
    const upperHalves = [0, 2, 4].map((row) => Array.from(top.pixels.slice(row * 2, row * 2 + 2)));
    expect(upperHalves).toEqual([
      [1, 1],
      [0, 0],
      [0, 2],
    ]);
  });

  it('guide one side with the others', () => {
    const doc = docFrom(['10'], () => [0, 2], 2);
    addPixel(doc, 'top', 1, 0, 2, packExtrusion(0, 1));
    // The top sees the front's box and not its own layer.
    expect(otherSidesView(doc, 'top')).toEqual({ width: 2, height: 2, pixels: Uint8Array.of(1, 0, 1, 0) });
    expect(otherSidesView(doc, 'front')).toEqual({ width: 2, height: 1, pixels: Uint8Array.of(0, 2) });
  });
});

describe('seenFrom', () => {
  // A front diagonal keeping the bottom and left (red) over a lower green square.
  const mixed: Content = { axis: AXIS_Z, quarters: 2 + 2 * 0x100 + 1 * 0x10000 + 1 * 0x1000000 };
  const halves = (content: Content, side: Direction, up: Direction) => [true, false].map((upper) => seenFrom(content, side, up, upper));

  it('shows the quarter on the viewer’s side, else those beyond it', () => {
    expect(halves(mixed, POS_X, NEG_Y)).toEqual([2, 2]);
    const cut: Content = { axis: AXIS_Z, quarters: 1 * 0x10000 + 1 * 0x1000000 };
    // Bottom and left only: from the right, the bottom shows below and the left above.
    expect(halves(cut, POS_X, NEG_Y)).toEqual([1, 1]);
    expect(halves({ axis: AXIS_Z, quarters: 2 * 0x10000 + 1 * 0x1000000 }, POS_X, NEG_Y)).toEqual([1, 2]);
  });

  it('looks down one quarter per half along the split axis', () => {
    expect(halves(mixed, POS_Z, NEG_Y)).toEqual([2, 1]);
    expect(halves({ axis: AXIS_X, quarters: 3 }, POS_X, NEG_Y)).toEqual([3, 0]);
  });
});

describe('buildMesh', () => {
  it('makes a single pixel a unit cube facing +z, centered on x and z, standing on y = 0', () => {
    const mesh = meshOf(docFrom(['1']));
    expect(mesh.faces).toBe(6);
    expect(mesh.bounds).toEqual({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] });
    const front = faces(mesh.parts[0]).find((q) => q.normal[2] === 1)!;
    expect(box(front)).toEqual({ normal: [0, 0, 1], min: [-0.5, 0, 0.5], max: [0.5, 1, 0.5] });
  });

  it('winds every triangle counter-clockwise seen from outside', () => {
    const doc = docFrom(['12', '01'], (x, y) => [x, y + 1, x === y ? CUT_TOP_RIGHT : SQUARE], 3);
    addPixel(doc, 'top', 0, 1, 2, packExtrusion(0, 2, CUT_TOP_LEFT));
    addPixel(doc, 'left', 2, 1, 1, packExtrusion(0, 1, CUT_BOTTOM_LEFT));
    for (const part of meshOf(doc).parts) {
      const at = (v: number): Vec3 => [part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]];
      for (let t = 0; t < part.indices.length; t += 3) {
        const [a, b, c] = [part.indices[t], part.indices[t + 1], part.indices[t + 2]].map(at);
        const normal = at(part.indices[t]).map((_, k) => part.normals![part.indices[t] * 3 + k]) as Vec3;
        expect(dot(cross(sub(b, a), sub(c, a)), normal)).toBeGreaterThan(0);
      }
    }
  });

  it('drops faces between touching boxes, and spans deep sides with one quad', () => {
    const mesh = meshOf(docFrom(['11'], () => [0, 5], 5));
    // Two boxes, merged into one.
    expect(mesh.faces).toBe(6);
    const right = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(right.map(box)).toEqual([{ normal: [1, 0, 0], min: [1, 0, -2.5], max: [1, 1, 2.5] }]);
  });

  it('merges a filled rectangle of one color into a single box', () => {
    const mesh = meshOf(docFrom(['111', '111'], () => [1, 3], 4));
    expect(mesh.faces).toBe(6);
    expect(box(faces(mesh.parts[0]).find((q) => q.normal[2] === 1)!)).toEqual({ normal: [0, 0, 1], min: [-1.5, 0, 2], max: [1.5, 2, 2] });
    expect(mesh.bounds).toEqual({ min: [-1.5, 0, -1], max: [1.5, 2, 2] });
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
    const mesh = meshOf(docFrom(['1', '1', '1'], (_, y) => [0, y < 2 ? 2 : 3], 3));
    const right = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(right.map(box)).toEqual([
      { normal: [1, 0, 0], min: [0.5, 1, -1.5], max: [0.5, 3, 0.5] },
      { normal: [1, 0, 0], min: [0.5, 0, -1.5], max: [0.5, 1, 1.5] },
    ]);
  });

  it('cuts side faces where a neighbor covers only part of them', () => {
    // Left pixel 6 deep, right pixel from 2 to 4 out from the back.
    const mesh = meshOf(docFrom(['12'], (x) => (x === 0 ? [0, 6] : [2, 2]), 6));
    const red = faces(mesh.parts[0]).filter((q) => q.normal[0] === 1);
    expect(red.map((q) => [q.min[2], q.max[2]])).toEqual([
      [1, 3],
      [-3, -1],
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
    const doc = docFrom(['1'], () => [0, 2], 4);
    addPixel(doc, 'front', 0, 0, 2, packExtrusion(2, 2));
    const mesh = meshOf(doc);
    expect(mesh.faces).toBe(10);
    expect(mesh.parts.map((p) => p.index)).toEqual([1, 2]);
  });

  it('makes a diagonal pixel a wedge: triangles front and back, two sides and a slope', () => {
    const mesh = meshOf(docFrom(['1'], () => [0, 2, CUT_TOP_RIGHT], 2));
    const all = faces(mesh.parts[0]);
    expect(mesh.faces).toBe(5);
    expect(all.filter((f) => f.corners.length === 3).map((f) => f.normal)).toEqual([
      [0, 0, 1],
      [0, 0, -1],
    ]);
    // The front keeps the bottom left half.
    const front = all.find((f) => f.normal[2] === 1)!.corners.map((c) => c.join(' '));
    expect(front.sort()).toEqual(['-0.5 0 1', '-0.5 1 1', '0.5 0 1']);
    const slope = all.find((f) => f.normal[0] > 0 && f.normal[1] > 0)!;
    expect(box(slope).min).toEqual([-0.5, 0, -1]);
    expect(box(slope).max).toEqual([0.5, 1, 1]);
    expect(Math.hypot(...slope.normal)).toBeCloseTo(1, 6);
    expect(all.filter((f) => f.normal[0] === 1 || f.normal[1] === 1)).toEqual([]);
  });

  it('merges the slopes of a staircase into one quad', () => {
    const steps = ['0001', '0011', '0111', '1111'];
    const doc = docFrom(steps, (x, y) => [0, 1, x + y === 3 ? CUT_TOP_LEFT : SQUARE]);
    const slopes = faces(meshOf(doc).parts[0]).filter((f) => f.normal[0] < 0 && f.normal[1] > 0);
    expect(slopes.map(box)).toEqual([{ normal: slopes[0].normal, min: [-2, 0, -0.5], max: [2, 4, 0.5] }]);
  });

  it('merges the slopes of a staircase drawn on the top or a side into one quad', () => {
    // A roof seen from the right: rising to the back, then falling.
    const doc = createDocument(3, 4, palette, 'roof', 4);
    const side = createFacingLayer(doc, 'right', 'Roof');
    const rows = ['0110', '1111', '1111', '1111'];
    side.pixels.set(rows.join('').split('').map(Number));
    for (let i = 0; i < side.pixels.length; i++) {
      const [u, v] = [i % 4, Math.floor(i / 4)];
      const shape = v === 0 ? (u === 1 ? CUT_TOP_LEFT : CUT_TOP_RIGHT) : v === 1 && (u === 0 || u === 3) ? (u === 0 ? CUT_TOP_LEFT : CUT_TOP_RIGHT) : SQUARE;
      side.extrusion[i] = packExtrusion(0, 3, shape);
    }
    doc.layers.push(side);
    const mesh = meshOf(doc);
    // Each slope, front and back, is one quad across the roof's width.
    const slopes = faces(mesh.parts[0]).filter((f) => f.normal[1] > 0 && f.normal[2] !== 0);
    expect(slopes.map((f) => f.corners.length)).toEqual([4, 4]);
    expect(slopes.every((f) => f.max[0] - f.min[0] === 3)).toBe(true);
    expectMeshMatches(doc, mesh);
  });

  it('fills the cut-off half of a diagonal pixel with a lower layer, inside a closed box', () => {
    const doc = docFrom(['1']);
    addPixel(doc, 'front', 0, 0, 2, packExtrusion(0, 1, CUT_BOTTOM_LEFT));
    const mesh = meshOf(doc);
    // Two triangles front and back, four sides, and no slope between opaque colors.
    expect(mesh.faces).toBe(8);
    expect(mesh.parts.flatMap(faces).every((f) => f.normal.every((v) => Number.isInteger(v)))).toBe(true);
    expectMeshMatches(doc, mesh);
  });

  it('covers exactly the faces a voxel-by-voxel check finds, once each', () => {
    const random = seeded(7);
    for (let n = 0; n < 40; n++) {
      const doc = randomDoc(random);
      expectMeshMatches(doc, meshOf(doc));
    }
  });

  it('is empty for an empty document', () => {
    const mesh = meshOf(createDocument(3, 3, palette));
    expect(mesh).toEqual({ parts: [], faces: 0, bounds: null });
  });
});

describe('buildMesh, watertight', () => {
  const watertightOf = (doc: PixelDocument) => buildMesh(buildVoxelModel(doc), doc.palette, { watertight: true });

  it('closes every color, so where two touch both have a face', () => {
    const mesh = watertightOf(docFrom(['12']));
    expect(mesh.faces).toBe(12);
    expect(meshOf(docFrom(['12'])).faces).toBe(10);
    for (const part of mesh.parts) {
      expect(part.normals).toBeNull();
      // A cube: 8 shared corners, 12 triangles.
      expect([part.positions.length / 3, part.indices.length / 3]).toEqual([8, 12]);
      expectManifold(part);
      expect(volumeOf(part)).toBeCloseTo(1, 9);
    }
  });

  it('gives boxes that touch only along an edge their own vertices', () => {
    const [part] = watertightOf(docFrom(['10', '01'])).parts;
    expect(part.positions.length / 3).toBe(16);
    expectManifold(part);
  });

  it('adds vertices where merged faces meet others along their edges', () => {
    // The back is one quad across both boxes; the front is two (different depths).
    const [part] = watertightOf(docFrom(['11'], (x) => [0, x + 1], 2)).parts;
    expectManifold(part);
    expect(volumeOf(part)).toBeCloseTo(3, 9);
  });

  it('is a closed 2-manifold per color, holding its volume, on random documents', () => {
    const random = seeded(11);
    for (let n = 0; n < 40; n++) {
      const doc = randomDoc(random);
      const mesh = watertightOf(doc);
      const volumes = colorVolumes(doc);
      for (const part of mesh.parts) {
        expectManifold(part);
        expect(volumeOf(part)).toBeCloseTo(volumes.get(part.index)!, 6);
      }
      expectMeshMatches(doc, mesh, true);
    }
  });

  it('stays manifold where a color pinches to a line under a flat face, in dense documents', () => {
    // Many layers on every side, sparsely painted, give solids of one color
    // that touch along an edge right under a face that would otherwise merge
    // across it.
    const random = seeded(29);
    const pick = (count: number) => Math.floor(random() * count);
    for (let n = 0; n < 6; n++) {
      const doc = createDocument(8, 7, palette, 'dense', 6);
      doc.layers = [];
      for (const facing of [...FACINGS, ...FACINGS]) {
        const layer = createFacingLayer(doc, facing, 'Layer');
        for (let i = 0; i < layer.pixels.length; i++) {
          if (random() < 0.6) continue;
          layer.pixels[i] = 1 + pick(2);
          layer.extrusion[i] = packExtrusion(pick(planeExtent(doc, facing)), 1 + pick(3), SHAPES[pick(SHAPES.length)]);
        }
        doc.layers.push(layer);
      }
      const volumes = colorVolumes(doc);
      for (const part of watertightOf(doc).parts) {
        expectManifold(part);
        expect(volumeOf(part)).toBeCloseTo(volumes.get(part.index)!, 6);
      }
    }
  });

  it('closes diagonals on every axis', () => {
    const random = seeded(19);
    for (const facings of [['top'], ['left', 'right'], ['bottom', 'front']] as Facing[][]) {
      for (let n = 0; n < 10; n++) {
        const doc = randomDoc(random, facings);
        for (const part of watertightOf(doc).parts) expectManifold(part);
      }
    }
  });
});

describe('model axes', () => {
  it('splits only across the axis of a layer’s boxes', () => {
    expect([AXIS_X, AXIS_Y, AXIS_Z].map((axis) => QUARTER_DIRECTIONS[axis].map(directionAxis).includes(axis))).toEqual([false, false, false]);
    expect(createLayer(1, 1, 'x').facing).toBe('front');
  });
});
