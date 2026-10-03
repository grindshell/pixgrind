import { describe, expect, it } from 'vitest';
import {
  directionAxis,
  directionVector,
  FACINGS,
  facingFrame,
  facingVoxel,
  isFacing,
  planeExtent,
  planeSize,
  stepsAlong,
  type Direction,
} from './facing.ts';

const volume = { width: 4, height: 3, depth: 2 };

describe('facings', () => {
  it('see the volume at the size of the two axes across their camera', () => {
    expect(FACINGS.map((facing) => [facing, planeSize(volume, facing), planeExtent(volume, facing)])).toEqual([
      ['front', { width: 4, height: 3 }, 2],
      ['back', { width: 4, height: 3 }, 2],
      ['left', { width: 2, height: 3 }, 4],
      ['right', { width: 2, height: 3 }, 4],
      ['top', { width: 4, height: 2 }, 3],
      ['bottom', { width: 4, height: 2 }, 3],
    ]);
    expect(isFacing('top')).toBe(true);
    expect(isFacing('inside')).toBe(false);
  });

  it('are rotations of the front: right × down points away from the camera', () => {
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (const facing of FACINGS) {
      const { right, down, toward } = facingFrame(facing);
      expect(new Set([right, down, toward].map(directionAxis)).size).toBe(3);
      // x right, y down, z back: right × down is the way into the picture.
      expect(cross(directionVector(right), directionVector(down)).map((v) => -v + 0)).toEqual(directionVector(toward));
    }
  });

  it('place pixel art on the volume, the far side at w = 0', () => {
    // The front's boxes grow from the back (z = 1) toward the front (z = 0).
    expect(facingVoxel(volume, 'front', 1, 2, 0)).toEqual([1, 2, 1]);
    // The back is mirrored: its column 0 is the volume's right.
    expect(facingVoxel(volume, 'back', 0, 0, 0)).toEqual([3, 0, 0]);
    // From above, row 0 is the back, and boxes grow up from the floor.
    expect(facingVoxel(volume, 'top', 0, 0, 0)).toEqual([0, 2, 1]);
    // From the right, column 0 is the front, and boxes grow from the left wall.
    expect(facingVoxel(volume, 'right', 0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('count steps back to pixel coordinates', () => {
    for (const facing of FACINGS) {
      const { right, down, toward } = facingFrame(facing);
      const { width, height } = planeSize(volume, facing);
      for (let w = 0; w < planeExtent(volume, facing); w++) {
        for (let v = 0; v < height; v++) {
          for (let u = 0; u < width; u++) {
            const [x, y, z] = facingVoxel(volume, facing, u, v, w);
            const steps = (direction: Direction) => stepsAlong(volume, direction, x, y, z);
            expect([steps(right), steps(down), steps(toward)]).toEqual([u, v, w]);
          }
        }
      }
    }
  });
});
