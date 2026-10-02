import type { ReferencePlacement } from '../core/referencePlacement.ts';

/**
 * An image shown with the artwork as a tracing guide. Not a layer: it is
 * never part of pixel data or exports, and its settings aren't undoable.
 */
export interface ReferenceImage extends ReferencePlacement {
  name: string;
  /** Decoded image, ready to draw. */
  bitmap: ImageBitmap;
  /** The original file, kept so project files can embed it. */
  source: Blob;
  /** Size in image pixels. */
  width: number;
  height: number;
  /** 0–1. */
  opacity: number;
  visible: boolean;
  /** Draw over the artwork instead of under it. */
  above: boolean;
  /** Smooth scaling. Off shows the reference's own pixels as crisp squares. */
  smooth: boolean;
}

/** The settings a user can change after loading. */
export type ReferenceSettings = Pick<ReferenceImage, 'x' | 'y' | 'scale' | 'opacity' | 'visible' | 'above' | 'smooth'>;
