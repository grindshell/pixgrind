import {
  checkClipSize,
  clipFromImage,
  clipImage,
  clipMatchesImage,
  copyPixels,
  cutEdit,
  pasteEdit,
  type PixelClip,
} from '../core/clipboard.ts';
import type { RgbaImage } from '../core/image.ts';
import { decodeImage, encodeImage } from '../io/imageCodec.ts';
import { BUSY_MESSAGE } from './commands.ts';
import { isTextEntry } from './dom.ts';
import type { Editor } from './editor.ts';

/**
 * Copy (Ctrl/Cmd+C), cut (X) and paste (V), except in text fields.
 *
 * A copy is kept here with its palette indices, and also put on the system
 * clipboard as a PNG for other apps. A paste takes an image from the system
 * clipboard (e.g. copied in another app) in the nearest palette colors,
 * unless it is the last copy made here, which pastes exactly. Pastes float
 * on the active layer, with the Move tool ready to position them.
 * `report` shows messages, such as why a paste failed.
 */
export function attachClipboard(target: Document, editor: Editor, report: (message: string) => void): void {
  let clip: PixelClip | null = null;
  /**
   * True from a copy here until the page loses focus. Until then no other app
   * can have copied, so an image on the system clipboard is older than `clip`
   * (writing it failed or hasn't finished) and the copy made here wins.
   */
  let clipIsNewest = false;
  target.defaultView?.addEventListener('blur', () => {
    clipIsNewest = false;
  });
  /** Set when a `paste` event arrives, so the Ctrl+V fallback knows not to paste again. */
  let pasteEventSeen = false;

  /** Whether to act: not in text fields (which keep their own clipboard), and not mid-gesture. */
  const handles = (e: Event) => !isTextEntry(e.target) && !editor.busy;

  const store = (copied: PixelClip) => {
    clip = copied;
    clipIsNewest = true;
    writeSystemClipboard(clipImage(copied));
  };

  const copy = () => store(copyPixels(editor.doc, editor.activeLayer));

  const cut = () => {
    const layer = editor.activeLayer;
    if (!layer.visible) {
      report("Can't cut from a hidden layer.");
      return;
    }
    store(copyPixels(editor.doc, layer));
    editor.perform(cutEdit(editor.doc, layer));
  };

  const paste = async (file: File | undefined) => {
    let source = clip;
    if (file && !(clip && clipIsNewest)) {
      const image = await decodeImage(file, checkClipSize);
      // Our own copy comes back through PNG slightly changed if it has translucent colors.
      if (!clip || !clipMatchesImage(clip, image)) source = clipFromImage(image, editor.doc.palette, editor.plane);
    }
    if (!source) return;
    const layer = editor.activeLayer;
    if (!layer.visible) {
      report("Can't paste onto a hidden layer.");
      return;
    }
    // Decoding takes a moment, in which a gesture may have started.
    if (editor.perform(pasteEdit(editor.doc, layer, source))) editor.setTool('move');
    else report(BUSY_MESSAGE);
  };
  const runPaste = (file: File | undefined) => {
    paste(file).catch((error: unknown) => report(error instanceof Error ? error.message : String(error)));
  };

  // Copy and cut are handled on the key itself: no clipboard data is needed
  // to start them, and browsers only fire `copy`/`cut` with something
  // selected or editable. Preventing the default stops a second copy.
  target.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !handles(e)) return;
    const key = e.key.toLowerCase();
    if (key === 'c' || key === 'x') {
      e.preventDefault();
      if (e.repeat) return;
      if (key === 'c') copy();
      else cut();
    } else if (key === 'v' && !e.repeat) {
      // Pasting needs the `paste` event, the only way to read another app's
      // image without a permission prompt. Should the browser not fire one,
      // paste the last copy made here instead.
      pasteEventSeen = false;
      setTimeout(() => {
        if (!pasteEventSeen) runPaste(undefined);
      });
    }
  });

  // Cancelling `beforepaste` enables the browser's Paste command with
  // nothing editable focused, so Ctrl+V fires `paste` (likewise for menus).
  for (const type of ['beforecopy', 'beforecut', 'beforepaste']) {
    target.addEventListener(type, (e) => {
      if (handles(e)) e.preventDefault();
    });
  }

  // Clipboard events from the browser's own menus.
  target.addEventListener('copy', (e) => {
    if (!handles(e)) return;
    e.preventDefault();
    copy();
  });
  target.addEventListener('cut', (e) => {
    if (!handles(e)) return;
    e.preventDefault();
    cut();
  });
  target.addEventListener('paste', (e) => {
    pasteEventSeen = true;
    if (!handles(e)) return;
    e.preventDefault();
    runPaste([...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/')));
  });
}

/** Best effort: fails without focus or permission, or in browsers without the async clipboard API. */
function writeSystemClipboard(image: RgbaImage): void {
  try {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': encodeImage(image, 'png') })]).catch(() => {});
  } catch {
    // No async clipboard here; copies still work within Pixgrind.
  }
}
