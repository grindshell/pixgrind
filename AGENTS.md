# AGENTS.md — Pixgrind (Pixel Grinder)

Guidance for AI coding agents working in this repo. Keep it current: when a
"planned" item below becomes real (or a decision changes), update this file in
the same change.

## Project

Pixgrind is a browser-based pixel art editor built with **Vite + TypeScript**.

Core features:

- **Drawing** on a pixel grid, with **layers** (add, delete, reorder, rename,
  visibility, opacity, merge).
- **Palettes**: create, save, load, import/export, and **palette swapping**
  (recolor the whole image by switching to another palette).
- **Reference images**: import an image of any size as a background guide to
  trace over. References are never part of the artwork.
- **Import/export** of common image formats (PNG, JPG, WebP, …) plus a native
  project format that preserves layers and palette.

## Status

Built so far:

- Document model with layers and an indexed palette (`src/core/`).
- Layer compositing, rasterization (line, rect), flood fill, color/hex
  utilities.
- Canvas renderer with checkerboard backdrop, integer zoom, crisp scaling.
- Tools in a vertical strip beside the canvas: Rectangle select (M), Move
  (V), Pencil (B), Eraser (E), Line (L), Rectangle (R), Filled rectangle
  (Shift+R), Fill (G), Eyedropper (I).
  - The left button uses the primary color and the right button uses
    transparent.
  - Alt+click picks a color whatever the tool.
  - Middle-drag pans and the wheel zooms around the cursor.
- Selection:
  - Rectangle marquee. Ctrl+A selects all; Ctrl+D or Escape deselects.
  - Delete/Backspace clears the selected pixels.
  - With the Move tool, the arrow keys nudge 1px, or 10px with Shift.
  - Painting and fill are clipped to the selection.
  - Selection changes and moves are undoable.
- Palette panel: swatches (click to select the primary color, + to add), and
  for the selected color a picker with live preview, a hex field, and delete
  (unused colors only).
- Palettes panel:
  - Built-in presets (PICO-8, Game Boy, 1-bit, Grayscale 8) plus palettes
    saved in `localStorage`.
  - Load a palette by swap (keep indices) or remap (nearest colors).
  - Save, delete saved (two-click confirm).
  - Import/export `.hex`, `.gpl`, `.pal` and PNG swatches.
- All palette changes are undoable; the library itself is not.
- Undo/redo: per-stroke pixel diffs, Undo/Redo buttons, Ctrl/Cmd+Z,
  Ctrl+Shift+Z and Ctrl+Y.
- Layers panel: thumbnails, select, show/hide, rename (double-click), add,
  duplicate, delete, move up/down, merge down, opacity slider. All undoable
  except show/hide.

Not built yet, roughly in priority order: image import/export, reference
images, project files.
Follow-ups:
- Layers panel: drag-and-drop reordering, keyboard shortcuts for layer
  actions.
- Tools: a choosable secondary color (the right button is fixed to
  transparent), brush sizes, shape previews that react to Shift being pressed
  without moving the pointer.
- Selection:
  - A floating selection that keeps pixels moved off-canvas until it is
    committed (today they are dropped on release).
  - Non-rectangular selections (lasso, magic wand) and copy/paste.
  - Animated marching ants.
  - Dragging inside a selection with the marquee to move only the outline.
- Palettes:
  - Reorder colors by dragging.
  - A "replace color" remap (move all pixels from one index to another).
  - Alpha editing in the color editor (the native picker is RGB only; alpha
    can be typed as `#rrggbbaa`).

## Git

