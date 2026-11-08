import { test } from 'node:test';
import assert from 'node:assert/strict';
import { along, corners, deg, fovFromLens, moveLabel, project, rotate, toCamera } from '../lib/math3d.js';
import { addBoard, addCameraPoint, boardAt, cameraAt, cameraMoves, frameTimes, framesCSV, keyBoard, newScene, notesText, present, presentChanges, removeCameraPoint, setBoard } from '../lib/scene.js';
import { depthOrder, drawFrame, wallQuads } from '../lib/render.js';
import { findBoard, movieCommands, newMovieDoc, sceneOf } from '../lib/commands.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('the camera sees ahead in the middle, sideways off-centre, and nothing behind it', () => {
  const cam = { x: 0, y: 1.6, z: 4, yaw: 0, pitch: 0, lens: 35 };
  assert.ok(near(deg(fovFromLens(35)), 37.849, 0.001));
  assert.deepEqual(project([0, 1.6, 0], cam, 1280, 720), [640, 360, 4]);
  const right = project([1, 1.6, 0], cam, 1280, 720);
  assert.ok(near(right[0], 640 + (360 / Math.tan(fovFromLens(35) / 2)) / 4, 1e-6));
  assert.ok(project([0, 2.6, 0], cam, 1280, 720)[1] < 360, 'higher in the room is higher in the picture');
  assert.equal(project([0, 1.6, 6], cam, 1280, 720), null, 'behind the camera');
  // turned left 90 degrees, the camera looks along -x
  const left = { ...cam, yaw: 90 };
  assert.deepEqual(toCamera([-3, 1.6, 4], left).map((v) => Math.round(v * 1e6) / 1e6 + 0), [0, 0, 3]);
  // a longer lens makes things bigger
  assert.ok(project([1, 1.6, 0], { ...cam, lens: 85 }, 1280, 720)[0] > right[0]);
});

test('boards turn, tilt and stand where they are placed', () => {
  assert.deepEqual(rotate([1, 0, 0], { ry: 90 }).map((v) => Math.round(v * 1e9) / 1e9), [0, 0, -1]);
  const c = corners({ x: 1, y: 1, z: -2, w: 2, h: 1, rx: 0, ry: 0, rz: 0 });
  assert.deepEqual(c, [[0, 1.5, -2], [2, 1.5, -2], [2, 0.5, -2], [0, 0.5, -2]]);
  const turned = corners({ x: 0, y: 1, z: 0, w: 2, h: 1, ry: 90 });
  assert.ok(near(turned[0][2], 1) && near(turned[1][2], -1), 'turned a quarter, its left edge comes forward');
});

test('camera paths pass through their points, smoothly, with film labels for each move', () => {
  let s = newScene();
  s = addCameraPoint(s, { t: 4, x: 1, y: 1.6, z: 1, yaw: 30, pitch: -3, lens: 35 });
  s = addCameraPoint(s, { t: 8, x: 1, y: 1.6, z: 1, yaw: 30, pitch: -3, lens: 50 });
  assert.deepEqual([cameraAt(s, 0).z, cameraAt(s, 4).z, cameraAt(s, 4).yaw], [3.5, 1, 30]);
  const mid = cameraAt(s, 2);
  assert.ok(mid.z < 3.5 && mid.z > 1 && near(mid.yaw, 15), JSON.stringify(mid));
  assert.equal(cameraAt(s, 6).lens, 42.5);
  assert.deepEqual(cameraMoves(s).map((m) => m.label), ['tracking in, pan left', 'zoom in']);
  assert.equal(moveLabel({ x: 0, y: 1.6, z: 3, yaw: 0, pitch: 0 }, { x: 1, y: 1.6, z: 3, yaw: 0, pitch: 0 }), 'tracking right');
  assert.equal(moveLabel({ x: 0, y: 1, z: 3, yaw: 0, pitch: 0 }, { x: 0, y: 2, z: 3, yaw: 0, pitch: 10 }), 'crane up, tilt up');
  assert.equal(moveLabel({ x: 0, y: 1, z: 3, yaw: 350, pitch: 0 }, { x: 0, y: 1, z: 3, yaw: 10, pitch: 0 }), 'pan left', 'the short way round');
  s = removeCameraPoint(s, 4);
  assert.equal(s.camera.points.length, 2);
  assert.equal(along([{ t: 0, x: 0 }, { t: 1, x: 10 }], 0.5).x, 5);
});

