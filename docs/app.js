// MediHack ending switch (web version).
// v1 (?v=1):         open hand on the knob -> FIST to grab -> slide with fist. Open hand = let go.
// v2 (default):       keep a fist -> on the knob OPEN hand to grab -> slide open. Fist = let go.
// While sliding, the logo opens from the center like curtains.
// At the end: screen flickers -> old-TV power-off -> black.
// Keys: F fullscreen (or double-click), R reset, S jump to ending, D debug.
import { FilesetResolver, HandLandmarker } from "./vendor/vision_bundle.mjs";

const params = new URLSearchParams(location.search);
const VERSION = params.get("v") === "1" ? 1 : 2; // default = v2

// ============ EDIT HERE ============
const FIST_RATIO = 1.15;     // finger is "curled" if tip-wrist < FIST_RATIO * knuckle-wrist
const FINGERS_FOR_FIST = 3;  // how many of 4 fingers must be curled
const STABLE_FRAMES = 3;     // fist must stay the same this many frames (stops flicker)
const LOST_HAND_MS = 300;    // hand missing longer than this = let go
const SMOOTHING = 0.45;      // 0..1, higher = cursor follows faster but jitters more

const LOGO_WIDTH = 0.75;     // logo width as a fraction of the screen width
const LOGO_Y = 0.4;          // logo center height as a fraction of the screen height
const CURTAIN_SOFT = 40;     // px of soft edge on the curtain opening

// Ending flicker: [seconds, brightness]. 0 = black, 1 = normal, >1 = flash.
const SCREEN_FLICKER = [[0.06, 1.6], [0.07, 0.15], [0.10, 1.2], [0.05, 0.0], [0.14, 1.0], [0.06, 0.1],
                        [0.08, 0.8], [0.18, 0.0], [0.12, 1.0]];
const TV_SQUEEZE = 0.18;     // picture squeezes into a horizontal line
const TV_LINE = 0.20;        // line shrinks into a dot
const TV_DOT = 0.40;         // dot fades out
// ===================================

const WHITE = "#ffffff", GRAY = "rgb(150,150,150)", DARK = "rgb(30,30,30)";
const ACCENT = "rgb(40,200,230)", GREEN = "rgb(90,200,90)", RED = "rgb(220,80,80)";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const FINGERS = [[8, 5], [12, 9], [16, 13], [20, 17]]; // [tip, knuckle]

const video = document.getElementById("video");
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("msg");

// Everything is drawn on "scene" first, so the ending can flicker / squeeze it.
const scene = document.createElement("canvas");
const sctx = scene.getContext("2d");
const logoCanvas = document.createElement("canvas");
const lctx = logoCanvas.getContext("2d");

const logo = new Image();
logo.src = "logo.png";

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [canvas, scene]) {
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
  }
}
window.addEventListener("resize", resize);
resize();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function layout() {
  const r = Math.max(20, Math.min(W, H) * 0.045);
  return { r, y: H * 0.82, start: W * 0.27, end: W * 0.73, barR: r * 1.35, targetR: r * 1.15 };
}

// ---------- State ----------
const S = {
  mode: "IDLE", // IDLE | GRABBED | RETURNING | SUCCESS
  ballX: null, ballV: 0, ballScale: 1, grabOffset: 0,
  cursor: null, points: null, lastHand: -1e9,
  fist: false, fistPending: 0, curled: 0,
  hover: false, armed: false, successAt: 0, debug: false,
};
if (params.has("test")) window.S = S; // for testing only

function reset() {
  S.mode = "IDLE";
  S.ballX = null;
  S.ballV = 0;
  S.ballScale = 1;
}

// ---------- Hand ----------
function coverRect() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(W / vw, H / vh);
  return { x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s };
}

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function countCurled(world) {
  // 3D world landmarks (meters) -> works at any distance from the camera
  const wrist = world[0];
  return FINGERS.filter(([tip, mcp]) => dist3(world[tip], wrist) < FIST_RATIO * dist3(world[mcp], wrist)).length;
}

