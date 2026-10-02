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

Pre-scaffold: the repo contains only this file. The first coding task is to
scaffold the Vite project (see Commands). Treat the structure and design below
as the plan to follow, not a description of existing code.

## Environment

- Windows, PowerShell 7. Use PowerShell syntax in commands (no bash-isms).
- Node 24, npm 11. Use **npm** (no yarn/pnpm) so there is one lockfile.

## Commands

```powershell
# One-time scaffold. The directory is not empty (.git, AGENTS.md): when prompted,
# choose "Ignore files and continue" — NEVER "Remove existing files".
npm create vite@latest . -- --template vanilla-ts
npm install
npm install -D vitest

npm run dev          # dev server
npm run build        # tsc type-check + production build
npm run preview      # serve the production build
npm test             # vitest (add "test": "vitest run" to package.json)
npx tsc --noEmit     # type-check only
```

Before calling a task done: `npm run build` and `npm test` pass. For UI changes,
also run the dev server and check the behavior in a browser.

## Stack

- Vanilla TypeScript, no UI framework. Revisit only if UI complexity demands it;
  record the decision here if so.
- Rendering: Canvas 2D API.
- Tests: Vitest.
- TypeScript `strict: true`. No `any`; use `unknown` and narrow.
- No runtime dependencies without a clear reason. Prefer small, focused ones.

## Planned layout

```
src/
  main.ts        entry point; builds the app and wires UI to state
  core/          pure logic, no DOM: document, layers, palette, tools, history
  render/        canvas rendering, viewport (zoom/pan), coordinate mapping
  io/            import/export: images, palette files, project files
  ui/            DOM panels, toolbars, keyboard/pointer input
  styles/
```

- `core/` must not import from `render/`, `ui/`, or touch `document`/`window`,
  so it can be unit-tested in Node. Put tests next to the code as `*.test.ts`.
- Dependency direction: `ui` → `render` / `io` → `core`.

## Core design decisions

### Indexed color

Layer pixels store **palette indices**, not RGBA:

- Each layer is a `Uint8Array` of length `width * height`, row-major
  (`i = y * width + x`).
- Index `0` is reserved for **transparent**. Usable palette colors are 1–255.
- The palette maps index → RGBA color.

This is what makes palette swapping cheap and lossless: switching palettes
changes the colors without touching pixel data. Don't introduce per-layer RGBA
storage without updating this section and the palette-swap design.

### Palettes

- A palette is an ordered list of colors plus a name. In memory keep a
  `Uint32Array` of packed RGBA for rendering; serialize colors as hex strings
  (`#rrggbb` / `#rrggbbaa`).
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

- Composite bottom to top with per-layer visibility and opacity.
- Draw operations target the active layer only.
- The reference image is **not** a layer: it is drawn under (or optionally
  over) the composite, has its own opacity/position/scale, and is excluded from
  export and from pixel data.

### Rendering

- Composite layers into an `ImageData` at native resolution, then draw it
  scaled by the zoom factor.
- Pixel art must stay crisp: `ctx.imageSmoothingEnabled = false` for artwork
  and CSS `image-rendering: pixelated` on canvases. (Smoothing may be enabled
  for the reference image only.)
- Keep screen ↔ pixel coordinate conversion in a single function in `render/`.
  Pixel coordinates are always integers (`Math.floor`).
- Redraw on demand via `requestAnimationFrame` with a dirty flag, not every frame.

### Tools and input

- Use Pointer Events (mouse, pen, touch).
- Pointer events skip pixels on fast strokes: interpolate between the previous
  and current point with Bresenham's line algorithm.
- Planned tools: pencil, eraser (writes index 0), line, rectangle, fill
  (iterative flood fill, not recursive), eyedropper, select/move.

### Undo/redo

- Every pixel-changing action is undoable. One stroke = one history entry.
- Store diffs (changed indices + before/after values) or per-layer snapshots
  for large ops; don't snapshot the whole document per pointer move.

### Import/export

- Image import: decode with `createImageBitmap` → `ImageData`. Importing as
  artwork requires quantizing to the palette: either map to the nearest palette
  colors or build a palette from the image's unique colors (error clearly if
  more than 255).
- Image export: flatten visible layers, optional integer upscale (1×, 2×, 4×…,
  nearest-neighbor), then `canvas.toBlob`.
  - PNG: default; lossless, keeps transparency.
  - JPG: no alpha, so flatten onto a user-chosen background color; it is lossy
    and adds artifacts, so export at max quality and say so in the UI.
  - WebP: export losslessly when supported.
- Project format: `.pixgrind` JSON with a `version` field, dimensions, palette,
  and layers (pixel data base64-encoded). Optionally embed the reference image.
  Bump `version` and add a migration when the schema changes.

## Conventions

- Named exports only; no default exports.
- Small modules with one responsibility. Files `camelCase.ts`; types and classes
  `PascalCase`.
- Keep `core/` functions pure where practical (input → output, no hidden state)
  so they are easy to test.
- Unit-test core logic: palette parsing/serialization, palette swap, flood fill,
  line rasterization, layer compositing, history, project file round-trips.
- Don't commit build output (`dist/`) or `node_modules/`.
