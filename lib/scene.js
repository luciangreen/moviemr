// A Movie MR scene: 2D boards (video, photos or a colour) placed in a 3D room, the room's walls,
// and a camera path with timed points. Each board and the camera can carry notes ("character
// name y, but cute"), which go beside the MP4 for whoever builds the scene in 3D software.
import { along, corners, moveLabel } from './math3d.js';

export const WALLS = ['back', 'left', 'right', 'floor', 'ceiling'];
let seq = 0;
export const newId = (p = 'b') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newScene() {
  return {
    width: 1280, height: 720, fps: 30, duration: 8,
    room: { w: 8, h: 3.5, d: 8 },
    walls: Object.fromEntries(WALLS.map((k) => [k, { colour: { back: '#d9d4c7', left: '#cfc9bb', right: '#cfc9bb', floor: '#8a7f6e', ceiling: '#eeeae2' }[k], media: null, opacity: 100, light: 100 }])),
    boards: [],
    camera: { lens: 35, lighting: '', note: '', points: [{ t: 0, x: 0, y: 1.6, z: 3.5, yaw: 0, pitch: -3, lens: 35, label: '' }] }
  };
}

export function newBoard(fields = {}) {
  return { id: newId('b'), name: 'Board', x: 0, y: 1, z: 0, rx: 0, ry: 0, rz: 0, w: 1.6, h: 0.9, media: null, colour: '#6a8fc7', opacity: 100, note: '', start: 0, keys: [], ...fields };
}

// ---------------------------------------------------------------- where things are at a time
export const cameraAt = (s, t) => ({ lens: s.camera.lens, ...along(s.camera.points, t) });
// A board moves along its recorded keys (if any); otherwise it stays where it is.
export function boardAt(b, t) {
  if (!b.keys?.length) return b;
  const k = along(b.keys, t, { angles: ['ry', 'rx', 'rz'] });
  return { ...b, x: k.x ?? b.x, y: k.y ?? b.y, z: k.z ?? b.z, ry: k.ry ?? b.ry };
}

// The camera's moves, with film labels, for the notes and the editor.
export function cameraMoves(s) {
  const ps = [...s.camera.points].sort((a, b) => a.t - b.t);
  return ps.slice(1).map((p, i) => ({ from: ps[i].t, to: p.t, label: p.label || moveLabel(ps[i], p) }));
}

// ---------------------------------------------------------------- changes (pure)
const copy = (x) => JSON.parse(JSON.stringify(x));
export function update(s, f) { const q = copy(s); f(q); return q; }
const board = (q, id) => q.boards.find((b) => b.id === id);
export const addBoard = (s, fields) => { const b = newBoard(fields); return { s: update(s, (q) => q.boards.push(b)), id: b.id }; };
export const setBoard = (s, id, fields) => update(s, (q) => Object.assign(board(q, id) ?? {}, copy(fields)));
export const removeBoard = (s, id) => update(s, (q) => { q.boards = q.boards.filter((b) => b.id !== id); });
export const setWall = (s, side, fields) => update(s, (q) => Object.assign(q.walls[side], copy(fields)));
export const addCameraPoint = (s, point) => update(s, (q) => {
  q.camera.points = q.camera.points.filter((p) => Math.abs(p.t - point.t) > 1e-6);
  q.camera.points.push({ ...cameraAt(s, point.t), label: '', ...point });
  q.camera.points.sort((a, b) => a.t - b.t);
  q.duration = Math.max(q.duration, point.t);
});
export const removeCameraPoint = (s, t) => update(s, (q) => { if (q.camera.points.length > 1) q.camera.points = q.camera.points.filter((p) => Math.abs(p.t - t) > 1e-6); });
// Record a board's movement: a key at time t (replacing one within a frame of it).
export const keyBoard = (s, id, t, fields) => update(s, (q) => {
  const b = board(q, id); if (!b) return;
  const at = { t, x: b.x, y: b.y, z: b.z, ry: b.ry, ...fields };
  b.keys = (b.keys ?? []).filter((k) => Math.abs(k.t - t) > 1 / (q.fps * 2));
  b.keys.push(at); b.keys.sort((a, c) => a.t - c.t);
  Object.assign(b, { x: at.x, y: at.y, z: at.z, ry: at.ry });
});

