import { describe, expect, it } from 'vitest';
import { createLayer } from '../core/layer.ts';
import { rectMask } from '../core/mask.ts';
import { createPalette } from '../core/palette.ts';
import { createDocument, setPixel, type PixelDocument } from '../core/pixelDocument.ts';
import { MAX_REFERENCE_SCALE } from '../core/referencePlacement.ts';
import { deflate, toBase64 } from './bytes.ts';
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

/** A minimal valid version-1 file, for corrupting one field at a time. */
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