function setFist(raw) {
  if (raw === S.fist) { S.fistPending = 0; return; }
  if (++S.fistPending >= STABLE_FRAMES) { S.fist = raw; S.fistPending = 0; }
}

function onResult(res, now) {
  if (res.landmarks && res.landmarks.length) {
    const rect = coverRect();
    // Mirror x so it feels like a selfie
    const pts = res.landmarks[0].map((p) => ({ x: W - (rect.x + p.x * rect.w), y: rect.y + p.y * rect.h }));
    S.points = pts;
    const ids = [0, 5, 9, 13, 17]; // palm center
    const px = ids.reduce((a, i) => a + pts[i].x, 0) / ids.length;
    const py = ids.reduce((a, i) => a + pts[i].y, 0) / ids.length;
    if (!S.cursor) S.cursor = { x: px, y: py };
    else {
      S.cursor.x += (px - S.cursor.x) * SMOOTHING;
      S.cursor.y += (py - S.cursor.y) * SMOOTHING;
    }
    S.lastHand = now;
    S.curled = countCurled(res.worldLandmarks[0]);
    setFist(S.curled >= FINGERS_FOR_FIST);
  } else if (now - S.lastHand > LOST_HAND_MS) {
    S.points = null;
    S.cursor = null;
    S.fist = false;
    S.fistPending = 0;
  }
}

// ---------- Logic ----------
function update(L, now, dt) {
  const f = dt / 33.3; // 1.0 at 30 fps (same feel as the Python version)
  if (S.ballX === null) S.ballX = L.start;
  const hand = !!S.cursor && now - S.lastHand <= LOST_HAND_MS;
  S.hover = hand && Math.hypot(S.cursor.x - S.ballX, S.cursor.y - L.y) < L.r * 2.4;

  let canGrab, letGo;
  if (VERSION === 1) {
    canGrab = S.hover && S.fist;
    letGo = !hand || !S.fist;
  } else {
    // Only grab on fist -> open while on the knob, so an open hand passing by won't grab.
    if (!S.hover) S.armed = false;
    else if (S.fist) S.armed = true;
    canGrab = S.hover && hand && !S.fist && S.armed;
    letGo = !hand || S.fist;
  }

  if (S.mode === "IDLE") {
    S.ballX = L.start;
    if (canGrab) grab();
  } else if (S.mode === "GRABBED") {
    if (letGo) {
      S.mode = "RETURNING";
      S.ballV = 0;
    } else {
      const target = clamp(S.cursor.x + S.grabOffset, L.start, L.end);
      S.ballX += (target - S.ballX) * (1 - Math.pow(0.5, f));
      if (S.ballX >= L.end - L.targetR * 0.35) finish(now);
    }
  } else if (S.mode === "RETURNING") {
    // Spring back to start with a small bounce
    S.ballV += (L.start - S.ballX) * 0.08 * f;
    S.ballV *= Math.pow(0.75, f);
    S.ballX += S.ballV * f;
    if (canGrab) grab();
    else if (Math.abs(S.ballX - L.start) < 0.5 && Math.abs(S.ballV) < 0.5) S.mode = "IDLE";
  } else if (S.mode === "SUCCESS") {
    S.ballX += (L.end - S.ballX) * (1 - Math.pow(0.7, f));
  }

  const want = S.mode === "GRABBED" ? 0.88 : S.hover ? 1.12 : 1;
  S.ballScale += (want - S.ballScale) * (1 - Math.pow(0.7, f));
}

function grab() {
  S.mode = "GRABBED";
  S.grabOffset = S.ballX - S.cursor.x; // no jump when grabbing off-center
}

function finish(now) {
  if (S.mode === "SUCCESS") return;
  S.mode = "SUCCESS";
  S.successAt = now;
}

// ---------- Drawing ----------
function pill(c, x0, x1, y, hr) {
  x1 = Math.max(x0, x1);
  c.beginPath();
  c.moveTo(x0, y - hr);
  c.lineTo(x1, y - hr);
  c.arc(x1, y, hr, -Math.PI / 2, Math.PI / 2);
  c.lineTo(x0, y + hr);
  c.arc(x0, y, hr, Math.PI / 2, Math.PI * 1.5);
  c.closePath();
}

