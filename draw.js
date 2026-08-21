/**
 * draw.js
 *
 * Main app: webcam loop, gesture-triggered actions, 2D/3D drawing,
 * move-mode pan/zoom/rotate. Feature parity with the Python
 * air_draw.py, including the $1-recognizer-based shape detection
 * (square/circle/triangle) and the 3D wireframe mode.
 *
 * Requires (loaded before this file, as plain <script> tags):
 *   gesture.js    -> classifyGesture, landmarkPos
 *   recognizer.js -> recognizeShape
 *   shape3d.js    -> PRIMITIVE_BUILDERS, project, shadeColor
 */

const FRAME_W = 1280;
const FRAME_H = 720;
const MIN_STROKE_POINTS_TO_KEEP = 8;
const AUTO_ROTATE_SPEED = 0.012;
const SHAPE3D_BASE_SCALE_DIVISOR = 2.2;


const DRAW_COLORS = [
  [60, 220, 255],
  [255, 120, 60],
  [120, 60, 255],
  [80, 255, 120],
  [255, 255, 255],
];
const rgbCss = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

const videoElement = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const modeText = document.getElementById("mode-text");
const colorBox = document.getElementById("color-box");
const badge3d = document.getElementById("badge-3d");


const flipCanvas = document.createElement("canvas");
flipCanvas.width = FRAME_W;
flipCanvas.height = FRAME_H;
const flipCtx = flipCanvas.getContext("2d");

let colorIndex = 0;
let mode = "draw"; // "draw" | "move"
let threeDMode = false;
let strokes = []; // array of Stroke2D | Shape3DObject
let undoneStrokes = [];
let activePoints = [];
let wasDrawing = false;
let moveAnchor = null; // { mid, dist, angle }
let moveReference = []; // per-object snapshot, same order as `strokes`



class Stroke2D {
  constructor(points, label, color) {
    this.points = points; // [{x,y}, ...] in local (pre-offset) space
    this.label = label; // "square" | "circle" | "triangle" | "freehand"
    this.isClosed = label !== "freehand";
    this.color = color;
    this.offset = { x: 0, y: 0 };
    this.scale = 1.0;
  }

  draw(ctx) {
    if (this.points.length === 0) return;
    const cx = this.points.reduce((s, p) => s + p.x, 0) / this.points.length;
    const cy = this.points.reduce((s, p) => s + p.y, 0) / this.points.length;

    ctx.beginPath();
    ctx.strokeStyle = rgbCss(this.color);
    ctx.lineWidth = 3;

    this.points.forEach((p, i) => {
      const tx = (p.x - cx) * this.scale + cx + this.offset.x;
      const ty = (p.y - cy) * this.scale + cy + this.offset.y;
      if (i === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    });

    if (this.isClosed) ctx.closePath();
    ctx.stroke();
  }
}

class Shape3DObject {
  constructor(label, anchor, size, color) {
    this.label = label;
    const { vertices, edges } = PRIMITIVE_BUILDERS[label]();
    this.vertices = vertices;
    this.edges = edges;
    this.baseAnchor = { x: anchor.x, y: anchor.y };
    this.baseSize = size;
    this.color = color;
    this.offset = { x: 0, y: 0 };
    this.scale = 1.0;
    this.rotation = [0.3, 0.4, 0.0]; // rx, ry, rz
  }

  stepAutoRotate() {
    this.rotation[1] += AUTO_ROTATE_SPEED;
  }

  draw(ctx) {
    const anchor = { x: this.baseAnchor.x + this.offset.x, y: this.baseAnchor.y + this.offset.y };
    const { points2d, camZ } = project(
      this.vertices, this.rotation, anchor, this.baseSize * this.scale
    );
    const zMin = Math.min(...camZ);
    const zMax = Math.max(...camZ);
    const zRange = Math.max(zMax - zMin, 1e-6);

    for (const [i, j] of this.edges) {
      const depthT = ((camZ[i] + camZ[j]) / 2 - zMin) / zRange;
      const color = shadeColor(this.color, depthT);
      ctx.beginPath();
      ctx.strokeStyle = rgbCss(color);
      ctx.lineWidth = 2;
      ctx.moveTo(points2d[i].x, points2d[i].y);
      ctx.lineTo(points2d[j].x, points2d[j].y);
      ctx.stroke();
    }
  }
}



class GestureTrigger {
  constructor(name, holdFrames = 5, cooldownMs = 600) {
    this.name = name;
    this.holdFrames = holdFrames;
    this.cooldownMs = cooldownMs;
    this.count = 0;
    this.lastFired = 0;
  }
  update(presentGestures) {
    if (presentGestures.has(this.name)) this.count++;
    else this.count = 0;

    const now = Date.now();
    if (this.count === this.holdFrames && now - this.lastFired > this.cooldownMs) {
      this.lastFired = now;
      return true;
    }
    return false;
  }
}

const triggers = {
  modeToggle: new GestureTrigger("peace"),
  undo: new GestureTrigger("three_up"),
  redo: new GestureTrigger("open_palm"),
  clear: new GestureTrigger("ok_sign"),
  color: new GestureTrigger("thumbs_up"),
  threeD: new GestureTrigger("rock_on"),
};

// ------------------------------------------------------------- shape snapping

function buildCleanShape(points, label) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const r = Math.max(maxX - minX, maxY - minY) / 2;

