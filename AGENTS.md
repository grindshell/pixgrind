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
- Tools in a vertical strip beside the canvas: Rectangle select (M), Lasso
  select (Q), Polygonal lasso (Shift+Q), Magic wand (W), Move (V), Pencil
  (B), Eraser (E), Line (L), Rectangle (R), Filled rectangle (Shift+R), Fill
  (G), Eyedropper (I).
  - The left button paints the primary color and the right button the
    secondary color (transparent by default, so right-click erases). X
    swaps them.
  - Alt+click picks a color whatever the tool, into the pressed button's
    color.
  - Middle-drag pans and the wheel zooms around the cursor.
- Brush panel: size 1–64 and round/square shape, shared by Pencil, Eraser,
  Line and both Rectangles. `[` / `]` step the size. The canvas outlines
  the brush under the pointer. A "Pixel perfect" option (1px only) makes
  Pencil and Eraser drop the corners of L-shaped turns.
- Selection:
  - Any shape of pixels. Made with the rectangle marquee, the lasso
    (freehand; selects the pixels it passes over and everything inside),
    the polygonal lasso (click corners; click the first one, double-click
    or press Enter to finish, Backspace undoes a corner, Escape cancels),
    or the magic wand (the clicked color on the active layer, touching
    pixels only or all of them). Ctrl+A selects all; Ctrl+D or Escape
    deselects; Ctrl+I inverts (with nothing selected, it selects all). A
    click without dragging deselects.
  - Selection panel: All / None / Invert buttons, a mode for the selection
    tools (new, add, subtract, intersect) and the wand's Contiguous option.
    Shift adds, Ctrl/Cmd subtracts and Ctrl+Shift intersects, whatever the
    mode.
  - Moving selected pixels (Move tool, or arrow keys with it: 1px, 10px
    with Shift) floats them.
    - Pixels moved off the canvas are kept, shown faintly outside it, until
      the float is dropped.
    - Enter drops it in place. Deselecting, a new marquee, or any other edit
      drops it too.
    - Delete/Backspace deletes the floating pixels, uncovering what was
      under them. Without a float it clears the selected pixels.
  - Painting and fill are clipped to the selection.
  - Selection changes, moves and drops are undoable.
- Copy/cut/paste (Ctrl/Cmd+C, X, V):
  - Copy takes the float, else the selection, else the whole active layer,
    with its selection shape.
  - Paste floats it on the active layer, where it was copied from if that
    fits, else centered, and switches to Move.
  - Colors follow the palette as it was at copy time.
  - Copies also go to the system clipboard as PNG, and images copied in
    other apps paste in nearest palette colors.
- Palette panel:
  - Swatches: click for the primary color, right-click (or the context menu
    key) for the secondary, + to add.
  - Primary/secondary wells, a swap button, and a transparent swatch that
    can be either color.
  - For the primary color: a picker with live preview, a hex field, and
    delete (unused colors only). These are disabled when the primary is
    transparent.
- Palettes panel:
  - Built-in presets (PICO-8, Game Boy, 1-bit, Grayscale 8) plus palettes
    saved in `localStorage`.
  - Load a palette by swap (keep indices) or remap (nearest colors).
  - Save, delete saved (two-click confirm).
  - Import/export `.hex`, `.gpl`, `.pal` and PNG swatches.
- All palette changes are undoable; the library itself is not.
- File panel:
  - Open (Ctrl+O, or drop on the canvas) a `.pixgrind` project or an image
    as the document. Undoable. Images use either their own colors or the
    current palette.
  - Save (Ctrl+S) downloads a `.pixgrind` project, optionally with the
    reference image embedded.
  - Unsaved changes show as `•` in the window title, and production builds
    ask before closing the tab.
  - Add an image as a layer.
  - Export PNG/JPEG/WebP at 1–16×.
- Reference panel: load an image of any size as a tracing guide, fitted to
  the canvas.
  - Show/hide, above/below the artwork, smoothing, opacity, scale (with
    Fit), and remove.
  - Move mode: drag to position it and wheel to scale it around the pointer.
  - Never part of pixel data or exports, and not undoable.