- The main branch is **`master`**. Branch from it and target it with PRs.
  (Claude Code's auto-detected "main branch" may say `main`; ignore that.)

## Environment

- Windows, PowerShell 7. Use PowerShell syntax in commands (no bash-isms).
- Node 24. Package manager is **pnpm** (pinned via `packageManager` in
  `package.json`). Never use npm or yarn; they would create a second lockfile.

## Commands

```powershell
pnpm install
pnpm dev             # dev server (http://localhost:5173)
pnpm build           # tsc type-check + production build to dist/
pnpm preview         # serve the production build
pnpm test            # vitest run (once)
pnpm test:watch      # vitest in watch mode
pnpm typecheck       # tsc only
pnpm add <pkg>       # runtime dependency
pnpm add -D <pkg>    # dev dependency
```

Before calling a task done: `pnpm build` and `pnpm test` pass. For UI changes,
also check the behavior in a browser (see Verifying in the browser).

## Stack

- Vite 8, TypeScript 6, Vitest 5. Vanilla TypeScript, no UI framework. Revisit
  only if UI complexity demands it; record the decision here if so.
- Rendering: Canvas 2D API.
- No runtime dependencies yet. Add one only with a clear reason.

TypeScript settings that affect how code is written (`tsconfig.json`):

- `strict: true`. No `any`; use `unknown` and narrow.
- `erasableSyntaxOnly`: **no `enum`, no `namespace`, no constructor parameter
  properties** (`constructor(private x: T)`). Use union types / `as const`
  objects and explicit fields.
- `verbatimModuleSyntax`: type-only imports must use `import type` /
  `import { type X }`.
- `allowImportingTsExtensions`: relative imports include the `.ts` extension
  (`import { plotLine } from './raster.ts'`).
- `noUnusedLocals` / `noUnusedParameters` are on.

## Layout

```
src/
  main.ts        entry point; mounts the editor
  style.css      global styles (dark theme, CSS custom properties on :root)
  core/          pure logic, no DOM: color, palette, layer, pixelDocument,
                 composite (+ visibleIndexAt), raster (line, rect, shape
                 constraints), rect (Rect geometry), floodFill, edits
                 (undoable changes), layerEdits / selection / paletteEdits
                 (edit constructors), history
  render/        viewport math (zoom/pan/coordinate mapping), CanvasRenderer
  io/            import/export and persistence: paletteFormats (pure text
                 parsers/serializers), paletteLibrary (saved palettes over a
                 storage interface), paletteImage (PNG swatches, DOM), files
                 (download, file picker, file names)
  ui/            Editor state + mounting, canvas input, tools + tool strip,
                 commands (non-pointer actions like select all, nudge),
                 keyboard shortcuts, history controls, palette and palettes
                 (library) panels, layers panel, DOM helpers (dom.ts) and
                 inline SVG icons (icons.ts)
public/          static assets served as-is (favicon.svg)
```

- `core/` must not import from `render/`, `ui/`, or `io/`, and must not touch
  `document`/`window`, so it can be unit-tested in Node. `render/viewport.ts`
  is also pure and tested.
- In `io/`, keep format parsing/serializing pure (string or bytes in, data
  out) and in separate modules from the DOM parts (file pickers, canvas
  encode/decode), so formats are unit-tested in Node. Persistence takes its
  storage as a parameter (`KeyValueStorage`) for the same reason.
- Dependency direction: `ui` → `render` / `io` → `core`.
- Tests live next to the code as `*.test.ts` and import from `vitest`
  explicitly (no globals).

## Core design decisions

### Indexed color

Layer pixels store **palette indices**, not RGBA:

- Each layer's `pixels` is a `Uint8Array` of length `width * height`, row-major
  (`i = y * width + x`).
- Index `0` (`TRANSPARENT`) is reserved for transparency. Palette colors are
  indices 1–255 (`MAX_PALETTE_COLORS`).
- `Palette.colors[i]` is the color of pixel index `i + 1`. Use
  `colorForIndex()` rather than indexing `colors` directly; it handles index 0
  and indices past the end (both render transparent).

This is what makes palette swapping cheap and lossless: switching palettes
changes the colors without touching pixel data. Don't introduce per-layer RGBA
storage without updating this section and the palette-swap design.

### Colors

- In memory a color is an `Rgba` number packed as `0xRRGGBBAA` (unsigned; see
  `core/color.ts` for pack/unpack helpers).
- Serialized as hex strings: `#rrggbb` when opaque, else `#rrggbbaa`
  (`toHex` / `parseHex`).

### Palettes

- A palette is `{ name, colors }`. A document owns its own copy
  (`createDocument` clones the palette passed in). It must keep at least one
  color.
- Palette changes are `palette` edits holding whole before/after snapshots
  (palettes are tiny). `applyEdit` clones on apply, because live previews
  (`Editor.previewPaletteColor`) mutate `doc.palette` in place and must never
  reach a snapshot in history. Constructors live in `core/paletteEdits.ts`.
- **Palette swap** (`swapPaletteEdit`): switch palettes keeping every pixel's
  index, so the image is recolored without touching pixel data.
  - Used indices the new palette lacks are remapped to the nearest new color,
    in the same undoable batch.
  - Indices that already had no color become transparent, so nothing new
    appears.
  - This is the "palette swap" feature.
- **Remap** (`remapToPaletteEdit`): every pixel moves to the nearest-looking
  new color (`colorDistance`, redmean-weighted RGB plus alpha). Use it when
  palettes are ordered differently.
- Deleting a color is only allowed when no pixel uses it (`canRemoveColor`
  gives the reason otherwise), so nothing is recolored silently. Later colors
  shift down an index and pixels using them are renumbered on every layer.
- The editor clamps `primaryIndex` into the palette after every document
  change.
- Saved palettes: `io/paletteLibrary.ts` defines an async `PaletteLibrary`
  interface. Today it's backed by `localStorage`, stored as JSON of hex
  strings under `pixgrind.palettes.v1`.
  - Saving replaces a saved palette with the same name.
  - Unreadable or malformed data reads as empty instead of breaking the app.
  - If storage is blocked, an in-memory fallback is used and the panel says
    saves won't persist.
  - The library is outside undo history, which is why deleting needs a second
    click.
- File formats (`io/paletteFormats.ts`):
  - `.hex` (Lospec), `.gpl` (GIMP) and `.pal` (JASC) are RGB only, so alpha is
    dropped on export, with a warning.
  - PNG swatches (`io/paletteImage.ts`) export one pixel per color (Lospec 1x)
    and keep alpha. On import they read any image's distinct visible colors
    in reading order.
  - More than 255 colors is an error, never a silent truncation.

### Layers

- `doc.layers` is ordered bottom to top (the panel shows it reversed).
  Composite with per-layer visibility and opacity (`compositeRgba`,
  straight-alpha "source over"). A document always has at least one layer.
- Refer to layers by **id**, not array position, anywhere the reference
  outlives the current call (edits, editor state, UI callbacks).
- The editor tracks the active layer by id (`Editor.selectLayer`). If an edit
  or undo removes it, the editor falls back to the layer at its old position.
- Draw operations target the editor's active layer only, and are blocked
  while that layer is hidden (the stage shows a not-allowed cursor).
- Merge down (`mergeDownEdit`) requires both layers visible and at 100%
  opacity, because palette indices can't blend. The upper layer's
  non-transparent pixels replace the lower layer's. A translucent palette
  color therefore replaces what was under it instead of blending with it.
- The reference image is **not** a layer: it is drawn under (or optionally
  over) the composite, has its own opacity/position/scale, and is excluded from
  export and from pixel data.

### Rendering

- `CanvasRenderer` composites layers into an `ImageData` at native resolution
  on an offscreen canvas, then draws it scaled by the zoom factor onto the
  screen canvas over a checkerboard.
- Pixel art must stay crisp: `imageSmoothingEnabled = false` for artwork and
  CSS `image-rendering: pixelated` on canvases. (Smoothing may be enabled for
  the reference image only.)
- The canvas backing store is sized to CSS size × `devicePixelRatio`. Resizes
  come from a ResizeObserver plus a `devicePixelRatio` watcher (monitor
  changes don't trigger ResizeObserver).
- Zoom is always an integer (`clampZoom`, 1–64). Viewport offsets may be
  fractional so zooming keeps the point under the cursor exact; the renderer
  snaps them to device pixels when drawing.
- `screenToPixel()` in `render/viewport.ts` is the only screen → document
  coordinate conversion. Pixel coordinates are always integers.
- Redraws go through `Editor.requestRender()` (one per animation frame), never
  direct `render()` calls from input handlers.

### Tools and input

- Pointer Events (mouse, pen, touch), with pointer capture during gestures.
  `ui/canvasInput.ts` turns them into tool gestures in document pixel
  coordinates and only forwards a move when the pixel or Shift state changes.
- Tools live in `ui/tools.ts`, one `Tool` object each:
  - `begin(editor, input, index)` returns a `ToolGesture` with `move`/`end`.
    `index` is the primary color for the left button and `TRANSPARENT` for
    the right.
  - `paints: true` tools are blocked while the active layer is hidden.
  - `shortcut` is matched case-sensitively against `KeyboardEvent.key`, so
    `"R"` means Shift+R.
  - The `TOOLS` array order is the toolbar order.

  To add a tool: write the object, add its id to `ToolId`, add an icon in
  `ui/icons.ts`, and put it in `TOOLS`. Keep geometry in `core/`.
- Painting tools write through `editor.beginStroke(label)` and commit in
  `end` with `editor.endStroke()`:
  - Freehand tools (pencil, eraser) connect consecutive positions with
    `plotLine` so fast strokes have no gaps.
  - Shape tools (line, rect) call `session.revert()` and redraw on every
    move. The preview lives in the layer, needs no overlay, and the final
    shape is one undo entry.
- Fill is 4-connected (`core/floodFill.ts`, iterative). 8-connected fills
  leak through diagonal one-pixel outlines.
- Eyedropper (`visibleIndexAt`) picks the topmost visible color, not the
  active layer's, and ignores transparent pixels.

### Selection

- `doc.selection` is a `Rect` (always inside the document) or null. It lives
  on the document, not the editor, so selection changes are undoable and a
  move restores both pixels and outline in one step. It isn't image data, so
  don't export it.
- With a selection, `editor.beginStroke` clips writes to it, and fill passes
  it to `floodRegion` as bounds. The flood itself stays inside rather than
  being clipped afterwards. Pass `{ clipToSelection: false }` for tools that
  must write outside it (Move).
- Move: on each pointer move, `session.revert()`, then rewrite
  `movedPixels(...)` computed from the untouched original. The source area is
  cleared and only non-transparent pixels are stamped, so transparent parts
  don't cover what's beneath. Pixels landing outside the document are
  dropped on release. With no selection, the whole layer moves.
- Keyboard selection actions live in `ui/commands.ts` (select all, deselect,
  clear, nudge) and use the core constructors in `core/selection.ts`.
- The renderer draws the selection as a 1-device-pixel dashed black/white
  outline.

### Undo/redo

- Every document-changing action must be undoable. One stroke = one history
  entry. **Exception:** layer visibility is not undoable, as in most pixel
  art editors: toggling it to compare shouldn't consume undo steps. It goes
  through `Editor.setLayerVisible`.
- `core/edits.ts` defines `Edit`, a discriminated union of plain-data
  changes, and `applyEdit(doc, edit, 'undo' | 'redo')`. Current kinds:
  - `pixels`
  - `layer-add`, `layer-remove`, `layer-move`, `layer-props` (name, opacity)
  - `palette`
  - `selection`
  - `batch`, which is all-or-nothing: it rolls back if any part fails.
    `combineEdits(label, edits)` builds one, or returns the single edit or
    null.

  New kinds of change (palette edits, resize, …) become new union members
  with a case in `applyEdit`. The `assertNever` default makes a missed case a
  type error. Don't use callbacks or closures for edits.
- Edits are constructed **unapplied**. Performing one for the first time is
  `applyEdit(doc, edit, 'redo')`, which is what `Editor.perform(edit)` does
  before pushing it to history. Constructors in `core/layerEdits.ts` validate
  and return `null` for no-op changes. `perform(null)` is a no-op.
- `PixelEdit` is a diff: changed offsets plus before/after palette indices.
  It targets its layer by id, so it survives reordering and delete/restore.
- Live previews (e.g. dragging the opacity slider) mutate through
  `Editor.previewLayerOpacity`, then commit one edit on release with an
  explicit `before` value (`layerPropsEdit(doc, id, after, before)`).
- Editor entry points:
  - `perform(edit)` applies an unapplied edit and records it.
  - `record(edit)` records one whose changes are already applied, e.g.
    after a preview or a stroke.
  - `takeStroke()` ends a stroke without recording it, so a tool can
    combine it with other edits (Move = pixels + selection).
- While a pointer gesture or stroke is active (`editor.busy`), undo, redo and
  `perform` are ignored. Without this, an edit made mid-gesture would
  interleave with the gesture's own edit.
- `core/history.ts` `History` holds the undo/redo stacks (default limit 256).
  `push` takes an edit that is already applied and clears redo. If
  `applyEdit` throws, the stacks are left unchanged.
- In the UI, pixel writes go through `editor.beginStroke(label)`, which
  returns a `PixelEditSession`, then `editor.endStroke()`, which commits it.
  Never call `setPixel` on document layers directly from UI code: the change
  would skip history.
- Strokes that change nothing (or end up back at the original values) don't
  create entries. Undo/redo are ignored while a stroke is in progress.

### Import/export (planned)

- Image import: decode with `createImageBitmap` → `ImageData`. Importing as
  artwork requires quantizing to the palette: either map to the nearest palette
  colors or build a palette from the image's unique colors (error clearly if
  more than 255).
- Image export: flatten visible layers (`compositeRgba`), optional integer
  upscale (1×, 2×, 4×…, nearest-neighbor), then `canvas.toBlob`.
  - PNG: default; lossless, keeps transparency.
  - JPG: no alpha, so flatten onto a user-chosen background color; it is lossy
    and adds artifacts, so export at max quality and say so in the UI.
  - WebP: export losslessly when supported.
- Project format: `.pixgrind` JSON with a `version` field, dimensions, palette,
  and layers (pixel data base64-encoded). Optionally embed the reference image.
  Bump `version` and add a migration when the schema changes.

## Verifying in the browser

- `.claude/launch.json` defines a `dev` server config (port 5173) for preview
  tooling.
- In dev builds the editor is exposed as `window.pixgrind` (see `main.ts`), so
  automation can read `pixgrind.viewport`, `pixgrind.doc`, and
  `pixgrind.activeLayer.pixels` instead of guessing coordinates.
- Synthetic `PointerEvent`/`WheelEvent`s dispatched on the stage canvas
  exercise the real input path. Compute client coordinates from
  `pixgrind.viewport`. Select it with `.stage-canvas`: plain `canvas` matches
  a layer thumbnail in the sidebar first.
- When the app window is occluded, the page reports
  `visibilityState: 'hidden'` and the browser stops running
  `requestAnimationFrame` and ResizeObserver callbacks. Screenshots time out,
  the canvas isn't redrawn, and its backing size can be stale. State checks
  still work. To check pixel output, render synchronously first, then read
  pixels with `getImageData`:
  `pixgrind.renderer.resize(w, h); pixgrind.renderer.render(pixgrind.doc, pixgrind.viewport)`.
- On Windows the Vite dev server often misses a file change made right after
  another edit to the same file. It then keeps serving the old module, and
  you'll see errors like "does not provide an export named …" or "X is not
  defined" for code that exists. This has happened repeatedly. **Restart the
  dev server before browser verification** whenever a file was edited more
  than once in quick succession.
- A page loaded while the pane is hidden may fit the view to a tiny stage
  (zoom 1). Compute coordinates from `pixgrind.viewport` rather than assuming
  a zoom level.
- Don't trigger real downloads or file pickers from automation. Check
  exports by calling the encoders directly (e.g.
  `await import('/src/io/paletteImage.ts')` and round-trip `paletteToPng`
  through `paletteFromImageFile`). Text formats are covered by unit tests.
  Remove any test data saved to `localStorage` afterwards.

## Conventions

- Named exports only; no default exports.
- Small modules with one responsibility. Files `camelCase.ts`; types and classes
  `PascalCase`; constants `UPPER_SNAKE_CASE`.
- Keep `core/` functions pure where practical (input → output, no hidden state)
  so they are easy to test.
- Unit-test core logic: palette parsing/serialization, palette swap, flood fill,
  line rasterization, layer compositing, edits and history (undo + redo for
  every new `Edit` kind), project file round-trips.
- Don't commit build output (`dist/`) or `node_modules/`.