test('recorded movement moves a board along its keys', () => {
  let r = addBoard(newScene(), { name: 'Ann', x: 0, y: 1, z: -1 }); let s = r.s;
  s = keyBoard(s, r.id, 0, { x: -2 });
  s = keyBoard(s, r.id, 2, { x: 2, ry: 90 });
  const b = s.boards[0];
  assert.deepEqual([boardAt(b, 0).x, boardAt(b, 2).x, boardAt(b, 1).ry], [-2, 2, 45]);
  s = keyBoard(s, r.id, 2.01, { x: 3 }); // within a frame of 2 s: replaces it
  assert.equal(s.boards[0].keys.length, 2);
});

test('Present neatens the scene: squares boards up, stands them on the floor, lines up rows, keeps them in the room', () => {
  let s = newScene();
  s = addBoard(s, { name: 'Ann', x: -2.03, y: 0.52, z: -1.12, ry: 7, w: 1.6, h: 0.9 }).s;
  s = addBoard(s, { name: 'Ben', x: 0.4, y: 0.47, z: -0.85, ry: -4, w: 1.6, h: 0.9 }).s;
  s = addBoard(s, { name: 'Sky', x: 9, y: 2.5, z: -3, rx: 20, w: 2, h: 1 }).s;
  const r = addBoard(s, { name: 'Walker', x: 0.33, y: 1.1, z: 0.5 }); s = keyBoard(r.s, r.id, 1, { x: 1.37 });
  const { boards, changes } = presentChanges(s);
  const by = Object.fromEntries(boards.map((b) => [b.name, b]));
  assert.deepEqual([by.Ann.ry, by.Ben.ry, by.Ann.z, by.Ben.z], [0, 0, -0.9, -0.9], 'turns to 15°, and the row shares a line (the mean of -1.1 and -0.8, to 10 cm)');
  assert.deepEqual([by.Ann.y, by.Ben.y], [0.45, 0.45], 'standing on the floor');
  assert.deepEqual([by.Ann.x, by.Ben.x], [-2, 0.4], 'spaced from the leftmost edge to the rightmost');
  assert.deepEqual([by.Sky.x, by.Sky.rx], [3, 15], 'kept inside the room, tilt squared to 15°');
  assert.deepEqual([by.Walker.x, by.Walker.keys.length], [1.37, 1], 'moving boards keep their paths');
  assert.ok(changes.find((c) => c.name === 'Ann').what.includes('stands on the floor'));
  assert.ok(changes.find((c) => c.name === 'Sky').what.includes('moved inside the room'));
  assert.equal(presentChanges(present(s)).changes.filter((c) => c.name !== 'Walker').length, 0, 'presenting twice changes nothing more');
});

