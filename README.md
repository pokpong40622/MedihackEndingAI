# medihackendingAI

Closing "switch" for MediHack 2026. Grab the knob with a hand gesture and slide it into the circle. While sliding, the logo opens from the center like curtains. At the end the screen flickers, switches off like an old TV, and goes black.

## Website (main way to run)
The website is in `docs/`. It runs in Chrome on any computer (Windows or Mac) with no install.

| Link | Gesture |
|---|---|
| `.../?v=1` | Open hand on the knob → **fist** to grab → slide with fist. Open hand = let go. |
| `.../` (default) | Keep a **fist** → on the knob **open your hand** to grab → slide open. Fist = let go. |

Keys: **F** or double-click = fullscreen, **R** = reset, **S** = jump to the ending (backup), **D** = debug info.
First time: Chrome asks for camera permission → Allow.

### Put it on GitHub Pages
1. Create an empty repo on github.com (e.g. `medihackendingAI`).
2. In this folder:
   ```
   git add .
   git commit -m "MediHack ending"
   git branch -M main
   git remote add origin https://github.com/<you>/medihackendingAI.git
   git push -u origin main
   ```
3. Repo → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder **`/docs`** → Save.
4. After ~1 minute open `https://<you>.github.io/medihackendingAI/` (add `?v=1` for version 1).

### Edit
Top of `docs/app.js` (`EDIT HERE`): fist sensitivity, logo size/position, flicker timing. Logo image: `docs/logo.png`.
The MediaPipe library (`docs/vendor/`, `@mediapipe/tasks-vision@0.10.14`) and the hand model are inside the folder, so nothing loads from other sites.

## Python version (offline backup)
Same behaviour in a desktop window. Needs Python 3.12+ and, once: `pip install -r requirements.txt`.
- Windows: double-click `run_v1.bat` / `run_v2.bat`.
- Mac: run `chmod +x run_v1.command run_v2.command` once in Terminal, then double-click them. Allow camera for Terminal when asked.

Code: `v1/`, `v2/` (`main.py`, `hud.py`, `logo.png`), model in `models/`. Keys: Q/Esc quit, R, S, F, D.
- Wrong camera: change `CAMERA_INDEX` in `main.py` (0, 1, 2…).
- Fist hard to detect: raise `FIST_RATIO` (e.g. 1.25). Open hand counts as fist: lower it (e.g. 1.05).

Only run one version (web or Python) at a time — they share the camera.
