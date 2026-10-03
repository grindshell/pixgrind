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
- **3D models** from the pixel art: pixel art can be drawn on any of the six
  sides of the model (front, back, left, right, top, bottom), and each pixel
  extruded into a box that grows from the far side toward the camera looking
  at that side. A side view edits one column's depth directly, a 3D view
  shows the model, and it exports as `.glb`.

## Status

Built so far:

- Document model with layers and an indexed palette (`src/core/`).
- Layer compositing, rasterization (line, rect), flood fill, color/hex
  utilities.
- Canvas renderer with checkerboard backdrop, integer zoom, crisp scaling.
- Tools in a vertical strip beside the canvas: Rectangle select (M), Lasso
  select (Q), Polygonal lasso (Shift+Q), Magic wand (W), Move (V), Pencil
  (B), Eraser (E), Line (L), Rectangle (R), Filled rectangle (Shift+R), Fill
  (G), Eyedropper (I), Extrude (D), Diagonal (Shift+D).
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
  - Add an image as a layer (on the side being edited).
  - Export PNG/JPEG/WebP at 1–16× (the side being edited; file names get
    `-<side>` for all but the front).
- Reference panel: load an image of any size as a tracing guide, fitted to
  the canvas.
  - Show/hide, above/below the artwork, smoothing, opacity, scale (with
    Fit), and remove.
  - Move mode: drag to position it and wheel to scale it around the pointer.
  - Never part of pixel data or exports, and not undoable.
- Undo/redo: per-stroke pixel diffs, Undo/Redo buttons, Ctrl/Cmd+Z,
  Ctrl+Shift+Z and Ctrl+Y. Undoing or redoing a change on another side of
  the model switches the canvas there.
- Layers panel: the side being edited's layers, with thumbnails, select,
  show/hide, rename (double-click), add, duplicate, delete, move up/down,
  merge down, opacity slider. All undoable except show/hide.
- Perspective bar over the canvas: Front, Back, Left, Right, Top, Bottom
  (keys 1–6) pick the side of the model the canvas edits (see Sides below),
  with its size, and a Guide toggle that shows the other sides' model
  faintly under its layers.
- 3D model (see 3D model below):
  - Every painted pixel has an extrusion: depth 1–1024, offset 0–1023 (out
    from the far side) and a shape, a square or a diagonal half with one
    corner cut off (default a square 1 deep against the far side). Moves,
    floats, copy/paste, merge down, undo and project files carry it with
    the pixel.
  - 3D model panel: Side and 3D view toggles, the model's depth (Model
    depth: grows or shrinks at the front), the Extrude tool's depth and
    offset with Apply depth (to the selection or layer), the Diagonal
    tool's shape (Auto, a corner, or square) with Apply shape, depth labels
    and diagonal cuts on the canvas (labels at zoom 12× or more), and GLB
    export at a chosen size per pixel: watertight by default (each color a
    closed, manifold solid), or lean (fewest faces).
  - Extrude tool (D): paints the panel's depth and offset onto painted
    pixels with the brush, so boxes grow toward the camera (cut short at
    the far side of the volume); right-click resets them. Shapes stay.
    Pressing also picks the side view's column.
  - Diagonal tool (Shift+D): paints the panel's shape onto painted pixels,
    keeping depths; right-click makes them square. Auto cuts the corner
    between a pixel's two empty sides (the steps of a staircase edge, which
    become a smooth 45° slope) and leaves other pixels. While it's active
    the canvas shades the corners diagonal pixels cut off.
  - Side view pane: one column of the side being edited, seen from that
    side's right, rows level with the canvas, the camera's side on the
    left. Painting a cell adds that depth to the pixel's box (or makes a
    new pixel); transparent (right-click by default) takes it away.
    Alt+click picks the cell's color. ‹ › change the column.
  - 3D view pane: WebGL 2, drag to orbit, right/middle/Shift-drag to pan,
    wheel to zoom, double-click or Reset view to frame the model.
  - Panes open beside the canvas; drag their left edge to resize.
  - Meshes merge same-color faces that lie side by side in one plane, so
    flat areas and straight edges, slopes included, are one quad each (3D
    view and GLB).

