/*
 * An orbit camera for the 3D view, and the 4×4 matrices WebGL needs
 * (column-major, as `uniformMatrix4fv` takes them). Pure, so it's tested.
 */

export type Vec3 = [number, number, number];

export interface OrbitCamera {
  /** Point the camera looks at and orbits around. */
  target: Vec3;
  /** Angle around the vertical axis, radians; 0 looks at the front (from +z), positive moves right. */
  yaw: number;
  /** Angle above the horizon, radians. */
  pitch: number;
  distance: number;
}

/** Vertical field of view, radians. */
export const FIELD_OF_VIEW = (35 * Math.PI) / 180;
const MAX_PITCH = (89 * Math.PI) / 180;
const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 20_000;

export function cameraEye({ target, yaw, pitch, distance }: OrbitCamera): Vec3 {
  return [
    target[0] + distance * Math.sin(yaw) * Math.cos(pitch),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * Math.cos(yaw) * Math.cos(pitch),
  ];
}

/**
 * A camera framing a box, looking a little from the right and above so
 * depth shows.
 */
export function fitCamera(min: Vec3, max: Vec3, aspect = 1): OrbitCamera {
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  // Fit the bounding sphere in the narrower of the two fields of view.
  const halfFov = Math.min(FIELD_OF_VIEW / 2, Math.atan(Math.tan(FIELD_OF_VIEW / 2) * aspect));
  return { target, yaw: (30 * Math.PI) / 180, pitch: (20 * Math.PI) / 180, distance: (radius / Math.sin(halfFov)) * 1.05 };
}

/** Turns the camera around its target. */
export function orbit(camera: OrbitCamera, dYaw: number, dPitch: number): OrbitCamera {
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.pitch + dPitch));
  return { ...camera, yaw: camera.yaw + dYaw, pitch };
}

/** Moves the camera toward (factor < 1) or away from its target. */
export function dolly(camera: OrbitCamera, factor: number): OrbitCamera {
  return { ...camera, distance: Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, camera.distance * factor)) };
}

/**
 * Slides camera and target sideways and up by a drag of (dx, dy) CSS pixels
 * in a view `viewHeight` pixels tall, so the target plane follows the pointer.
 */
export function pan(camera: OrbitCamera, dx: number, dy: number, viewHeight: number): OrbitCamera {
  const { right, up } = cameraAxes(camera);
  const unitsPerPixel = (2 * camera.distance * Math.tan(FIELD_OF_VIEW / 2)) / Math.max(1, viewHeight);
  const target = camera.target.map(
    (value, axis) => value + (-dx * right[axis] + dy * up[axis]) * unitsPerPixel,
  ) as Vec3;
  return { ...camera, target };
}

/** The camera's right and up directions in world space. */
export function cameraAxes(camera: OrbitCamera): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(subtract(camera.target, cameraEye(camera)));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { right, up: cross(right, forward), forward };
}

/** World → camera space. */
export function viewMatrix(camera: OrbitCamera): Float32Array {
  const eye = cameraEye(camera);
  const { right: s, up: u, forward: f } = cameraAxes(camera);
  return Float32Array.of(
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  );
}

/** Camera → clip space, for depths from `near` to `far`. */
export function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return Float32Array.of(
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  );
}

/** a × b for column-major 4×4 matrices: applies b, then a. */
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Transforms a point (w = 1) and divides by w. */
export function transformPoint(m: Float32Array, [x, y, z]: Vec3): Vec3 {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
