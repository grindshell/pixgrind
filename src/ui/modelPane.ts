import { buildMesh, type ModelMesh } from '../core/model.ts';
import { dolly, fitCamera, orbit, pan, type OrbitCamera, type Vec3 } from '../render/camera.ts';
import { ModelRenderer } from '../render/modelRenderer.ts';
import { el, textButton } from './dom.ts';
import type { Editor } from './editor.ts';
import { addToBar, createPaneFrame } from './paneFrame.ts';
import { adaptiveThrottle } from './throttle.ts';

const BUTTON_PRIMARY = 0;
/** Radians of turn per CSS pixel dragged. */
const ORBIT_SPEED = 0.01;
/** Distance factor per wheel step. */
const DOLLY_STEP = 1.15;

/**
 * The 3D view: the model of the visible layers, rebuilt as the document
 * changes. Drag to orbit, right- or middle-drag (or Shift+drag) to pan,
 * wheel to zoom, double-click or "Reset view" to frame the model again.
 */
export function createModelPane(editor: Editor): HTMLElement {
  const { doc } = editor;
  let renderer: ModelRenderer | null = null;
  let camera: OrbitCamera | null = null;
  let mesh: ModelMesh | null = null;
  let meshVersion = -1;
  /** Document size the camera was framed for; a new size frames it again. */
  let framedSize = '';
  let drawQueued = false;
  let drag: { pointerId: number; mode: 'orbit' | 'pan'; lastX: number; lastY: number } | null = null;

  const message = el('p', 'pane-message');
  message.hidden = true;
  let sized = false;
  const frame = createPaneFrame(editor, 'model', '3D', '3D view', (width, height) => {
    if (!ensureRenderer()) return;
    renderer!.resize(width, height);
    // A model framed before the pane had a size was framed for the wrong shape.
    if (!sized && camera) frameModel();
    sized = true;
    requestDraw();
  });
  const { canvas } = frame;
  canvas.classList.add('model-canvas');
  frame.element.append(message);

  const faces = el('span', 'pane-readout pane-hint');
  const reset = textButton('Reset view', () => frameModel());
  reset.classList.add('pane-button');
  reset.title = 'Frame the whole model again (or double-click it)';
  addToBar(frame, faces, reset);

  /** Creates the renderer on first use; false (with a message shown) when WebGL isn't available. */
  const ensureRenderer = (): boolean => {
    if (renderer) return true;
    try {
      renderer = new ModelRenderer(canvas);
      return true;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
      return false;
    }
  };

  const frameModel = () => {
    if (!renderer) return;
    const bounds = mesh?.bounds ?? { min: [-doc.width / 2, 0, -1] as Vec3, max: [doc.width / 2, doc.height, 0] as Vec3 };
    const { width, height } = renderer.viewSize;
    camera = fitCamera(bounds.min, bounds.max, width / height);
    framedSize = `${doc.width}x${doc.height}`;
    requestDraw();
  };

  const rebuild = adaptiveThrottle(() => {
    if (!renderer || !editor.panes.model) return;
    meshVersion = editor.contentVersion;
    const model = editor.voxelModel;
    mesh = buildMesh(model, doc.palette);
    renderer.setMesh(mesh);
    renderer.setGuides(doc.width, doc.height, model.depth);
    faces.textContent = `${mesh.quads.toLocaleString()} ${mesh.quads === 1 ? 'face' : 'faces'}`;
    if (!camera || framedSize !== `${doc.width}x${doc.height}`) frameModel();
    requestDraw();
  });

  const requestDraw = () => {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      if (renderer && camera && editor.panes.model) renderer.render(camera);
    });
  };

  editor.onRender((contentChanged) => {
    if (!editor.panes.model || !ensureRenderer()) return;
    if (contentChanged || meshVersion !== editor.contentVersion) rebuild();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (drag || !camera) return;
    const panning = e.button !== BUTTON_PRIMARY || e.shiftKey;
    drag = { pointerId: e.pointerId, mode: panning ? 'pan' : 'orbit', lastX: e.clientX, lastY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag?.pointerId !== e.pointerId || !camera || !renderer) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    camera =
      drag.mode === 'orbit'
        ? orbit(camera, -dx * ORBIT_SPEED, dy * ORBIT_SPEED)
        : pan(camera, dx, dy, renderer.viewSize.height);
    requestDraw();
  });
  const endDrag = (e: PointerEvent) => {
    if (drag?.pointerId === e.pointerId) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('dblclick', () => frameModel());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!camera || e.deltaY === 0) return;
      camera = dolly(camera, e.deltaY < 0 ? 1 / DOLLY_STEP : DOLLY_STEP);
      requestDraw();
    },
    { passive: false },
  );

  return frame.element;
}
