// The functions whose inputs and outputs are recorded in io/ios.txt (see io/engine.mjs).
import { fovFromLens, rotate, project, along, moveLabel } from '../lib/math3d.js';
import { newScene, newBoard, boardAt, cameraMoves } from '../lib/scene.js';

export const title = 'Movie MR';

const pt = (rnd) => [rnd.int(-5, 5), rnd.int(-3, 3), rnd.int(-5, 5)];
const cam = (rnd) => ({ x: rnd.int(-2, 2), y: rnd.pick([1.2, 1.6, 2]), z: rnd.int(4, 8), yaw: rnd.pick([0, 15, -20, 45]), pitch: rnd.pick([0, -10, 5]), lens: rnd.pick([24, 35, 50, 85]) });
const key = (rnd, t) => ({ t, x: rnd.int(-3, 3), y: rnd.pick([1, 1.6, 2]), z: rnd.int(2, 8), yaw: rnd.int(-60, 60), pitch: rnd.int(-15, 15), ry: rnd.int(-30, 30), lens: rnd.pick([24, 35, 50]) });

export const cases = [
  { name: 'fovFromLens', run: fovFromLens, make: (rnd) => [rnd.pick([14, 18, 24, 28, 35, 50, 85, 135, 200])] },
  { name: 'rotate', run: (p, r) => rotate(p, r), make: (rnd) => [pt(rnd), { rx: rnd.pick([0, 30, 90]), ry: rnd.pick([0, 45, 180]), rz: rnd.pick([0, -30, 90]) }] },
  { name: 'project', run: (p, c, W, H) => project(p, c, W, H), make: (rnd) => [pt(rnd), cam(rnd), rnd.pick([640, 1280, 1920]), rnd.pick([360, 720, 1080])] },
  { name: 'along', run: (points, t) => along(points, t), make: (rnd) => { const n = rnd.int(1, 4); return [Array.from({ length: n }, (_, i) => key(rnd, i * 2)), rnd.int(-1, n * 2 + 1) + rnd.pick([0, 0.25, 0.5])]; } },
  { name: 'moveLabel', run: (a, b) => moveLabel(a, b), make: (rnd) => [key(rnd, 0), key(rnd, rnd.pick([1, 2, 4]))] },
  { name: 'boardAt', run: (fields, t) => { const { id, ...b } = boardAt(newBoard({ ...fields, id: 'b' }), t); return b; }, make: (rnd) => [{ text: rnd.sentence(), keys: Array.from({ length: rnd.int(0, 3) }, (_, i) => ({ t: i * 3, x: rnd.int(-3, 3), y: rnd.pick([1, 1.5]), z: rnd.int(-3, 3), ry: rnd.int(-90, 90) })) }, rnd.int(0, 8)] },
  { name: 'cameraMoves', run: (points) => { const s = newScene(); return cameraMoves({ ...s, camera: { ...s.camera, points } }); }, make: (rnd) => [Array.from({ length: rnd.int(1, 4) }, (_, i) => key(rnd, i * 3))] }
];
