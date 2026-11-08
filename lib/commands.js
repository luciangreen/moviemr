// Movie MR as a Lucian Office document (data.scene), so each change is one undoable step, and
// the character's commands: "add a board called Ann", "move Ann left 1 metre", "turn Ann 45
// degrees", "note on Ann: character name y, but cute", "make the back wall blue", "back wall
// opacity 50%", "set the lens to 50 mm", "add a camera point at 3 seconds", "present".
import { createCommands, createDocument } from './core.js';
import { WALLS, addBoard, addCameraPoint, presentChanges, present, setBoard, setWall, update } from './scene.js';

export const newMovieDoc = (scene, title = 'Untitled scene') => createDocument({ app: 'moviemr', title, data: { scene } });
export const sceneOf = (doc) => doc.data.scene;
export const sceneOps = (s) => [{ op: 'data', key: 'scene', value: s }];

const clean = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').replace(/[.!]$/, '').trim();
const COLOURS = { red: '#c0392b', orange: '#e67e22', yellow: '#f1c40f', green: '#27ae60', blue: '#2e6fd8', purple: '#8e44ad', pink: '#e86fa8', white: '#ffffff', black: '#111111', grey: '#888888', gray: '#888888', brown: '#7b5a3c', cream: '#efe6d2' };
export const colourOf = (word) => { const w = clean(word).toLowerCase().replace(/^(light|dark)\s+/, ''); return /^#[0-9a-f]{6}$/i.test(w) ? w : COLOURS[w] ?? null; };

export function findBoard(s, phrase, selected = []) {
  const p = clean(phrase).toLowerCase().replace(/^the\s+/, '').replace(/\s+board$/, '');
  if (/^(it|this|that|this board|that board)$/.test(p)) return s.boards.find((b) => selected.includes(b.id));
  return s.boards.find((b) => b.name.toLowerCase() === p) ?? s.boards.find((b) => b.name.toLowerCase().startsWith(p));
}
const wallOf = (phrase) => { const p = clean(phrase).toLowerCase().replace(/^the\s+/, '').replace(/\s+wall$/, ''); return WALLS.find((w) => w === p); };
const metres = (text) => { const m = /(-?\d+(?:\.\d+)?)\s*(cm|centimet(?:re|er)s?|m|met(?:re|er)s?)?/i.exec(String(text)); if (!m) return NaN; return /^c/i.test(m[2] ?? '') ? Number(m[1]) / 100 : Number(m[1]); };
const DIRS = { left: ['x', -1], right: ['x', 1], up: ['y', 1], down: ['y', -1], forward: ['z', 1], closer: ['z', 1], back: ['z', -1], away: ['z', -1], backward: ['z', -1] };

// A new board's place: across the room, four to a row, standing on the floor.
export const spot = (s) => Math.round(((s.boards.length % 4) - 1.5) * Math.min(1.8, (s.room.w - 1.6) / 4) * 10) / 10;

export function movieCommands() {
  const reg = createCommands({ app: 'Movie MR' });
  const missing = (phrase) => ({ ops: [], say: `There's no board called ${clean(phrase)}.` });
  reg
    .register({ name: 'add board', patterns: ['add a board called {name}', 'add a board {name}', 'new board {name}'], help: 'add a board called Ann',
      run: ({ args, doc }) => { const s = sceneOf(doc); const r = addBoard(s, { name: clean(args.name), x: spot(s), y: 0.45, z: -1 }); return { ops: sceneOps(r.s), say: `Added the board ${clean(args.name)}.` }; } })
    .register({ name: 'move board', patterns: ['move {board} {dir} {amount}'], help: 'move Ann left 1 metre',
      run: ({ args, doc, ctx }) => {
        const s = sceneOf(doc); const b = findBoard(s, args.board, ctx.selected?.() ?? []);
        if (!b) return missing(args.board);
        const d = DIRS[clean(args.dir).toLowerCase()]; const n = metres(args.amount);
        if (!d || !Number.isFinite(n)) return { ops: [], say: 'Say left, right, up, down, forward or back, and how far (e.g. 1 metre, 50 cm).' };
        const v = Math.round((b[d[0]] + d[1] * n) * 1000) / 1000;
        return { ops: sceneOps(setBoard(s, b.id, { [d[0]]: v })), say: `Moved ${b.name} ${clean(args.dir)} ${n} m.` };
      } })
    .register({ name: 'turn board', patterns: ['turn {board} {n} degrees', 'rotate {board} {n} degrees', 'turn {board} {n}'], help: 'turn Ann 45 degrees',
      run: ({ args, doc, ctx }) => {
        const s = sceneOf(doc); const b = findBoard(s, args.board, ctx.selected?.() ?? []); const n = Number(String(args.n).replace(/degrees?|°/g, '').trim());
        if (!b) return missing(args.board);
        if (!Number.isFinite(n)) return { ops: [], say: 'How many degrees?' };
        return { ops: sceneOps(setBoard(s, b.id, { ry: ((b.ry + n) % 360 + 360) % 360 })), say: `Turned ${b.name} ${n}°.` };
      } })
    .register({ name: 'board note', patterns: ['note on {rest}'], help: 'note on Ann: character name y, but cute',
      run: ({ args, doc, ctx }) => {
        const m = /^(.+?)\s*:\s*(.+)$/.exec(args.rest); if (!m) return { ops: [], say: 'Say it like "note on Ann: character name y, but cute".' };
        const s = sceneOf(doc);
        if (/^(the\s+)?camera$/i.test(clean(m[1]))) return { ops: sceneOps(update(s, (q) => { q.camera.note = clean(m[2]); })), say: 'Noted on the camera.' };
        const b = findBoard(s, m[1], ctx.selected?.() ?? []); if (!b) return missing(m[1]);
        return { ops: sceneOps(setBoard(s, b.id, { note: clean(m[2]) })), say: `Noted on ${b.name}: ${clean(m[2])}.` };
      } })
    .register({ name: 'wall colour', patterns: ['make the {wall} wall {colour}', 'colour the {wall} wall {colour}', 'paint the {wall} wall {colour}', 'make the {wall} {colour}'], help: 'make the back wall blue',
      run: ({ args, doc }) => {
        const w = wallOf(args.wall), c = colourOf(args.colour);
        if (!w) return { ops: [], say: `Walls: ${WALLS.join(', ')}.` };
        if (!c) return { ops: [], say: `I know these colours: ${Object.keys(COLOURS).join(', ')}, or #rrggbb.` };
        return { ops: sceneOps(setWall(sceneOf(doc), w, { colour: c })), say: `The ${w} is ${clean(args.colour)}.` };
      } })
    .register({ name: 'wall opacity', patterns: ['{wall} wall opacity {n}', 'set the {wall} wall opacity to {n}', 'make the {wall} wall {n} opaque'], help: 'back wall opacity 50%',
      run: ({ args, doc }) => { const w = wallOf(args.wall), n = Number(String(args.n).replace('%', '')); if (!w || !(n >= 0 && n <= 100)) return { ops: [], say: 'Which wall, and a percentage from 0 to 100?' }; return { ops: sceneOps(setWall(sceneOf(doc), w, { opacity: n })), say: `The ${w} wall is ${n}% opaque.` }; } })
    .register({ name: 'wall light', patterns: ['{wall} wall lighting {n}', 'light the {wall} wall {n}', 'set the {wall} wall lighting to {n}'], help: 'back wall lighting 70%',
      run: ({ args, doc }) => { const w = wallOf(args.wall), n = Number(String(args.n).replace('%', '')); if (!w || !(n >= 0 && n <= 200)) return { ops: [], say: 'Which wall, and lighting from 0 to 200%?' }; return { ops: sceneOps(setWall(sceneOf(doc), w, { light: n })), say: `The ${w} wall's lighting is ${n}%.` }; } })
    .register({ name: 'lens', patterns: ['set the lens to {n}', 'use a {n} lens', 'lens {n}'], help: 'set the lens to 50 mm',
      run: ({ args, doc }) => { const n = Number(String(args.n).replace(/mm/i, '').trim()); if (!(n >= 8 && n <= 400)) return { ops: [], say: 'A lens from 8 to 400 mm.' }; return { ops: sceneOps(update(sceneOf(doc), (q) => { q.camera.lens = n; for (const p of q.camera.points) p.lens = n; })), say: `The lens is ${n} mm.` }; } })
    .register({ name: 'lighting', patterns: ['the lighting is {text}', 'lighting: {text}', 'set the lighting to {text}'], help: 'the lighting is warm, from the left',
      run: ({ args, doc }) => ({ ops: sceneOps(update(sceneOf(doc), (q) => { q.camera.lighting = clean(args.text); })), say: `Lighting: ${clean(args.text)}.` }) })
    .register({ name: 'camera point', patterns: ['add a camera point at {t}', 'camera point at {t}', 'keyframe the camera at {t}'], help: 'add a camera point at 3 seconds',
      run: ({ args, doc, ctx }) => {
        const t = Number(String(args.t).replace(/s(ec(ond)?s?)?$/i, '').trim());
        if (!(t >= 0 && t <= 600)) return { ops: [], say: 'At how many seconds?' };
        const here = ctx.camera?.() ?? {};
        return { ops: sceneOps(addCameraPoint(sceneOf(doc), { t, ...here })), say: `Added a camera point at ${t} s.` };
      } })
    .register({ name: 'duration', patterns: ['make it {n} seconds long', 'set the length to {n} seconds', 'make the scene {n} seconds'], help: 'make it 12 seconds long',
      run: ({ args, doc }) => { const n = Number(args.n); if (!(n > 0 && n <= 600)) return { ops: [], say: 'How many seconds (up to 600)?' }; return { ops: sceneOps(update(sceneOf(doc), (q) => { q.duration = n; })), say: `The scene is ${n} seconds long.` }; } })
    .register({ name: 'present', patterns: ['present', 'neaten the scene', 'tidy the scene', 'present it'], help: 'present',
      run: async ({ doc, ctx }) => {
        const s = sceneOf(doc);
        const { changes } = presentChanges(s);
        if (!changes.length) return { ops: [], say: 'The scene is already neat.' };
        const list = changes.map((c) => `${c.name}: ${c.what}`).join('; ');
        const ok = ctx.confirm ? await ctx.confirm(`Present will neaten the scene: ${list}. Go ahead? (You can undo it.)`) : true;
        if (!ok) return { ops: [], say: 'Left as it is.' };
        return { ops: sceneOps(present(s)), say: `Neatened: ${list}. Say "undo that" to put it back.` };
      } });
  return reg;
}