function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
}

function drawVideo(c) {
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  if (video.readyState < 2) return;
  const r = coverRect();
  c.save();
  c.translate(W, 0);
  c.scale(-1, 1); // mirror
  c.drawImage(video, r.x, r.y, r.w, r.h);
  c.restore();
}

function drawLogoCurtain(c, progress) {
  if (progress <= 0 || !logo.complete || !logo.naturalWidth) return;
  const lw = W * LOGO_WIDTH, lh = lw * logo.naturalHeight / logo.naturalWidth;
  const pw = Math.ceil(lw * DPR), ph = Math.ceil(lh * DPR);
  if (logoCanvas.width !== pw || logoCanvas.height !== ph) {
    logoCanvas.width = pw;
    logoCanvas.height = ph;
  }
  // Logo, then cut it with a soft-edged opening that grows from the center
  lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, pw, ph);
  lctx.drawImage(logo, 0, 0, pw, ph);
  const half = progress * (lw / 2 + CURTAIN_SOFT) * DPR;
  const mid = pw / 2;
  const soft = Math.min(0.5, (CURTAIN_SOFT * DPR) / (2 * half));
  const g = lctx.createLinearGradient(mid - half, 0, mid + half, 0);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(soft, "rgba(0,0,0,1)");
  g.addColorStop(1 - soft, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  lctx.globalCompositeOperation = "destination-in";
  lctx.fillStyle = g;
  lctx.fillRect(0, 0, pw, ph);
  lctx.globalCompositeOperation = "source-over";

  c.drawImage(logoCanvas, (W - lw) / 2, H * LOGO_Y - lh / 2, lw, lh);
}

function drawSwitch(c, L) {
  const done = S.mode === "SUCCESS";
  const fill = done ? GREEN : ACCENT;
  pill(c, L.start, L.end, L.y, L.barR);
  c.fillStyle = DARK;
  c.fill();
  pill(c, L.start, S.ballX, L.y, L.barR);
  c.fillStyle = fill;
  c.fill();
  pill(c, L.start, L.end, L.y, L.barR);
  c.strokeStyle = GRAY;
  c.lineWidth = 2;
  c.stroke();

  circle(c, L.end, L.y, L.targetR);
  c.strokeStyle = WHITE;
  c.stroke();

  const kr = L.r * S.ballScale;
  circle(c, S.ballX, L.y, kr);
  c.fillStyle = WHITE;
  c.fill();
  c.strokeStyle = fill;
  c.stroke();
}

function drawHand(c) {
  if (S.points) {
    c.strokeStyle = WHITE;
    c.lineWidth = 1;
    c.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      c.moveTo(S.points[a].x, S.points[a].y);
      c.lineTo(S.points[b].x, S.points[b].y);
    }
    c.stroke();
    c.fillStyle = WHITE;
    for (const p of S.points) {
      circle(c, p.x, p.y, 3);
      c.fill();
    }
  }
  if (S.cursor) {
    const holding = VERSION === 1 ? S.fist : S.mode === "GRABBED";
    if (holding) {
      circle(c, S.cursor.x, S.cursor.y, 12);
      c.fillStyle = ACCENT;
      c.fill();
    } else {
      circle(c, S.cursor.x, S.cursor.y, 16);
      c.strokeStyle = WHITE;
      c.lineWidth = 2;
      c.stroke();
    }
  }
}

function drawStatus(c) {
  let text = S.cursor ? "Hand detected" : "No hand";
  if (S.debug) text += ` | v${VERSION} curled ${S.curled}/4 fist ${S.fist} mode ${S.mode}`;
  circle(c, 20, 22, 6);
  c.fillStyle = S.cursor ? GREEN : RED;
  c.fill();
  c.fillStyle = WHITE;
  c.font = "14px system-ui, sans-serif";
  c.textBaseline = "middle";
  c.fillText(text, 34, 23);
}

