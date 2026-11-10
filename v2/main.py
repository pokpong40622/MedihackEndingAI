"""MediHack ending switch.

v2 = reversed gesture: keep a fist (กำ) normally. Put the fist on the knob,
OPEN your hand (แบมือ) to grab it, slide it right into the circle with the
hand open. Close back to a fist to let go. Then the screen flickers out
to black. Drawing lives in hud.py.

Keys: Q/Esc quit, R reset, S force success, F fullscreen, D debug.
"""
import math
import os
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

import hud

# ============ EDIT HERE ============
CAMERA_INDEX = 0

FIST_RATIO = 1.15     # finger is "curled" if tip-wrist < FIST_RATIO * knuckle-wrist
FINGERS_FOR_FIST = 3  # how many of 4 fingers must be curled
STABLE_FRAMES = 3     # fist must stay the same this many frames (stops flicker)
LOST_HAND_SEC = 0.3   # hand missing longer than this = let go
SMOOTHING = 0.45      # 0..1, higher = cursor follows faster but jitters more
# ===================================

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models", "hand_landmarker.task")
WINDOW = "MediHack Ending"

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),        # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),        # index
    (5, 9), (9, 10), (10, 11), (11, 12),   # middle
    (9, 13), (13, 14), (14, 15), (15, 16), # ring
    (13, 17), (17, 18), (18, 19), (19, 20),# pinky
    (0, 17),
]
FINGERS = [(8, 5), (12, 9), (16, 13), (20, 17)]  # (tip, knuckle)


def dist3(a, b):
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def count_curled(world):
    """Uses 3D world landmarks (meters) so it works at any distance."""
    wrist = world[0]
    return sum(
        1 for tip, mcp in FINGERS
        if dist3(world[tip], wrist) < FIST_RATIO * dist3(world[mcp], wrist)
    )


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def layout(w, h):
    r = max(20, int(min(w, h) * 0.045))
    return {"r": r, "y": int(h * 0.82), "start": int(w * 0.27), "end": int(w * 0.73),
            "bar_r": int(r * 1.35),     # half height of the switch bar
            "target_r": int(r * 1.15)}  # ring at the end, fits inside the bar


class Switch:
    def __init__(self):
        self.reset()
        self.cursor = None
        self.points = None
        self.last_hand = -1e9
        self.fist = False
        self.fist_pending = 0
        self.curled = 0
        self.hover = False
        self.armed = False  # fist was seen on the knob -> opening now will grab
        self.debug = False

    def reset(self):
        self.mode = "IDLE"  # IDLE | GRABBED | RETURNING | SUCCESS
        self.ball_x = None
        self.ball_v = 0.0
        self.ball_scale = 1.0
        self.grab_offset = 0
        self.released_at = -1e9
        self.ending = None

    def set_fist(self, raw):
        if raw == self.fist:
            self.fist_pending = 0
            return
        self.fist_pending += 1
        if self.fist_pending >= STABLE_FRAMES:
            self.fist = raw
            self.fist_pending = 0

    def on_result(self, result, w, h, now):
        if result.hand_landmarks:
            pts = [(p.x * w, p.y * h) for p in result.hand_landmarks[0]]
            self.points = pts
            ids = [0, 5, 9, 13, 17]  # palm center
            px = sum(pts[i][0] for i in ids) / len(ids)
            py = sum(pts[i][1] for i in ids) / len(ids)
            if self.cursor is None:
                self.cursor = [px, py]
            else:
                self.cursor[0] += (px - self.cursor[0]) * SMOOTHING
                self.cursor[1] += (py - self.cursor[1]) * SMOOTHING
            self.last_hand = now
            self.curled = count_curled(result.hand_world_landmarks[0])
            self.set_fist(self.curled >= FINGERS_FOR_FIST)
        elif now - self.last_hand > LOST_HAND_SEC:
            self.points = None
            self.cursor = None
            self.fist = False
            self.fist_pending = 0

    def update(self, L, w, h, now):
        if self.ball_x is None:
            self.ball_x = L["start"]
        hand = self.cursor is not None and now - self.last_hand <= LOST_HAND_SEC
        self.hover = hand and math.hypot(self.cursor[0] - self.ball_x, self.cursor[1] - L["y"]) < L["r"] * 2.4
        open_hand = hand and not self.fist
        # Only grab on fist -> open while on the knob, so an open hand passing by won't grab.
        if not self.hover:
            self.armed = False
        elif self.fist:
            self.armed = True
        can_grab = self.hover and open_hand and self.armed

        if self.mode == "IDLE":
            self.ball_x = L["start"]
            if can_grab:
                self.grab()
        elif self.mode == "GRABBED":
            if not hand or self.fist:  # closing the hand lets go
                self.mode = "RETURNING"
                self.ball_v = 0.0
                self.released_at = now
            else:
                target = clamp(self.cursor[0] + self.grab_offset, L["start"], L["end"])
                self.ball_x += (target - self.ball_x) * 0.5
                if self.ball_x >= L["end"] - L["target_r"] * 0.35:
                    self.finish(L, w, h, now)
        elif self.mode == "RETURNING":
            # Spring back to start with a small bounce.
            self.ball_v += (L["start"] - self.ball_x) * 0.08
            self.ball_v *= 0.75
            self.ball_x += self.ball_v
            if can_grab:
                self.grab()
            elif abs(self.ball_x - L["start"]) < 0.5 and abs(self.ball_v) < 0.5:
                self.mode = "IDLE"
        elif self.mode == "SUCCESS":
            self.ball_x += (L["end"] - self.ball_x) * 0.3

        want = 0.88 if self.mode == "GRABBED" else 1.12 if self.hover else 1.0
        self.ball_scale += (want - self.ball_scale) * 0.3

    def grab(self):
        self.mode = "GRABBED"
        self.grab_offset = self.ball_x - self.cursor[0]  # no jump when grabbing off-center

    def finish(self, L, w, h, now):
        if self.mode == "SUCCESS":
            return
        self.mode = "SUCCESS"
        self.ending = hud.Ending(now)



