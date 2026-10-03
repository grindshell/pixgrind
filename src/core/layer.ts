import { defaultExtrusions } from './extrusion.ts';
import type { Facing } from './facing.ts';
import { newId } from './id.ts';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1, applied on top of each palette color's own alpha. */
  opacity: number;
  /** The side of the model it's drawn on; its pixels are that side's plane (see `planeSize`). */
  facing: Facing;
  width: number;
  height: number;
  /** Palette indices, row-major: `pixels[y * width + x]`. */
  pixels: Uint8Array;
  /**
   * Each pixel's extrusion for the 3D model (see `Extrusion`), parallel to
   * `pixels`. Meaningless where the pixel is transparent: a pixel painted
   * there starts at the default again.
   */
  extrusion: Uint32Array;
}

export function createLayer(width: number, height: number, name: string, facing: Facing = 'front'): Layer {
  return {
    id: newId(),
    name,
    visible: true,
    opacity: 1,
    facing,
    width,
    height,
    pixels: new Uint8Array(width * height),
    extrusion: defaultExtrusions(width * height),
  };
}

/** Whether (x, y) is on the layer. */
export function inLayer(layer: Layer, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layer.width && y < layer.height;
}
