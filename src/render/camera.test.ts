import { describe, expect, it } from 'vitest';
import {
  cameraEye,
  dolly,
  fitCamera,
  FIELD_OF_VIEW,
  multiply,
  orbit,
  pan,
  perspectiveMatrix,
  transformPoint,
  viewMatrix,
  type OrbitCamera,
} from './camera.ts';

const front: OrbitCamera = { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 10 };

const close = (actual: number[], expected: number[]) =>
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));

describe('orbit camera', () => {
  it('sits in front of the target at yaw 0, to the right at a positive yaw, above at a positive pitch', () => {
    close(cameraEye(front), [0, 0, 10]);
    close(cameraEye({ ...front, yaw: Math.PI / 2 }), [10, 0, 0]);
    close(cameraEye({ ...front, pitch: Math.PI / 2 }), [0, 10, 0]);
  });

  it('maps the target to the middle of the screen, nearer points to smaller depth', () => {
    const camera = { ...front, target: [3, 2, -1] as [number, number, number], yaw: 0.7, pitch: 0.3 };
    const matrix = multiply(perspectiveMatrix(FIELD_OF_VIEW, 1.5, 0.1, 100), viewMatrix(camera));
    const center = transformPoint(matrix, camera.target);
    close(center.slice(0, 2), [0, 0]);
    const eye = cameraEye(camera);
    const nearer = transformPoint(matrix, [(eye[0] + 3) / 2, (eye[1] + 2) / 2, (eye[2] - 1) / 2]);
    expect(nearer[2]).toBeLessThan(center[2]);
  });

  it('shows +x on the right and +y up when looking at the front', () => {
    const matrix = multiply(perspectiveMatrix(FIELD_OF_VIEW, 1, 0.1, 100), viewMatrix(front));
    expect(transformPoint(matrix, [1, 0, 0])[0]).toBeGreaterThan(0);
    expect(transformPoint(matrix, [0, 1, 0])[1]).toBeGreaterThan(0);
  });

  it('fits a box entirely in view', () => {
    const camera = fitCamera([-8, 0, -4], [8, 16, 0], 1);
    const matrix = multiply(perspectiveMatrix(FIELD_OF_VIEW, 1, 0.1, 1000), viewMatrix(camera));
    for (const x of [-8, 8]) {
      for (const y of [0, 16]) {
        for (const z of [-4, 0]) {
          const [sx, sy] = transformPoint(matrix, [x, y, z]);
          expect(Math.abs(sx)).toBeLessThan(1);
          expect(Math.abs(sy)).toBeLessThan(1);
        }
      }
    }
  });

  it('clamps pitch and distance, and pans the target across the view', () => {
    expect(orbit(front, 0, 10).pitch).toBeLessThan(Math.PI / 2);
    expect(dolly(front, 1e-9).distance).toBeGreaterThan(0);
    // Dragging right moves the target left (the scene follows the pointer).
    expect(pan(front, 10, 0, 100).target[0]).toBeLessThan(0);
    expect(pan(front, 0, 10, 100).target[1]).toBeGreaterThan(0);
  });
});