- Undo/redo: per-stroke pixel diffs, Undo/Redo buttons, Ctrl/Cmd+Z,
  Ctrl+Shift+Z and Ctrl+Y.
- Layers panel: thumbnails, select, show/hide, rename (double-click), add,
  duplicate, delete, move up/down, merge down, opacity slider. All undoable
  except show/hide.

Follow-ups:
- Files:
  - Save in place with the File System Access API where available (today
    every save is a new download).
  - Autosave/crash recovery (e.g. IndexedDB).
- Layers panel: drag-and-drop reordering, keyboard shortcuts for layer
  actions.
- Selection:
  - Whole-layer moves (nothing selected) don't float, so pixels moved off
    the canvas are still lost on release.
  - A wand option to sample all visible layers.
  - Shift to snap polygonal lasso edges to 45°, as the Line tool does.
  - Clipboard: paste into a new layer, copy merged (all visible layers), and
    on-screen buttons for touch devices (keyboard only today).
  - Animated marching ants (shift the outline pattern's transform per
    frame).
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
                 constraints), brush (footprints, brush lines and
                 rectangles), pixelPerfect (L-corner removal for 1px
                 strokes), clipboard (copy/cut/paste clips), rect (Rect
                 geometry), mask (pixel sets: selection shapes, lasso,
                 combining, outlines), floodFill (+ colorRegion), image (RGBA
                 ↔ indices, upscale, flatten), edits (undoable changes),
                 layerEdits / selection / paletteEdits / documentEdits (edit
                 constructors), history
  render/        viewport math (zoom/pan/coordinate mapping), CanvasRenderer,
                 ReferenceImage type
  io/            import/export and persistence: projectFile (.pixgrind
                 serialize/parse), bytes (base64, zlib), paletteFormats (pure
                 text parsers/serializers), paletteLibrary (saved palettes
                 over a storage interface), imageCodec (decode/encode via
                 canvas), paletteImage (PNG swatches), files (download, file
                 picker, file names and sizes)
  ui/            Editor state + mounting, canvas input, tools + tool strip,
                 commands (non-pointer actions like select all, nudge),
                 fileCommands (open/save project, open/add/export image),
                 keyboard shortcuts, clipboard (copy/cut/paste events and
                 the system clipboard), brush and selection panels,
                 history controls, file panel, palette and palettes (library)
                 panels, layers panel, reference panel (+ loadReferenceFile),
                 DOM helpers (dom.ts) and inline SVG
                 icons (icons.ts)