Follow-ups:
- 3D model:
  - More mesh optimization: fewer rectangles where rows don't repeat
    exactly (e.g. a minimum rectangle partition per plane), and sharing
    vertices in lean exports too (only between faces facing the same way,
    since they keep normals).
  - Watertight export runs on the main thread: seconds for large noisy
    documents (a 256² noise test takes ~2.5 s). A worker would keep the UI
    responsive.
  - More diagonal slopes: 2:1 and 1:2 (common in pixel art, isometric
    especially). They cut across pixel pairs, which quarters can't
    describe, so they need finer pixel shapes and partial side faces.
  - Where diagonal pixels from sides with different axes overlap in one
    voxel, the upper keeps only part of the lower (see `overlay`); exact
    would need voxels split both ways (24 tetrahedra).
  - The side view shows columns only; rows (seen from below) would help on
    wide sides.
  - The reference image is shared by every side; one per side would let
    each trace its own view.
  - Layer opacity in 3D (today only visibility counts).
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
                 facing (the model's sides, directions, plane geometry),
                 composite (+ visibleIndexAt), raster (line, rect, shape
                 constraints), brush (footprints, brush lines and
                 rectangles), pixelPerfect (L-corner removal for 1px
                 strokes), clipboard (copy/cut/paste clips), rect (Rect
                 geometry), mask (pixel sets: selection shapes, lasso,
                 combining, outlines), floodFill (+ colorRegion), image (RGBA
                 ↔ indices, upscale, flatten), extrusion (packed extrusions
                 and shapes, cells, side view cell edits, autoShape), model
                 (voxel runs by quarter, views and slices, mesh), meshWeld
                 (manifold welding for watertight export),
                 edits (undoable changes), layerEdits / selection /
                 paletteEdits / documentEdits / extrusionEdits (edit
                 constructors), history
  render/        viewport math (zoom/pan/coordinate mapping), CanvasRenderer,
                 ReferenceImage type, camera (orbit camera and matrices),
                 ModelRenderer (WebGL 2), SideRenderer
  io/            import/export and persistence: projectFile (.pixgrind
                 serialize/parse), bytes (base64, zlib, 16/32-bit LE), glb (3D
                 export), paletteFormats (pure
                 text parsers/serializers), paletteLibrary (saved palettes
                 over a storage interface), imageCodec (decode/encode via
                 canvas), paletteImage (PNG swatches), files (download, file
                 picker, file names and sizes)
  ui/            Editor state + mounting, canvas input, tools + tool strip,
                 commands (non-pointer actions like select all, nudge),
                 fileCommands (open/save project, open/add/export image,
                 export model), keyboard shortcuts, clipboard
                 (copy/cut/paste events and the system clipboard), brush and
                 selection panels, history controls, file panel, palette and
                 palettes (library) panels, layers panel, reference panel (+
                 loadReferenceFile), 3D model panel (modelPanel), perspective
                 bar (perspectiveBar), side and 3D panes (sidePane,
                 modelPane, on paneFrame), throttle
                 (adaptiveThrottle), DOM helpers (dom.ts) and inline SVG
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

### Sides (facings)

- A document is a model's volume, `width` × `height` × `depth` (x left to
  right, y top to bottom as on the front, z front to back), and its layers
  are pixel art drawn on one of its six sides: each layer has a `facing`
  (`core/facing.ts`: front, back, left, right, top, bottom) and is the size
  of that side's plane (`planeSize`: front/back W×H, left/right D×H,
  top/bottom W×D), stored as `layer.width`/`height`.