def render(frame, s, L, now):
    h, w = frame.shape[:2]
    progress = clamp((s.ball_x - L["start"]) / (L["end"] - L["start"]), 0, 1)
    hud.draw_logo_curtain(frame, 1.0 if s.mode == "SUCCESS" else progress)
    hud.draw_switch(frame, s, L)
    if not s.ending:
        hud.draw_hand(frame, s, HAND_CONNECTIONS)
        hud.draw_status(frame, s, s.debug)
        return frame

    # Ending: flicker -> TV power-off -> black.
    return s.ending.render(frame, now)


def main():
    options = vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
        min_hand_detection_confidence=0.6,
        min_hand_presence_confidence=0.6,
        min_tracking_confidence=0.5,
    )
    landmarker = vision.HandLandmarker.create_from_options(options)

    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY  # DSHOW = faster on Windows only
    cap = cv2.VideoCapture(CAMERA_INDEX, backend)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    if not cap.isOpened():
        print(f"Could not open camera {CAMERA_INDEX}. Close other apps using it, or change CAMERA_INDEX.")
        return

    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW, 1280, 720)
    s = Switch()
    fullscreen = False
    t0 = time.monotonic()
    last_ts = -1

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera stopped sending frames.")
            break
        frame = cv2.flip(frame, 1)  # mirror like a selfie
        h, w = frame.shape[:2]
        now = time.monotonic()
        L = layout(w, h)

        if s.mode != "SUCCESS":  # no need to track hands during the ending
            ts = max(int((now - t0) * 1000), last_ts + 1)  # MediaPipe needs increasing timestamps
            last_ts = ts
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
            s.on_result(result, w, h, now)

        s.update(L, w, h, now)
        cv2.imshow(WINDOW, render(frame, s, L, now))

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("r"):
            s.reset()
        elif key == ord("s"):
            s.finish(L, w, h, now)
        elif key == ord("d"):
            s.debug = not s.debug
        elif key == ord("f"):
            fullscreen = not fullscreen
            cv2.setWindowProperty(WINDOW, cv2.WND_PROP_FULLSCREEN,
                                  cv2.WINDOW_FULLSCREEN if fullscreen else cv2.WINDOW_NORMAL)
        if cv2.getWindowProperty(WINDOW, cv2.WND_PROP_VISIBLE) < 1:
            break  # window closed with X

    cap.release()
    cv2.destroyAllWindows()
    landmarker.close()


if __name__ == "__main__":
    main()
