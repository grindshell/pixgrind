import { describe, expect, it } from 'vitest';
import {
  brushLine,
  brushMask,
  brushRect,
  clampBrushSize,
  MAX_BRUSH_SIZE,
  stampBrush,
  stepBrushSize,
  type Brush,
  type BrushMask,
} from './brush.ts';
import { plotLine, plotRect } from './raster.ts';

/** The footprint drawn as rows of `#` (covered) and `.`, with the pointer pixel at (0, 0) marked `@`. */
function picture(mask: BrushMask): string[] {
  const xs = mask.pixels.map((p) => p.x);
  const ys = mask.pixels.map((p) => p.y);
  const rows: string[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    let row = '';
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      const covered = mask.pixels.some((p) => p.x === x && p.y === y);
      row += x === 0 && y === 0 ? (covered ? '@' : '?') : covered ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

function covered(draw: (plot: (x: number, y: number) => void) => void): Set<string> {
  const points = new Set<string>();
  draw((x, y) => points.add(`${x},${y}`));
  return points;
}

const round = (size: number): Brush => ({ size, shape: 'round' });
const square = (size: number): Brush => ({ size, shape: 'square' });

describe('brushMask', () => {
  it('is a single pixel at size 1 in either shape', () => {
    expect(picture(brushMask(round(1)))).toEqual(['@']);
    expect(picture(brushMask(square(1)))).toEqual(['@']);
  });

  it('draws the usual small pixel-art circles', () => {
    expect(picture(brushMask(round(2)))).toEqual(['##', '#@']);
    expect(picture(brushMask(round(3)))).toEqual(['.#.', '#@#', '.#.']);
    expect(picture(brushMask(round(4)))).toEqual(['.##.', '####', '##@#', '.##.']);
    expect(picture(brushMask(round(5)))).toEqual(['.###.', '#####', '##@##', '#####', '.###.']);
  });

  it('is symmetric and fills its box rows evenly for larger circles', () => {
    const rows = picture(brushMask(round(8)));
    expect(rows.map((row) => row.replace(/[.]/g, '').length)).toEqual([4, 6, 8, 8, 8, 8, 6, 4]);
  });

  it('fills the whole box for squares, centered on the pointer', () => {
    expect(picture(brushMask(square(3)))).toEqual(['###', '#@#', '###']);
    expect(picture(brushMask(square(4)))).toEqual(['####', '####', '##@#', '####']);
  });

  it('marks pixels next to the outside as edge', () => {
    const mask = brushMask(square(5));
    expect(mask.edge).toHaveLength(16);
    expect(mask.edge).not.toContainEqual({ x: 0, y: 0 });
    expect(brushMask(round(2)).edge).toHaveLength(4);
  });

  it('outlines a single pixel with four unit runs on the outside', () => {
    const convex = { from: 0, to: 1, concaveFrom: false, concaveTo: false };
    expect(brushMask(round(1)).outline).toEqual([
      { horizontal: true, at: 0, out: -1, ...convex },
      { horizontal: true, at: 1, out: 1, ...convex },
      { horizontal: false, at: 0, out: -1, ...convex },
      { horizontal: false, at: 1, out: 1, ...convex },
    ]);
  });

  it('merges straight stretches of the border into single runs', () => {
    // A square is four runs; a 3px plus has three runs per side.
    expect(brushMask(square(6)).outline).toHaveLength(4);
    expect(brushMask(square(6)).outline[0]).toEqual({
      horizontal: true,
      at: -3,
      from: -3,
      to: 3,
      out: -1,
      concaveFrom: false,
      concaveTo: false,
    });
    expect(brushMask(round(3)).outline).toHaveLength(12);
  });

  it('clamps out-of-range sizes', () => {
    expect(brushMask(round(0)).pixels).toHaveLength(1);
    expect(brushMask(square(1000)).pixels).toHaveLength(MAX_BRUSH_SIZE * MAX_BRUSH_SIZE);
  });
});

describe('brushLine', () => {
  it.each([
    ['round', 1],
    ['round', 3],
    ['round', 6],
    ['square', 4],
    ['round', 11],
  ] as const)('covers the same pixels as stamping a %s %d brush at every point', (shape, size) => {
    const mask = brushMask({ shape, size });
    for (const [x0, y0, x1, y1] of [
      [0, 0, 9, 4],
      [3, 8, -5, -2],
      [0, 0, 0, 0],
      [2, 2, 2, -7],
    ]) {
      const expected = covered((plot) => plotLine(x0, y0, x1, y1, (x, y) => stampBrush(mask, x, y, plot)));
      expect(covered((plot) => brushLine(mask, x0, y0, x1, y1, plot))).toEqual(expected);
    }
  });

  it('continues a stroke with only what each segment newly reaches', () => {
    const mask = brushMask(round(7));
    const points = [[0, 0], [6, 2], [6, 2], [-3, 9], [-2, 9]];
    const expected = covered((plot) => {
      for (let k = 1; k < points.length; k++) {
        const [[x0, y0], [x1, y1]] = [points[k - 1], points[k]];
        plotLine(x0, y0, x1, y1, (x, y) => stampBrush(mask, x, y, plot));
      }
    });
    const stroke = (continued: boolean) => {
      let plotted = 0;
      const pixels = covered((plot) => {
        const counting = (x: number, y: number) => {
          plotted++;
          plot(x, y);
        };
        brushLine(mask, 0, 0, 0, 0, counting);
        for (let k = 1; k < points.length; k++) {
          const [[x0, y0], [x1, y1]] = [points[k - 1], points[k]];
          brushLine(mask, x0, y0, x1, y1, counting, continued);
        }
      });
      return { pixels, plotted };
    };
    const continued = stroke(true);
    expect(continued.pixels).toEqual(expected);
    // Each continued segment skips the full stamp at its start.
    expect(stroke(false).plotted - continued.plotted).toBe((points.length - 1) * mask.pixels.length);
    // A continued segment back at the same pixel adds nothing.
    expect(covered((plot) => brushLine(mask, 4, 4, 4, 4, plot, true)).size).toBe(0);
  });
});

describe('brushRect', () => {
  it('is the plain outline or fill at size 1', () => {
    const mask = brushMask(round(1));
    expect(covered((plot) => brushRect(mask, 0, 0, 3, 2, false, plot)).size).toBe(10);
    expect(covered((plot) => brushRect(mask, 0, 0, 3, 2, true, plot)).size).toBe(12);
  });

  it('thickens the outline with the brush, and fills inside it', () => {
    const mask = brushMask(square(3));
    const outline = covered((plot) => brushRect(mask, 0, 0, 6, 6, false, plot));
    // A 9×9 square (corners extended by the brush) minus the 3×3 hole in the middle.
    expect(outline.size).toBe(81 - 9);
    expect(outline.has('3,3')).toBe(false);
    expect(outline.has('-1,-1')).toBe(true);
    expect(covered((plot) => brushRect(mask, 0, 0, 6, 6, true, plot)).size).toBe(81);
  });

  it('covers the same pixels as stamping along the outline, flat ones included', () => {
    const mask = brushMask(round(6));
    for (const [x0, y0, x1, y1] of [
      [0, 0, 7, 4],
      [5, 5, 5, 5],
      [3, 1, -4, 1],
      [2, 6, 2, -1],
    ]) {
      const expected = covered((plot) => plotRect(x0, y0, x1, y1, false, (x, y) => stampBrush(mask, x, y, plot)));
      expect(covered((plot) => brushRect(mask, x0, y0, x1, y1, false, plot))).toEqual(expected);
    }
  });
});

describe('brush sizes', () => {
  it('clamps to whole sizes in range', () => {
    expect(clampBrushSize(0)).toBe(1);
    expect(clampBrushSize(2.6)).toBe(3);
    expect(clampBrushSize(500)).toBe(MAX_BRUSH_SIZE);
  });

  it('steps by one up to 8, then coarser, stopping at the limits', () => {
    expect(stepBrushSize(1, 1)).toBe(2);
    expect(stepBrushSize(8, 1)).toBe(10);
    expect(stepBrushSize(10, -1)).toBe(8);
    expect(stepBrushSize(9, 1)).toBe(10);
    expect(stepBrushSize(9, -1)).toBe(8);
    expect(stepBrushSize(1, -1)).toBe(1);
    expect(stepBrushSize(MAX_BRUSH_SIZE, 1)).toBe(MAX_BRUSH_SIZE);
  });
});
