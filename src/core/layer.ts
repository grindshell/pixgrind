import { defaultExtrusions } from './extrusion.ts';
import { newId } from './id.ts';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1, applied on top of each palette color's own alpha. */
  opacity: number;
  /** Palette indices, row-major: `pixels[y * width + x]`. */
  pixels: Uint8Array;
  /**
   * Each pixel's extrusion for the 3D model (see `Extrusion`), parallel to
   * `pixels`. Meaningless where the pixel is transparent: a pixel painted
   * there starts at the default again.
   */
  extrusion: Uint16Array;
}

export function createLayer(width: number, height: number, name: string): Layer {
  return {
    id: newId(),
    name,
    visible: true,
    opacity: 1,
    pixels: new Uint8Array(width * height),
    extrusion: defaultExtrusions(width * height),
  };
}
