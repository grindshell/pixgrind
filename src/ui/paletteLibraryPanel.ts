import { BUILTIN_PALETTES, createPalette, type Palette } from '../core/palette.ts';
import { paletteEdit, remapToPaletteEdit, swapPaletteEdit } from '../core/paletteEdits.ts';
import { chooseFile, downloadBlob, fileBaseName, safeFileName } from '../io/files.ts';
import {
  hasTranslucentColors,
  PALETTE_TEXT_FORMATS,
  parsePaletteText,
  serializePalette,
  type PaletteTextFormat,
} from '../io/paletteFormats.ts';
import { paletteFromImageFile, paletteToPng } from '../io/paletteImage.ts';
import {
  createMemoryStorage,
  createStoragePaletteLibrary,
  type PaletteLibrary,
  type SavedPalette,
} from '../io/paletteLibrary.ts';
import { el, fieldRow as row, iconButton, option, setButtonLabel, textButton } from './dom.ts';
import type { Editor } from './editor.ts';

export interface OpenedLibrary {
  library: PaletteLibrary;
  /** False when browser storage is unavailable and saves last only for this session. */
  persistent: boolean;
}

/** The user's palette library in `localStorage`, or an in-memory one if storage is blocked. */
export function openPaletteLibrary(): OpenedLibrary {
  try {
    const storage = window.localStorage;
    storage.getItem('pixgrind.probe');
    return { library: createStoragePaletteLibrary(storage), persistent: true };
  } catch {
    return { library: createStoragePaletteLibrary(createMemoryStorage()), persistent: false };
  }
}

type ExportFormat = PaletteTextFormat | 'png';

const DELETE_CONFIRM_MS = 3000;

/**
 * Built-in and saved palettes: load one into the document (swap keeps pixel
 * indices; remap moves pixels to the nearest new color), save the current
 * palette, delete saved ones, and import/export palette files.
 */
