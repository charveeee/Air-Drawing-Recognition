"""
draw.py

Mid-air gesture drawing app.

Controls:
  - Point with your index finger (other fingers curled) -> DRAW mode.
    Move your fingertip through the air to trace a shape.
  - Lift your finger / stop pointing to end the current stroke. It's
    auto-recognized and snapped into a clean shape (square, circle,
    triangle, or left as a freehand line if it doesn't match well).
  - Hold up a peace sign (index + middle finger) -> toggles MOVE mode.
  - In MOVE mode, use BOTH hands: the midpoint between your two index
    fingertips controls the pan offset, and the distance between them
    controls scale (pinch both hands together/apart to zoom).
  - Hold up index + middle + ring (three fingers) -> undo the last shape.
  - Hold up an open palm (all four fingers) -> redo the last undone shape.
  - Make an OK sign (pinch thumb+index, other three fingers up) -> clear
    the whole canvas.
  - Thumbs up -> cycle the active draw color.
  - Press 'c' to clear the canvas, 'q' or ESC to quit.

  All hand gestures (other than pointing to draw) must be held for a
  brief moment to register, so accidental hand shapes while drawing
  don't misfire actions.

Run locally (needs a webcam):
    python air_draw.py

Dependencies: opencv-python, mediapipe, numpy
    pip install opencv-python mediapipe numpy
"""

import time
import cv2
import numpy as np
import mediapipe as mp

from gesture_utils import classify_gesture, fingertip_pos, INDEX_TIP
from shape_recognizer import recognize



CAM_INDEX = 0
FRAME_W, FRAME_H = 1280, 720
SHAPE_COLOR = (80, 255, 120)    
MOVE_HINT_COLOR = (255, 180, 60)
MIN_STROKE_POINTS_TO_KEEP = 8
GESTURE_HOLD_FRAMES = 5          
GESTURE_COOLDOWN = 0.6          


DRAW_COLORS = [
    (60, 220, 255),  
    (255, 120, 60),   
    (120, 60, 255),   
    (80, 255, 120),  
    (255, 255, 255),  
]


class GestureTrigger:
    """
    Debounced one-shot trigger for a held gesture: fires its action
    exactly once when the gesture has been held for `hold_frames`
    consecutive frames, then won't fire again until `cooldown`
    seconds have passed (even if the gesture is still held).
    """

    def __init__(self, gesture_name, hold_frames=GESTURE_HOLD_FRAMES,
                 cooldown=GESTURE_COOLDOWN):
        self.gesture_name = gesture_name
        self.hold_frames = hold_frames
        self.cooldown = cooldown
        self._count = 0
        self._last_fired = 0.0

    def update(self, present_gestures):
        """Call once per frame with the set of gestures seen this frame.
        Returns True exactly on the frame the action should fire."""
        if self.gesture_name in present_gestures:
            self._count += 1
        else:
            self._count = 0

        now = time.time()
        if (
            self._count == self.hold_frames
            and now - self._last_fired > self.cooldown
        ):
            self._last_fired = now
            return True
        return False


class Stroke:
    """A single committed shape on the canvas: either a recognized
    template shape or a raw freehand polyline, plus its own pan/scale
    state so MOVE mode can transform it independently of the canvas."""

    def __init__(self, points, label, color=DRAW_COLORS[0]):
        self.raw_points = points          
        self.label = label                
        self.color = color
        self.offset = np.array([0.0, 0.0])
        self.scale = 1.0

    def transformed_points(self):
        pts = np.array(self.raw_points, dtype=np.float64)
        centroid = pts.mean(axis=0)
        pts = (pts - centroid) * self.scale + centroid + self.offset
        return pts.astype(int)


def snap_to_shape(points):
    """Given a raw traced stroke, try to recognize it as a clean shape.
    Falls back to the freehand points if recognition isn't confident."""
    label, score = recognize(points)
    if label and score > 0.75 and label != "line":
        return build_clean_shape(points, label), label
    return points, "freehand"


def build_clean_shape(points, label):
    pts = np.array(points, dtype=np.float64)
    min_xy, max_xy = pts.min(axis=0), pts.max(axis=0)
    cx, cy = (min_xy + max_xy) / 2
    w, h = max_xy - min_xy
    r = max(w, h) / 2

    if label == "square":
        return [
            (cx - r, cy - r), (cx + r, cy - r),
            (cx + r, cy + r), (cx - r, cy + r), (cx - r, cy - r),
        ]
    if label == "circle":
        return [
            (cx + r * np.cos(a), cy + r * np.sin(a))
            for a in np.linspace(0, 2 * np.pi, 40)
        ]
    if label == "triangle":
        return [
            (cx, cy - r), (cx - r, cy + r), (cx + r, cy + r), (cx, cy - r),
        ]
    return points


