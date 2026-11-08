// Movie MR (Lucian Office, Phase 9): record video onto 2D boards placed in a 3D room, arrange
// them in three views, plan the camera's path, note how each part is meant, and make it all
// into one MP4 in the browser (MediaRecorder, so it works on a Mac and an iPhone).
import { api } from '/shared/api.js';
import { apply, characterHandler, deserialise, redo, serialise, toProlog, undo } from './lib/core.js';
import { corners, deg, project, rad } from './lib/math3d.js';
import { WALLS, addBoard, addCameraPoint, boardAt, cameraAt, cameraMoves, framesCSV, keyBoard, newScene, notesText, present, presentChanges, removeBoard, removeCameraPoint, setBoard, setWall, update } from './lib/scene.js';
import { drawFrame } from './lib/render.js';
import { movieCommands, newMovieDoc, sceneOf, sceneOps, spot } from './lib/commands.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const { dataset, style, ...rest } = props;
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('aria-')) n.setAttribute(k, v); else n[k] = v;
  Object.assign(n.dataset, dataset ?? {});
  if (style) n.style.cssText = style;
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const say = (t) => { $('reply').textContent = t; };

let doc = newMovieDoc(newScene());
let selected = null; // board id
let t = 0;
let playing = null; // { t0, start }
let tab = 'board';
let settings = { savePath: '' };
const S = () => sceneOf(doc);
const persist = () => { api.state.set('moviemr', settings).catch(() => {}); api.state.set('moviemr-doc', doc).catch(() => {}); };
function change(s, label) { doc = apply(doc, sceneOps(s), { by: 'user', label }); persist(); render(); }
// live edits while dragging: shown at once, recorded as one step when the drag ends
let draft = null;
const live = () => draft ?? S();

