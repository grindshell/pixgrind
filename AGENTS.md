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
- Tools in a vertical strip beside the canvas: Pencil (B), Eraser (E), Line
  (L), Rectangle (R), Filled rectangle (Shift+R), Fill (G), Eyedropper (I).
  - The left button uses the primary color and the right button uses
    transparent.
  - Alt+click picks a color whatever the tool.
  - Middle-drag pans and the wheel zooms around the cursor.
- Palette panel showing the default PICO-8 palette; click to select a color.
- Undo/redo: per-stroke pixel diffs, Undo/Redo buttons, Ctrl/Cmd+Z,
  Ctrl+Shift+Z and Ctrl+Y.
- Layers panel: thumbnails, select, show/hide, rename (double-click), add,
  duplicate, delete, move up/down, merge down, opacity slider. All undoable
  except show/hide.

Not built yet, roughly in priority order: select/move tool, palette
management and swap, image import/export, reference images, project files.
Follow-ups:
- Layers panel: drag-and-drop reordering, keyboard shortcuts for layer
  actions.
- Tools: a choosable secondary color (the right button is fixed to
  transparent), brush sizes, shape previews that react to Shift being pressed
  without moving the pointer.

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
                 constraints), floodFill, edits (undoable changes),
                 layerEdits (edit constructors for layer operations), history
  render/        viewport math (zoom/pan/coordinate mapping), CanvasRenderer
  io/            (not created yet) import/export: images, palette files,
                 project files
  ui/            Editor state + mounting, canvas input, tools + tool strip,
                 keyboard shortcuts, history controls, palette panel, layers
                 panel, DOM helpers (dom.ts) and inline SVG icons (icons.ts)
public/          static assets served as-is (favicon.svg)
```

- `core/` must not import from `render/`, `ui/`, or `io/`, and must not touch
  `document`/`window`, so it can be unit-tested in Node. `render/viewport.ts`
  is also pure and tested.
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
  (`createDocument` clones the palette passed in).
- **Palette swap** = replace the active palette with another, mapping index to
  index. If the new palette is shorter, indices with no color need a defined
  fallback (e.g. nearest color in the new palette); never silently corrupt data.
- **Color remap** (change which index pixels use) is a separate operation that
  rewrites pixel data and goes through undo history.
- Saved palettes persist in the browser (IndexedDB or localStorage, behind an
  interface in `io/` so storage can change).
- Palette file formats to support: `.hex` (Lospec), `.gpl` (GIMP), `.pal`
  (JASC-PAL), and PNG swatch images.

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

### Undo/redo

- Every document-changing action must be undoable. One stroke = one history
  entry. **Exception:** layer visibility is not undoable, as in most pixel
  art editors: toggling it to compare shouldn't consume undo steps. It goes
  through `Editor.setLayerVisible`.
- `core/edits.ts` defines `Edit`, a discriminated union of plain-data
  changes, and `applyEdit(doc, edit, 'undo' | 'redo')`. Current kinds:
  - `pixels`
  - `layer-add`, `layer-remove`, `layer-move`, `layer-props` (name, opacity)
  - `batch`, which is all-or-nothing: it rolls back if any part fails.

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
- On Windows the Vite dev server occasionally misses a file change made
  right after another edit to the same file. It then keeps serving the old
  module, and you'll see errors like "does not provide an export named …"
  for code that exists. Check with `fetch('/src/…')`, and restart the dev
  server if the source is stale.

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