- A facing's frame (`facingFrame`) says which way its columns (`right`),
  rows (`down`) and boxes (`toward` its camera) run on the volume, as
  `Direction`s (±x, ±y, ±z). Each is a proper rotation of the front's, so
  the back is mirrored (its column 0 is the model's right), the top's row 0
  is the back, and the right side's column 0 is the front, as cameras
  there see them. `facingVoxel` maps a pixel and a box cell to a voxel,
  `stepsAlong` back.
- Every facing has at least one layer: `createDocument` makes one per
  side, deleting the last of a side is refused (`canRemoveLayer`), and
  project files without some side get an empty layer for it.
- The editor edits one side at a time (`Editor.facing`, `setFacing`; keys
  1–6 and the perspective bar). The canvas shows that side's layers only,
  plus the guide: the model of the other sides' layers as its camera sees
  it (`otherSidesView`), faint under them. The guide is rebuilt only when
  other sides may have changed (`guideStamp`: recorded edits, visibility,
  opacity), not on every stroke. `Editor.plane` and `extent` are the side's
  size and how far its boxes reach.
- Everything 2D works per side: plane-sized layers, the side's selection
  (`doc.selections[facing]`), layer lists and moves (the next layer of the
  same side, `neighborLayerIndex`), merges, copy/paste, image import and
  export. The float belongs to its layer and stays when switching sides; it
  shows only on its side.
- Changing the depth (`setDepthEdit`, a `document` edit) grows or shrinks
  the volume at the front, so the model stays put: front boxes keep their
  offsets, back ones move out, top/bottom/side layers gain or lose rows or
  columns at the front, and boxes past the front are cut short. Selections
  of the resized sides and the float are dropped.
- Undo and redo switch to the side an edit changed (`editedSide`), so the
  change shows.

### Layers

- `doc.layers` is ordered bottom to top (the panel shows the side being
  edited's, reversed). Upper layers win where their boxes overlap in 3D,
  whatever their sides. Composite one side with per-layer visibility and
  opacity (`compositeRgba(doc, facing)`, straight-alpha "source over").
- Refer to layers by **id**, not array position, anywhere the reference
  outlives the current call (edits, editor state, UI callbacks).
- The editor tracks the active layer per side by id (`Editor.selectLayer`,
  which switches to the layer's side). If an edit or undo removes it, the
  editor falls back to the side's layer at its old position. This runs for
  every side after each change (`syncActiveLayers`), since an undo can
  remove another side's active layer; sides with no chosen layer use their
  topmost.
- Draw operations target the editor's active layer only, and are blocked
  while that layer is hidden (the stage shows a not-allowed cursor).
- Merge down (`mergeDownEdit`) requires both layers visible and at 100%
  opacity, because palette indices can't blend. The upper layer's
  non-transparent pixels replace the lower layer's. A translucent palette
  color therefore replaces what was under it instead of blending with it.
  It also requires pixels both layers have to share an extrusion, since a
  merge would lose the lower one's box in 3D.
- Panels re-render on every editor change, so they keep that cheap: layer
  thumbnails are sampled down to at most 64px (`layerThumbnailRgba`), and
  the palette panel recounts color usage only when `Editor.revision`
  (bumped by every recorded edit, undo and redo) changes.
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
  - Image size, and placement in **document coordinates** (of whichever
    side is shown: one reference serves all): `x`/`y` of the top-left and
    `scale` in document px per image px. These are fractional, since
    references are guides rather than pixels.
  - `opacity`, `visible`, `above`, `smooth`.

  Placement math is pure, in `core/referencePlacement.ts`: fit, scale around
  an anchor, center, and the logarithmic slider mapping. Scale is clamped to
  0.01–64.
- Rendering order: checkerboard, then the reference if below, then the
  guide (other sides' model, faint), then artwork,
  then the reference if above, then extrusions (diagonal cuts and depth
  labels), then the side view's
  column band, then floating pixels off the document, then
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
  - `requestRender('view')` says only the view or overlays changed (pan,
    zoom, brush outline, selection, lasso, reference), so the renderer
    reuses its layer composite (`RenderOptions.reuseComposite`) instead of
    recompositing every layer.
  - The default, `'content'`, recomposites. Use it for anything that changes
    pixels, the palette, or layer order, visibility or opacity, and when in
    doubt: a missed `'view'` only costs time, a wrong one shows stale pixels.
  - Direct `renderer.render()` calls (automation) always recomposite.
  - Every `'content'` request bumps `Editor.contentVersion` (unlike
    `revision`, also mid-stroke and for previews). Views caching what they
    draw key on it.
  - `Editor.onRender(listener)` runs after each canvas render with whether
    content changed. The side and 3D panes redraw from there, so they follow
    the canvas without their own subscriptions to every change.
- `render(doc, facing, viewport, overlays)` draws one side's plane. It
  takes what isn't document data as
  `RenderOverlays`: the reference image, the guide, the brush cursor, the
  lasso, the side view's column (`slice`) and the layer whose extrusions to show
  (`extrusions`: the corners diagonal pixels cut off, shaded from zoom 4×,
  and with `depths` the depth labels from zoom 12×). They're drawn into a
  cached canvas, redrawn only when the content, layer or view changes:
  text is slow.

### Tools and input

- Pointer Events (mouse, pen, touch), with pointer capture during gestures.
  `ui/canvasInput.ts` turns them into tool gestures in document pixel
  coordinates and only forwards a move when the pixel or Shift state changes.
  Pressing or releasing Shift mid-gesture re-sends the last position with the
  new Shift state, so line snapping, squares and axis-locked moves update
  without moving the pointer. Tools must therefore handle a `move` to the same
  pixel; all current ones simply recompute.
- Before a canvas or side view gesture starts, `commitTextEntry` blurs a
  focused text field. Fields that commit on blur (layer rename, hex color,
  model depth) would otherwise blur only after the press made the editor
  busy, and their edit would be refused. Neither view starts a gesture while
  the editor is busy with the other's (two fingers on a touch screen).
- Tools live in `ui/tools.ts`, one `Tool` object each:
  - `begin(editor, input, index, slot)` returns a `ToolGesture` with
    `move`/`end`. `slot` is the pressed button's color (`primary` for the
    left, `secondary` for the right) and `index` its palette index, which
    may be `TRANSPARENT`. The eraser ignores `index` and always erases; the
    eyedropper picks into `slot`.
  - `paints: true` tools are blocked while the active layer is hidden.
  - `shortcut` is matched case-sensitively against `KeyboardEvent.key`, so
    `"R"` means Shift+R. The case comes from Shift alone, so Caps Lock
    doesn't change a shortcut.
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
  between clicks stay safe. Keys still run while the button is down, so a
  gesture must check that its work wasn't finished or dropped meanwhile
  (the polygon's press is then void).

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

- Each side has its own selection: `doc.selections[facing]` is a `Mask`
  (always inside that side's plane) or null, and `selection` edits name
  their side. It lives on the document, not the editor, so selection
  changes are undoable and a move restores both pixels and outline in one
  step. It isn't image data, so don't export it. `Editor.selection` is the
  side being edited's.
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
  - The float record adds what stamping loses: the lifted `pixels` and
    their `extrusion` (including any off the document) and `under`, the
    layer cell (index and extrusion) beneath each stamped pixel.
  - Lifting and dropping therefore change no pixels. Moving (`moveFloating`)
    puts `under` back, then stamps at the new place, recording the new
    `under`. Transparent float pixels cover nothing.
  - `rect` may extend past the layer. The selection of the float's side is
    kept as the float's mask clipped to the layer (null when entirely off
    it), so selection clipping still works. The renderer outlines the
    float's whole mask instead (on its side only), and draws off-layer float
    pixels at half their layer's opacity.
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
  - With no selection, Move moves the whole layer without floating: on each
    pointer move the session is reverted and the layer's pixels and
    extrusions rewritten with `shiftedValues` (row copies into reused
    buffers) through `PixelEditSession.setAll`. Pixels outside the document are lost on
    release (`shiftLayerEdit` for nudges; `moveLayerEdit` in
    `core/layerEdits.ts` is reordering, a different thing).
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

- `core/clipboard.ts` (pure): a `PixelClip` is the copied indices and
  extrusions, the mask they came from (shape and place), and the palette
  colors at copy time. Pasting floats the same shape. Images from other
  apps have no extrusions and paste at the default.
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
  - Until the page loses focus after a copy, paste uses the in-memory clip
    whatever the system clipboard holds: no other app can have copied
    since, so an image there is older (our write failed or is unfinished).
  - Otherwise a clipboard image that matches our last copy
    (`clipMatchesImage`: exact for opaque pixels, within premultiplied
    rounding for translucent ones) pastes the in-memory clip, keeping exact
    indices (duplicate palette colors included). Any other image is mapped
    to the nearest palette colors.
  - Text fields keep their normal clipboard (`isTextEntry`: text inputs,
    textareas, contenteditable; checkboxes, sliders and drop-downs don't
    count, so shortcuts keep working after using them). Hidden layers
    refuse with a message in the File panel status.
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
- `PixelEdit` is a diff: changed offsets plus before/after palette indices,
  and before/after extrusions when any changed (`extrusion`, absent
  otherwise). It targets its layer by id, so it survives reordering and
  delete/restore. Diffs ignore extrusion changes on pixels that stay
  transparent: they mean nothing there.
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
  interleave with the gesture's own edit. Saving is refused too: a
  half-done stroke isn't a history position to mark saved. Commands that
  fail this way say so (`BUSY_MESSAGE`).
- `core/history.ts` `History` holds the undo/redo stacks (default limit 256).
  `push` takes an edit that is already applied and clears redo. If
  `applyEdit` throws, the stacks are left unchanged.
- `History.position` is an opaque token for the current state: undoing or
  redoing back to a state gives the same token. When the oldest edit is
  dropped, it stays the token of the state after it (now the one with
  nothing to undo), so undoing back to a save made there reads as clean.
  Clearing history makes a new token. The editor compares it with the
  position saved by `markSaved` to compute `Editor.dirty`.
- In the UI, pixel writes go through `editor.beginStroke(label)`, which
  returns a `PixelEditSession`, then `editor.endStroke()`, which commits it.
  Never call `setPixel` on document layers directly from UI code: the change
  would skip history.
  - A session copies the layer when it begins and tracks the range of
    offsets written. `revert` copies that range back, and `finish` diffs it
    against the copy, so neither costs more than the stroke's extent.
  - `setAll` writes a whole layer's worth at once. For edits built outside
    a session, `pixelEditFromArray` diffs a whole-layer array (and
    optionally extrusions), which is much faster than
    `pixelEditFromValues`' map for big changes.
  - `updateExtrusion` changes a painted pixel's extrusion (through a
    function of the current one, so tools keep what they don't paint),
    `setCell` a pixel's
    index and extrusion together. `pixelEditFromCells` is the map version
    for cells (floats and pastes use it); `pixelEditFromValues` sets indices
    only.
- Strokes that change nothing (or end up back at the original values) don't
  create entries. Undo/redo are ignored while a stroke is in progress.

### 3D model

- **Extrusions** (`core/extrusion.ts`): each layer has `extrusion: Uint32Array`
  parallel to `pixels`, packed as `shape << 21 | offset << 11 | depth`. A
  pixel's box grows **toward its layer's camera**: it fills the cells
  `offset` up to `offset + depth`, counted from the far side of the volume
  (the side away from the camera; see Sides). Depth is 1–1024, offset
  0–1023. Boxes reaching past the volume are cut at its side
  (`fitExtrusion`; the model does it too, for any that slip through).
  - `Shape` is how the box looks to its camera: `SQUARE` (0), or the right
    triangle left when one corner is cut off along the diagonal
    (`CUT_TOP_LEFT` … `CUT_BOTTOM_LEFT`, 1–4 clockwise). `withBox` and
    `withShape` change one part and keep the other; the Extrude tool, Apply
    depth and the side view keep shapes, the Diagonal tool keeps boxes.
  - `autoShape` picks the corner from the layer's pixels: the one between
    exactly two empty sides that meet (off the document counts as empty),
    else null.
  - Only meaningful where the pixel is painted. `setPixel` resets it to
    `DEFAULT_EXTRUSION` (1 deep against the far side) when painting where
    there was no pixel, so an erased pixel's box never comes back. Writing
    a transparent cell leaves the extrusion alone.
  - A `Cell` is index and extrusion as one number
    (`extrusion * 256 + index`, under 2³²), for code that moves whole
    pixels: float stamping, pastes, the side view.
- **Gaps** come from layers: each layer gives a pixel one box, so stacking
  layers puts several boxes behind the same pixel, with gaps between.
  There's no list of boxes per pixel.
- **Model** (`core/model.ts`, pure), in the volume's coordinates (x right,
  y down, z front to back):
  - A box is a line of voxels along its layer's axis (z for the front and
    back, y for the top and bottom, x for the sides). Each voxel is split
    by both diagonals across one axis, its **split axis**, into four
    **quarters**, each touching one side (`QUARTER_DIRECTIONS`: for z the
    front's top, right, bottom, left; for y and x the top's and the right
    side's, as their cameras see them). A square fills all four, a diagonal
    half two (a layer's shape maps to quarters through its frame,
    `SHAPE_BYTES`). `Content` is a split axis plus a palette index per
    quarter (`Quarters`, packed bytes, 0 where empty; the axis is z when all
    four are one color), so culling between pixels and diagonal halves is
    exact, and a diagonal pixel over a square on a lower layer shows the
    square in its cut-off half.
  - `buildVoxelModel` turns visible layers (opacity above 0) into sorted
    runs along z per front pixel (`columns`). Front and back boxes are one
    run each; top, bottom and side boxes a voxel per column they cross,
    gathered into runs. Upper layers win where boxes overlap, as in 2D, in
    the quarters they fill (`overlay`); quarters split across different
    axes don't line up, so then the lower keeps only the quarters on the
    sides both split alike. Touching runs with the same content merge.
    Fully transparent palette colors are left out; layer opacity isn't
    modeled. Empty layers are skipped quickly (most sides are empty).
  - `voxelSampler` gives any voxel's content without building the model,
    `sliceOf` a whole slice behind one column of a side (the side view's,
    fresh on every change), `viewModel` the model seen from a side, two
    halves per pixel (the side view's backdrop), `otherSidesView` the
    canvas's guide, and `seenFrom` what a viewer on a side sees in a
    voxel's upper or lower half.
  - `buildMesh` makes faces per palette color (a `MeshPart` each). Faces
    covered by a neighbor that's opaque or the same color are dropped, so
    translucent colors show what's behind them but no faces inside
    themselves. A voxel's side is whole, belonging to the quarter touching
    it, unless the voxel is split across that side's axis: then it's four
    triangles, one per quarter along each edge (`faceLabels`; halves of one
    color become one triangle). Side faces are cut into the stretches of z
    where the neighboring column doesn't change. Between two quarters of a
    voxel that differ, slanted faces (normals at 45°) run along the
    half-diagonal; inside runs split across x or y, consecutive voxels also
    get faces between them where their touching quarters differ
    (`betweenVoxels`).
  - Faces of one color side by side in one plane merge into rectangles
    (`FacePlane`, one per family, normal and plane; see the table above
    `FACE_X`): spans join along a row, and a rectangle grows into the next
    row while that row repeats its span exactly. Slanted planes are the 45°
    lines through voxel corners across a split axis, with a row (or span)
    per half-diagonal, so a staircase's slope is one quad whichever side it
    was drawn on. Linear time, emitting each rectangle as soon as it closes
    (keeping them all made garbage collection dominate), except slants
    split across x or y, which arrive out of order and are sorted first
    (they come only from diagonals on the top, bottom and sides). Corners
    come from `PLANE_PLACES`, and quads and triangles are wound from their
    normal, so no case can get it wrong. Not the fewest rectangles
    possible, but a flat area or a straight edge is one quad. Merged quads
    meet at T-junctions, which hasn't shown seams. Triangles aren't merged.
  - The test checks the mesh piece by piece (each side's four triangles and
    each half-diagonal of every voxel, worked out from the model's content)
    against the mesh on random documents with layers on every side and
    diagonals: every exposed piece covered exactly once, hidden ones not at
    all, and no extra area. Keep it when changing the mesh.
  - **Watertight** (`buildMesh(…, { watertight: true })`, for export): only
    the same color hides a face, so every color is a closed shell (where two
    colors touch, both have a face, back to back inside the model). Each
    part is then welded by `weldPolygons` (`core/meshWeld.ts`): corners at
    one place share a vertex; a vertex lying along another face's edge is
    added to it (no T-junctions); faces are fanned into triangles from a
    corner whose edges weren't split, else from a new middle vertex (no flat
    triangles); and where a shell touches itself along an edge or at a
    point, each sheet gets its own vertices (triangles around such an edge
    are paired by angle, solid wedge by solid wedge, via union-find over
    triangle corners). Sheets paired apart along an edge can still be one
    surface around both its ends (a solid pinched to the edge but whole past
    it); then each further sheet gets its own vertex in the edge's middle.
    Result: each part a closed 2-manifold with shared vertices and
    `normals: null`.
  - Pinches hide under merged faces: where a quarter meets the edge of a
    face only at its corner (a slanted face ends there), the solid under a
    face that spans the edge is two pieces touching along a line, and the
    weld would need an edge inside a face. So watertight meshes don't merge
    a color's faces across the edges its slants end at (`slantEnds`,
    `mergeRules`); a voxel's two half-diagonals and slants along their split
    axis still merge.
  - Why a shell per color: glTF needs a primitive per material, and
    Blender's glTF import keeps each primitive's vertices separate unless
    "Merge Vertices" is ticked (which in turn would fuse sheets that only
    touch). Shells per color are manifold with the default import. Tests
    check manifoldness (each edge once each way, one fan per vertex) and each
    color's enclosed volume on random documents.
  - Mesh coordinates follow glTF: y up, front faces +z, one unit per pixel,
    the volume centered on x and z with y = 0 at its bottom (so a sprite on
    the front of a deep volume sits behind the origin). Triangles are
    counter-clockwise from outside. Normals use `0 - v` to avoid -0.
- `Editor.voxelModel` builds the model on demand and caches it per
  `contentVersion`, so the side and 3D views share one build. Both rebuild
  derived data through `adaptiveThrottle` (`ui/throttle.ts`): every frame
  when fast, otherwise no sooner than 3× the last build's time, with a
  trailing run so the last change always shows.
- **Extrude and Diagonal tools and the panel**: `Editor.extrude` (depth,
  offset) is what the Extrude tool's left button paints and what Apply
  depth sets; `Editor.diagonal` (a `Shape` or `'auto'`) likewise for the
  Diagonal tool and Apply shape. Both tools share `extrusionStroke`; the
  buttons use `updateExtrusionsEdit` (`core/extrusionEdits.ts`, on the
  selection or the whole layer). Writes go through strokes, so they're
  clipped to the selection and undoable.
- **Panes** (`ui/paneFrame.ts`): open beside the canvas in `.workspace`, set
  by `Editor.setPaneOpen('side' | 'model', open)`. Each has a canvas, a
  floating bar (title, controls, close), and a resize handle on its left
  edge. They draw only while open.
- **Side view** (`ui/sidePane.ts`, `render/sideRenderer.ts`): column
  `Editor.sliceColumn` of the side being edited, seen from that side's
  right: the camera's side on the left, the far side (drawn as a line) on
  the right, as many cells as the volume reaches. Cell `s` from the left is
  box cell `extent - 1 - s`.
  - It shares the canvas's zoom and vertical offset, so rows line up with
    the canvas; it has its own horizontal offset. Its wheel zooms the
    shared viewport; middle-drag pans both.
  - Cells in the slice (`sliceOf`) show at full color, the rest of the
    model (`viewModel`, from the throttled model) faintly behind; the active
    layer's boxes in the column are outlined. Each cell's upper and lower
    half show what a viewer on the right sees there (`seenFrom`; they
    differ only for diagonal pixels), and Alt+click picks the half under
    the pointer.
  - Painting: `extendCell` (grow the box to reach the cell, or a new pixel
    one deep) with a color, `carveCell` with transparent (a box has no
    gaps, so it's trimmed from the nearer end; the far end on a tie, keeping
    the end the camera sees; a one-deep box becomes transparent). One
    stroke per drag, `plotLine` between cells.
- **3D view** (`ui/modelPane.ts`, `render/modelRenderer.ts`,
  `render/camera.ts`): WebGL 2, created on first open (a message replaces
  it when unavailable). Flat shading from a fixed light, with each
  triangle's normal worked out in the fragment shader from screen-space
  derivatives of the position (so normals aren't uploaded and shared
  vertices would shade flat too), opaque parts first
  then translucent ones blended without depth writes, a floor grid and the
  volume's outline. An orbit camera (yaw, pitch, distance, target);
  framed by `fitCamera` on first build, on a volume size change, on
  Reset view and on double-click, otherwise kept across edits. Drawn only
  when something changes.
- **GLB export** (`io/glb.ts`, pure): one mesh, a primitive and material per
  palette color (named by hex; base color converted to linear, matte,
  `BLEND` when translucent). Positions are scaled to the chosen meters per
  pixel; POSITION has exact min/max; indices are 16-bit when they fit.
  NORMAL is written only when the mesh has normals: watertight exports
  (the panel's Watertight checkbox, on by default) share vertices between
  faces facing different ways, so they leave normals out, and glTF viewers
  must then shade flat. The lean export (checkbox off) is the 3D view's
  mesh, with per-face vertices and normals.
  Empty models are refused. `fileCommands.exportModel` downloads
  `<name>.glb`.

### Image import/export

- Layering: pure conversions live in `core/image.ts` (`RgbaImage`, indexing,
  upscale, flatten) and `core/documentEdits.ts` (edits). Browser decode and
  encode live in `io/imageCodec.ts`. The commands in `ui/fileCommands.ts` take
  `File`s rather than opening pickers, so drag-and-drop and tests call them
  directly.
- Decode: `createImageBitmap` with `colorSpaceConversion: 'none'` and
  `premultiplyAlpha: 'none'`, so colors come out exactly as stored.
  `decodeImage`'s `checkSize` sees the size before the pixels are read, so
  opening and pasting refuse images too large for a document before they
  take memory.
- **Open image** (`openImageEdit`) replaces the whole document through a
  `document` edit (a before/after `DocumentState`), so it is undoable and
  nothing is lost without a prompt. Two color modes:
  - `image`: the image's distinct colors become the palette (exact; more than
    255 colors is an error).
  - `palette`: nearest colors of the current palette (`indexImageToPalette`).

  The image becomes the front's layer, in a volume as deep as it's wide or
  tall (`defaultDepth`), with an empty layer on every other side. Fully
  transparent pixels become index 0. Documents are capped at
  `MAX_DOCUMENT_SIZE` (1024) per side, depth too. Dropping an image file on
  the stage opens it with the panel's color mode.
- **Add as layer** (`importImageLayerEdit`): nearest current-palette colors,
  placed at the top-left of the side being edited, cropped to it. It's a
  `layer-add` edit.
- When the size of the side being edited changes (open, a depth change,
  switching sides, or undoing one), the editor refits the view
  (`Editor.fitToView`). `doc.name` (from the file name) drives export file
  names and the window title.
- Export (`renderExport`, of one side, the one being edited):
  - Flatten its visible layers (`documentImage`), then `upscaleImage`
    (integer nearest-neighbor, 1–16×), then `encodeImage`.
  - PNG is lossless with alpha. JPEG is flattened onto a chosen background
    (`flattenImage`) at quality 1, and the UI warns it's lossy. WebP is
    encoded at quality 1, which Chromium makes lossless.
  - `encodeImage` rejects when the browser silently substitutes another
    format (Safari WebP), and when an image exceeds `MAX_EXPORT_SIZE` (8192)
    per side. `renderExport` checks the size (`checkExportSize`) before
    upscaling, since a 1024px document at 16× would take gigabytes.
  - File names are `<name>[-<side>][@<scale>x].<ext>`, the side left out for
    the front.
- Not built yet: export of the selection only, a "new document / canvas size"
  dialog, GIF/animated formats.

### Project files

- `.pixgrind` is pretty-printed JSON (`io/projectFile.ts`):
  - `format: "pixgrind"` and an integer `version`, then name, width,
    height, depth and the palette (hex strings).
  - Layers bottom to top: name, visible, opacity, `facing`, and `pixels`
    (the size of its side), which is base64 of the zlib-compressed
    (`CompressionStream('deflate')`) palette indices, row-major. Optionally
    `extrusion`, likewise for little-endian 32-bit packed extrusions (shape
    included), written only when a painted pixel isn't at the default
    (transparent pixels are saved as the default). A side with no layer in
    the file gets an empty one.
  - An optional `reference`: the original image file (base64) with its MIME
    type, placement and settings. It's re-decoded on load.
- Not saved: the selection, floating selection (its on-canvas pixels are in
  the layer; off-canvas ones are lost), history, view, active layer, tool or
  paint colors. Layer ids are regenerated on load.
- `PROJECT_VERSION` is 4 (2 added `extrusion` as 16-bit boxes, 3 added
  `shapes`, 4 added `depth` and `facing` and turned boxes around). Versions
  1–3 are read as front layers whose boxes went back from the picture
  plane: the picture plane becomes the front of a volume as deep as the
  deepest box (1 for flat art, so it stays at the default extrusion), and
  each box is turned around (`offset = depth - old offset - box depth`), so
  the model looks the same. When the schema changes, bump it
  and keep reading
  every older version by migrating its JSON to the current shape before
  reading. A newer version than this build knows is refused with a clear
  message, never half-read.
- `parseProject` validates everything and throws user-readable errors
  naming the field (e.g. "layer 2 opacity must be between 0 and 1").
  Inflation is capped at the layer's size so a small file can't expand
  without limit. Pixel indices past the palette load as transparent, which
  is how they render, so they can't appear when the palette grows.
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
  `pixgrind.activeLayer.pixels` instead of guessing coordinates. Switch
  sides with `pixgrind.setFacing('top')` or the keys 1–6.
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
  `pixgrind.renderer.resize(w, h); pixgrind.renderer.render(pixgrind.doc, pixgrind.facing, pixgrind.viewport)`.
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
  - Test GLB export the same way (stub `HTMLAnchorElement.prototype.click`,
    click Export GLB, fetch the blob URL), or call `renderModelExport`.
    Core and `io/` modules run in plain Node 24 (type stripping), e.g. a
    scratch script that builds a document and writes a `.glb` to inspect.
  - Blender (through its MCP tools, when the user has it open) checks GLBs
    for real: import with `bpy.ops.import_scene.gltf` (default settings,
    as users would), then count non-manifold edges and vertices with
    `bmesh` and compare each material's signed volume with the colors'
    volumes. Import into a collection of its own, away from the user's
    objects. The startup splash hides the viewport from screenshots; render
    with `bpy.ops.render.opengl(view_context=True)` and save the Render
    Result instead. Small random documents rarely hit the awkward cases:
    also try a dense one (many sparse layers on every side with
    diagonals), which is how the pinch fixes in watertight meshing were
    found.
  - The side and 3D panes only create their renderers once their
    ResizeObserver fires, which doesn't happen while the page is hidden. To
    check their pixels then, construct `SideRenderer`/`ModelRenderer` on a
    detached canvas (`await import(...)`) and read it back
    (`getImageData`, `gl.readPixels` right after `render`).
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