test('for 3D software: a line per frame, and notes on every board, wall and camera move', () => {
  let r = addBoard(newScene(), { name: 'Ann', x: 0, y: 1, z: -1, note: 'character name y, but cute', media: { kind: 'video', path: 'Movies/ann.mp4' } });
  let s = setBoard(r.s, r.id, { opacity: 80 });
  s = addCameraPoint(s, { t: 2, x: 0, y: 1.6, z: 2, yaw: 0, pitch: -3 });
  s = { ...s, duration: 2, fps: 10 };
  assert.equal(frameTimes(s).length, 21);
  const csv = framesCSV(s).trim().split('\n');
  assert.equal(csv[0], 'frame,time,cam_x,cam_y,cam_z,cam_yaw,cam_pitch,cam_lens,Ann_x,Ann_y,Ann_z,Ann_ry');
  assert.equal(csv.length, 22);
  assert.equal(csv[1], '0,0,0,1.6,3.5,0,-3,35,0,1,-1,0');
  assert.equal(csv.at(-1), '20,2,0,1.6,2,0,-3,35,0,1,-1,0');
  const notes = notesText(s, { title: 'Meeting' });
  assert.match(notes, /^# Meeting\n\n1280 x 720, 10 fps, 2 seconds\./);
  assert.match(notes, /### Ann\n1\.6 x 0\.9 m at \(0, 1, -1\), turned 0°\. Shows video: Movies\/ann\.mp4, 80% opaque\.\nCorners: \(-0\.8, 1\.45, -1\) \(0\.8, 1\.45, -1\) \(0\.8, 0\.55, -1\) \(-0\.8, 0\.55, -1\)\.\nHow to interpret it: character name y, but cute/);
  assert.match(notes, /Moves: 0–2s tracking in\./);
});

test('frames draw walls then boards far to near, through a canvas', () => {
  let s = newScene();
  s = addBoard(s, { name: 'Far', z: -3 }).s;
  s = addBoard(s, { name: 'Near', z: 1 }).s;
  assert.deepEqual(depthOrder(s, 0).map((b) => b.name), ['Far', 'Near']);
  assert.deepEqual(Object.keys(wallQuads(s.room)), ['back', 'left', 'right', 'floor', 'ceiling']);
  // a recording canvas: count what is drawn
  const calls = { fill: 0, text: [] };
  const g = new Proxy({ canvas: { width: 320, height: 180 } }, { get: (o, k) => (k in o ? o[k] : k === 'fill' ? () => calls.fill++ : k === 'fillText' ? (t) => calls.text.push(t) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  drawFrame(g, s, 0);
  assert.ok(calls.fill > 100, `${calls.fill} triangles filled`);
  assert.deepEqual(calls.text, ['Far', 'Near'], 'boards without media show their names, far first');
});

test('the character builds the scene, asks before Present, and its changes can be undone', async () => {
  let doc = newMovieDoc(newScene(), 'Meeting');
  const cmds = movieCommands();
  let confirmed = null;
  const ctx = { selected: () => [], camera: () => ({ x: 0, y: 1.6, z: 2, yaw: 10, pitch: 0 }), confirm: async (q) => { confirmed = q; return true; } };
  const say = async (text) => { const r = await cmds.perform(text, doc, { ctx }); assert.ok(r.matched, `understood "${text}"`); doc = r.doc; return r.say; };
  assert.match(await say('add a board called Ann'), /Added the board Ann/);
  await say('add a board called Ben');
  assert.match(await say('move Ann left 1 metre'), /Moved Ann left 1 m/);
  assert.match(await say('move Ben up 50 cm'), /up 0\.5 m/);
  assert.match(await say('turn Ann 45 degrees'), /Turned Ann 45°/);
  assert.match(await say('note on Ann: character name y, but cute'), /Noted on Ann/);
  assert.match(await say('make the back wall blue'), /back is blue/);
  assert.match(await say('back wall opacity 50%'), /50% opaque/);
  assert.match(await say('set the lens to 50 mm'), /50 mm/);
  assert.match(await say('add a camera point at 3 seconds'), /3 s/);
  assert.match(await say('the lighting is warm, from the left'), /warm, from the left/);
  const s = sceneOf(doc);
  const ann = findBoard(s, 'ann');
  assert.deepEqual([ann.x, ann.y, ann.ry, ann.note], [-3.4, 0.45, 45, 'character name y, but cute']);
  assert.deepEqual([s.walls.back.colour, s.walls.back.opacity, s.camera.lens, s.camera.points[1].yaw], ['#2e6fd8', 50, 50, 10]);
  assert.match(await say('present'), /Neatened: .*Ann/);
  assert.match(confirmed, /^Present will neaten the scene: .*Go ahead\? \(You can undo it\.\)$/);
  assert.equal(sceneOf(doc).boards[0].ry, 45, 'already on 15°');
  await say('undo that');
  assert.equal(findBoard(sceneOf(doc), 'ann').x, -3.4, 'Present had moved her inside the room; undo puts her back');
  assert.match(await say('move Zed left 1 m'), /no board called Zed/);
});
