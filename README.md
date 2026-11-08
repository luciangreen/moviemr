# Movie MR

Movie MR is the film part of [Lucian Office](https://github.com/luciangreen/lucianoffice), inside [LucianOS](https://github.com/luciangreen/lucianos). You place 2D boards showing video, photos or a colour in a 3D room, plan the camera's path, note how each part is meant, and make it all into **one MP4 in the browser**. Beside the MP4 go the notes and a per-frame CSV, so the scene can be rebuilt in 3D software. Recording uses the browser's MediaRecorder rather than ffmpeg, so it works on a Mac and on an iPhone.

- **Boards**: name, position (x, y, z in metres), turn, tilt and spin, size and opacity.
  - **● Record video** films straight onto the board with the camera (sound too, when there's a microphone).
  - **Choose video or photo…** uses a file.
  - **Video starts at** sets when its video begins in the scene.
  - **How to interpret it**: e.g. "character name y, but cute".
- **Three views** (top, front and side): drag a board to move it in that view's two directions. Hold **Shift** and drag to turn it (top), spin it (front) or tilt it (side). Arrow keys nudge the selected board by 10 cm (Shift: 1 m).
- **Recording movement**: tick **Record movement**, press ▶ and drag a board. Its path is kept as timed points and drawn in the views; boards then move along their paths.
- **Camera**:
  - **Path**: timed points (position, yaw, pitch and lens). The camera moves smoothly through them (Catmull-Rom), and each move is labelled in film terms: tracking in/out/left/right, crane, pan, tilt, zoom or hold. You can relabel any move.
  - **Setting points**: drag in the camera view to look around (Shift: move), or scroll to zoom; drag the green camera dot in a view; or press **Camera point here**. Each sets a point at the current time.
  - **Lens and lighting**: the lens in mm (full-frame) and a lighting description.
- **Walls**: back, left, right, floor and ceiling, each with a colour or a photo or video, opacity %, and lighting % (below 100 darkens, above brightens). The room's size can be changed.
- **Present**: neatens the scene after showing you what it will change. It snaps positions to 10 cm and turns to 15°, stands boards close to the floor on it, lines up boards that are nearly in a row with even spacing, and keeps boards inside the room. Boards with recorded movement keep their paths. It is one undoable step, and running it twice changes nothing more.
- **Make MP4**: records the scene in real time from a canvas, at 1280 × 720, 1920 × 1080, 720 × 1280 (tall) or 1080 × 1080, at 24 to 60 fps. It saves `<scene>.mp4` (WebM in a browser that can't make MP4) in `Movies/Movie MR/<scene>/` with:
  - `<scene>.notes.md`: each board's size, place, corners, media, movement and how to interpret it; the walls; the camera points, moves, lens, lighting and notes;
  - `<scene>.frames.csv`: per frame, the camera's position, yaw, pitch and lens, and each board's position and turn.

  A download link is shown too (handy on an iPhone).
- **Tell Lucian**: "add a board called Ann", "move Ann left 1 metre", "turn Ann 45 degrees", "note on Ann: character name y, but cute", "make the back wall blue", "back wall opacity 50%", "back wall lighting 70%", "set the lens to 50 mm", "the lighting is warm, from the left", "add a camera point at 3 seconds", "make it 12 seconds long", "present", "play", "make the MP4", "undo that".

## Install

From your `lucianos` folder:

```sh
git clone https://github.com/luciangreen/lucianoffice apps/lucianoffice
git clone https://github.com/luciangreen/moviemr apps/moviemr
```

The camera and microphone need the page opened over HTTPS or on localhost (as LucianOS's remote mode provides).

## Tests

```sh
npm test
```

The tests cover:

- **projection**: the centre, off-centre, behind the camera, turning, and lens length;
- **boards**: turning and their corners;
- **camera paths**: passing through their points, smooth in between, and their move labels;
- **recorded movement**;
- **Present**, including that running it twice changes nothing more;
- the **per-frame CSV** and the **notes**;
- **drawing** walls and boards far to near;
- the **character's commands**, including asking before Present, and undo.

In a browser (headless Chrome), a scene made through the character was recorded into an MP4: a valid MP4 (`ftyp`/`isom`) of 3.0 seconds at 1280 × 720. A recording made onto a board through MediaRecorder showed in the finished video. The browser had no camera, so a canvas animation stood in for it. Safari on a Mac and iPhone makes MP4 with MediaRecorder too; it has not been tried here.

## Later

- Copy and paste camera paths.
- Match path lengths to an "eyedropped" point.

## Inputs and outputs

`io/ios.txt` lists 200 inputs and the outputs they give, from real runs of this repo's functions (the list of functions is in `io/cases.mjs`; the inputs come from a fixed seed, so they are the same every time). `npm test` runs them again and fails if any output changes. If a change is meant, run `npm run ios` to write the new outputs and check the diff.