  if (label === "square") {
    return [
      { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
      { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r }, { x: cx - r, y: cy - r },
    ];
  }
  if (label === "circle") {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }
  if (label === "triangle") {
    return [
      { x: cx, y: cy - r }, { x: cx - r, y: cy + r }, { x: cx + r, y: cy + r }, { x: cx, y: cy - r },
    ];
  }
  return points;
}

function snapToShape(points) {
  const { label, score } = recognizeShape(points);
  if (label && score > 0.75 && label !== "line") {
    return { cleanPoints: buildCleanShape(points, label), label };
  }
  return { cleanPoints: points, label: "freehand" };
}

// ------------------------------------------------------------------- main loop

function onResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  const presentGestures = new Set();
  const handsInfo = []; 

  if (results.multiHandLandmarks) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const lm = results.multiHandLandmarks[i];
      const handedness = results.multiHandedness[i].label; 
      const gesture = classifyGesture(lm, handedness);
      presentGestures.add(gesture);
      const indexTip = landmarkPos(lm, canvasElement.width, canvasElement.height, INDEX_TIP);
      handsInfo.push({ lm, handedness, gesture, indexTip });
    }
  }


  if (triggers.modeToggle.update(presentGestures)) {
    mode = mode === "draw" ? "move" : "draw";
    moveAnchor = null;
    activePoints = [];
  }
  if (triggers.undo.update(presentGestures) && strokes.length > 0) {
    undoneStrokes.push(strokes.pop());
  }
  if (triggers.redo.update(presentGestures) && undoneStrokes.length > 0) {
    strokes.push(undoneStrokes.pop());
  }
  if (triggers.clear.update(presentGestures)) {
    strokes = [];
    undoneStrokes = [];
    activePoints = [];
  }
  if (triggers.color.update(presentGestures)) {
    colorIndex = (colorIndex + 1) % DRAW_COLORS.length;
  }
  if (triggers.threeD.update(presentGestures)) {
    threeDMode = !threeDMode;
  }


  modeText.innerText = `MODE: ${mode.toUpperCase()}`;
  modeText.style.color = mode === "draw" ? "#38ef7d" : "#ffb43c";
  colorBox.style.background = rgbCss(DRAW_COLORS[colorIndex]);
  badge3d.style.display = threeDMode ? "inline" : "none";


  if (mode === "draw") {
    const drawHand = handsInfo.find((h) => h.gesture === "draw");
    if (drawHand) {
      activePoints.push(drawHand.indexTip);
      wasDrawing = true;
    } else {
      if (wasDrawing && activePoints.length >= MIN_STROKE_POINTS_TO_KEEP) {
        const { cleanPoints, label } = snapToShape(activePoints);
        const color = DRAW_COLORS[colorIndex];

        if (threeDMode && PRIMITIVE_BUILDERS[label]) {
          const xs = activePoints.map((p) => p.x);
          const ys = activePoints.map((p) => p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const anchor = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
          const radius = Math.max(maxX - minX, maxY - minY) / 2;
          const size = Math.max(radius / SHAPE3D_BASE_SCALE_DIVISOR, 20.0);
          strokes.push(new Shape3DObject(label, anchor, size, color));
        } else {
          strokes.push(new Stroke2D(cleanPoints, label, color));
        }
        undoneStrokes = [];
      }
      activePoints = [];
      wasDrawing = false;
    }
  } else {
    // ---- MOVE mode ----
    const indexTips = handsInfo.map((h) => h.indexTip);
    if (indexTips.length === 2) {
      const [p1, p2] = indexTips;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const handDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const handAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      if (!moveAnchor) {
        moveAnchor = { mid, dist: handDist, angle: handAngle };
        moveReference = strokes.map((s) => ({
          offset: { ...s.offset },
          scale: s.scale,
          rotation: s instanceof Shape3DObject ? [...s.rotation] : null,
        }));
      } else {
        const pan = { x: mid.x - moveAnchor.mid.x, y: mid.y - moveAnchor.mid.y };
        const zoom = moveAnchor.dist > 1e-6 ? handDist / moveAnchor.dist : 1.0;
        const dAngle = handAngle - moveAnchor.angle;

        strokes.forEach((s, idx) => {
          const ref = moveReference[idx];
          if (!ref) return;
          s.offset.x = ref.offset.x + pan.x;
          s.offset.y = ref.offset.y + pan.y;
          s.scale = Math.max(0.2, Math.min(4.0, ref.scale * zoom));
          if (s instanceof Shape3DObject && ref.rotation) {
            s.rotation[2] = ref.rotation[2] + dAngle; // hand-pair twist -> Z spin
            s.rotation[0] = ref.rotation[0] + pan.y / 150.0; // vertical pan -> X tilt
          }
        });
      }
    } else {
      moveAnchor = null;
    }
  }

 
  strokes.forEach((s) => {
    if (s instanceof Shape3DObject) s.stepAutoRotate();
    s.draw(canvasCtx);
  });

  if (activePoints.length > 1) {
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = rgbCss(DRAW_COLORS[colorIndex]);
    canvasCtx.lineWidth = 3;
    activePoints.forEach((p, i) => {
      if (i === 0) canvasCtx.moveTo(p.x, p.y);
      else canvasCtx.lineTo(p.x, p.y);
    });
    canvasCtx.stroke();
  }

  handsInfo.forEach((h) => {
    canvasCtx.beginPath();
    canvasCtx.arc(h.indexTip.x, h.indexTip.y, 8, 0, 2 * Math.PI);
    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.fill();
  });

  canvasCtx.restore();
}


const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6,
});
hands.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
   
    flipCtx.save();
    flipCtx.scale(-1, 1);
    flipCtx.drawImage(videoElement, -flipCanvas.width, 0, flipCanvas.width, flipCanvas.height);
    flipCtx.restore();
    await hands.send({ image: flipCanvas });
  },
  width: FRAME_W,
  height: FRAME_H,
});
camera.start();