public/          static assets served as-is (favicon.svg)
```

- `core/` must not import from `render/`, `ui/`, or `io/`, and must not touch
  `document`/`window`, so it can be unit-tested in Node. `render/viewport.ts`
  is also pure and tested.
- In `io/`, keep format parsing/serializing pure (string or bytes in, data
  out) and in separate modules from the DOM parts (file pickers, canvas
  encode/decode), so formats are unit-tested in Node. `Blob`, `btoa`/`atob`
  and compression streams are fine there: Node has them too. Persistence takes its
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
- Paint colors (`Editor.primaryIndex` / `secondaryIndex`, changed through
  `setColorIndex(slot, index)` and `swapColors`) are palette indices, where
  0 means transparent. They're editor state: not undoable, not saved.
  - Edits that renumber colors set `PaletteEdit.renumber` (index maps for
    redo and undo). After every perform, record, undo and redo, the editor
    runs both slots through `followIndex`, so they stay on the same colors.
    Today only deletion renumbers; reordering colors should do the same.
  - Then both are clamped into the palette.
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
- The reference image is **not** a layer. See Reference images below.

### Reference images

- Editor state (`editor.reference: ReferenceImage | null`), not document
  state, so it never touches pixel data, compositing, exports or history.
  Change it only through `Editor.setReference` / `updateReference`.
  `setReference` closes the old `ImageBitmap`. `updateReference(…, { silent:
  true })` skips listeners for per-pointer-move updates.
- `ReferenceImage` (`render/referenceImage.ts`):
  - The decoded `bitmap` for drawing, plus the original `source` Blob so
    project files can embed it.
  - Image size, and placement in **document coordinates**: `x`/`y` of the
    top-left and `scale` in document px per image px. These are fractional,
    since references are guides rather than pixels.
  - `opacity`, `visible`, `above`, `smooth`.

  Placement math is pure, in `core/referencePlacement.ts`: fit, scale around
  an anchor, center, and the logarithmic slider mapping. Scale is clamped to
  0.01–64.
- Rendering order: checkerboard, then the reference if below, then artwork,
  then the reference if above, then floating pixels off the document, then
  the selection (or float) outline, then a lasso being drawn, then the
  brush outline. The reference is clipped
  to the document rect and drawn with `globalAlpha` and its own smoothing
  setting (on by default for photos). Artwork smoothing stays off.
- Move mode is a hidden tool (`reference`) toggled from the panel.
  - It's `continuous`, so it gets every pointer move, not just
    pixel-to-pixel ones, and uses the exact (fractional) coordinates in
    `ToolInput.exact`.
  - Its `wheel` handler scales around the pointer; Ctrl+wheel still zooms.
  - Removing the reference returns to the pencil.

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
- `render(doc, viewport, overlays)` takes what isn't document data as
  `RenderOverlays`: the reference image and the brush cursor.

### Tools and input

- Pointer Events (mouse, pen, touch), with pointer capture during gestures.
  `ui/canvasInput.ts` turns them into tool gestures in document pixel
  coordinates and only forwards a move when the pixel or Shift state changes.
  Pressing or releasing Shift mid-gesture re-sends the last position with the
  new Shift state, so line snapping, squares and axis-locked moves update
  without moving the pointer. Tools must therefore handle a `move` to the same
  pixel; all current ones simply recompute.
- Tools live in `ui/tools.ts`, one `Tool` object each:
  - `begin(editor, input, index, slot)` returns a `ToolGesture` with
    `move`/`end`. `slot` is the pressed button's color (`primary` for the
    left, `secondary` for the right) and `index` its palette index, which
    may be `TRANSPARENT`. The eraser ignores `index` and always erases; the
    eyedropper picks into `slot`.
  - `paints: true` tools are blocked while the active layer is hidden.
  - `shortcut` is matched case-sensitively against `KeyboardEvent.key`, so
    `"R"` means Shift+R.
  - The `TOOLS` array order is the toolbar order.
  - Optional:
    - `hidden` keeps a tool out of the strip (activated elsewhere).
    - `brush` paints with `editor.brush` and shows the brush outline.
    - `continuous` forwards every pointer move.
    - `wheel` takes over the mouse wheel.
    - `hover` follows the pointer between gestures (null when it leaves
      the canvas).
    - `key` gets first go at plain keys (no Ctrl/Cmd or Alt) while the
      tool is active, before the global shortcuts.
    - `deactivate` runs when `Editor.setTool` switches away.
    - `ToolInput.exact` has the fractional document position; `x`/`y` are
      the floored pixel.

  Work that spans several gestures (the polygonal lasso's corners) lives
  outside the gesture: per editor in a module `WeakMap`, shown through
  `hover`, finished or cancelled through `key` and `deactivate`. It
  touches no document state until it finishes, so undo and other edits
  between clicks stay safe.

  To add a tool: write the object, add its id to `ToolId`, add an icon in
  `ui/icons.ts`, and put it in `TOOLS`. Keep geometry in `core/`.
- Painting tools write through `editor.beginStroke(label)` and commit in
  `end` with `editor.endStroke()`:
  - Freehand tools (pencil, eraser) drag the brush between consecutive
    positions with `brushLine` so fast strokes have no gaps.
  - Pixel perfect (`Editor.pixelPerfect`, used only with a 1px brush)
    feeds each stroke pixel to a `pixelPerfectPath` (`core/pixelPerfect.ts`).
    - When the last three points make an L, the corner is dropped and put
      back with `PixelEditSession.restore`, live as the stroke goes.
    - The check runs on the kept path, so a staircase of orthogonal steps
      becomes a clean diagonal.
    - A corner the stroke also crosses elsewhere stays painted.
    - Bresenham segments never contain an L themselves; corners only appear
      where segments join.
  - Shape tools (line, rect) call `session.revert()` and redraw on every
    move. The preview lives in the layer, needs no overlay, and the final
    shape is one undo entry.
- Brushes (`core/brush.ts`): one `Brush` (size 1–64, `round` or
  `square`) on the editor, shared by every `brush` tool and changed through
  `Editor.setBrush`. It isn't saved in projects.
  - `brushMask` builds the footprint once per size and shape (cached), as
    offsets from the pointer pixel. Odd sizes center on it; even sizes put
    it right of and below the center, as Aseprite does.
  - Round brushes include a pixel when its center is within r² − 0.5 of the
    middle. That gives the usual pixel-art circles: a plus at 3, clipped
    corners from 4 on.
  - `brushLine` stamps the full footprint at the first point and only its
    `edge` pixels after that: a one-pixel step can't reach anything else.
    This keeps large brushes fast. Tests check it against stamping
    everywhere.
  - `brushRect` traces the outline with the brush (four `brushLine`s), and
    fills inside it when filled. Corners grow with the brush, as with lines.
  - Canvas input reports the hovered pixel (`Editor.setPointer`) on move,
    pan, wheel zoom and pointer down, and clears it on leave. The renderer
    draws the mask's `outline` runs (`outlineRuns`, as for selections) one
    device pixel outside the footprint, dashed black on white. It is hidden
    for non-brush tools and over hidden layers.
  - `[` / `]` call `stepBrushSize`: one step at a time up to 8, then
    coarser.
- Fill is 4-connected (`core/floodFill.ts`, iterative). 8-connected fills
  leak through diagonal one-pixel outlines.
- Eyedropper (`visibleIndexAt`) picks the topmost visible color, not the
  active layer's, and ignores transparent pixels (so a stray click on empty
  canvas doesn't turn a color into an eraser; use the transparent swatch).

### Selection

- `doc.selection` is a `Mask` (always inside the document) or null. It lives
  on the document, not the editor, so selection changes are undoable and a
  move restores both pixels and outline in one step. It isn't image data, so
  don't export it.
- Masks (`core/mask.ts`) are sets of pixels: a `rect` plus `bits` (one byte
  per pixel of the rect), or `bits: null` for the whole rect.
  - Always normalized: never empty (null means no pixels), `rect` is the
    tight bounding box, and `bits` is null exactly when every pixel of the
    rect is in. So equal sets compare equal (`masksEqual`), and rectangle
    selections stay cheap.
  - Never mutated. Moves (`translateMask`) share `bits`; the renderer
    caches outlines per `bits` array, so dragging a float doesn't recompute
    them.
  - `rectMask`, `maskFromBits`, `maskFromOffsets` (flood regions),
    `lassoMask`, `clipMask` (always returns a plain mask, even for a float
    or clip), `combineMasks(selection, shape, mode)`.
- Selection tools (marquee, lasso, wand) share `selecting()` in
  `ui/tools.ts`.
  - The mode is fixed at the press: Ctrl+Shift intersects, Shift adds,
    Ctrl/Cmd subtracts, else `Editor.selectionMode` (the Selection panel).
    `ToolInput.ctrl` is Ctrl or Cmd.
  - The tool previews `combineMasks(start selection, shape, mode)` and
    records it on release, with the float's drop, as one entry ("Select" or
    "Deselect").
  - A click with the marquee or lasso is an empty shape: it deselects in
    replace mode, and changes nothing when adding or subtracting.
  - Lasso: the path's pixels plus pixel centers inside the closed polygon
    (nonzero winding, so loops drawn over themselves stay filled). While
    dragging only the path is drawn (`Editor.previewLasso`); in replace
    mode the old selection is hidden at once.
  - Polygonal lasso: `lassoMask` over its corners. Each click adds a
    corner on release (so dragging positions it). A click on the last
    corner, or on or within `CLOSE_DISTANCE` screen pixels of the first,
    finishes; the rubber band snaps to the first corner when a click would.
    Its mode comes from the first click's modifiers, and the current
    selection stays shown until it finishes.
  - Wand: `floodRegion` (contiguous, 4-connected like fill) or
    `colorRegion` (every pixel of that index) on the active layer, per
    `Editor.wandContiguous`.
- With a selection, `editor.beginStroke` clips writes to it, and fill passes
  it to `floodRegion` as bounds. The flood itself stays inside rather than
  being clipped afterwards (unselected pixels are pre-marked as visited).
  Pass `{ clipToSelection: false }` for tools that must write outside it
  (Move).
- **Floating selections** (`doc.floating: FloatingPixels | null`): moving
  selected pixels lifts them into a float. A float is a `Mask` too (its
  selection shape), plus its pixels; those outside the mask are
  transparent, so they cover nothing.
  - The float's pixels are always stamped into its layer at `rect`. So
    export, save, the eyedropper, thumbnails, palette tools and color usage
    all just see layer pixels.
  - The float record adds what stamping loses: the lifted `pixels` (including
    any off the document) and `under`, the layer value beneath each stamped
    pixel.
  - Lifting and dropping therefore change no pixels. Moving (`moveFloating`)
    puts `under` back, then stamps at the new place, recording the new
    `under`. Transparent float pixels cover nothing.
  - `rect` may extend past the document. `doc.selection` is kept as the
    float's mask clipped to the document (null when entirely off it), so
    selection clipping still works. The renderer outlines the float's whole
    mask instead, and draws off-document float pixels at half their layer's
    opacity.
  - Edits: a `floating` edit sets or clears the float. `moveSelectionEdit`
    (nudge) lifts if needed and batches pixels + floating + selection.
    `dropFloatingEdit` and `deleteFloatingEdit` (Delete key: uncovers
    `under`) are the other two.
  - **Any edit that doesn't manage the float itself drops it.**
    `Editor.perform`/`record` prepend a drop to the same history entry
    unless `editSetsFloating(edit)`. Dropping changes no pixels, so edits
    built while the float existed stay valid, and undo restores the float.
    Code that changes the document doesn't need to know about floats.
  - Selection tools drop the float at gesture start (`previewFloating(null)`)
    so the new selection shows, and record the drop with the selection.
  - With no selection, Move moves the whole layer without floating:
    `movedPixels` from the untouched original on each pointer move, and
    pixels outside the document are lost on release (`moveLayerEdit` for
    nudges).
  - A float belongs to a layer (`layerId`). Moving on another layer lifts a
    new float there, replacing (dropping) the old one.
- Move tool: on each pointer move, `session.revert()`, then rewrite from the
  state at the start of the drag (`moveFloating` from the starting float).
  The drag is one history entry; dragging back to the start records nothing.
- Keyboard selection actions live in `ui/commands.ts` (select all, deselect,
  invert, drop, clear, nudge) and use the core constructors in
  `core/selection.ts`. Enter drops a float; Escape and Ctrl+D drop and
  deselect.
  - Invert is Ctrl+I (as in GIMP), because Ctrl+Shift+I, the usual
    shortcut elsewhere, opens dev tools in every major browser before the
    page sees it. Ctrl+Shift+I is handled too, for when it gets through.
  - `invertMask` complements within the document, so inverting nothing
    selects everything and inverting everything deselects.

### Clipboard

- `core/clipboard.ts` (pure): a `PixelClip` is the copied indices, the mask
  they came from (shape and place), and the palette colors at copy time.
  Pasting floats the same shape.
  - `copyPixels` takes the float on the active layer (including off-canvas
    pixels), else the selection, else the whole layer. `cutEdit` removes
    the same thing.
  - `pasteEdit` places it as a new float (`placeFloatingEdit`, replacing
    any float), at its original rect when that's inside the document, else
    centered.
  - `clipIndices` keeps an index whose color is unchanged in the current
    palette, else maps to the nearest color. That's how pasting after a
    palette change or into another document keeps the look.
- `ui/clipboard.ts`:
  - The last copy is kept in memory, and also written to the system
    clipboard as PNG (best effort; failures are ignored).
  - Copy and cut run on keydown with the default prevented, because browsers
    only fire `copy`/`cut` when something is selected or editable.
  - Paste needs the `paste` event: it's the only way to read another app's
    image without a permission prompt. `beforecopy`/`beforecut`/
    `beforepaste` are cancelled outside text fields so the browser fires
    them.
  - If no `paste` event follows a Ctrl+V keydown, a `setTimeout` fallback
    pastes the in-memory copy.
  - A clipboard image that is pixel-identical to our own last copy pastes
    the in-memory clip, keeping exact indices (duplicate palette colors
    included). Any other image is mapped to the nearest palette colors.
  - Text fields keep their normal clipboard. Hidden layers refuse with a
    message in the File panel status.
- The renderer draws the selection's `maskOutline` one device pixel inside
  its edge, stroked with a diagonal black/white stripe pattern fixed to the
  canvas (`createAnts`), not a dash pattern: dashes restart on every run, so
  jagged outlines would come out mostly black.
  - `OutlineRun`s say whether each end is a concave corner. Lines inside an
    edge reach one device pixel further at concave corners, lines outside
    (the brush) at convex ones (`traceRun`); otherwise corners are left
    open.
  - The lasso path is drawn with the same pattern through pixel centers.

### Undo/redo

- Every document-changing action must be undoable. One stroke = one history
  entry. **Exceptions:**
  - Layer visibility (through `Editor.setLayerVisible`) and reference image
    settings are not undoable, as in most pixel art editors. Toggling or
    adjusting them to compare shouldn't consume undo steps.
  - The reference isn't part of the document at all.
- `core/edits.ts` defines `Edit`, a discriminated union of plain-data
  changes, and `applyEdit(doc, edit, 'undo' | 'redo')`. Current kinds:
  - `pixels`
  - `layer-add`, `layer-remove`, `layer-move`, `layer-props` (name, opacity)
  - `palette`
  - `selection`
  - `floating` (sets or clears the floating selection; see Selection)
  - `document` (replaces everything; e.g. opening an image)
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
  - `perform(edit)` applies an unapplied edit and records it. It returns
    false when it did nothing (null edit, or busy); async commands check
    this rather than reporting success.
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
- `History.position` is an opaque token for the current state: undoing or
  redoing back to a state gives the same token. The empty-stack token is
  replaced when old edits are dropped or history is cleared, since that
  state is then no longer the original one. The editor compares it with the
  position saved by `markSaved` to compute `Editor.dirty`.
- In the UI, pixel writes go through `editor.beginStroke(label)`, which
  returns a `PixelEditSession`, then `editor.endStroke()`, which commits it.
  Never call `setPixel` on document layers directly from UI code: the change
  would skip history.
- Strokes that change nothing (or end up back at the original values) don't
  create entries. Undo/redo are ignored while a stroke is in progress.

### Image import/export

- Layering: pure conversions live in `core/image.ts` (`RgbaImage`, indexing,
  upscale, flatten) and `core/documentEdits.ts` (edits). Browser decode and
  encode live in `io/imageCodec.ts`. The commands in `ui/fileCommands.ts` take
  `File`s rather than opening pickers, so drag-and-drop and tests call them
  directly.
- Decode: `createImageBitmap` with `colorSpaceConversion: 'none'` and
  `premultiplyAlpha: 'none'`, so colors come out exactly as stored.
- **Open image** (`openImageEdit`) replaces the whole document through a
  `document` edit (a before/after `DocumentState`), so it is undoable and
  nothing is lost without a prompt. Two color modes:
  - `image`: the image's distinct colors become the palette (exact; more than
    255 colors is an error).
  - `palette`: nearest colors of the current palette (`indexImageToPalette`).

  Fully transparent pixels become index 0. Documents are capped at
  `MAX_DOCUMENT_SIZE` (1024) per side. Dropping an image file on the stage
  opens it with the panel's color mode.
- **Add as layer** (`importImageLayerEdit`): nearest current-palette colors,
  placed at the top-left, cropped to the document. It's a `layer-add` edit.
- When the document size changes (open, or undoing one), the editor refits
  the view (`Editor.fitToView`). `doc.name` (from the file name) drives export
  file names and the window title.
- Export (`renderExport`):
  - Flatten the visible layers (`documentImage`), then `upscaleImage`
    (integer nearest-neighbor, 1–16×), then `encodeImage`.
  - PNG is lossless with alpha. JPEG is flattened onto a chosen background
    (`flattenImage`) at quality 1, and the UI warns it's lossy. WebP is
    encoded at quality 1, which Chromium makes lossless.
  - `encodeImage` rejects when the browser silently substitutes another
    format (Safari WebP), and when an image exceeds `MAX_EXPORT_SIZE` (8192)
    per side.
  - File names are `<name>[@<scale>x].<ext>`.
- Not built yet: export of the selection only, a "new document / canvas size"
  dialog, GIF/animated formats.

### Project files

- `.pixgrind` is pretty-printed JSON (`io/projectFile.ts`):
  - `format: "pixgrind"` and an integer `version`, then name, width,
    height and the palette (hex strings).
  - Layers bottom to top: name, visible, opacity, and `pixels`, which is
    base64 of the zlib-compressed (`CompressionStream('deflate')`) palette
    indices, row-major.
  - An optional `reference`: the original image file (base64) with its MIME
    type, placement and settings. It's re-decoded on load.
- Not saved: the selection, floating selection (its on-canvas pixels are in
  the layer; off-canvas ones are lost), history, view, active layer, tool or
  paint colors. Layer ids are regenerated on load.
- `PROJECT_VERSION` is 1. When the schema changes, bump it and keep reading
  every older version by migrating its JSON to the current shape before
  reading. A newer version than this build knows is refused with a clear
  message, never half-read.
- `parseProject` validates everything and throws user-readable errors
  naming the field (e.g. "layer 2 opacity must be between 0 and 1").
  Inflation is capped at the layer's size so a small file can't expand
  without limit.
- `serializeProject` copies the document synchronously before its first
  await, so edits made during compression don't leak into the file.
- Opening a project replaces the document with a `document` edit
  (`replaceDocumentEdit`, undoable) and marks it saved. The reference is
  decoded first, and if the project has one it replaces the current
  reference. Otherwise the current one stays, as when opening an image.
  The reference isn't undoable, so undoing the open keeps it.
- Saving downloads `<name>.pixgrind`. The File panel's "with reference"
  checkbox (shown only when a reference is loaded) controls embedding.
- Dirty tracking: `Editor.dirty` is true when the history position differs
  from the saved one, or when layer visibility changed since saving
  (visibility is saved but isn't in history). Reference changes don't
  count. The title shows `•` when dirty. `main.ts` adds a `beforeunload`
  guard in production builds only, because Vite's full reloads after every
  source edit would trigger it in dev.
- Ctrl+O / Ctrl+S are handled even in text fields (overriding the browser's
  open/save page). The File panel owns them (`FilePanel.open`/`save`) so
  results show in its status line.

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
- Don't trigger real downloads or file pickers from automation:
  - Check exports by calling the encoders directly, e.g.
    `await import('/src/ui/fileCommands.ts')` and decode `renderExport(...)`
    with `decodeImage`, or round-trip `paletteToPng` through
    `paletteFromImageFile`.
  - Test opening images by dispatching `dragover` and `drop` on `.stage` with
    a `DataTransfer` holding a `File` (build one with `encodeImage`), or call
    `openImageFile` / `addImageLayer` directly.
  - Text formats are covered by unit tests.
  - Test Save/Ctrl+S end to end by temporarily replacing
    `HTMLAnchorElement.prototype.click` with a recorder, then `fetch` the
    recorded blob URL to read the file. Restore it afterwards. Likewise
    stub `HTMLInputElement.prototype.click` to check that Ctrl+O opens a
    picker. Test opening projects by dropping a `File` named `*.pixgrind`
    on `.stage`.
  - Test clipboard handling by dispatching
    `new ClipboardEvent('paste', { clipboardData })` with a `DataTransfer`
    holding an image `File`. For the real key path, the browser pane's
    `computer` key action (e.g. `ctrl+v`) works.
    - Synthetic `KeyboardEvent`s never trigger the browser's clipboard
      commands.
    - Copies write a PNG to the user's real OS clipboard, so tell them.
  - Remove any test data saved to `localStorage` afterwards.
- While the pane is hidden, `editor.renderer.viewSize` can stay 0×0 because
  ResizeObserver never fires, so `fitToView` does nothing. Call
  `pixgrind.renderer.resize(w, h)` with the stage size first when checking
  zoom.
- Synthetic `MouseEvent`/`WheelEvent`s round `clientX`/`clientY` to integers
  (`PointerEvent` keeps fractions). When asserting exact positions after a
  wheel event, compute from the event's own coordinates.

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