function drawScene(L) {
  sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawVideo(sctx);
  const progress = clamp((S.ballX - L.start) / (L.end - L.start), 0, 1);
  drawLogoCurtain(sctx, S.mode === "SUCCESS" ? 1 : progress);
  drawSwitch(sctx, L);
  if (S.mode !== "SUCCESS") {
    drawHand(sctx);
    drawStatus(sctx);
  }
}

// Main canvas: scene as-is, or the ending effect (in device pixels).
function present(now) {
  const pw = canvas.width, ph = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, pw, ph);
  if (S.mode !== "SUCCESS") {
    ctx.drawImage(scene, 0, 0);
    return;
  }

  let t = (now - S.successAt) / 1000;

  // 1. Flicker
  for (const [dur, level] of SCREEN_FLICKER) {
    if (t < dur) {
      ctx.drawImage(scene, 0, 0);
      if (level < 1) ctx.fillStyle = `rgba(0,0,0,${1 - level})`;
      else ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, (level - 1) * 0.6)})`;
      ctx.fillRect(0, 0, pw, ph);
      return;
    }
    t -= dur;
  }

  // 2. Picture squeezes into a bright horizontal strip
  if (t < TV_SQUEEZE) {
    const k = (t / TV_SQUEEZE) ** 2; // speeds up, like a real CRT
    const hh = Math.max(2, ph * (1 - k));
    const y0 = (ph - hh) / 2;
    ctx.drawImage(scene, 0, y0, pw, hh);
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, k)})`;
    ctx.fillRect(0, y0, pw, hh);
    return;
  }
  t -= TV_SQUEEZE;

  // 3. Line shrinks into a dot
  if (t < TV_LINE) {
    const k = t / TV_LINE;
    const half = Math.max(3 * DPR, (pw / 2) * (1 - k) ** 2);
    ctx.fillStyle = WHITE;
    ctx.fillRect(pw / 2 - half, ph / 2 - 1.5 * DPR, half * 2, 3 * DPR);
    return;
  }
  t -= TV_LINE;

  // 4. Dot fades out, then black forever
  if (t < TV_DOT) {
    circle(ctx, pw / 2, ph / 2, 4 * DPR);
    ctx.fillStyle = `rgba(255,255,255,${1 - t / TV_DOT})`;
    ctx.fill();
  }
}

// ---------- Input ----------
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
window.addEventListener("dblclick", toggleFullscreen);
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "f") toggleFullscreen();
  else if (k === "r") reset();
  else if (k === "s") finish(performance.now());
  else if (k === "d") S.debug = !S.debug;
});

// ---------- Startup ----------
async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(new URL("vendor/wasm", location.href).href);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: "hand_landmarker.task", delegate },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (err) {
    console.warn("GPU failed, using CPU", err);
    return await HandLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

function errorText(err) {
  const name = err && err.name;
  if (name === "NotAllowedError") return "Camera is blocked. Click the camera icon in the address bar, allow it, then reload.";
  if (name === "NotFoundError") return "No camera found. Plug in a webcam and reload.";
  if (name === "NotReadableError") return "Camera is busy. Close other apps using it (Zoom, Teams, the Python version…) and reload.";
  return "Something went wrong: " + (err && err.message ? err.message : err);
}

async function main() {
  let landmarker;
  try {
    msg.textContent = "Loading hand tracking & camera…";
    [landmarker] = await Promise.all([createLandmarker(), startCamera()]);
  } catch (err) {
    console.error(err);
    msg.textContent = errorText(err);
    return;
  }
  msg.classList.add("hidden");

  let lastVideoTime = -1;
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(now - last, 100);
    last = now;
    if (S.mode !== "SUCCESS" && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        onResult(landmarker.detectForVideo(video, now), now);
      } catch (err) {
        console.error(err);
      }
    }
    const L = layout();
    update(L, now, dt);
    drawScene(L);
    present(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

if (location.protocol !== "file:") main();
