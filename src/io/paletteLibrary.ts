import { parseHex, toHex } from '../core/color.ts';
import { newId } from '../core/id.ts';
import { createPalette, type Palette } from '../core/palette.ts';

export interface SavedPalette extends Palette {
  id: string;
}

/**
 * The user's saved palettes. Async so the backing store can move to
 * IndexedDB (or a server) without changing callers.
 */
export interface PaletteLibrary {
  list(): Promise<SavedPalette[]>;
  /** Saves a copy. A saved palette with the same name is replaced. */
  save(palette: Palette): Promise<SavedPalette>;
  remove(id: string): Promise<void>;
}

/** The subset of `Storage` the library needs, so tests can pass a fake. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'pixgrind.palettes.v1';

interface StoredPalette {
  id: string;
  name: string;
  colors: string[];
}

/**
 * A library kept as JSON in `storage` (normally `localStorage`). Unreadable
 * or malformed data is treated as empty rather than breaking the editor;
 * failed writes (e.g. quota exceeded) reject.
 */
export function createStoragePaletteLibrary(storage: KeyValueStorage, key = STORAGE_KEY): PaletteLibrary {
  const read = (): SavedPalette[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(storage.getItem(key) ?? '[]');
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown) => {
      if (!isStoredPalette(item)) return [];
      try {
        return [{ id: item.id, ...createPalette(item.name, item.colors.map(parseHex)) }];
      } catch {
        return [];
      }
    });
  };

  const write = (palettes: SavedPalette[]) => {
    const stored: StoredPalette[] = palettes.map(({ id, name, colors }) => ({ id, name, colors: colors.map(toHex) }));
    storage.setItem(key, JSON.stringify(stored));
  };

  return {
    async list() {
      return read();
    },
    async save(palette) {
      const all = read();
      const existing = all.find((p) => p.name === palette.name);
      const saved: SavedPalette = { id: existing?.id ?? newId(), ...createPalette(palette.name, palette.colors) };
      write(existing ? all.map((p) => (p.id === saved.id ? saved : p)) : [...all, saved]);
      return saved;
    },
    async remove(id) {
      write(read().filter((p) => p.id !== id));
    },
  };
}

/** A non-persistent store, for when `localStorage` is unavailable (e.g. blocked by browser settings). */
export function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function isStoredPalette(value: unknown): value is StoredPalette {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, colors } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    Array.isArray(colors) &&
    colors.every((c) => typeof c === 'string')
  );
}
