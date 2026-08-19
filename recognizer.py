"""
recognizer.py

A simplified implementation of the $1 Unistroke Recognizer
(Wobbrock, Wilson & Li, 2007) for classifying a traced path of
(x, y) points into a known shape: circle, square, triangle, or line.

The algorithm:
  1. Resample the stroke into a fixed number of equidistant points.
  2. Rotate so the "indicative angle" (centroid -> first point) is 0.
  3. Scale to a reference bounding box and translate to origin.
  4. Compare against a set of pre-defined template gestures using
     the average point-distance ("Golden Section Search" is used in
     the original paper to find the best rotation alignment; we use
     a simple brute-force angle sweep here for clarity).

This is intentionally dependency-free (just math) so it drops into
any pipeline that hands it a list of points.
"""

import math

NUM_RESAMPLE_POINTS = 64
SQUARE_SIZE = 250.0  # reference bounding box side length used for scaling
ANGLE_SWEEP_RANGE = math.radians(45)
ANGLE_SWEEP_STEP = math.radians(2)


def _path_length(points):
    return sum(
        math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
        for i in range(1, len(points))
    )


def _resample(points, n=NUM_RESAMPLE_POINTS):
    interval = _path_length(points) / (n - 1)
    if interval == 0:
        return [points[0]] * n

    new_points = [points[0]]
    accumulated = 0.0
    pts = list(points)

    i = 1
    while i < len(pts):
        d = math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        if accumulated + d >= interval:
            t = (interval - accumulated) / d if d != 0 else 0
            nx = pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0])
            ny = pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])
            new_point = (nx, ny)
            new_points.append(new_point)
            pts.insert(i, new_point)
            accumulated = 0.0
        else:
            accumulated += d
        i += 1

    # Pad in case of float rounding leaving us one short
    while len(new_points) < n:
        new_points.append(pts[-1])

    return new_points[:n]


def _centroid(points):
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    return cx, cy


def _rotate_to_zero(points):
    cx, cy = _centroid(points)
    theta = math.atan2(points[0][1] - cy, points[0][0] - cx)
    cos_t, sin_t = math.cos(-theta), math.sin(-theta)
    return [
        (
            (p[0] - cx) * cos_t - (p[1] - cy) * sin_t + cx,
            (p[0] - cx) * sin_t + (p[1] - cy) * cos_t + cy,
        )
        for p in points
    ]


def _scale_to_square(points, size=SQUARE_SIZE):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    w = w if w != 0 else 1e-9
    h = h if h != 0 else 1e-9
    return [((p[0] - min(xs)) * size / w, (p[1] - min(ys)) * size / h) for p in points]


def _translate_to_origin(points):
    cx, cy = _centroid(points)
    return [(p[0] - cx, p[1] - cy) for p in points]


def _rotate_by(points, angle):
    cx, cy = _centroid(points)
    cos_t, sin_t = math.cos(angle), math.sin(angle)
    return [
        (
            (p[0] - cx) * cos_t - (p[1] - cy) * sin_t + cx,
            (p[0] - cx) * sin_t + (p[1] - cy) * cos_t + cy,
        )
        for p in points
    ]


def _path_distance(a, b):
    return sum(math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) for i in range(len(a))) / len(a)


def _best_distance(candidate, template):
    """Brute-force angle sweep to find the best alignment distance."""
    best = float("inf")
    theta = -ANGLE_SWEEP_RANGE
    while theta <= ANGLE_SWEEP_RANGE:
        rotated = _rotate_by(candidate, theta)
        d = _path_distance(rotated, template)
        if d < best:
            best = d
        theta += ANGLE_SWEEP_STEP
    return best


def normalize(points):
    """Runs the full $1 normalization pipeline on a raw list of (x, y) points."""
    resampled = _resample(points)
    rotated = _rotate_to_zero(resampled)
    scaled = _scale_to_square(rotated)
    return _translate_to_origin(scaled)


def _make_template(raw_points):
    return normalize(raw_points)


# --- Reference templates, defined as simple parametric point sets ---

def _square_template():
    pts = []
    for t in range(26):
        pts.append((t / 25 * SQUARE_SIZE, 0))
    for t in range(26):
        pts.append((SQUARE_SIZE, t / 25 * SQUARE_SIZE))
    for t in range(26):
        pts.append((SQUARE_SIZE - t / 25 * SQUARE_SIZE, SQUARE_SIZE))
    for t in range(26):
        pts.append((0, SQUARE_SIZE - t / 25 * SQUARE_SIZE))
    return pts


def _circle_template():
    pts = []
    for i in range(64):
        a = 2 * math.pi * i / 63
        pts.append((SQUARE_SIZE / 2 * math.cos(a), SQUARE_SIZE / 2 * math.sin(a)))
    return pts


def _triangle_template():
    p1 = (SQUARE_SIZE / 2, 0)
    p2 = (0, SQUARE_SIZE)
    p3 = (SQUARE_SIZE, SQUARE_SIZE)
    pts = []
    for t in range(22):
        f = t / 21
        pts.append((p1[0] + f * (p2[0] - p1[0]), p1[1] + f * (p2[1] - p1[1])))
    for t in range(22):
        f = t / 21
        pts.append((p2[0] + f * (p3[0] - p2[0]), p2[1] + f * (p3[1] - p2[1])))
    for t in range(21):
        f = t / 20
        pts.append((p3[0] + f * (p1[0] - p3[0]), p3[1] + f * (p1[1] - p3[1])))
    return pts


def _line_template():
    return [(t / 63 * SQUARE_SIZE, 0) for t in range(64)]


TEMPLATES = {
    "square": _make_template(_square_template()),
    "circle": _make_template(_circle_template()),
    "triangle": _make_template(_triangle_template()),
    "line": _make_template(_line_template()),
}


_DIAGONAL = math.hypot(SQUARE_SIZE, SQUARE_SIZE)
_HALF_DIAGONAL = _DIAGONAL / 2


def recognize(raw_points, min_points=10):
    """
    Classifies a raw stroke (list of (x, y) pixel points) against the
    template shapes. Returns (best_label, score) where score is in
    [0, 1] -- 1.0 is a perfect match. Returns (None, 0.0) if the
    stroke has too few points to be meaningful.
    """
    if len(raw_points) < min_points:
        return None, 0.0

    candidate = normalize(raw_points)

    best_label, best_score = None, -1.0
    for label, template in TEMPLATES.items():
        d = _best_distance(candidate, template)
        score = max(0.0, 1.0 - d / _HALF_DIAGONAL)
        if score > best_score:
            best_label, best_score = label, score

    return best_label, best_score
