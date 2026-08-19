"""
gesture.py

Utility functions for classifying hand gestures from MediaPipe Hands
landmarks. No ML here on purpose -- just geometric rules on the 21
landmark points, which is fast, robust, and easy to tune.

MediaPipe hand landmark indices (for reference):
    0: WRIST
    1-4:   THUMB (CMC, MCP, IP, TIP)
    5-8:   INDEX (MCP, PIP, DIP, TIP)
    9-12:  MIDDLE (MCP, PIP, DIP, TIP)
    13-16: RING (MCP, PIP, DIP, TIP)
    17-20: PINKY (MCP, PIP, DIP, TIP)
"""

import math


WRIST = 0
THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP = 1, 2, 3, 4
INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP = 5, 6, 7, 8
MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP = 9, 10, 11, 12
RING_MCP, RING_PIP, RING_DIP, RING_TIP = 13, 14, 15, 16
PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP = 17, 18, 19, 20

FINGER_TIPS = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]
FINGER_PIPS = [INDEX_PIP, MIDDLE_PIP, RING_PIP, PINKY_PIP]


def _dist(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)


def fingers_up(landmarks, handedness_label="Right"):
    """
    Returns a list of 5 booleans [thumb, index, middle, ring, pinky]
    indicating whether each finger is extended.

    landmarks: the .landmark list from a MediaPipe HandLandmark result
               (normalized image coords, y grows downward).
    handedness_label: "Left" or "Right" as reported by MediaPipe
                       (note: MediaPipe mirrors this relative to the
                       *camera's* view, so a hand the user sees as
                       their right hand is often labeled "Left" if
                       the feed isn't flipped -- flip your frame with
                       cv2.flip(frame, 1) upstream and this lines up
                       with intuition).
    """
    result = []

    if handedness_label == "Right":
        result.append(landmarks[THUMB_TIP].x < landmarks[THUMB_IP].x)
    else:
        result.append(landmarks[THUMB_TIP].x > landmarks[THUMB_IP].x)

    for tip, pip in zip(FINGER_TIPS, FINGER_PIPS):
        result.append(landmarks[tip].y < landmarks[pip].y - 0.02)

    return result  


def _thumb_index_pinch(landmarks, pinch_threshold=0.055):
    """True if thumb tip and index tip are close together (a 'pinch'/OK sign)."""
    return _dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) < pinch_threshold


def classify_gesture(landmarks, handedness_label="Right"):
    """
    Classifies a single hand's pose into one of a small set of named
    gestures based on which fingers are extended.

    Returns one of: "draw", "peace", "ok_sign", "three_up", "open_palm",
    "thumbs_up", "fist", "unknown"
    """
    thumb, index, middle, ring, pinky = fingers_up(landmarks, handedness_label)

  
    if middle and ring and pinky and _thumb_index_pinch(landmarks):
        return "ok_sign"  

    if index and not middle and not ring and not pinky:
        return "draw"  

    if index and middle and not ring and not pinky:
        return "peace"  

    if index and middle and ring and not pinky:
        return "three_up"  

    if index and middle and ring and pinky:
        return "open_palm"  

    if thumb and not index and not middle and not ring and not pinky:
        return "thumbs_up"  

    if not thumb and not index and not middle and not ring and not pinky:
        return "fist"  

    return "unknown"


def fingertip_pos(landmarks, frame_w, frame_h, tip=INDEX_TIP):
    """Pixel-space (x, y) position of a given fingertip landmark."""
    lm = landmarks[tip]
    return int(lm.x * frame_w), int(lm.y * frame_h)


def hand_center(landmarks, frame_w, frame_h):
    """Pixel-space centroid of the whole hand (average of all landmarks)."""
    xs = [lm.x for lm in landmarks]
    ys = [lm.y for lm in landmarks]
    cx = sum(xs) / len(xs) * frame_w
    cy = sum(ys) / len(ys) * frame_h
    return int(cx), int(cy)
