import { describe, expect, it } from 'vitest';
import { weldPolygons } from './meshWeld.ts';

type Point = [number, number, number];

/** Polygons (corner lists, counter-clockwise from outside) as `weldPolygons` takes them. */
function soup(polygons: Point[][]): [Float32Array, number[]] {
  return [Float32Array.from(polygons.flat(2)), polygons.map((p) => p.length)];
}

/** The six faces of the box from `min` to `max`, each its own quad. */
function box([x0, y0, z0]: Point, [x1, y1, z1]: Point): Point[][] {
  return [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  ];
}

/** How many triangles use each undirected edge. */
function edgeUses(indices: Uint32Array): number[] {
  const uses = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [indices[t + k], indices[t + ((k + 1) % 3)]].sort((p, q) => p - q);
      uses.set(`${a},${b}`, (uses.get(`${a},${b}`) ?? 0) + 1);
    }
  }
  return [...new Set(uses.values())];
}

describe('weldPolygons', () => {
  it('shares corners between faces', () => {
    const { positions, indices } = weldPolygons(...soup(box([0, 0, 0], [1, 1, 1])));
    expect(positions.length / 3).toBe(8);
    expect(indices.length / 3).toBe(12);
    expect(edgeUses(indices)).toEqual([2]);
  });

  it('adds a corner lying along another face’s edge to it', () => {
    // Two unit boxes side by side, front and back merged into long quads,
    // but the top split in two: its middle corners sit on the long edges.
    const faces = box([0, 0, 0], [2, 1, 1]).filter((_, k) => k !== 4);
    faces.push(
      [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      [[1, 1, 1], [2, 1, 1], [2, 1, 0], [1, 1, 0]],
    );
    const { positions, indices } = weldPolygons(...soup(faces));
    expect(edgeUses(indices)).toEqual([2]);
    // The 8 corners and the 2 in the top's middle; no new ones inside faces,
    // since each long face has a corner whose edges weren't split.
    expect(positions.length / 3).toBe(10);
  });

  it('keeps boxes touching only along an edge apart', () => {
    const { positions, indices } = weldPolygons(...soup([...box([0, 0, 0], [1, 1, 1]), ...box([1, 1, 0], [2, 2, 1])]));
    expect(positions.length / 3).toBe(16);
    expect(edgeUses(indices)).toEqual([2]);
  });

  it('refuses corners off the half-unit grid and edges at other angles', () => {
    expect(() => weldPolygons(...soup([[[0.25, 0, 0], [1, 0, 0], [1, 1, 0]]]))).toThrow(RangeError);
    expect(() => weldPolygons(...soup([[[0, 0, 0], [2, 1, 0], [0, 1, 0]]]))).toThrow(/45°/);
  });
});
