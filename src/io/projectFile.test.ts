import { describe, expect, it } from 'vitest';
import { CUT_BOTTOM_LEFT, CUT_TOP_LEFT, CUT_TOP_RIGHT, DEFAULT_EXTRUSION, packExtrusion } from '../core/extrusion.ts';
import { createLayer } from '../core/layer.ts';
import { rectMask } from '../core/mask.ts';
import { createPalette } from '../core/palette.ts';
import { createDocument, setPixel, type PixelDocument } from '../core/pixelDocument.ts';
import { MAX_REFERENCE_SCALE } from '../core/referencePlacement.ts';
import { deflate, toBase64, uint16ToBytes } from './bytes.ts';
import {
  isProjectFile,
  parseProject,
  PROJECT_VERSION,
  serializeProject,
  type ProjectReference,
} from './projectFile.ts';

const palette = createPalette('Mine', [0x000000ff, 0xff000080, 0x00ff00ff]);

function sampleDoc(): PixelDocument {
  const doc = createDocument(5, 3, palette, 'hero');
  setPixel(doc, doc.layers[0], 0, 0, 1);
  setPixel(doc, doc.layers[0], 4, 2, 2);
  const top = createLayer(5, 3, 'Shading');
  top.visible = false;
  top.opacity = 0.25;
  top.pixels[7] = 3;
  doc.layers.push(top);
  doc.selection = rectMask({ x: 1, y: 1, width: 2, height: 1 });
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

describe('project files', () => {
  it('round-trips name, size, palette and layers', async () => {
    const doc = sampleDoc();
    const { document: loaded, reference } = await parseProject(await serializeProject(doc));
    expect([loaded.name, loaded.width, loaded.height]).toEqual(['hero', 5, 3]);
    expect(loaded.palette).toEqual(palette);
    expect(loaded.layers.map(({ name, visible, opacity }) => ({ name, visible, opacity }))).toEqual([
      { name: 'Layer 1', visible: true, opacity: 1 },
      { name: 'Shading', visible: false, opacity: 0.25 },
    ]);
    loaded.layers.forEach((layer, i) => expect(layer.pixels).toEqual(doc.layers[i].pixels));
    expect(reference).toBeNull();
  });

  it('does not save the selection, and gives loaded layers fresh ids', async () => {
    const doc = sampleDoc();
    const { document: loaded } = await parseProject(await serializeProject(doc));
    expect(loaded.selection).toBeNull();
    expect(new Set([...doc.layers, ...loaded.layers].map((l) => l.id)).size).toBe(4);
  });

  it('writes a versioned, readable JSON file with compressed pixels', async () => {
    const doc = createDocument(256, 256, palette, 'big');
    const json = JSON.parse(await serializeProject(doc)) as Record<string, unknown>;
    expect(json).toMatchObject({ format: 'pixgrind', version: PROJECT_VERSION, width: 256, height: 256 });
    expect(json.palette).toEqual({ name: 'Mine', colors: ['#000000', '#ff000080', '#00ff00'] });
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

  it('round-trips extrusions, and leaves them out when all are the default', async () => {
    const doc = sampleDoc();
    expect(layersOf(JSON.parse(await serializeProject(doc)) as Record<string, unknown>)[0]).not.toHaveProperty('extrusion');
    doc.layers[0].extrusion[0] = packExtrusion(3, 7);
    doc.layers[0].extrusion[1] = packExtrusion(9, 9); // transparent pixel: not saved
    const json = JSON.parse(await serializeProject(doc)) as Record<string, unknown>;
    expect(layersOf(json)[0]).toHaveProperty('extrusion');
    expect(layersOf(json)[1]).not.toHaveProperty('extrusion');
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect(loaded.layers[0].extrusion[0]).toBe(packExtrusion(3, 7));
    expect(loaded.layers[0].extrusion[1]).toBe(DEFAULT_EXTRUSION);
  });

  it('round-trips shapes apart from boxes, and leaves them out when all are square', async () => {
    const doc = sampleDoc();
    doc.layers[0].extrusion[0] = packExtrusion(0, 1, CUT_TOP_RIGHT);
    doc.layers[0].extrusion[14] = packExtrusion(2, 5, CUT_BOTTOM_LEFT);
    doc.layers[0].extrusion[3] = packExtrusion(0, 1, CUT_TOP_LEFT); // transparent pixel: not saved
    const json = JSON.parse(await serializeProject(doc)) as Record<string, unknown>;
    expect(layersOf(json)[0]).toHaveProperty('shapes');
    expect(layersOf(json)[1]).not.toHaveProperty('shapes');
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect([0, 3, 14].map((i) => loaded.layers[0].extrusion[i])).toEqual([
      packExtrusion(0, 1, CUT_TOP_RIGHT),
      DEFAULT_EXTRUSION,
      packExtrusion(2, 5, CUT_BOTTOM_LEFT),
    ]);
    // Only the shape differs from the default for pixel 0, so boxes are saved for pixel 14 alone.
    doc.layers[0].extrusion[14] = packExtrusion(0, 1, CUT_BOTTOM_LEFT);
    expect(layersOf(JSON.parse(await serializeProject(doc)) as Record<string, unknown>)[0]).not.toHaveProperty('extrusion');
  });

  it('reads version 1 and 2 files, which have no extrusions or shapes', async () => {
    const json = { ...(await sampleJson()), version: 1 };
    const { document: loaded } = await parseProject(JSON.stringify(json));
    expect(loaded.layers[0].pixels[0]).toBe(1);
    expect(loaded.layers[0].extrusion.every((e) => e === DEFAULT_EXTRUSION)).toBe(true);

    const doc = sampleDoc();
    doc.layers[0].extrusion[0] = packExtrusion(3, 7);
    const v2 = { ...(JSON.parse(await serializeProject(doc)) as Record<string, unknown>), version: 2 };
    const { document: fromV2 } = await parseProject(JSON.stringify(v2));
    expect(fromV2.layers[0].extrusion[0]).toBe(packExtrusion(3, 7));
  });

  it('rejects shape data that is corrupt, the wrong size, or unknown', async () => {
    const parse = (json: unknown) => parseProject(JSON.stringify(json));
    const shaped = async (values: Uint8Array<ArrayBuffer>) => {
      const json = await sampleJson();
      layersOf(json)[0].shapes = toBase64(await deflate(values));
      return json;
    };
    const corrupt = await sampleJson();
    layersOf(corrupt)[0].shapes = 'AAAA';
    await expect(parse(corrupt)).rejects.toThrow(/layer 1 shape data is corrupted/);
    await expect(parse(await shaped(new Uint8Array(14)))).rejects.toThrow(/14 shapes for 15 pixels/);
    // Pixel 0 is painted; pixel 1 isn't, so its shape doesn't matter.
    const unknown = new Uint8Array(15);
    unknown[1] = 9;
    await expect(parse(await shaped(unknown))).resolves.toBeTruthy();
    unknown[0] = 5;
    await expect(parse(await shaped(unknown))).rejects.toThrow(/layer 1 has a pixel of unknown shape 5/);
  });

  it('recognizes project files by extension', () => {
    expect(isProjectFile({ name: 'hero.pixgrind' })).toBe(true);
    expect(isProjectFile({ name: 'HERO.PIXGRIND' })).toBe(true);
    expect(isProjectFile({ name: 'hero.png' })).toBe(false);
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
    await expect(parse({ ...(await sampleJson()), palette: null })).rejects.toThrow(/palette is missing/);
    await expect(parse({ ...(await sampleJson()), layers: [] })).rejects.toThrow(/no layers/);

    const json = await sampleJson();
    layersOf(json)[1].visible = 'yes';
    await expect(parse(json)).rejects.toThrow(/layer 2 visibility/);
  });

  it('rejects bad sizes, palettes and opacities', async () => {
    await expect(parse({ ...(await sampleJson()), width: 4096 })).rejects.toThrow(/too large/);
    await expect(parse({ ...(await sampleJson()), width: 0 })).rejects.toThrow(/Invalid document size/);
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

  it('rejects pixel data that is corrupt or the wrong size', async () => {
    const corrupt = await sampleJson();
    layersOf(corrupt)[0].pixels = 'AAAA';
    await expect(parse(corrupt)).rejects.toThrow(/layer 1 pixel data is corrupted/);

    const short = await sampleJson();
    layersOf(short)[1].pixels = toBase64(await deflate(new Uint8Array(14)));
    await expect(parse(short)).rejects.toThrow(/layer 2 has 14 pixels; a 5×3 layer has 15/);

    const long = await sampleJson();
    layersOf(long)[0].pixels = toBase64(await deflate(new Uint8Array(16)));
    await expect(parse(long)).rejects.toThrow(/layer 1 pixel data is corrupted/);
  });

  it('rejects extrusion data that is corrupt, the wrong size, or 0 deep', async () => {
    const extruded = async (values: Uint16Array) => {
      const json = await sampleJson();
      layersOf(json)[0].extrusion = toBase64(await deflate(uint16ToBytes(values)));
      return json;
    };
    const corrupt = await sampleJson();
    layersOf(corrupt)[0].extrusion = 'AAAA';
    await expect(parse(corrupt)).rejects.toThrow(/layer 1 extrusion data is corrupted/);
    await expect(parse(await extruded(new Uint16Array(14).fill(1)))).rejects.toThrow(/14 extrusions for 15 pixels/);
    // Pixel 0 is painted; pixel 1 isn't, so its 0 doesn't matter.
    const zeroDeep = new Uint16Array(15).fill(1);
    zeroDeep[1] = 0;
    await expect(parse(await extruded(zeroDeep))).resolves.toBeTruthy();
    zeroDeep[0] = 0x0400; // offset 4, depth 0
    await expect(parse(await extruded(zeroDeep))).rejects.toThrow(/layer 1 has a pixel extruded 0 deep/);
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
