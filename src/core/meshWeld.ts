/*
 * Turning a polygon soup into a manifold triangle mesh, for watertight
 * export. `buildMesh` writes every face with its own corners and merges
 * faces into big rectangles, so corners of one face can sit along an edge of
 * another (a T-junction) and nothing is shared. A manifold mesh needs every
 * edge shared by exactly two triangles and every corner's triangles to form
 * a single fan.
 */

/** Half-unit grid: `buildMesh` puts every corner on it. */
const GRID = 2;
/** Grid steps a coordinate may take either side of 0, and key sizes from it. */
const REACH = 4096;
const SPAN = REACH * 2;

/** An indexed triangle mesh. */
export interface WeldedMesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex numbers per triangle, in the polygons' winding. */
  indices: Uint32Array;
}

/**
 * Welds a closed surface given as convex polygons into a 2-manifold
 * triangle mesh:
 *
 * 1. Corners at the same place become one vertex.
 * 2. A vertex lying along another polygon's edge is added to that edge, so
 *    edges meet end to end (no T-junctions).
 * 3. Polygons are split into triangles: fanned from a corner whose edges
 *    gained no vertices, or else from a new vertex in the middle, so no
 *    triangle is flat.
 * 4. Where the surface touches itself along an edge or at a point (two
 *    boxes meeting only at an edge, say), each sheet gets its own copy of
 *    the vertices there, so every edge has two triangles and every vertex
 *    one fan. Sheets that are one surface around both ends of such an edge
 *    get their own vertex in its middle instead.
 *
 * `points` holds x, y, z per corner, polygon after polygon, `sizes` the
 * corner count of each, counter-clockwise from outside. Corners must lie on
 * a half-unit grid within ±2048, and edges must run along an axis or at 45°
 * in a plane square to one, as `buildMesh`'s do.
 */
export function weldPolygons(points: Float32Array, sizes: ArrayLike<number>): WeldedMesh {
  // 1. Weld: one vertex per grid position.
  const grid: number[] = [];
  const ids = new Map<number, number>();
  const polygons: number[][] = [];
  let p = 0;
  for (let k = 0; k < sizes.length; k++) {
    const polygon: number[] = [];
    for (let c = 0; c < sizes[k]; c++, p += 3) {
      const g = [points[p], points[p + 1], points[p + 2]].map(toGrid);
      const key = gridKey(g[0], g[1], g[2]);
      let id = ids.get(key);
      if (id === undefined) {
        id = grid.length / 3;
        ids.set(key, id);
        grid.push(g[0], g[1], g[2]);
      }
      polygon.push(id);
    }
    polygons.push(polygon);
  }

  // 2. Every vertex on each line an edge can run along, sorted along it.
  // Only the kinds of line some edge runs along: diagonals are rare.
  const kinds = new Set<number>();
  for (const polygon of polygons) {
    for (let c = 0; c < polygon.length; c++) kinds.add(edgeKind(grid, polygon[c], polygon[(c + 1) % polygon.length]));
  }
  const lines = new Map<number, Array<[number, number]>>();
  for (let id = 0; id < grid.length / 3; id++) {
    for (const kind of kinds) {
      const [key, along] = lineThrough(kind, grid[id * 3], grid[id * 3 + 1], grid[id * 3 + 2]);
      let line = lines.get(key);
      if (!line) lines.set(key, (line = []));
      line.push([along, id]);
    }
  }
  for (const line of lines.values()) line.sort((a, b) => a[0] - b[0]);

  const positions = grid.map((v) => v / GRID);
  const triangles: number[] = [];
  for (const polygon of polygons) {
    const boundary: number[] = [];
    const split: boolean[] = [];
    for (let c = 0; c < polygon.length; c++) {
      const from = polygon[c];
      const between = verticesBetween(grid, lines, from, polygon[(c + 1) % polygon.length]);
      boundary.push(from, ...between);
      split.push(between.length > 0);
    }
    // 3. Fan from a corner neither of whose edges was split, if any.
    const apex = polygon.findIndex((_, c) => !split[c] && !split[(c + polygon.length - 1) % polygon.length]);
    if (apex >= 0) {
      const start = boundary.indexOf(polygon[apex]);
      const ring = [...boundary.slice(start), ...boundary.slice(0, start)];
      for (let i = 1; i + 1 < ring.length; i++) triangles.push(ring[0], ring[i], ring[i + 1]);
    } else {
      const middle = positions.length / 3;
      for (let axis = 0; axis < 3; axis++) {
        positions.push(polygon.reduce((sum, id) => sum + positions[id * 3 + axis], 0) / polygon.length);
      }
      for (let i = 0; i < boundary.length; i++) triangles.push(middle, boundary[i], boundary[(i + 1) % boundary.length]);
    }
  }

  return splitNonManifold(positions, triangles);
}

