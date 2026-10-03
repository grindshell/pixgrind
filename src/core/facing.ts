import type { Rect } from './rect.ts';

/*
 * The model fills a box of voxels, the document's volume: x from left to
 * right and y from top to bottom as on the front, z from the front to the
 * back. Layers are pixel art drawn on one of its six sides (a facing), as
 * seen by a camera looking at that side; each pixel's box runs from the far
 * side of the volume toward that camera.
 */

/** The side of the model a layer is drawn on, and seen from. */
export type Facing = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export const FACINGS: readonly Facing[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value);
}

/** The volume's size along x, y and z. */
export interface Volume {
  width: number;
  height: number;
  depth: number;
}

/** An axis of the volume: x, y or z. */
export type Axis = 0 | 1 | 2;
export const AXIS_X: Axis = 0;
export const AXIS_Y: Axis = 1;
export const AXIS_Z: Axis = 2;

/** One way along an axis: `axis * 2` toward higher coordinates, `axis * 2 + 1` toward lower ones. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5;
export const POS_X: Direction = 0;
export const NEG_X: Direction = 1;
/** Down, as rows go. */
export const POS_Y: Direction = 2;
export const NEG_Y: Direction = 3;
/** Toward the back. */
export const POS_Z: Direction = 4;
export const NEG_Z: Direction = 5;

export function directionAxis(direction: Direction): Axis {
  return (direction >> 1) as Axis;
}

export function directionSign(direction: Direction): 1 | -1 {
  return direction & 1 ? -1 : 1;
}

export function oppositeDirection(direction: Direction): Direction {
  return (direction ^ 1) as Direction;
}

/** A direction as a step along x, y and z. */
export function directionVector(direction: Direction): [number, number, number] {
  const vector: [number, number, number] = [0, 0, 0];
  vector[directionAxis(direction)] = directionSign(direction);
  return vector;
}

/**
 * How a facing's pixel art lies on the volume: which way its columns (`right`)
 * and rows (`down`) run, and which way its boxes grow (`toward` the camera
 * looking at it). Each is a proper rotation of the front's, so nothing is
 * mirrored: seen from behind, the back's columns run right to left on the
 * model, as they would on a real object.
 */
export interface FacingFrame {
  right: Direction;
  down: Direction;
  toward: Direction;
}

const FRAMES: Readonly<Record<Facing, FacingFrame>> = {
  front: { right: POS_X, down: POS_Y, toward: NEG_Z },
  back: { right: NEG_X, down: POS_Y, toward: POS_Z },
  left: { right: NEG_Z, down: POS_Y, toward: NEG_X },
  right: { right: POS_Z, down: POS_Y, toward: POS_X },
  // From above, the back is up; from below, the front.
  top: { right: POS_X, down: NEG_Z, toward: NEG_Y },
  bottom: { right: POS_X, down: POS_Z, toward: POS_Y },
};

export function facingFrame(facing: Facing): FacingFrame {
  return FRAMES[facing];
}

/** The volume's size along `axis`. */
export function volumeSize(volume: Volume, axis: Axis): number {
  return axis === AXIS_X ? volume.width : axis === AXIS_Y ? volume.height : volume.depth;
}

/** The size of a facing's pixel art: the volume as its camera sees it. */
export function planeSize(volume: Volume, facing: Facing): { width: number; height: number } {
  const { right, down } = FRAMES[facing];
  return { width: volumeSize(volume, directionAxis(right)), height: volumeSize(volume, directionAxis(down)) };
}

/** A facing's pixel art as a rectangle at the origin. */
export function planeRect(volume: Volume, facing: Facing): Rect {
  return { x: 0, y: 0, ...planeSize(volume, facing) };
}

/** How far a facing's boxes can reach: the volume's size toward its camera. */
export function planeExtent(volume: Volume, facing: Facing): number {
  return volumeSize(volume, directionAxis(FRAMES[facing].toward));
}

/**
 * The voxel at column `u`, row `v` of a facing's pixel art, `w` cells out
 * from the far side of the volume toward its camera, as [x, y, z].
 */
export function facingVoxel(volume: Volume, facing: Facing, u: number, v: number, w: number): [number, number, number] {
  const voxel: [number, number, number] = [0, 0, 0];
  const { right, down, toward } = FRAMES[facing];
  for (const [direction, step] of [
    [right, u],
    [down, v],
    [toward, w],
  ] as const) {
    const axis = directionAxis(direction);
    voxel[axis] = directionSign(direction) > 0 ? step : volumeSize(volume, axis) - 1 - step;
  }
  return voxel;
}

/** How many cells voxel (x, y, z) is from the side of the volume that `direction` points away from. */
export function stepsAlong(volume: Volume, direction: Direction, x: number, y: number, z: number): number {
  const axis = directionAxis(direction);
  const at = axis === AXIS_X ? x : axis === AXIS_Y ? y : z;
  return directionSign(direction) > 0 ? at : volumeSize(volume, axis) - 1 - at;
}
