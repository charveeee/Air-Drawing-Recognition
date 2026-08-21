/**
 * gesture.js
 *
 * Classifies hand poses from MediaPipe Hands landmarks into named
 * gestures, mirroring the logic in the Python gesture_utils.py.
 *
 * IMPORTANT: this assumes the image fed into MediaPipe has already
 * been mirrored (see draw.js, which draws the camera feed onto a
 * flipped offscreen canvas before calling hands.send). With a
 * mirrored input, MediaPipe's handedness label directly matches the
 * hand the user intuitively expects ("Right" = their right hand),
 * exactly like Python's `cv2.flip(frame, 1)` before processing.
 * If you ever feed MediaPipe an unflipped frame, you must swap the
 * handedness label AND flip the thumb-direction test below, or the
 * thumb-based gestures (thumbs_up) will only work for one hand.
 *
 * MediaPipe hand landmark indices (for reference):
 *   0: WRIST
 *   1-4:   THUMB (CMC, MCP, IP, TIP)
 *   5-8:   INDEX (MCP, PIP, DIP, TIP)
 *   9-12:  MIDDLE (MCP, PIP, DIP, TIP)
 *   13-16: RING (MCP, PIP, DIP, TIP)
 *   17-20: PINKY (MCP, PIP, DIP, TIP)
 */

const THUMB_TIP = 4, THUMB_IP = 3;
const INDEX_TIP = 8, INDEX_PIP = 6;
const MIDDLE_TIP = 12, MIDDLE_PIP = 10;
const RING_TIP = 16, RING_PIP = 14;
const PINKY_TIP = 20, PINKY_PIP = 18;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Returns { thumb, index, middle, ring, pinky } booleans for whether
 * each finger is extended.
 *
 * handedness: "Left" or "Right", as reported by MediaPipe on a
 * mirrored input frame (see module docstring above).
 */
function fingersUp(lm, handedness = "Right") {
  const thumb =
    handedness === "Right"
      ? lm[THUMB_TIP].x < lm[THUMB_IP].x
      : lm[THUMB_TIP].x > lm[THUMB_IP].x;

  const index = lm[INDEX_TIP].y < lm[INDEX_PIP].y - 0.02;
  const middle = lm[MIDDLE_TIP].y < lm[MIDDLE_PIP].y - 0.02;
  const ring = lm[RING_TIP].y < lm[RING_PIP].y - 0.02;
  const pinky = lm[PINKY_TIP].y < lm[PINKY_PIP].y - 0.02;

  return { thumb, index, middle, ring, pinky };
}

function thumbIndexPinch(lm, threshold = 0.055) {
  return dist(lm[THUMB_TIP], lm[INDEX_TIP]) < threshold;
}

/**
 * Classifies a single hand's pose into one of a small set of named
 * gestures. Returns one of:
 *   "draw", "peace", "three_up", "open_palm", "ok_sign",
 *   "thumbs_up", "rock_on", "fist", "unknown"
 */
function classifyGesture(lm, handedness = "Right") {
  const { thumb, index, middle, ring, pinky } = fingersUp(lm, handedness);

  // OK sign checked first: thumb+index pinched, other three up.
  if (middle && ring && pinky && thumbIndexPinch(lm)) return "ok_sign";

  if (index && !middle && !ring && !pinky) return "draw";
  if (index && middle && !ring && !pinky) return "peace";
  if (index && middle && ring && !pinky) return "three_up";
  if (index && middle && ring && pinky) return "open_palm";
  if (thumb && !index && !middle && !ring && !pinky) return "thumbs_up";
  if (index && pinky && !middle && !ring) return "rock_on";
  if (!thumb && !index && !middle && !ring && !pinky) return "fist";

  return "unknown";
}


function landmarkPos(lm, frameW, frameH, index = INDEX_TIP) {
  return { x: lm[index].x * frameW, y: lm[index].y * frameH };
}
