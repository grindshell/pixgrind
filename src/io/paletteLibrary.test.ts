import { describe, expect, it } from 'vitest';
import { createPalette } from '../core/palette.ts';
import { createMemoryStorage, createStoragePaletteLibrary, type KeyValueStorage } from './paletteLibrary.ts';

const KEY = 'test.palettes';

describe('storage palette library', () => {
  it('saves, lists and removes palettes', async () => {
    const library = createStoragePaletteLibrary(createMemoryStorage(), KEY);
    expect(await library.list()).toEqual([]);
    const a = await library.save(createPalette('A', [0xff0000ff]));
    const b = await library.save(createPalette('B', [0x00ff00ff, 0x0000ff80]));
    expect((await library.list()).map((p) => p.name)).toEqual(['A', 'B']);
    expect((await library.list())[1].colors).toEqual([0x00ff00ff, 0x0000ff80]);
    await library.remove(a.id);
    expect((await library.list()).map((p) => p.id)).toEqual([b.id]);
  });

  it('replaces a saved palette with the same name, keeping its id', async () => {
    const library = createStoragePaletteLibrary(createMemoryStorage(), KEY);
    const first = await library.save(createPalette('Mine', [0xff0000ff]));
    const second = await library.save(createPalette('Mine', [0x00ff00ff]));
    expect(second.id).toBe(first.id);
    const all = await library.list();
    expect(all).toHaveLength(1);
    expect(all[0].colors).toEqual([0x00ff00ff]);
  });

  it('stores hex strings so the data stays readable', async () => {
    const storage = createMemoryStorage();
    await createStoragePaletteLibrary(storage, KEY).save(createPalette('A', [0xff004dff]));
    expect(JSON.parse(storage.getItem(KEY) ?? '')[0].colors).toEqual(['#ff004d']);
  });

  it('treats corrupt or malformed data as empty, skipping only bad entries', async () => {
    const storage = createMemoryStorage();
    storage.setItem(KEY, '{not json');
    expect(await createStoragePaletteLibrary(storage, KEY).list()).toEqual([]);
    storage.setItem(
      KEY,
      JSON.stringify([
        { id: '1', name: 'Good', colors: ['#000000'] },
        { id: '2', name: 'Bad color', colors: ['purple'] },
        { id: 3, name: 'Bad id', colors: [] },
        'nonsense',
      ]),
    );
    expect((await createStoragePaletteLibrary(storage, KEY).list()).map((p) => p.name)).toEqual(['Good']);
  });

  it('rejects when the storage write fails', async () => {
    const full: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    await expect(createStoragePaletteLibrary(full, KEY).save(createPalette('A', []))).rejects.toThrow('Quota');
  });
});
