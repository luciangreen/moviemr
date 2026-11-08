// The 3D maths of a Movie MR scene, in metres and degrees. The floor is y = 0, x runs right
// and z runs toward the front of the room (the back wall is at z = -depth/2). A camera with
// yaw 0 and pitch 0 looks toward the back wall (-z); yaw turns it left (+) and right (-),
// pitch tilts it up (+) and down (-).

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// Vertical field of view of a lens on a full-frame (36 x 24 mm) sensor.
export const fovFromLens = (mm) => 2 * Math.atan(12 / mm);

// Rotate a point by rx (about x), then ry (about y), then rz (about z)... applied as
// R = Ry * Rx * Rz so a board turns (ry) after it is tilted (rx) and spun (rz).
export function rotate([x, y, z], { rx = 0, ry = 0, rz = 0 } = {}) {
  let a = rad(rz), c = Math.cos(a), s = Math.sin(a);
  [x, y] = [x * c - y * s, x * s + y * c];
  a = rad(rx); c = Math.cos(a); s = Math.sin(a);
  [y, z] = [y * c - z * s, y * s + z * c];
  a = rad(ry); c = Math.cos(a); s = Math.sin(a);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}

// A board's four corners in the room: top-left, top-right, bottom-right, bottom-left, as seen
// from the front (a board with ry 0 faces +z, toward the camera's usual place).
export function corners(b) {
  const hw = b.w / 2, hh = b.h / 2;
  return [[-hw, hh, 0], [hw, hh, 0], [hw, -hh, 0], [-hw, -hh, 0]].map((p) => {
    const q = rotate(p, b);
    return [r6(q[0] + b.x), r6(q[1] + b.y), r6(q[2] + b.z)];
  });
}

// A room point in the camera's frame: x right, y up, and depth in front of the camera.
export function toCamera([x, y, z], cam) {
  let px = x - cam.x, py = y - cam.y, pz = z - cam.z;
  // undo yaw (about y), then pitch (about x)
  let a = rad(-cam.yaw), c = Math.cos(a), s = Math.sin(a);
  [px, pz] = [px * c + pz * s, -px * s + pz * c];
  a = rad(-cam.pitch); c = Math.cos(a); s = Math.sin(a);
  [py, pz] = [py * c - pz * s, py * s + pz * c];
  return [px + 0, py + 0, -pz + 0]; // depth: forward is -z (and no -0)
}

// Where a room point lands in the picture (pixels from the top left), or null if it is behind
// the camera (closer than `near`).
export function project(p, cam, W, H, near = 0.05) {
  const [x, y, d] = toCamera(p, cam);
  if (d < near) return null;
  const f = (H / 2) / Math.tan(fovFromLens(cam.lens ?? 35) / 2);
  return [W / 2 + (f * x) / d, H / 2 - (f * y) / d, d];
}

// Smooth paths: Catmull-Rom through the points for position; angles and lens change in a
// straight line, the short way round.
const catmull = (p0, p1, p2, p3, u) => 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
const lerp = (a, b, u) => a + (b - a) * u;
const lerpAngle = (a, b, u) => { let d = ((b - a + 540) % 360) - 180; return a + d * u; };
export function along(points, t, { smooth = ['x', 'y', 'z'], angles = ['yaw', 'pitch', 'ry'], linear = ['lens'] } = {}) {
  if (!points.length) return null;
  const ps = [...points].sort((a, b) => a.t - b.t);
  if (t <= ps[0].t) return { ...ps[0] };
  if (t >= ps.at(-1).t) return { ...ps.at(-1) };
  let i = ps.findIndex((p) => p.t > t) - 1;
  const a = ps[i], b = ps[i + 1], u = (t - a.t) / (b.t - a.t);
  const before = ps[i - 1] ?? a, after = ps[i + 2] ?? b;
  const out = { ...a, t };
  for (const k of smooth) if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = catmull(before[k] ?? a[k], a[k], b[k], after[k] ?? b[k], u);
  for (const k of angles) if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = lerpAngle(a[k], b[k], u);
  for (const k of linear) if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = lerp(a[k], b[k], u);
  return out;
}

// What the camera does between two points, in film words: tracking (moves), pan (turns),
// tilt, zoom (lens), or holds.
export function moveLabel(a, b, { still = 0.05, turn = 2 } = {}) {
  const moved = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const parts = [];
  if (moved > still) {
    const fwd = toCamera([b.x, b.y, b.z], a);
    const side = Math.abs(fwd[0]), deep = Math.abs(fwd[2]), up = Math.abs(fwd[1]);
    parts.push(deep >= side && deep >= up ? (fwd[2] > 0 ? 'tracking in' : 'tracking out') : up > side ? (fwd[1] > 0 ? 'crane up' : 'crane down') : (fwd[0] > 0 ? 'tracking right' : 'tracking left'));
  }
  const yaw = ((b.yaw - a.yaw + 540) % 360) - 180, pitch = b.pitch - a.pitch;
  if (Math.abs(yaw) > turn) parts.push(yaw > 0 ? 'pan left' : 'pan right');
  if (Math.abs(pitch) > turn) parts.push(pitch > 0 ? 'tilt up' : 'tilt down');
  if ((a.lens ?? 35) !== (b.lens ?? 35)) parts.push(b.lens > a.lens ? 'zoom in' : 'zoom out');
  return parts.length ? parts.join(', ') : 'hold';
}
