import { newId } from './id.ts';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1, applied on top of each palette color's own alpha. */
  opacity: number;
  /** Palette indices, row-major: `pixels[y * width + x]`. */
  pixels: Uint8Array;
}

export function createLayer(width: number, height: number, name: string): Layer {
  return {
    id: newId(),
    name,
    visible: true,
    opacity: 1,
    pixels: new Uint8Array(width * height),
  };
}
