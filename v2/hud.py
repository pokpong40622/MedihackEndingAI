"""Drawing: plain switch bar, curtain logo reveal, flicker / TV power-off ending."""
import os

import cv2
import numpy as np

LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logo.png")
LOGO_WIDTH = 0.75  # logo width as a fraction of the screen width
LOGO_Y = 0.4      # logo center height as a fraction of the screen height
CURTAIN_SOFT = 40  # px of soft edge on the curtain opening
# Colors (BGR)
WHITE = (255, 255, 255)
GRAY = (150, 150, 150)
DARK = (30, 30, 30)
ACCENT = (230, 200, 40)
GREEN = (90, 200, 90)
FONT = cv2.FONT_HERSHEY_SIMPLEX
AA = cv2.LINE_AA

# Ending flicker: (seconds, brightness). 0 = black, 1 = normal, >1 = flash.
# After the flicker comes the TV power-off, then black forever.
SCREEN_FLICKER = [(0.06, 1.6), (0.07, 0.15), (0.10, 1.2), (0.05, 0.0), (0.14, 1.0), (0.06, 0.1),
                  (0.08, 0.8), (0.18, 0.0), (0.12, 1.0)]

# TV power-off timing (seconds)
TV_SQUEEZE = 0.18  # picture squeezes into a horizontal line
TV_LINE = 0.20     # line shrinks into a dot
TV_DOT = 0.40      # dot fades out


def pill(img, x0, x1, y, hr, color, thick=-1):
    """Rounded bar from x0 to x1 (centers of the round ends), half-height hr."""
    x0, x1, y, hr = int(x0), int(x1), int(y), int(hr)
    if thick < 0:
        cv2.rectangle(img, (x0, y - hr), (x1, y + hr), color, -1)
        cv2.circle(img, (x0, y), hr, color, -1, AA)
        cv2.circle(img, (x1, y), hr, color, -1, AA)
    else:
        cv2.line(img, (x0, y - hr), (x1, y - hr), color, thick, AA)
        cv2.line(img, (x0, y + hr), (x1, y + hr), color, thick, AA)
        cv2.ellipse(img, (x0, y), (hr, hr), 0, 90, 270, color, thick, AA)
        cv2.ellipse(img, (x1, y), (hr, hr), 0, -90, 90, color, thick, AA)


def draw_switch(img, s, L):
    y, r = L["y"], L["r"]
    done = s.mode == "SUCCESS"
    fill = GREEN if done else ACCENT

    pill(img, L["start"], L["end"], y, L["bar_r"], DARK)
    pill(img, L["start"], s.ball_x, y, L["bar_r"], fill)
    pill(img, L["start"], L["end"], y, L["bar_r"], GRAY, 2)
    cv2.circle(img, (L["end"], y), L["target_r"], WHITE, 2, AA)

    kr = int(r * s.ball_scale)
    cv2.circle(img, (int(s.ball_x), y), kr, WHITE, -1, AA)
    cv2.circle(img, (int(s.ball_x), y), kr, fill, 2, AA)


_logo_cache = {}


def load_logo(target_w):
    """Logo resized to target_w as (color float32, alpha 0..1). Cached per size."""
    if target_w not in _logo_cache:
        im = cv2.imread(LOGO_PATH, cv2.IMREAD_UNCHANGED)
        if im is None:
            raise FileNotFoundError(f"Logo not found: {LOGO_PATH}")
        th = int(im.shape[0] * target_w / im.shape[1])
        im = cv2.resize(im, (target_w, th), interpolation=cv2.INTER_AREA)
        _logo_cache[target_w] = (im[:, :, :3].astype(np.float32), im[:, :, 3:4].astype(np.float32) / 255)
    return _logo_cache[target_w]


def draw_logo_curtain(img, progress):
    """Logo opens from the center outward like curtains. progress 0 = closed, 1 = fully open."""
    if progress <= 0:
        return
    h, w = img.shape[:2]
    color, alpha = load_logo(int(w * LOGO_WIDTH))
    lh, lw = color.shape[:2]
    x0, y0 = (w - lw) // 2, int(h * LOGO_Y - lh / 2)

    # Curtain mask per column: 1 inside the opening, soft fade at its edges.
    half_open = progress * (lw / 2 + CURTAIN_SOFT)
    dist = np.abs(np.arange(lw) - lw / 2)
    mask = np.clip((half_open - dist) / CURTAIN_SOFT, 0, 1).astype(np.float32)
    a = alpha * mask[None, :, None]

    roi = img[y0:y0 + lh, x0:x0 + lw].astype(np.float32)
    img[y0:y0 + lh, x0:x0 + lw] = (color * a + roi * (1 - a)).astype(np.uint8)


def draw_hand(img, s, connections):
    if s.points:
        for a, b in connections:
            pa, pb = s.points[a], s.points[b]
            cv2.line(img, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), WHITE, 1, AA)
        for p in s.points:
            cv2.circle(img, (int(p[0]), int(p[1])), 3, WHITE, -1, AA)
    if s.cursor:
        c = (int(s.cursor[0]), int(s.cursor[1]))
        if s.mode == "GRABBED":  # filled dot = holding the knob
            cv2.circle(img, c, 12, ACCENT, -1, AA)
        else:
            cv2.circle(img, c, 16, WHITE, 2, AA)


def draw_status(img, s, debug):
    status = "Hand detected" if s.cursor else "No hand"
    if debug:
        status += f" | curled {s.curled}/4 fist {s.fist} mode {s.mode}"
    cv2.circle(img, (20, 22), 6, GREEN if s.cursor else (80, 80, 220), -1, AA)
    cv2.putText(img, status, (34, 28), FONT, 0.55, WHITE, 1, AA)


class Ending:
    """Screen flickers, then switches off like an old TV, then stays black."""

    def __init__(self, now):
        self.t0 = now

    def render(self, frame, now):
        h, w = frame.shape[:2]
        t = now - self.t0

        # 1. Flicker
        for dur, level in SCREEN_FLICKER:
            if t < dur:
                return cv2.convertScaleAbs(frame, alpha=level)
            t -= dur

        out = np.zeros_like(frame)
        cy, cx = h // 2, w // 2

        # 2. Picture squeezes vertically into a bright line
        if t < TV_SQUEEZE:
            k = (t / TV_SQUEEZE) ** 2  # speeds up, like a real CRT
            hh = max(2, int(h * (1 - k)))
            squeezed = cv2.resize(frame, (w, hh), interpolation=cv2.INTER_AREA)
            squeezed = cv2.convertScaleAbs(squeezed, alpha=1 + k * 2, beta=k * 120)  # gets brighter
            out[cy - hh // 2:cy - hh // 2 + hh] = squeezed
            return out
        t -= TV_SQUEEZE

        # 3. Line shrinks into a dot
        if t < TV_LINE:
            k = t / TV_LINE
            half = max(3, int(w / 2 * (1 - k) ** 2))
            cv2.line(out, (cx - half, cy), (cx + half, cy), WHITE, 3, AA)
            return out
        t -= TV_LINE

        # 4. Dot fades out
        if t < TV_DOT:
            k = 1 - t / TV_DOT
            cv2.circle(out, (cx, cy), 4, tuple(int(255 * k) for _ in range(3)), -1, AA)
        return out