function toGrid(value: number): number {
  const g = Math.round(value * GRID);
  if (Math.abs(g / GRID - value) > 1e-6 || Math.abs(g) >= REACH) throw new RangeError(`Corner ${value} is off the half-unit grid`);
  return g;
}

function gridKey(x: number, y: number, z: number): number {
  return ((x + REACH) * SPAN + (y + REACH)) * SPAN + (z + REACH);
}

/**
 * Line kinds: along x, y or z, or at 45° in a plane square to one axis, with
 * the difference or the sum of the other two coordinates fixed.
 */
const ALONG_X = 0;
const ALONG_Y = 1;
const ALONG_Z = 2;
const XY_DIFFERENCE = 3;
const XY_SUM = 4;
const XZ_DIFFERENCE = 5;
const XZ_SUM = 6;
const YZ_DIFFERENCE = 7;
const YZ_SUM = 8;

function lineKey(kind: number, a: number, b: number): number {
  return (kind * SPAN * 2 + (a + SPAN)) * SPAN * 2 + (b + SPAN);
}

/** The line of `kind` through a grid point, as its key and the point's position along it. */
function lineThrough(kind: number, x: number, y: number, z: number): [number, number] {
  switch (kind) {
    case ALONG_X:
      return [lineKey(kind, y, z), x];
    case ALONG_Y:
      return [lineKey(kind, x, z), y];
    case ALONG_Z:
      return [lineKey(kind, x, y), z];
    case XY_DIFFERENCE:
      return [lineKey(kind, x - y, z), x];
    case XY_SUM:
      return [lineKey(kind, x + y, z), x];
    case XZ_DIFFERENCE:
      return [lineKey(kind, x - z, y), x];
    case XZ_SUM:
      return [lineKey(kind, x + z, y), x];
    case YZ_DIFFERENCE:
      return [lineKey(kind, y - z, x), y];
    default:
      return [lineKey(kind, y + z, x), y];
  }
}

/** The kind of line the edge from grid vertex `from` to `to` runs along. Throws for any other direction. */
function edgeKind(grid: readonly number[], from: number, to: number): number {
  const dx = grid[to * 3] - grid[from * 3];
  const dy = grid[to * 3 + 1] - grid[from * 3 + 1];
  const dz = grid[to * 3 + 2] - grid[from * 3 + 2];
  if (dy === 0 && dz === 0) return ALONG_X;
  if (dx === 0 && dz === 0) return ALONG_Y;
  if (dx === 0 && dy === 0) return ALONG_Z;
  if (dz === 0 && dx === dy) return XY_DIFFERENCE;
  if (dz === 0 && dx === -dy) return XY_SUM;
  if (dy === 0 && dx === dz) return XZ_DIFFERENCE;
  if (dy === 0 && dx === -dz) return XZ_SUM;
  if (dx === 0 && dy === dz) return YZ_DIFFERENCE;
  if (dx === 0 && dy === -dz) return YZ_SUM;
  throw new RangeError('Edge runs neither along an axis nor at 45° in a plane square to one');
}

/** The vertices strictly between `from` and `to` on the edge joining them, in order from `from`. */
function verticesBetween(grid: readonly number[], lines: ReadonlyMap<number, Array<[number, number]>>, from: number, to: number): number[] {
  const kind = edgeKind(grid, from, to);
  const [key, a] = lineThrough(kind, grid[from * 3], grid[from * 3 + 1], grid[from * 3 + 2]);
  const [, b] = lineThrough(kind, grid[to * 3], grid[to * 3 + 1], grid[to * 3 + 2]);
  const line = lines.get(key) ?? [];
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  // First entry past `low`, by binary search; the line is sorted.
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (line[mid][0] <= low) lo = mid + 1;
    else hi = mid;
  }
  const found: number[] = [];
  for (let i = lo; i < line.length && line[i][0] < high; i++) found.push(line[i][1]);
  return a < b ? found : found.reverse();
}

/**
 * Gives each sheet of the surface its own vertices where sheets touch. Each
 * triangle corner starts as its own vertex; corners are joined across every
 * edge two triangles share as one sheet: the only two at a manifold edge,
 * and at an edge with more, each with its neighbor around the edge on the
 * solid side.
 */
