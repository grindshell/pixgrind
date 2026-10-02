/** Saves a blob through the browser's download flow. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the file picker. Resolves to null if the user cancels. Must be called from a user gesture. */
export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** "My Palette.gpl" → "My Palette". */
export function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '') || fileName;
}

/** A name safe to use as a download file name. */
export function safeFileName(name: string, fallback = 'untitled'): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || fallback;
}
