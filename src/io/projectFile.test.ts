import { describe, expect, it } from 'vitest';
import { CUT_BOTTOM_LEFT, CUT_TOP_RIGHT, DEFAULT_EXTRUSION, packExtrusion } from '../core/extrusion.ts';
import { createLayer } from '../core/layer.ts';
import { rectMask } from '../core/mask.ts';
import { buildVoxelModel } from '../core/model.ts';
import { createPalette } from '../core/palette.ts';
import { createDocument, facingLayers, setPixel, type PixelDocument } from '../core/pixelDocument.ts';
import { MAX_REFERENCE_SCALE } from '../core/referencePlacement.ts';
import { deflate, toBase64, uint16ToBytes, uint32ToBytes } from './bytes.ts';
import {
  isProjectFile,
  parseProject,
  PROJECT_VERSION,
  serializeProject,
  type ProjectReference,
} from './projectFile.ts';

const palette = createPalette('Mine', [0x000000ff, 0xff000080, 0x00ff00ff]);

/** A 5×3×4 document: two front layers (the second hidden and faint), and a pixel on the top. */
function sampleDoc(): PixelDocument {
  const doc = createDocument(5, 3, palette, 'hero', 4);
  setPixel(doc.layers[0], 0, 0, 1);
  setPixel(doc.layers[0], 4, 2, 2);
  const shading = createLayer(5, 3, 'Shading');
  shading.visible = false;
  shading.opacity = 0.25;
  shading.pixels[7] = 3;
  doc.layers.splice(1, 0, shading);
  setPixel(facingLayers(doc, 'top')[0], 2, 3, 3);
  doc.selections.front = rectMask({ x: 1, y: 1, width: 2, height: 1 });
  return doc;
}

function sampleReference(): ProjectReference {
  return {
    name: 'photo',
    source: new Blob([Uint8Array.from([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }),
    x: -1.5,
    y: 2.25,
    scale: 0.125,
    opacity: 0.4,
    visible: true,
    above: true,
    smooth: false,
  };
}

/** A minimal valid file, for corrupting one field at a time. */
async function sampleJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await serializeProject(sampleDoc())) as Record<string, unknown>;
}

function layersOf(json: Record<string, unknown>): Array<Record<string, unknown>> {
  return json.layers as Array<Record<string, unknown>>;
}

/**
 * A version 1–3 file: one 3×1 front layer of pixels [1, 2, 0], with boxes
 * (`offset << 8 | depth`, back from the picture plane) and shapes when given.
 */
async function legacyJson(version: number, boxes?: number[], shapes?: number[]): Promise<string> {
  const layer: Record<string, unknown> = {
    name: 'Old',
    visible: true,
    opacity: 1,
    pixels: toBase64(await deflate(Uint8Array.of(1, 2, 0))),
  };
  if (boxes) layer.extrusion = toBase64(await deflate(uint16ToBytes(Uint16Array.from(boxes))));
  if (shapes) layer.shapes = toBase64(await deflate(Uint8Array.from(shapes)));
  return JSON.stringify({
    format: 'pixgrind',
    version,
    name: 'old',
    width: 3,
    height: 1,
    palette: { name: 'Mine', colors: ['#000000', '#ff0000'] },
    layers: [layer],
  });
}

