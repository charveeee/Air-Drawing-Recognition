/**
 * recognizer.js
 *
 * JS port of the Python shape_recognizer.py: a simplified $1
 * Unistroke Recognizer (Wobbrock, Wilson & Li, 2007) that classifies
 * a traced (x, y) point path into square / circle / triangle / line.
 *
 * No dependencies, just math -- resample to a fixed point count,
 * normalize rotation/scale/position, then brute-force sweep a small
 * rotation range to find the best match against each template.
 */

const NUM_RESAMPLE_POINTS = 64;
const SQUARE_SIZE = 250.0;
const ANGLE_SWEEP_RANGE = (45 * Math.PI) / 180;
const ANGLE_SWEEP_STEP = (2 * Math.PI) / 180;

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function resample(points, n = NUM_RESAMPLE_POINTS) {
  const interval = pathLength(points) / (n - 1);
  if (interval === 0) return new Array(n).fill(points[0]);

  const newPoints = [points[0]];
  let accumulated = 0.0;
  const pts = points.slice();

  let i = 1;
  while (i < pts.length) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (accumulated + d >= interval) {
      const t = d !== 0 ? (interval - accumulated) / d : 0;
      const newPoint = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
      newPoints.push(newPoint);
      pts.splice(i, 0, newPoint);
      accumulated = 0.0;
    } else {
      accumulated += d;
    }
    i += 1;
  }

  while (newPoints.length < n) newPoints.push(pts[pts.length - 1]);
  return newPoints.slice(0, n);
}

function centroid(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x: cx, y: cy };
}

function rotateToZero(points) {
  const c = centroid(points);
  const theta = Math.atan2(points[0].y - c.y, points[0].x - c.x);
  return rotateBy(points, -theta, c);
}

function rotateBy(points, angle, aboutPoint = null) {
  const c = aboutPoint || centroid(points);
  const cosT = Math.cos(angle);
  const sinT = Math.sin(angle);
  return points.map((p) => ({
    x: (p.x - c.x) * cosT - (p.y - c.y) * sinT + c.x,
    y: (p.x - c.x) * sinT + (p.y - c.y) * cosT + c.y,
  }));
}

function scaleToSquare(points, size = SQUARE_SIZE) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX || 1e-9;
  const h = maxY - minY || 1e-9;
  return points.map((p) => ({
    x: ((p.x - minX) * size) / w,
    y: ((p.y - minY) * size) / h,
  }));
}

function translateToOrigin(points) {
  const c = centroid(points);
  return points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function pathDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  }
  return total / a.length;
}

function bestDistance(candidate, template) {
  let best = Infinity;
  for (let theta = -ANGLE_SWEEP_RANGE; theta <= ANGLE_SWEEP_RANGE; theta += ANGLE_SWEEP_STEP) {
    const rotated = rotateBy(candidate, theta);
    const d = pathDistance(rotated, template);
    if (d < best) best = d;
  }
  return best;
}

function normalize(points) {
  const resampled = resample(points);
  const rotated = rotateToZero(resampled);
  const scaled = scaleToSquare(rotated);
  return translateToOrigin(scaled);
}

// ----------------------------------------------------- reference templates

function squareTemplateRaw() {
  const pts = [];
  for (let t = 0; t <= 25; t++) pts.push({ x: (t / 25) * SQUARE_SIZE, y: 0 });
  for (let t = 0; t <= 25; t++) pts.push({ x: SQUARE_SIZE, y: (t / 25) * SQUARE_SIZE });
  for (let t = 0; t <= 25; t++) pts.push({ x: SQUARE_SIZE - (t / 25) * SQUARE_SIZE, y: SQUARE_SIZE });
  for (let t = 0; t <= 25; t++) pts.push({ x: 0, y: SQUARE_SIZE - (t / 25) * SQUARE_SIZE });
  return pts;
}

function circleTemplateRaw() {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const a = (2 * Math.PI * i) / 63;
    pts.push({ x: (SQUARE_SIZE / 2) * Math.cos(a), y: (SQUARE_SIZE / 2) * Math.sin(a) });
  }
  return pts;
}

function triangleTemplateRaw() {
  const p1 = { x: SQUARE_SIZE / 2, y: 0 };
  const p2 = { x: 0, y: SQUARE_SIZE };
  const p3 = { x: SQUARE_SIZE, y: SQUARE_SIZE };
  const pts = [];
  for (let t = 0; t <= 21; t++) {
    const f = t / 21;
    pts.push({ x: p1.x + f * (p2.x - p1.x), y: p1.y + f * (p2.y - p1.y) });
  }
  for (let t = 0; t <= 21; t++) {
    const f = t / 21;
    pts.push({ x: p2.x + f * (p3.x - p2.x), y: p2.y + f * (p3.y - p2.y) });
  }
  for (let t = 0; t <= 20; t++) {
    const f = t / 20;
    pts.push({ x: p3.x + f * (p1.x - p3.x), y: p3.y + f * (p1.y - p3.y) });
  }
  return pts;
}

function lineTemplateRaw() {
  const pts = [];
  for (let t = 0; t < 64; t++) pts.push({ x: (t / 63) * SQUARE_SIZE, y: 0 });
  return pts;
}

const TEMPLATES = {
  square: normalize(squareTemplateRaw()),
  circle: normalize(circleTemplateRaw()),
  triangle: normalize(triangleTemplateRaw()),
  line: normalize(lineTemplateRaw()),
};

const DIAGONAL = Math.hypot(SQUARE_SIZE, SQUARE_SIZE);
const HALF_DIAGONAL = DIAGONAL / 2;

/**
 * Classifies a raw stroke (array of {x, y} pixel points) against the
 * template shapes. Returns { label, score } where score is in [0, 1]
 * (1.0 = perfect match). Returns { label: null, score: 0 } if the
 * stroke has too few points.
 */
function recognizeShape(rawPoints, minPoints = 10) {
  if (rawPoints.length < minPoints) return { label: null, score: 0.0 };

  const candidate = normalize(rawPoints);

  let bestLabel = null;
  let bestScore = -1.0;
  for (const [label, template] of Object.entries(TEMPLATES)) {
    const d = bestDistance(candidate, template);
    const score = Math.max(0.0, 1.0 - d / HALF_DIAGONAL);
    if (score > bestScore) {
      bestLabel = label;
      bestScore = score;
    }
  }

  return { label: bestLabel, score: bestScore };
}