def main():
    mp_hands = mp.solutions.hands
    hands = mp_hands.Hands(
        max_num_hands=2,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.6,
    )

    cap = cv2.VideoCapture(CAM_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)

    strokes = []           
    undone_strokes = []     
    active_points = []     
    mode = "draw"          
    was_drawing = False
    color_index = 0


    move_anchor = None    
    move_reference = {}     

    mode_toggle_trigger = GestureTrigger("peace")
    undo_trigger = GestureTrigger("three_up")
    redo_trigger = GestureTrigger("open_palm")
    clear_trigger = GestureTrigger("ok_sign")
    color_trigger = GestureTrigger("thumbs_up")

    print(
        "air_draw running.\n"
        "  point            -> draw\n"
        "  peace sign       -> toggle move mode\n"
        "  three fingers up -> undo last shape\n"
        "  open palm        -> redo last undone shape\n"
        "  OK sign          -> clear canvas\n"
        "  thumbs up        -> cycle color\n"
        "  'c' clear, 'q' quit"
    )

    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)  
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands.process(rgb)

        canvas = frame.copy()

        hands_info = []
        if result.multi_hand_landmarks:
            for lm_set, handedness in zip(
                result.multi_hand_landmarks, result.multi_handedness
            ):
                label = handedness.classification[0].label
                gesture = classify_gesture(lm_set.landmark, label)
                hands_info.append((lm_set.landmark, label, gesture))

        present_gestures = {g for _, _, g in hands_info}

        if mode_toggle_trigger.update(present_gestures):
            mode = "move" if mode == "draw" else "draw"
            move_anchor = None
            if active_points: 
                active_points = []

        if undo_trigger.update(present_gestures) and strokes:
            undone_strokes.append(strokes.pop())

        if redo_trigger.update(present_gestures) and undone_strokes:
            strokes.append(undone_strokes.pop())

        if clear_trigger.update(present_gestures):
            strokes = []
            undone_strokes = []
            active_points = []

        if color_trigger.update(present_gestures):
            color_index = (color_index + 1) % len(DRAW_COLORS)

       
        if mode == "draw":
            drawing_hand = next(
                ((lm, hl) for lm, hl, g in hands_info if g == "draw"), None
            )
            if drawing_hand:
                lm, hl = drawing_hand
                pos = fingertip_pos(lm, FRAME_W, FRAME_H, INDEX_TIP)
                active_points.append(pos)
                was_drawing = True
            else:
                if was_drawing and len(active_points) >= MIN_STROKE_POINTS_TO_KEEP:
                    clean_points, label = snap_to_shape(active_points)
                    strokes.append(Stroke(clean_points, label, DRAW_COLORS[color_index]))
                    undone_strokes = [] 
                active_points = []
                was_drawing = False

  
        else:
            index_tips = [
                fingertip_pos(lm, FRAME_W, FRAME_H, INDEX_TIP)
                for lm, hl, g in hands_info
            ]
            if len(index_tips) == 2:
                p1, p2 = np.array(index_tips[0]), np.array(index_tips[1])
                midpoint = (p1 + p2) / 2
                hand_dist = np.linalg.norm(p1 - p2)

                if move_anchor is None:
                    move_anchor = (midpoint, hand_dist)
                    move_reference = {
                        id(s): (s.offset.copy(), s.scale) for s in strokes
                    }
                else:
                    anchor_mid, anchor_dist = move_anchor
                    pan = midpoint - anchor_mid
                    zoom = hand_dist / anchor_dist if anchor_dist > 1e-6 else 1.0
                    for s in strokes:
                        base_offset, base_scale = move_reference.get(
                            id(s), (np.array([0.0, 0.0]), 1.0)
                        )
                        s.offset = base_offset + pan
                        s.scale = max(0.2, min(4.0, base_scale * zoom))
            else:
                move_anchor = None  


        for s in strokes:
            pts = s.transformed_points()
            closed = s.label in ("square", "circle", "triangle")
            cv2.polylines(canvas, [pts], isClosed=closed, color=s.color, thickness=3)

        if len(active_points) > 1:
            cv2.polylines(
                canvas, [np.array(active_points)], isClosed=False,
                color=DRAW_COLORS[color_index], thickness=3,
            )

        for lm, hl, g in hands_info:
            pos = fingertip_pos(lm, FRAME_W, FRAME_H, INDEX_TIP)
            cv2.circle(canvas, pos, 8, (255, 255, 255), 2)

        mode_color = DRAW_COLORS[color_index] if mode == "draw" else MOVE_HINT_COLOR
        cv2.putText(
            canvas, f"MODE: {mode.upper()}", (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX, 1.0, mode_color, 2,
        )

        cv2.rectangle(canvas, (20, 55), (55, 90), DRAW_COLORS[color_index], -1)
        cv2.rectangle(canvas, (20, 55), (55, 90), SHAPE_COLOR, 2)
        cv2.putText(
            canvas,
            "point=draw  peace=move  3-up=undo  palm=redo  OK=clear  thumb=color  "
            "'c'=clear  'q'=quit",
            (20, FRAME_H - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1,
        )

        cv2.imshow("air_draw", canvas)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        if key == ord("c"):
            strokes = []
            active_points = []

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