// ---------------------------------------------------------------- Present: neaten the scene
// Proposes changes (shown to you first; applied as one undoable step):
//   - positions snap to 10 cm and turns to 15 degrees;
//   - a board close to the floor stands on it;
//   - boards nearly in a row (fronts within 40 cm) line up, evenly spaced and facing the same way;
//   - boards stay inside the room.
// Boards with recorded movement keep their paths.
const snapTo = (v, step) => Math.round(v / step) * step + 0;
const r2 = (n) => Math.round(n * 100) / 100;
export function presentChanges(s) {
  const out = s.boards.map((b) => ({ ...b }));
  const changes = [];
  const note = (b, what) => changes.push({ id: b.id, name: b.name, what });
  const moving = (b) => b.keys?.length;
  for (const b of out) {
    if (moving(b)) continue;
    const before = { x: b.x, y: b.y, z: b.z, ry: b.ry, rx: b.rx, rz: b.rz };
    const standing = Math.abs(b.y - b.h / 2) < 1e-6;
    b.x = r2(snapTo(b.x, 0.1)); if (!standing) b.y = r2(snapTo(b.y, 0.1)); b.z = r2(snapTo(b.z, 0.1));
    b.ry = (snapTo(b.ry, 15) % 360) + 0; b.rx = snapTo(b.rx, 15) + 0; b.rz = snapTo(b.rz, 15) + 0;
    if (!b.rx && !b.rz && b.y - b.h / 2 < 0.2 && Math.abs(b.y - b.h / 2) > 1e-6) { b.y = r2(b.h / 2); note(b, 'stands on the floor'); }
    const half = { x: s.room.w / 2 - b.w / 2, z: s.room.d / 2 - 0.05 };
    if (Math.abs(b.x) > half.x) { b.x = r2(Math.sign(b.x) * Math.max(0, half.x)); note(b, 'moved inside the room'); }
    if (Math.abs(b.z) > half.z) { b.z = r2(Math.sign(b.z) * half.z); note(b, 'moved inside the room'); }
    if (b.y + b.h / 2 > s.room.h) { b.y = r2(s.room.h - b.h / 2); note(b, 'lowered below the ceiling'); }
    if (['x', 'y', 'z', 'ry', 'rx', 'rz'].some((k) => Math.abs(before[k] - b[k]) > 1e-9) && !changes.some((c) => c.id === b.id)) note(b, 'squared up');
  }
  // rows: boards facing the same way (to 15 degrees) with fronts within 40 cm
  const still = out.filter((b) => !moving(b) && !b.rx && !b.rz);
  const used = new Set();
  for (const a of still) {
    if (used.has(a.id)) continue;
    const row = still.filter((b) => !used.has(b.id) && b.ry === a.ry && Math.abs(b.z - a.z) <= 0.4 && (a.ry % 180 === 0));
    if (row.length < 2) continue;
    row.forEach((b) => used.add(b.id));
    const z = r2(snapTo(row.reduce((m, b) => m + b.z, 0) / row.length, 0.1));
    const y = r2(Math.min(...row.map((b) => b.y - b.h / 2)));
    row.sort((p, q) => p.x - q.x);
    const total = row.reduce((m, b) => m + b.w, 0);
    const left = row[0].x - row[0].w / 2, right = row.at(-1).x + row.at(-1).w / 2;
    const gap = Math.max(0.1, (right - left - total) / (row.length - 1));
    let at = left;
    for (const b of row) {
      const nx = r2(snapTo(at + b.w / 2, 0.1)), ny = r2(y + b.h / 2);
      if (nx !== b.x || b.z !== z || ny !== b.y) note(b, `lined up in a row of ${row.length}`);
      b.x = nx; b.z = z; b.y = ny;
      at += b.w + gap;
    }
  }
  const unique = [];
  for (const c of changes) { const u = unique.find((x) => x.id === c.id); if (u) { if (!u.what.includes(c.what)) u.what += `, ${c.what}`; } else unique.push({ ...c }); }
  return { boards: out, changes: unique };
}
export const present = (s) => update(s, (q) => { q.boards = presentChanges(s).boards; });