// ------------------------------------------------------------------ media (videos and photos)
const media = new Map(); // path -> <video> | <img>
const urls = new Map(); // path -> object URL for media just recorded (before the file is read back)
function mediaFor(path, at) {
  let m = media.get(path);
  if (!m) {
    const src = urls.get(path) ?? api.files.rawUrl(path);
    if (/\.(mp4|webm|mov|m4v)$/i.test(path)) { m = el('video', { src, muted: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous' }); m.setAttribute('playsinline', ''); m.addEventListener('loadeddata', () => drawAll()); }
    else { m = new Image(); m.crossOrigin = 'anonymous'; m.onload = () => drawAll(); m.src = src; }
    media.set(path, m);
  }
  if (m.tagName === 'VIDEO' && !playing && m.readyState >= 1) {
    const want = Math.max(0, Math.min(m.duration || 0, at));
    if (Math.abs(m.currentTime - want) > 0.05) m.currentTime = want;
  }
  return m.tagName === 'VIDEO' ? (m.readyState >= 2 ? m : null) : (m.complete && m.naturalWidth ? m : null);
}
const binaryWrite = async (path, blob) => {
  const res = await fetch(`/api/files/write?path=${encodeURIComponent(path)}&force=1&mkdirs=1`, { method: 'PUT', body: blob, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`couldn't save ${path} (${res.status})`);
};
const folder = () => `Movies/Movie MR/${(doc.title || 'Untitled scene').replace(/[^\w -]/g, '').trim() || 'scene'}`;
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const recType = () => VIDEO_TYPES.find((x) => window.MediaRecorder?.isTypeSupported?.(x)) ?? '';
const extOf = (type) => (/mp4/.test(type) ? 'mp4' : 'webm');

// ------------------------------------------------------------------ the camera view
function drawCam() {
  const c = $('cam'), s = live();
  if (c.width !== s.width || c.height !== s.height) { c.width = s.width; c.height = s.height; }
  const g = c.getContext('2d');
  drawFrame(g, s, t, mediaFor);
  // the selected board's outline
  const b = s.boards.find((x) => x.id === selected);
  if (b) {
    const cam = cameraAt(s, t);
    const pts = corners(boardAt(b, t)).map((p) => project(p, cam, c.width, c.height));
    if (pts.every(Boolean)) { g.strokeStyle = '#ffd400'; g.lineWidth = 3; g.setLineDash([10, 6]); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); g.setLineDash([]); }
  }
}

// ------------------------------------------------------------------ the three views
// top: x across, z down the page (front of the room at the bottom); front: x across, y up;
// side: z across (back of the room at the left), y up.
const VIEWS = {
  top: { a: 'x', b: 'z', flipB: false, rot: 'ry' },
  front: { a: 'x', b: 'y', flipB: true, rot: 'rz' },
  side: { a: 'z', b: 'y', flipB: true, rot: 'rx' }
};
function viewFrame(name) {
  const c = $(name), s = live(), v = VIEWS[name];
  const span = { x: s.room.w, y: s.room.h, z: s.room.d };
  const pad = 16;
  const k = Math.min((c.width - 2 * pad) / span[v.a], (c.height - 2 * pad) / span[v.b]);
  const mid = { x: 0, y: s.room.h / 2, z: 0 };
  return {
    k,
    to: (p) => [c.width / 2 + (p[v.a] - mid[v.a]) * k, c.height / 2 + (v.flipB ? -1 : 1) * (p[v.b] - mid[v.b]) * k],
    from: (sx, sy) => ({ [v.a]: (sx - c.width / 2) / k + mid[v.a], [v.b]: (v.flipB ? -1 : 1) * (sy - c.height / 2) / k + mid[v.b] })
  };
}
const asObj = ([x, y, z]) => ({ x, y, z });
function drawView(name) {
  const c = $(name), g = c.getContext('2d'), s = live(), f = viewFrame(name);
  g.clearRect(0, 0, c.width, c.height);
  // the room
  const r = s.room;
  const box = [asObj([-r.w / 2, 0, -r.d / 2]), asObj([r.w / 2, r.h, r.d / 2])].map(f.to);
  g.strokeStyle = '#998e7a'; g.lineWidth = 1.5; g.strokeRect(Math.min(box[0][0], box[1][0]), Math.min(box[0][1], box[1][1]), Math.abs(box[1][0] - box[0][0]), Math.abs(box[1][1] - box[0][1]));
  g.fillStyle = '#998e7a'; g.font = '10px system-ui'; g.fillText(name === 'side' ? 'back ←  → front' : name === 'top' ? 'back wall' : 'floor', 8, name === 'top' ? 26 : c.height - 6);
  // boards
  for (const b0 of s.boards) {
    const b = boardAt(b0, t);
    const cs = corners(b).map(asObj).map(f.to);
    g.fillStyle = b0.id === selected ? '#ffd40099' : `${b0.colour}88`;
    g.strokeStyle = b0.id === selected ? '#b38f00' : '#33445588'; g.lineWidth = b0.id === selected ? 2.5 : 1.5;
    g.beginPath(); cs.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.stroke();
    if (name === 'top') { // which way it faces
      const front = asObj(corners({ ...b, w: 0.001, h: 0.001 })[0].map((v, i) => v + [Math.sin(rad(b.ry)), 0, Math.cos(rad(b.ry))][i] * 0.4));
      const ctr = f.to(b), tip = f.to(front);
      g.beginPath(); g.moveTo(ctr[0], ctr[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    }
    const at = f.to(b); g.fillStyle = '#223'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(b0.name, at[0], at[1] - 6); g.textAlign = 'left';
    if (b0.keys?.length > 1) { g.strokeStyle = '#c33a'; g.setLineDash([3, 3]); g.beginPath(); b0.keys.forEach((kk, i) => { const p = f.to(kk); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke(); g.setLineDash([]); }
  }
  // the camera's path and where it is now
  const pts = s.camera.points;
  g.strokeStyle = '#2a7'; g.lineWidth = 1.5;
  if (pts.length > 1) { g.beginPath(); for (let i = 0; i <= 60; i++) { const p = f.to(cameraAt(s, (s.duration * i) / 60)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.stroke(); }
  for (const p of pts) { const q = f.to(p); g.fillStyle = '#2a7'; g.beginPath(); g.arc(q[0], q[1], 3.5, 0, 7); g.fill(); }
  const cam = cameraAt(s, t), cq = f.to(cam);
  g.fillStyle = '#0a5'; g.beginPath(); g.arc(cq[0], cq[1], 6, 0, 7); g.fill();
  if (name === 'top') { const look = f.to({ x: cam.x - Math.sin(rad(cam.yaw)) * 0.8, z: cam.z - Math.cos(rad(cam.yaw)) * 0.8 }); g.strokeStyle = '#0a5'; g.lineWidth = 2; g.beginPath(); g.moveTo(cq[0], cq[1]); g.lineTo(look[0], look[1]); g.stroke(); }
}
function drawAll() { drawCam(); for (const v of Object.keys(VIEWS)) drawView(v); }

// Dragging in a view: move a board in that view's two directions; with Shift, turn it.
// Dragging the green camera dot sets the camera point at this time.
function viewPointer(name) {
  const c = $(name);
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  let drag = null;
  c.addEventListener('pointerdown', (e) => {
    const [sx, sy] = pos(e), s = S(), f = viewFrame(name), v = VIEWS[name];
    const cq = f.to(cameraAt(s, t));
    if (Math.hypot(sx - cq[0], sy - cq[1]) < 10) { drag = { kind: 'camera', f, v }; c.setPointerCapture(e.pointerId); return; }
    // the nearest board under the pointer (by its centre and size in this view)
    const hit = [...s.boards].reverse().find((b0) => { const b = boardAt(b0, t); const cs = corners(b).map(asObj).map(f.to); const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]); return sx >= Math.min(...xs) - 6 && sx <= Math.max(...xs) + 6 && sy >= Math.min(...ys) - 6 && sy <= Math.max(...ys) + 6; });
    selected = hit?.id ?? null;
    if (hit) { drag = { kind: e.shiftKey ? 'turn' : 'move', id: hit.id, f, v, x0: sx, y0: sy, start: boardAt(hit, t), lastKey: 0 }; c.setPointerCapture(e.pointerId); }
    render();
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [sx, sy] = pos(e), { f, v } = drag;
    const p = f.from(sx, sy);
    const round = (n) => Math.round(n * 100) / 100;
    if (drag.kind === 'camera') {
      const cam = cameraAt(S(), t);
      draft = addCameraPoint(S(), { ...cam, t: Math.round(t * 100) / 100, [v.a]: round(p[v.a]), [v.b]: round(p[v.b]) });
    } else if (drag.kind === 'move') {
      const fields = { [v.a]: round(drag.start[v.a] + (p[v.a] - f.from(drag.x0, drag.y0)[v.a])), [v.b]: round(drag.start[v.b] + (p[v.b] - f.from(drag.x0, drag.y0)[v.b])) };
      draft = $('recMove').checked && playing ? keyBoard(draft ?? S(), drag.id, Math.round(t * 100) / 100, fields) : setBoard(S(), drag.id, fields);
    } else {
      const ctr = f.to(drag.start);
      const a0 = Math.atan2(drag.y0 - ctr[1], drag.x0 - ctr[0]), a1 = Math.atan2(sy - ctr[1], sx - ctr[0]);
      const turn = Math.round(deg(v.flipB ? a0 - a1 : a0 - a1));
      draft = setBoard(S(), drag.id, { [v.rot]: (((drag.start[v.rot] ?? 0) + turn) % 360 + 360) % 360 });
    }
    drawAll();
  });
  c.addEventListener('pointerup', () => {
    if (!drag) return;
    const kind = drag.kind; drag = null;
    if (draft) { const d = draft; draft = null; change(d, kind === 'camera' ? 'moved the camera' : kind === 'turn' ? 'turned a board' : $('recMove').checked && playing ? 'recorded movement' : 'moved a board'); }
  });
}

// The camera view: drag to look around (yaw and pitch), Shift-drag to move; wheel to zoom.
function camPointer() {
  const c = $('cam');
  let drag = null;
  c.addEventListener('pointerdown', (e) => { drag = { x0: e.clientX, y0: e.clientY, cam: cameraAt(S(), t), move: e.shiftKey }; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, cam = drag.cam;
    const r2 = (n) => Math.round(n * 100) / 100;
    const next = drag.move
      ? { x: r2(cam.x + (dx / 200) * Math.cos(rad(cam.yaw))), z: r2(cam.z - (dx / 200) * Math.sin(rad(cam.yaw))), y: r2(Math.max(0.1, cam.y - dy / 200)) }
      : { yaw: Math.round(cam.yaw - dx / 4), pitch: Math.max(-80, Math.min(80, Math.round(cam.pitch - dy / 4))) };
    draft = addCameraPoint(S(), { ...cam, t: Math.round(t * 100) / 100, ...next });
    drawAll();
  });
  c.addEventListener('pointerup', () => { if (!drag) return; drag = null; if (draft) { const d = draft; draft = null; change(d, 'moved the camera'); } });
  c.addEventListener('wheel', (e) => { e.preventDefault(); const cam = cameraAt(S(), t); const lens = Math.max(10, Math.min(200, Math.round((cam.lens ?? 35) * (e.deltaY > 0 ? 0.92 : 1.08)))); change(addCameraPoint(S(), { ...cam, t: Math.round(t * 100) / 100, lens }), 'zoomed'); }, { passive: false });
}

// ------------------------------------------------------------------ playing
function setTime(x) { t = Math.max(0, Math.min(S().duration, x)); $('time').value = t; $('tlabel').textContent = `${t.toFixed(1)} s`; drawAll(); }
function play() {
  if (playing) return stopPlay();
  if (t >= S().duration - 0.01) setTime(0);
  playing = { t0: performance.now(), start: t };
  for (const b of S().boards) if (b.media?.kind === 'video') { const m = media.get(b.media.path); if (m) { m.currentTime = Math.max(0, t - (b.start ?? 0)); m.play().catch(() => {}); } }
  $('play').textContent = '❚❚';
  const step = () => {
    if (!playing) return;
    const now = playing.start + (performance.now() - playing.t0) / 1000;
    if (now >= S().duration) { setTime(S().duration); stopPlay(); return; }
    setTime(now);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stopPlay() { playing = null; for (const m of media.values()) if (m.tagName === 'VIDEO') m.pause(); $('play').textContent = '▶'; drawAll(); }

// ------------------------------------------------------------------ recording video onto a board
let camRec = null;
async function recordOnto(boardId, preview, button) {
  if (camRec) {
    camRec.rec.stop();
    return;
  }
  try {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    // with sound if there is a microphone; video alone if not
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video }));
    preview.srcObject = stream; preview.muted = true; preview.hidden = false; await preview.play().catch(() => {});
    const type = recType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      for (const tr of stream.getTracks()) tr.stop();
      preview.srcObject = null; preview.hidden = true; camRec = null; button.textContent = '● Record video';
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
      const b = S().boards.find((x) => x.id === boardId);
      const path = `${folder()}/${(b?.name ?? 'board').replace(/[^\w-]+/g, '_')}-${Date.now().toString(36)}.${extOf(blob.type)}`;
      urls.set(path, URL.createObjectURL(blob));
      try { await binaryWrite(path, blob); } catch (err) { say(`Recorded, but ${err.message}; it is kept for this session only.`); }
      change(setBoard(S(), boardId, { media: { kind: 'video', path, type: blob.type } }), 'recorded video onto a board');
      say(`Recorded ${(blob.size / 1e6).toFixed(1)} MB of video onto ${b?.name}.`);
    };
    rec.start(250);
    camRec = { rec };
    button.textContent = '■ Stop recording';
    say('Recording… press Stop recording when done.');
  } catch (err) { say(`I couldn't use the camera: ${err.message}`); }
}
async function chooseMedia(apply) {
  const input = el('input', { type: 'file', accept: 'video/*,image/*' });
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    const path = `${folder()}/${f.name.replace(/[^\w.-]+/g, '_')}`;
    urls.set(path, URL.createObjectURL(f));
    try { await binaryWrite(path, f); } catch (err) { say(`${err.message}; it is kept for this session only.`); }
    apply({ kind: f.type.startsWith('video') ? 'video' : 'image', path, type: f.type });
  };
  input.click();
}

// ------------------------------------------------------------------ the inspector
const field = (label, control) => el('label', {}, label, control);
const btn = (text, onclick, props = {}) => el('button', { type: 'button', textContent: text, onclick, ...props });
const num = (value, onCommit, props = {}) => el('input', { type: 'number', step: 'any', value: String(value), inputMode: 'decimal', onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onCommit(n); }, ...props });
const TABS = [['board', 'Board'], ['walls', 'Walls'], ['camera', 'Camera'], ['notes', 'Notes']];
function renderInspector() {
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  $('inspector').replaceChildren(...({ board: boardTab, walls: wallsTab, camera: cameraTab, notes: notesTab }[tab])().filter((x) => x && x.nodeType));
}
function boardTab() {
  const s = S(), b = s.boards.find((x) => x.id === selected);
  if (!b) return [el('p', { className: 'note' }, 'Select a board in one of the views (or add one) to place it, give it video or a photo, and say how it is meant.'), btn('Add board', () => $('addBoard').click())];
  const set = (fields, label) => change(setBoard(S(), b.id, fields), label);
  const preview = el('video', { className: 'rec-preview', hidden: true, playsInline: true });
  const recBtn = btn(camRec ? '■ Stop recording' : '● Record video', () => recordOnto(b.id, preview, recBtn));
  return [
    field('Name', el('input', { type: 'text', value: b.name, onchange: (e) => set({ name: e.target.value.trim() || b.name }, 'renamed a board') })),
    el('div', { className: 'grid3' }, ...['x', 'y', 'z'].map((k) => field(`${k} (m)`, num(b[k], (n) => set({ [k]: n }, 'moved a board'))))),
    el('div', { className: 'grid3' }, field('turn °', num(b.ry, (n) => set({ ry: n }, 'turned a board'))), field('tilt °', num(b.rx, (n) => set({ rx: n }, 'tilted a board'))), field('spin °', num(b.rz, (n) => set({ rz: n }, 'spun a board')))),
    el('div', { className: 'grid3' }, field('width (m)', num(b.w, (n) => set({ w: Math.max(0.05, n) }, 'resized a board'))), field('height (m)', num(b.h, (n) => set({ h: Math.max(0.05, n) }, 'resized a board'))), field('opacity %', num(b.opacity, (n) => set({ opacity: Math.max(0, Math.min(100, n)) }, 'changed opacity')))),
    el('h3', {}, 'On the board'),
    el('p', { className: 'note' }, b.media ? `${b.media.kind === 'video' ? 'Video' : 'Photo'}: ${b.media.path}` : 'A coloured board.'),
    el('div', { className: 'row' }, recBtn, btn('Choose video or photo…', () => chooseMedia((m) => set({ media: m }, 'gave a board media'))), b.media && btn('Remove', () => set({ media: null }, 'removed media')),
      el('label', {}, 'Colour ', el('input', { type: 'color', value: b.colour, onchange: (e) => set({ colour: e.target.value }, 'coloured a board') }))),
    preview,
    b.media?.kind === 'video' && field('Video starts at (s into the scene)', num(b.start ?? 0, (n) => set({ start: Math.max(0, n) }, 'moved the video start'))),
    field('How to interpret it', el('textarea', { value: b.note ?? '', placeholder: 'e.g. character name y, but cute', onchange: (e) => set({ note: e.target.value }, 'wrote a note') })),
    el('p', { className: 'note' }, b.keys?.length ? `Recorded movement: ${b.keys.length} points from ${b.keys[0].t}s to ${b.keys.at(-1).t}s.` : 'To record movement, tick Record movement, press ▶ and drag the board in a view.'),
    el('div', { className: 'row' }, b.keys?.length ? btn('Clear movement', () => set({ keys: [] }, 'cleared movement')) : null, btn('Delete board', () => { change(removeBoard(S(), b.id), 'deleted a board'); selected = null; render(); }))
  ];
}
function wallsTab() {
  const s = S();
  return [el('p', { className: 'note' }, `The room is ${s.room.w} × ${s.room.d} m and ${s.room.h} m high.`),
    el('div', { className: 'grid3' }, ...[['w', 'width'], ['d', 'depth'], ['h', 'height']].map(([k, l]) => field(`${l} (m)`, num(s.room[k], (n) => change(update(S(), (q) => { q.room[k] = Math.max(1, n); }), 'resized the room'))))),
    ...WALLS.map((w) => {
      const wall = s.walls[w];
      return el('div', { className: 'pt' }, el('b', {}, w[0].toUpperCase() + w.slice(1)),
        el('div', { className: 'row' },
          el('input', { type: 'color', value: wall.colour, 'aria-label': `${w} colour`, onchange: (e) => change(setWall(S(), w, { colour: e.target.value }), `coloured the ${w}`) }),
          btn(wall.media ? 'Change photo/video' : 'Photo or video…', () => chooseMedia((m) => change(setWall(S(), w, { media: m }), `gave the ${w} media`))),
          wall.media && btn('Remove', () => change(setWall(S(), w, { media: null }), `removed the ${w} media`))),
        el('div', { className: 'grid3' }, field('opacity %', num(wall.opacity, (n) => change(setWall(S(), w, { opacity: Math.max(0, Math.min(100, n)) }), `changed the ${w} opacity`))), field('lighting %', num(wall.light, (n) => change(setWall(S(), w, { light: Math.max(0, Math.min(200, n)) }), `changed the ${w} lighting`)))));
    })];
}
function cameraTab() {
  const s = S();
  const moves = cameraMoves(s);
  return [
    el('div', { className: 'grid3' }, field('Lens (mm)', num(s.camera.lens, (n) => change(update(S(), (q) => { q.camera.lens = n; for (const p of q.camera.points) p.lens = n; }), 'changed the lens')))),
    field('Lighting', el('input', { type: 'text', value: s.camera.lighting, placeholder: 'e.g. warm key from the left, soft fill', onchange: (e) => change(update(S(), (q) => { q.camera.lighting = e.target.value; }), 'described the lighting') })),
    field('Camera notes', el('textarea', { value: s.camera.note, onchange: (e) => change(update(S(), (q) => { q.camera.note = e.target.value; }), 'wrote camera notes') })),
    el('h3', {}, 'Path'),
    el('p', { className: 'note' }, 'Each point is where the camera is at a time. Drag the green dot in a view, or look around in the camera view, to set one at the current time.'),
    ...s.camera.points.map((p, i) => el('div', { className: 'pt' },
      el('div', { className: 'row', style: 'margin:0' }, el('b', {}, `${p.t} s`), btn('Go', () => setTime(p.t), { className: 'small' }), s.camera.points.length > 1 && btn('✕', () => change(removeCameraPoint(S(), p.t), 'removed a camera point'), { className: 'small' })),
      el('div', { className: 'grid3' }, ...['x', 'y', 'z', 'yaw', 'pitch', 'lens'].map((k) => field(k, num(p[k] ?? s.camera.lens, (n) => change(update(S(), (q) => { q.camera.points[i][k] = n; }), 'edited a camera point'))))),
      field('Label (pan, tracking…)', el('input', { type: 'text', value: p.label ?? '', placeholder: moves[i - 1]?.label ?? 'the start', onchange: (e) => change(update(S(), (q) => { q.camera.points[i].label = e.target.value; }), 'labelled a camera move') })))),
    moves.length ? el('p', { className: 'note' }, `Moves: ${moves.map((m) => `${m.from}–${m.to}s ${m.label}`).join('; ')}.`) : null
  ];
}
function notesTab() {
  return [el('p', { className: 'note' }, 'Written beside the MP4 (with a CSV of every frame\'s camera and board positions), so the scene can be built in 3D software.'), el('pre', { style: 'white-space:pre-wrap;font-size:.8em', textContent: notesText(S(), { title: doc.title }) })];
}

// ------------------------------------------------------------------ making the MP4
async function makeMovie() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { say('This browser cannot record video.'); return; }
  stopPlay();
  const s = S();
  const type = recType();
  const canvas = el('canvas', { width: s.width, height: s.height });
  const g = canvas.getContext('2d');
  const stream = canvas.captureStream(s.fps);
  const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: Math.round(s.width * s.height * s.fps * 0.12) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const bar = el('div'); const prog = el('div', { className: 'progress' }, bar);
  $('reply').replaceChildren('Recording the scene… ', prog);
  // videos play along in real time
  const vids = s.boards.filter((b) => b.media?.kind === 'video').map((b) => ({ b, m: media.get(b.media.path) })).filter((x) => x.m);
  for (const { b, m } of vids) { m.currentTime = Math.max(0, -(b.start ?? 0)); m.pause(); }
  const done = new Promise((r) => { rec.onstop = r; });
  drawFrame(g, s, 0, (p) => mediaFor(p, 0));
  rec.start(500);
  const t0 = performance.now();
  const started = new Set();
  await new Promise((resolve) => {
    const step = () => {
      const now = (performance.now() - t0) / 1000;
      for (const { b, m } of vids) if (!started.has(b.id) && now >= (b.start ?? 0)) { started.add(b.id); m.currentTime = now - (b.start ?? 0); m.play().catch(() => {}); }
      drawFrame(g, s, Math.min(now, s.duration), (p) => { const m = media.get(p); return m && (m.tagName !== 'VIDEO' || m.readyState >= 2) && (m.tagName !== 'IMG' || m.complete) ? m : null; });
      bar.style.width = `${Math.min(100, (now / s.duration) * 100)}%`;
      if (now >= s.duration) resolve(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await done;
  for (const { m } of vids) m.pause();
  const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
  const base = `${folder()}/${(doc.title || 'scene').replace(/[^\w -]/g, '').trim() || 'scene'}`;
  const path = `${base}.${extOf(blob.type)}`;
  const link = el('a', { href: URL.createObjectURL(blob), download: path.split('/').pop(), textContent: `Download ${path.split('/').pop()} (${(blob.size / 1e6).toFixed(1)} MB)` });
  try {
    await binaryWrite(path, blob);
    await api.files.write(`${base}.notes.md`, notesText(s, { title: doc.title }), { mkdirs: true, force: true });
    await api.files.write(`${base}.frames.csv`, framesCSV(s), { mkdirs: true, force: true });
    $('reply').replaceChildren(`Made ${path} (${blob.type.split(';')[0]}), with its notes and per-frame positions beside it. `, link);
  } catch (err) { $('reply').replaceChildren(`Made the video, but ${err.message}. `, link); }
  window.__lastMovie = { size: blob.size, type: blob.type, path };
}

// ------------------------------------------------------------------ the character
const commands = movieCommands();
const ctx = { selected: () => (selected ? [selected] : []), camera: () => { const c = cameraAt(S(), t); return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, lens: c.lens }; }, confirm: async (q) => confirm(q) };
const handle = characterHandler(commands, () => doc, (d) => { doc = d; persist(); render(); }, ctx);
async function sayDo(text) {
  if (/^(play|play it)$/i.test(text.trim())) { play(); say('Playing.'); return; }
  if (/^(make|record|export) (the |an? )?(mp4|movie|video)$/i.test(text.trim())) { await makeMovie(); return; }
  const reply = await handle({ intent: 'unknown', text }, text);
  say(reply ?? `I don't know how to do that in Movie MR. ${commands.help()}`);
}
$('say').addEventListener('submit', async (e) => { e.preventDefault(); await sayDo($('sayText').value); $('sayText').value = ''; });
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'lucianos.command') return;
  const reply = await handle({ intent: 'unknown', text: e.data.text }, e.data.text);
  e.source.postMessage({ type: 'lucianos.reply', id: e.data.id, text: reply }, location.origin);
});
if (parent !== window) parent.postMessage({ type: 'lucianos.commands', names: commands.list().map((c) => c.name) }, location.origin);

// ------------------------------------------------------------------ files
async function save() {
  const path = prompt('Save as (relative to your home folder)', settings.savePath || `${folder()}.moviemr.json`);
  if (!path) return;
  await api.files.write(path, serialise(doc), { mkdirs: true, force: true });
  settings.savePath = path; persist(); say(`Saved ${path}.`);
}
async function open() {
  const path = prompt('Open which .moviemr.json file?', settings.savePath || '');
  if (!path) return;
  try { const d = deserialise((await api.files.read(path)).content); if (d.app !== 'moviemr') throw new Error('that is not a Movie MR file'); doc = d; settings.savePath = path; selected = null; persist(); render(); } catch (err) { say(`Couldn't open it: ${err.message}`); }
}

// ------------------------------------------------------------------ start
function render() {
  const s = S();
  $('title').value = doc.title;
  $('time').max = s.duration; $('duration').value = s.duration; $('size').value = `${s.width}x${s.height}`; $('fps').value = String(s.fps);
  setTime(t);
  renderInspector();
}
async function init() {
  settings = { ...settings, ...((await api.state.get('moviemr').catch(() => null)) ?? {}) };
  const d = await api.state.get('moviemr-doc').catch(() => null);
  if (d?.format === 'lucianoffice/1' && d.app === 'moviemr') doc = d;
  $('tabs').replaceChildren(...TABS.map(([id, name]) => el('button', { type: 'button', textContent: name, dataset: { tab: id }, onclick: () => { tab = id; renderInspector(); } })));
  for (const v of Object.keys(VIEWS)) viewPointer(v);
  camPointer();
  $('time').oninput = () => setTime(Number($('time').value));
  $('play').onclick = play;
  $('duration').onchange = () => { const n = Number($('duration').value); if (n > 0) change(update(S(), (q) => { q.duration = n; }), 'changed the length'); };
  $('size').onchange = () => { const [w, h] = $('size').value.split('x').map(Number); change(update(S(), (q) => { q.width = w; q.height = h; }), 'changed the size'); };
  $('fps').onchange = () => change(update(S(), (q) => { q.fps = Number($('fps').value); }), 'changed the frame rate');
  $('addBoard').onclick = () => { const s = S(); const r = addBoard(s, { name: `Board ${s.boards.length + 1}`, x: spot(s), y: 0.45, z: -1 }); selected = r.id; tab = 'board'; change(r.s, 'added a board'); };
  $('camPoint').onclick = () => { const c = cameraAt(S(), t); change(addCameraPoint(S(), { ...c, t: Math.round(t * 100) / 100 }), 'added a camera point'); say(`Camera point at ${t.toFixed(2)} s.`); };
  $('present').onclick = () => sayDo('present');
  $('export').onclick = makeMovie;
  $('title').onchange = () => { doc = apply(doc, [{ op: 'title', value: $('title').value.trim() || 'Untitled scene' }], { by: 'user', label: 'renamed' }); persist(); };
  $('undo').onclick = () => { doc = undo(doc).doc; persist(); render(); };
  $('redo').onclick = () => { doc = redo(doc).doc; persist(); render(); };
  $('new').onclick = () => { if (confirm('Start a new scene? The current one stays saved if you saved it.')) { doc = newMovieDoc(newScene()); selected = null; t = 0; settings.savePath = ''; persist(); render(); } };
  $('save').onclick = save;
  $('open').onclick = open;
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doc = (e.shiftKey ? redo(doc) : undo(doc)).doc; persist(); render(); return; }
    if (e.key === ' ') { e.preventDefault(); play(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); change(removeBoard(S(), selected), 'deleted a board'); selected = null; render(); }
    const arrows = { ArrowLeft: ['x', -0.1], ArrowRight: ['x', 0.1], ArrowUp: ['z', -0.1], ArrowDown: ['z', 0.1] };
    if (arrows[e.key] && selected) { e.preventDefault(); const b = S().boards.find((x) => x.id === selected); const [k, d] = arrows[e.key]; change(setBoard(S(), selected, { [k]: Math.round((b[k] + d * (e.shiftKey ? 10 : 1)) * 100) / 100 }), 'nudged a board'); }
  });
  render();
  const params = new URLSearchParams(location.search);
  if (params.get('do')) await sayDo(params.get('do'));
}
init();