function splitNonManifold(positions: readonly number[], triangles: readonly number[]): WeldedMesh {
  const corners = triangles.length;
  const parent = Int32Array.from({ length: corners }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  // Triangles around each edge, keyed by its lower and higher vertex.
  const vertexCount = positions.length / 3;
  const edges = new Map<number, number[]>();
  for (let t = 0; t < corners / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t * 3 + e];
      const b = triangles[t * 3 + ((e + 1) % 3)];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      let around = edges.get(key);
      if (!around) edges.set(key, (around = []));
      around.push(t);
    }
  }

  const cornerOf = (t: number, vertex: number) => t * 3 + [0, 1, 2].find((k) => triangles[t * 3 + k] === vertex)!;
  /** Joins two triangles' corners at both ends of the edge a–b. */
  const join = (t1: number, t2: number, a: number, b: number) => {
    union(cornerOf(t1, a), cornerOf(t2, a));
    union(cornerOf(t1, b), cornerOf(t2, b));
  };

  /** Edges shared by more than two triangles, with how they were paired. */
  const sheetEdges: Array<{ a: number; b: number; pairs: Array<[number, number]> }> = [];
  for (const [key, around] of edges) {
    const a = Math.floor(key / vertexCount);
    const b = key % vertexCount;
    if (around.length === 2) {
      join(around[0], around[1], a, b);
    } else if (around.length > 2) {
      const pairs = pairAroundEdge(positions, triangles, around, a, b);
      for (const [t1, t2] of pairs) join(t1, t2, a, b);
      sheetEdges.push({ a, b, pairs });
    }
  }

  // A vertex per group of joined corners.
  const vertexOfRoot = new Map<number, number>();
  const out: number[] = [];
  const indices: number[] = new Array<number>(corners);
  for (let i = 0; i < corners; i++) {
    const root = find(i);
    let vertex = vertexOfRoot.get(root);
    if (vertex === undefined) {
      vertex = out.length / 3;
      vertexOfRoot.set(root, vertex);
      const source = triangles[i] * 3;
      out.push(positions[source], positions[source + 1], positions[source + 2]);
    }
    indices[i] = vertex;
  }

  // Sheets that meet along an edge can still be joined around both its ends
  // (the solid pinches to the edge, but is one piece past each end): then
  // they'd share it. Each further sheet gets a vertex of its own in the
  // middle of the edge instead, its two triangles there split in two.
  for (const { a, b, pairs } of sheetEdges) {
    const ends = new Set<string>();
    for (const pair of pairs) {
      const key = `${indices[cornerOf(pair[0], a)]},${indices[cornerOf(pair[0], b)]}`;
      if (!ends.has(key)) {
        ends.add(key);
        continue;
      }
      const middle = out.length / 3;
      for (let axis = 0; axis < 3; axis++) out.push((positions[a * 3 + axis] + positions[b * 3 + axis]) / 2);
      for (const t of pair) {
        // The triangle as (from, to, other), from and to along the edge in its winding.
        const k = [0, 1, 2].find((c) => {
          const next = triangles[t * 3 + ((c + 1) % 3)];
          return (triangles[t * 3 + c] === a && next === b) || (triangles[t * 3 + c] === b && next === a);
        })!;
        const [from, to, other] = [0, 1, 2].map((c) => indices[t * 3 + ((k + c) % 3)]);
        indices[t * 3] = from;
        indices[t * 3 + 1] = middle;
        indices[t * 3 + 2] = other;
        indices.push(middle, to, other);
      }
    }
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(indices) };
}

type Vec3 = [number, number, number];
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p: Vec3): Vec3 => {
  const length = Math.hypot(...p);
  return [p[0] / length, p[1] / length, p[2] / length];
};

/**
 * Pairs up the triangles around an edge shared by more than two, as the
 * sheets of the surface go: sorted by angle around the edge, solid and empty
 * wedges alternate, and each triangle pairs with its neighbor across the
 * solid wedge. Pairs must wind the edge in opposite directions; any that
 * don't (a surface that isn't closed) are left apart.
 */
function pairAroundEdge(
  positions: readonly number[],
  triangles: readonly number[],
  around: readonly number[],
  a: number,
  b: number,
): Array<[number, number]> {
  const at = (v: number): Vec3 => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const origin = at(a);
  const axis = unit(sub(at(b), origin));
  const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(axis, helper));
  const e2 = cross(axis, e1);
  const faces = around.map((t) => {
    const corners = [0, 1, 2].map((k) => triangles[t * 3 + k]);
    const third = corners.find((v) => v !== a && v !== b)!;
    const toward = sub(at(third), origin);
    const angle = Math.atan2(dot(toward, e2), dot(toward, e1));
    const [p, q, r] = corners.map(at);
    const normal = cross(sub(q, p), sub(r, p));
    // Which way the triangle winds the edge: a then b, or b then a.
    const forward = corners.some((v, k) => v === a && corners[(k + 1) % 3] === b);
    // In-face direction away from the edge, square to it.
    const inFace = unit(sub(toward, axis.map((v) => v * dot(toward, axis)) as Vec3));
    return { t, angle, normal, forward, inFace };
  });
  faces.sort((f, g) => f.angle - g.angle);
  // Turning from the first face toward the next by increasing angle: is that the solid side?
  const first = faces[0];
  const solidAhead = dot(first.normal, cross(axis, first.inFace)) < 0;
  const pairs: Array<[number, number]> = [];
  for (let i = solidAhead ? 0 : 1; i < faces.length + (solidAhead ? 0 : 1); i += 2) {
    const f = faces[i % faces.length];
    const g = faces[(i + 1) % faces.length];
    if (f.forward !== g.forward) pairs.push([f.t, g.t]);
  }
  return pairs;
}