describe('project files', () => {
  it('round-trips name, size, palette and layers on every side', async () => {
    const doc = sampleDoc();
    const { document: loaded, reference } = await parseProject(await serializeProject(doc));
    expect([loaded.name, loaded.width, loaded.height, loaded.depth]).toEqual(['hero', 5, 3, 4]);
    expect(loaded.palette).toEqual(palette);
    const props = (d: PixelDocument) => d.layers.map(({ name, visible, opacity, facing, width, height }) => ({ name, visible, opacity, facing, width, height }));
    expect(props(loaded)).toEqual(props(doc));
    expect(props(loaded)[1]).toEqual({ name: 'Shading', visible: false, opacity: 0.25, facing: 'front', width: 5, height: 3 });
    loaded.layers.forEach((layer, i) => expect(layer.pixels).toEqual(doc.layers[i].pixels));
    expect(reference).toBeNull();
  });

  it('does not save the selection, and gives loaded layers fresh ids', async () => {
    const doc = sampleDoc();
    const { document: loaded } = await parseProject(await serializeProject(doc));
    expect(Object.values(loaded.selections).every((selection) => selection === null)).toBe(true);
    expect(new Set([...doc.layers, ...loaded.layers].map((l) => l.id)).size).toBe(doc.layers.length * 2);
  });

  it('writes a versioned, readable JSON file with compressed pixels', async () => {
    const doc = createDocument(256, 256, palette, 'big');
    const json = JSON.parse(await serializeProject(doc)) as Record<string, unknown>;
    expect(json).toMatchObject({ format: 'pixgrind', version: PROJECT_VERSION, width: 256, height: 256, depth: 256 });
    expect(json.palette).toEqual({ name: 'Mine', colors: ['#000000', '#ff000080', '#00ff00'] });
    expect(layersOf(json).map((layer) => layer.facing)).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
    // 65,536 transparent pixels compress to a few hundred bytes.
    expect((layersOf(json)[0].pixels as string).length).toBeLessThan(500);
  });

  it('round-trips an embedded reference image', async () => {
    const saved = sampleReference();
    const { reference } = await parseProject(await serializeProject(sampleDoc(), saved));
    if (!reference) throw new Error('expected a reference');
    const { source, ...settings } = reference;
    const { source: originalSource, ...originalSettings } = saved;
    expect(settings).toEqual(originalSettings);
    expect(source.type).toBe('image/png');
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(new Uint8Array(await originalSource.arrayBuffer()));
  });

  it('saves the document as it was when saving started', async () => {
    const doc = sampleDoc();
    const pending = serializeProject(doc);
    doc.layers[0].pixels[0] = 3;
    doc.layers[1].name = 'Renamed';
    doc.name = 'later';
    const { document: loaded } = await parseProject(await pending);
    expect(loaded.layers[0].pixels[0]).toBe(1);
    expect(loaded.layers[1].name).toBe('Shading');
    expect(loaded.name).toBe('hero');
  });

  it('round-trips extrusions and shapes, and leaves them out when all are the default', async () => {
    const doc = sampleDoc();
    expect(layersOf(JSON.parse(await serializeProject(doc)) as Record<string, unknown>)[0]).not.toHaveProperty('extrusion');
    doc.layers[0].extrusion[0] = packExtrusion(3, 1, CUT_TOP_RIGHT);
    doc.layers[0].extrusion[14] = packExtrusion(900, 120, CUT_BOTTOM_LEFT);
    doc.layers[0].extrusion[1] = packExtrusion(9, 9); // transparent pixel: not saved
    const json = JSON.parse(await serializeProject(doc)) as Record<string, unknown>;
    expect(layersOf(json)[0]).toHaveProperty('extrusion');
    expect(layersOf(json)[1]).not.toHaveProperty('extrusion');
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect([0, 1, 14].map((i) => loaded.layers[0].extrusion[i])).toEqual([
      packExtrusion(3, 1, CUT_TOP_RIGHT),
      DEFAULT_EXTRUSION,
      packExtrusion(900, 120, CUT_BOTTOM_LEFT),
    ]);
  });

  it('adds an empty layer for a side the file has none on', async () => {
    const json = await sampleJson();
    json.layers = layersOf(json).filter((layer) => layer.facing !== 'left');
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect(facingLayers(loaded, 'left').map((l) => [l.width, l.height, l.pixels.every((p) => p === 0)])).toEqual([[4, 3, true]]);
  });

  it('recognizes project files by extension', () => {
    expect(isProjectFile({ name: 'hero.pixgrind' })).toBe(true);
    expect(isProjectFile({ name: 'HERO.PIXGRIND' })).toBe(true);
    expect(isProjectFile({ name: 'hero.png' })).toBe(false);
  });
});

