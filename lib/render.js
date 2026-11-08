// Drawing a frame of the scene on a 2D canvas: the room's walls and the boards, far to near,
// each textured with its video, photo or colour in perspective. The textures come from a
// `media(path)` function that returns a loaded <video> or <img> (or nothing yet).
import { project } from './math3d.js';
import { boardAt, cameraAt } from './scene.js';
import { corners } from './math3d.js';

// The room's walls as quads (top-left, top-right, bottom-right, bottom-left from inside).
export function wallQuads(room) {
  const w = room.w / 2, d = room.d / 2, h = room.h;
  return {
    back: [[-w, h, -d], [w, h, -d], [w, 0, -d], [-w, 0, -d]],
    left: [[-w, h, d], [-w, h, -d], [-w, 0, -d], [-w, 0, d]],
    right: [[w, h, -d], [w, h, d], [w, 0, d], [w, 0, -d]],
    floor: [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d]],
    ceiling: [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]]
  };
}

// Split a quad into an n x n grid of small quads in 3D, so each can be drawn as two flat
// (affine) triangles: close enough to true perspective, and it works on every canvas.
function grid(q, n) {
  const at = (u, v) => { const top = q[0].map((a, i) => a + (q[1][i] - a) * u), bot = q[3].map((a, i) => a + (q[2][i] - a) * u); return top.map((a, i) => a + (bot[i] - a) * v); };
  const cells = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push({ u0: i / n, v0: j / n, u1: (i + 1) / n, v1: (j + 1) / n, p: [at(i / n, j / n), at((i + 1) / n, j / n), at((i + 1) / n, (j + 1) / n), at(i / n, (j + 1) / n)] });
  return cells;
}

// Draw the image (or colour) on the triangle a b c whose texture corners are ta tb tc.
function tri(g, img, a, b, c, ta, tb, tc, colour) {
  g.save();
  // the clip is grown by about a pixel from the middle, so neighbouring triangles overlap
  // and leave no seam between them
  const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3;
  const grow = (p) => { const dx = p[0] - mx, dy = p[1] - my, d = Math.hypot(dx, dy) || 1; return [p[0] + (dx / d) * 0.9, p[1] + (dy / d) * 0.9]; };
  const [A, B, C] = [grow(a), grow(b), grow(c)];
  g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.closePath();
  g.clip();
  if (!img) { g.fillStyle = colour; g.fill(); g.restore(); return; }
  const [u0, v0] = ta, [u1, v1] = tb, [u2, v2] = tc;
  const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (!den) { g.restore(); return; }
  const m11 = ((b[0] - a[0]) * (v2 - v0) - (c[0] - a[0]) * (v1 - v0)) / den;
  const m12 = ((b[1] - a[1]) * (v2 - v0) - (c[1] - a[1]) * (v1 - v0)) / den;
  const m21 = ((c[0] - a[0]) * (u1 - u0) - (b[0] - a[0]) * (u2 - u0)) / den;
  const m22 = ((c[1] - a[1]) * (u1 - u0) - (b[1] - a[1]) * (u2 - u0)) / den;
  g.transform(m11, m12, m21, m22, a[0] - m11 * u0 - m21 * v0, a[1] - m12 * u0 - m22 * v0);
  g.drawImage(img, 0, 0);
  g.restore();
}

// Draw one quad (four 3D corners) textured with img (or a colour), with opacity and light.
export function drawQuad(g, q, cam, W, H, { img = null, colour = '#888', opacity = 100, light = 100, n = 6, label = '' } = {}) {
  const iw = img ? (img.videoWidth || img.naturalWidth || img.width) : 1, ih = img ? (img.videoHeight || img.naturalHeight || img.height) : 1;
  const usable = img && iw > 0 && ih > 0;
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, opacity / 100));
  let drew = false;
  for (const c of grid(q, n)) {
    const s = c.p.map((p) => project(p, cam, W, H));
    if (s.some((x) => !x)) continue; // a cell crossing behind the camera is skipped
    drew = true;
    const t = [[c.u0 * iw, c.v0 * ih], [c.u1 * iw, c.v0 * ih], [c.u1 * iw, c.v1 * ih], [c.u0 * iw, c.v1 * ih]];
    tri(g, usable ? img : null, s[0], s[1], s[2], t[0], t[1], t[2], colour);
    tri(g, usable ? img : null, s[0], s[2], s[3], t[0], t[2], t[3], colour);
  }
  if (drew && light !== 100) {
    // light below 100% darkens, above brightens
    const s = q.map((p) => project(p, cam, W, H));
    if (s.every(Boolean)) {
      g.globalAlpha = Math.min(1, Math.abs(light - 100) / 100) * (opacity / 100);
      g.fillStyle = light < 100 ? '#000' : '#fff';
      g.beginPath(); s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
    }
  }
  if (drew && label && !usable) {
    const s = q.map((p) => project(p, cam, W, H));
    if (s.every(Boolean)) {
      const cx = s.reduce((m, p) => m + p[0], 0) / 4, cy = s.reduce((m, p) => m + p[1], 0) / 4;
      const size = Math.max(10, Math.min(40, Math.abs(s[1][0] - s[0][0]) / 8));
      g.globalAlpha = 1; g.fillStyle = '#fff'; g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, cx, cy);
    }
  }
  g.restore();
  return drew;
}

// The order to draw boards: farthest from the camera first.
export function depthOrder(s, t) {
  const cam = cameraAt(s, t);
  return s.boards.map((b) => boardAt(b, t)).map((b) => {
    const c = corners(b);
    const mid = c.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4, m[2] + p[2] / 4], [0, 0, 0]);
    return { b, d: Math.hypot(mid[0] - cam.x, mid[1] - cam.y, mid[2] - cam.z) };
  }).sort((p, q) => q.d - p.d).map((x) => x.b);
}

export function drawFrame(g, s, t, media = () => null) {
  const W = g.canvas.width, H = g.canvas.height;
  const cam = cameraAt(s, t);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const quads = wallQuads(s.room);
  for (const side of ['floor', 'ceiling', 'back', 'left', 'right']) {
    const w = s.walls[side];
    drawQuad(g, quads[side], cam, W, H, { img: w.media ? media(w.media.path, t) : null, colour: w.colour, opacity: w.opacity, light: w.light, n: 8 });
  }
  for (const b of depthOrder(s, t)) drawQuad(g, corners(b), cam, W, H, { img: b.media ? media(b.media.path, t - (b.start ?? 0)) : null, colour: b.colour, opacity: b.opacity, n: 6, label: b.name });
}