// ---------------------------------------------------------------- for 3D software
export const frameTimes = (s) => Array.from({ length: Math.max(1, Math.round(s.duration * s.fps)) + 1 }, (_, i) => Math.round((i / s.fps) * 1e6) / 1e6).filter((t) => t <= s.duration + 1e-9);

// One line per frame: the camera, then each board's position and turn (metres, degrees).
export function framesCSV(s) {
  const head = ['frame', 'time', 'cam_x', 'cam_y', 'cam_z', 'cam_yaw', 'cam_pitch', 'cam_lens', ...s.boards.flatMap((b) => ['x', 'y', 'z', 'ry'].map((k) => `${b.name.replace(/[^\w]+/g, '_')}_${k}`))];
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const rows = frameTimes(s).map((t, i) => {
    const c = cameraAt(s, t);
    return [i, f(t), f(c.x), f(c.y), f(c.z), f(c.yaw), f(c.pitch), f(c.lens ?? s.camera.lens), ...s.boards.flatMap((b) => { const p = boardAt(b, t); return [f(p.x), f(p.y), f(p.z), f(p.ry)]; })].join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

// The notes beside the MP4.
export function notesText(s, { title = 'Untitled scene' } = {}) {
  const lines = [`# ${title}`, '', `${s.width} x ${s.height}, ${s.fps} fps, ${s.duration} seconds. Room ${s.room.w} m wide, ${s.room.h} m high, ${s.room.d} m deep (floor at y = 0, back wall at z = -${s.room.d / 2}).`, ''];
  lines.push('## Boards', '');
  for (const b of s.boards) {
    const c = corners(b);
    lines.push(`### ${b.name}`, `${b.w} x ${b.h} m at (${b.x}, ${b.y}, ${b.z}), turned ${b.ry}°${b.rx ? `, tilted ${b.rx}°` : ''}${b.rz ? `, spun ${b.rz}°` : ''}. ${b.media ? `Shows ${b.media.kind === 'video' ? 'video' : 'a picture'}: ${b.media.path}` : `A ${b.colour} board`}${b.opacity !== 100 ? `, ${b.opacity}% opaque` : ''}.`);
    lines.push(`Corners: ${c.map((p) => `(${p.join(', ')})`).join(' ')}.`);
    if (b.keys?.length) lines.push(`Moves: ${b.keys.map((k) => `${k.t}s (${k.x}, ${k.y}, ${k.z}) ${k.ry}°`).join('; ')}.`);
    if (b.note?.trim()) lines.push(`How to interpret it: ${b.note.trim()}`);
    lines.push('');
  }
  lines.push('## Walls', '');
  for (const k of WALLS) { const w = s.walls[k]; lines.push(`- ${k}: ${w.media ? w.media.path : w.colour}, ${w.opacity}% opaque, lighting ${w.light}%`); }
  lines.push('', '## Camera', '', `Lens ${s.camera.lens} mm${s.camera.lighting ? `; lighting: ${s.camera.lighting}` : ''}.`);
  for (const p of [...s.camera.points].sort((a, b) => a.t - b.t)) lines.push(`- ${p.t}s: at (${p.x}, ${p.y}, ${p.z}), yaw ${p.yaw}°, pitch ${p.pitch}°, ${p.lens ?? s.camera.lens} mm${p.label ? ` (${p.label})` : ''}`);
  const moves = cameraMoves(s);
  if (moves.length) lines.push('', 'Moves: ' + moves.map((m) => `${m.from}–${m.to}s ${m.label}`).join('; ') + '.');
  if (s.camera.note?.trim()) lines.push('', `Notes: ${s.camera.note.trim()}`);
  lines.push('', 'Per-frame positions are in the .frames.csv beside this file.');
  return lines.join('\n') + '\n';
}