describe('older project files', () => {
  it('turn flat art (version 1) into the front of a volume one deep', async () => {
    const { document: loaded } = await parseProject(await legacyJson(1));
    expect([loaded.width, loaded.height, loaded.depth]).toEqual([3, 1, 1]);
    expect(loaded.layers.map((l) => l.facing).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
    const [front] = facingLayers(loaded, 'front');
    expect(front.name).toBe('Old');
    expect(Array.from(front.pixels)).toEqual([1, 2, 0]);
    expect(front.extrusion.every((e) => e === DEFAULT_EXTRUSION)).toBe(true);
  });

  it('turn boxes around to grow from the back of a volume as deep as the deepest, so the model is the same', async () => {
    // Pixel 0 from the picture plane 2 back, pixel 1 from 1 back to 4: 4 deep.
    const { document: loaded } = await parseProject(await legacyJson(2, [0x0002, 0x0103, 0x0000]));
    expect(loaded.depth).toBe(4);
    const [front] = facingLayers(loaded, 'front');
    expect(Array.from(front.extrusion.slice(0, 2))).toEqual([packExtrusion(2, 2), packExtrusion(0, 3)]);
    // In the model, z counts back from the front, as the old boxes did.
    const { columns } = buildVoxelModel(loaded);
    expect(columns.slice(0, 2).map((runs) => runs?.map(({ start, end }) => [start, end]))).toEqual([[[0, 2]], [[1, 4]]]);
  });

  it('keep version 3 shapes', async () => {
    const { document: loaded } = await parseProject(await legacyJson(3, [0x0001, 0x0001, 0x0001], [CUT_TOP_RIGHT, 0, 7]));
    expect(facingLayers(loaded, 'front')[0].extrusion[0]).toBe(packExtrusion(0, 1, CUT_TOP_RIGHT));
  });

  it('reject boxes 0 deep and unknown shapes on painted pixels', async () => {
    // Pixel 2 is transparent, so its values don't matter.
    await expect(parseProject(await legacyJson(2, [0x0001, 0x0001, 0x0000]))).resolves.toBeTruthy();
    await expect(parseProject(await legacyJson(2, [0x0400, 0x0001, 0x0001]))).rejects.toThrow(/layer 1 has a pixel extruded 0 deep/);
    await expect(parseProject(await legacyJson(3, undefined, [0, 5, 0]))).rejects.toThrow(/layer 1 has a pixel of unknown shape 5/);
    await expect(parseProject(await legacyJson(3, undefined, [0, 0]))).rejects.toThrow(/2 shapes for 3 pixels/);
  });
});

describe('parseProject errors', () => {
  const parse = (json: unknown) => parseProject(JSON.stringify(json));

  it('rejects files that are not projects', async () => {
    await expect(parseProject('GIMP Palette')).rejects.toThrow(/not JSON/);
    await expect(parse({ hello: 'world' })).rejects.toThrow(/Not a Pixgrind project/);
    await expect(parse([1, 2])).rejects.toThrow(/Not a Pixgrind project/);
  });

  it('rejects projects from a newer version, and missing versions', async () => {
    await expect(parse({ ...(await sampleJson()), version: PROJECT_VERSION + 1 })).rejects.toThrow(/newer version/);
    await expect(parse({ ...(await sampleJson()), version: undefined })).rejects.toThrow(/missing version/);
  });

  it('rejects missing or mistyped fields with the field named', async () => {
    await expect(parse({ ...(await sampleJson()), name: 3 })).rejects.toThrow(/name must be text/);
    await expect(parse({ ...(await sampleJson()), depth: '4' })).rejects.toThrow(/depth must be a number/);
    await expect(parse({ ...(await sampleJson()), palette: null })).rejects.toThrow(/palette is missing/);
    await expect(parse({ ...(await sampleJson()), layers: [] })).rejects.toThrow(/no layers/);

    const json = await sampleJson();
    layersOf(json)[1].visible = 'yes';
    await expect(parse(json)).rejects.toThrow(/layer 2 visibility/);
    layersOf(json)[1].facing = 'inside';
    await expect(parse(json)).rejects.toThrow(/layer 2 facing must be one of/);
  });

  it('rejects bad sizes, palettes and opacities', async () => {
    await expect(parse({ ...(await sampleJson()), width: 4096 })).rejects.toThrow(/too large/);
    await expect(parse({ ...(await sampleJson()), width: 0 })).rejects.toThrow(/Invalid document size/);
    await expect(parse({ ...(await sampleJson()), depth: 2000 })).rejects.toThrow(/too large/);
    await expect(parse({ ...(await sampleJson()), palette: { name: 'x', colors: [] } })).rejects.toThrow(/0 colors/);
    await expect(parse({ ...(await sampleJson()), palette: { name: 'x', colors: ['#12'] } })).rejects.toThrow(
      /palette color 1/,
    );
    const many = Array.from({ length: 256 }, () => '#000000');
    await expect(parse({ ...(await sampleJson()), palette: { name: 'x', colors: many } })).rejects.toThrow(/256 colors/);

    const json = await sampleJson();
    layersOf(json)[0].opacity = 1.5;
    await expect(parse(json)).rejects.toThrow(/layer 1 opacity must be between 0 and 1/);
  });

  it('rejects pixel data that is corrupt or the wrong size for its side', async () => {
    const corrupt = await sampleJson();
    layersOf(corrupt)[0].pixels = 'AAAA';
    await expect(parse(corrupt)).rejects.toThrow(/layer 1 pixel data is corrupted/);

    const short = await sampleJson();
    layersOf(short)[1].pixels = toBase64(await deflate(new Uint8Array(14)));
    await expect(parse(short)).rejects.toThrow(/layer 2 has 14 pixels; a 5×3 layer has 15/);

    const long = await sampleJson();
    layersOf(long)[0].pixels = toBase64(await deflate(new Uint8Array(16)));
    await expect(parse(long)).rejects.toThrow(/layer 1 pixel data is corrupted/);

    // The left side of a 5×3×4 model is 4×3.
    const sideways = await sampleJson();
    layersOf(sideways)[3].pixels = toBase64(await deflate(new Uint8Array(15)));
    await expect(parse(sideways)).rejects.toThrow(/layer 4 pixel data is corrupted/);
  });

  it('rejects extrusion data that is corrupt, the wrong size, or invalid', async () => {
    const extruded = async (values: Uint32Array) => {
      const json = await sampleJson();
      layersOf(json)[0].extrusion = toBase64(await deflate(uint32ToBytes(values)));
      return json;
    };
    const corrupt = await sampleJson();
    layersOf(corrupt)[0].extrusion = 'AAAA';
    await expect(parse(corrupt)).rejects.toThrow(/layer 1 extrusion data is corrupted/);
    await expect(parse(await extruded(new Uint32Array(14).fill(DEFAULT_EXTRUSION)))).rejects.toThrow(/14 extrusions for 15 pixels/);
    // Pixel 0 is painted; pixel 1 isn't, so its 0 doesn't matter.
    const zeroDeep = new Uint32Array(15).fill(DEFAULT_EXTRUSION);
    zeroDeep[1] = 0;
    await expect(parse(await extruded(zeroDeep))).resolves.toBeTruthy();
    zeroDeep[0] = 4 << 11; // offset 4, depth 0
    await expect(parse(await extruded(zeroDeep))).rejects.toThrow(/layer 1 has a pixel with an invalid extrusion/);
  });

  it('makes pixel indices past the palette transparent, as they render', async () => {
    const json = await sampleJson();
    // The palette has 3 colors.
    layersOf(json)[0].pixels = toBase64(await deflate(Uint8Array.from({ length: 15 }, (_, i) => i % 6)));
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect(Array.from(loaded.layers[0].pixels)).toEqual([0, 1, 2, 3, 0, 0, 0, 1, 2, 3, 0, 0, 0, 1, 2]);
  });

  it('validates the reference and clamps its scale', async () => {
    const json = JSON.parse(await serializeProject(sampleDoc(), sampleReference())) as Record<string, unknown>;
    const reference = json.reference as Record<string, unknown>;

    await expect(parse({ ...json, reference: { ...reference, data: '%%%' } })).rejects.toThrow(/reference image data/);
    await expect(parse({ ...json, reference: { ...reference, x: 'left' } })).rejects.toThrow(/reference position/);
    const { reference: clamped } = await parse({ ...json, reference: { ...reference, scale: 1e9 } });
    expect(clamped?.scale).toBe(MAX_REFERENCE_SCALE);
    const { reference: none } = await parse({ ...json, reference: null });
    expect(none).toBeNull();
  });
});