export function createPaletteLibraryPanel(editor: Editor, { library, persistent }: OpenedLibrary): HTMLElement {
  const { doc } = editor;
  const panel = el('section', 'panel');
  const heading = el('h2', 'panel-title');
  heading.textContent = 'Palettes';

  const source = el('select', 'select');
  source.setAttribute('aria-label', 'Palette to load');
  const loadButton = textButton('Load', () => {
    const palette = selectedPalette();
    if (palette) apply(palette, 'Loaded');
  });
  const deleteButton = iconButton('trash', 'Delete saved palette', () => void removeSelected());
  const loadRow = row(source, loadButton, deleteButton);

  const mode = el('select', 'select');
  mode.setAttribute('aria-label', 'How to load');
  mode.append(
    option('swap', 'Keep indices (palette swap)'),
    option('remap', 'Match nearest colors (remap)'),
  );
  mode.title = 'Keep indices: each pixel keeps its palette slot and takes the new color there.\nMatch nearest colors: each pixel moves to the closest-looking new color.';

  const nameInput = el('input', 'text-input');
  nameInput.type = 'text';
  nameInput.maxLength = 64;
  nameInput.setAttribute('aria-label', 'Name to save the palette as');
  const saveButton = textButton('Save', () => void save());
  const saveRow = row(nameInput, saveButton);

  const importButton = textButton('Import…', () => void importFile());
  const exportSelect = el('select', 'select');
  exportSelect.setAttribute('aria-label', 'Export palette');
  exportSelect.append(option('', 'Export…'));
  for (const [format, { label }] of Object.entries(PALETTE_TEXT_FORMATS)) exportSelect.append(option(format, label));
  exportSelect.append(option('png', 'PNG swatches (.png)'));
  exportSelect.addEventListener('change', () => {
    const format = exportSelect.value;
    exportSelect.value = '';
    if (format === 'png' || format in PALETTE_TEXT_FORMATS) void exportAs(format as ExportFormat);
  });
  const fileRow = row(importButton, exportSelect);

  const status = el('p', 'panel-status');
  status.setAttribute('role', 'status');
  const say = (message: string) => {
    status.textContent = message;
  };
  if (!persistent) say('Browser storage is unavailable: saved palettes last only for this session.');

  let saved: SavedPalette[] = [];

  const selectedPalette = (): Palette | null => {
    const [kind, id] = source.value.split(':');
    if (kind === 'builtin') return BUILTIN_PALETTES[Number(id)] ?? null;
    if (kind === 'saved') return saved.find((p) => p.id === id) ?? null;
    return null;
  };

  const refreshList = async (selectValue = source.value) => {
    saved = await library.list();
    const builtins = el('optgroup');
    builtins.label = 'Built-in';
    builtins.append(...BUILTIN_PALETTES.map((p, i) => option(`builtin:${i}`, p.name)));
    const mine = el('optgroup');
    mine.label = 'Saved';
    mine.append(...saved.map((p) => option(`saved:${p.id}`, p.name)));
    source.replaceChildren(builtins, ...(saved.length > 0 ? [mine] : []));
    source.value = selectValue;
    if (!source.value) source.selectedIndex = 0;
    syncButtons();
  };

  // Deleting a saved palette can't be undone, so it takes a second click to confirm.
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  const resetDelete = () => {
    clearTimeout(confirmTimer);
    confirmTimer = undefined;
    deleteButton.classList.remove('is-confirming');
    const isSaved = source.value.startsWith('saved:');
    setButtonLabel(deleteButton, isSaved ? 'Delete saved palette' : 'Only saved palettes can be deleted');
  };
  const syncButtons = () => {
    deleteButton.disabled = !source.value.startsWith('saved:');
    resetDelete();
  };
  source.addEventListener('change', syncButtons);

  const apply = (palette: Palette, verb: string) => {
    const edit = mode.value === 'remap' ? remapToPaletteEdit(doc, palette) : swapPaletteEdit(doc, palette);
    if (!edit) {
      say(`Already using ${palette.name}.`);
      return;
    }
    editor.perform(edit);
    say(`${verb} ${palette.name} (${palette.colors.length} colors).`);
  };

  const save = async () => {
    const name = nameInput.value.trim() || doc.palette.name;
    try {
      // Saving under a new name also renames the document's palette, so the two stay in step.
      editor.perform(paletteEdit(doc, createPalette(name, doc.palette.colors), 'Rename palette'));
      const result = await library.save(doc.palette);
      await refreshList(`saved:${result.id}`);
      say(`Saved ${result.name}.`);
    } catch (error) {
      say(`Couldn't save: ${messageOf(error)}`);
    }
  };

  const removeSelected = async () => {
    const [kind, id] = source.value.split(':');
    if (kind !== 'saved') return;
    if (confirmTimer === undefined) {
      deleteButton.classList.add('is-confirming');
      setButtonLabel(deleteButton, 'Click again to delete');
      say(`Click the trash button again to delete ${selectedPalette()?.name ?? 'this palette'}.`);
      confirmTimer = setTimeout(resetDelete, DELETE_CONFIRM_MS);
      return;
    }
    const name = selectedPalette()?.name ?? 'palette';
    try {
      await library.remove(id);
      await refreshList('builtin:0');
      say(`Deleted ${name}.`);
    } catch (error) {
      say(`Couldn't delete: ${messageOf(error)}`);
    }
  };

  const importFile = async () => {
    const file = await chooseFile('.hex,.gpl,.pal,.png');
    if (!file) return;
    try {
      const name = fileBaseName(file.name);
      const palette = /\.png$/i.test(file.name)
        ? await paletteFromImageFile(file, name)
        : parsePaletteText(file.name, await file.text(), name);
      apply(palette, 'Imported');
    } catch (error) {
      say(`Couldn't import ${file.name}: ${messageOf(error)}`);
    }
  };

  const exportAs = async (format: ExportFormat) => {
    const palette = doc.palette;
    const base = safeFileName(palette.name, 'palette');
    try {
      if (format === 'png') {
        downloadBlob(await paletteToPng(palette), `${base}.png`);
        say(`Exported ${base}.png.`);
        return;
      }
      const { extension } = PALETTE_TEXT_FORMATS[format];
      downloadBlob(new Blob([serializePalette(palette, format)], { type: 'text/plain' }), `${base}.${extension}`);
      say(
        hasTranslucentColors(palette)
          ? `Exported ${base}.${extension}. This format has no transparency, so translucent colors were saved opaque.`
          : `Exported ${base}.${extension}.`,
      );
    } catch (error) {
      say(`Couldn't export: ${messageOf(error)}`);
    }
  };

  // The name field follows the document palette unless the user is typing in it.
  editor.onChange(() => {
    if (document.activeElement !== nameInput) nameInput.value = doc.palette.name;
  });
  nameInput.value = doc.palette.name;
  void refreshList('builtin:0');

  panel.append(heading, loadRow, mode, saveRow, fileRow, status);
  return panel;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
