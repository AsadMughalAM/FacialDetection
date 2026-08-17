/* Camera -> WebSocket -> FastAPI -> detection overlay */

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const placeholder = document.getElementById("placeholder");
const scanline = document.getElementById("scanline");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const statusText = statusEl.querySelector(".status-text");
const faceCountEl = document.getElementById("faceCount");
const latencyEl = document.getElementById("latency");
const fpsEl = document.getElementById("fps");
const faceList = document.getElementById("faceList");
const modelWarning = document.getElementById("modelWarning");

const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");

let stream = null;
let ws = null;
let running = false;
let lastSent = 0;
let frameTimes = [];

const JPEG_QUALITY = 0.7;
const MAX_SEND_WIDTH = 640; // downscale before sending to keep latency low

const EMOJI = {
  neutral: "😐", happy: "😊", surprise: "😲", sad: "😢",
  angry: "😠", disgust: "🤢", fear: "😨", contempt: "😒",
};
const GENDER_ICON = { male: "♂", female: "♀" };

function setStatus(text, mode = "") {
  statusText.textContent = text;
  statusEl.classList.toggle("live", mode === "live");
  statusEl.classList.toggle("error", mode === "error");
}

async function findBackend() {
  // Prefer same-origin (page served by FastAPI); fall back to localhost:8000
  // for pages opened via file:// or an IDE live-preview server.
  const candidates = [];
  if (location.protocol.startsWith("http") && location.host) candidates.push(location.host);
  candidates.push("localhost:8000", "127.0.0.1:8000");
  const scheme = location.protocol === "https:" ? "https" : "http";
  for (const host of candidates) {
    try {
      const resp = await fetch(`${scheme}://${host}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return host;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function start() {
  setStatus("connecting…");
  const backendHost = await findBackend();
  if (!backendHost) {
    setStatus("backend not reachable — start the server on port 8000", "error");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setStatus("camera permission denied", "error");
    return;
  }
  video.srcObject = stream;
  placeholder.hidden = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  await new Promise((res) => (video.onloadedmetadata = res));
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${backendHost}/ws`);
  ws.onopen = () => {
    running = true;
    scanline.hidden = false;
    setStatus("live", "live");
    sendFrame();
  };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (!data.error) render(data);
    if (running) sendFrame(); // ping-pong: next frame only after reply
  };
  ws.onclose = () => { if (running) setStatus("connection lost", "error"); };
  ws.onerror = () => setStatus("connection error", "error");
}

function stop() {
  running = false;
  if (ws) { ws.close(); ws = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.hidden = false;
  scanline.hidden = true;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("stopped");
  faceCountEl.textContent = "0";
  latencyEl.textContent = "–";
  fpsEl.textContent = "–";
  faceList.innerHTML = '<p class="empty">No faces detected yet — start the camera.</p>';
}

function sendFrame() {
  if (!running || !ws || ws.readyState !== WebSocket.OPEN) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) { requestAnimationFrame(sendFrame); return; }

  const scale = Math.min(1, MAX_SEND_WIDTH / vw);
  captureCanvas.width = Math.round(vw * scale);
  captureCanvas.height = Math.round(vh * scale);
  captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

  captureCanvas.toBlob(
    (blob) => {
      if (blob && ws && ws.readyState === WebSocket.OPEN) {
        lastSent = performance.now();
        ws.send(blob);
      }
    },
    "image/jpeg",
    JPEG_QUALITY
  );
}

/* Scanner-style corner brackets around a face box */
function drawBrackets(x, y, w, h) {
  const len = Math.min(w, h) * 0.22;
  const r = 3;
  ctx.strokeStyle = "#38e1c8";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(56, 225, 200, 0.7)";
  ctx.shadowBlur = 10;
  const corners = [
    [x, y, len, 0, 0, len],             // top-left
    [x + w, y, -len, 0, 0, len],        // top-right
    [x, y + h, len, 0, 0, -len],        // bottom-left
    [x + w, y + h, -len, 0, 0, -len],   // bottom-right
  ];
  for (const [cx, cy, dx1, dy1, dx2, dy2] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx1, cy + dy1);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx2, cy + dy2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawLabelChip(text, x, y) {
  const padX = 10, height = 26;
  const tw = ctx.measureText(text).width + padX * 2;
  const ry = Math.max(4, y - height - 8);
  ctx.fillStyle = "rgba(5, 8, 16, 0.78)";
  ctx.strokeStyle = "rgba(56, 225, 200, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, ry, tw, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef1fa";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, ry + height / 2 + 1);
}

function render(data) {
  // fps tracking
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((t) => now - t < 2000);
  fpsEl.textContent = (frameTimes.length / 2).toFixed(1);
  latencyEl.textContent = Math.round(now - lastSent);
  faceCountEl.textContent = data.count;
  modelWarning.hidden = data.models.age && data.models.emotion && data.models.gender;

  // scale factor: detection ran on the downscaled frame
  const sx = overlay.width / data.frame.w;
  const sy = overlay.height / data.frame.h;

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.font = "600 15px 'Sora', 'Segoe UI', sans-serif";

  const cards = [];
  data.faces.forEach((face, i) => {
    const { x, y, w, h } = face.box;
    const rx = x * sx, ry = y * sy, rw = w * sx, rh = h * sy;

    drawBrackets(rx, ry, rw, rh);

    const parts = [];
    if (face.gender) parts.push(`${GENDER_ICON[face.gender.label] || ""} ${face.gender.label}`);
    if (face.age) parts.push(face.age.range);
    if (face.emotion) parts.push(`${EMOJI[face.emotion.label] || ""} ${face.emotion.label}`);
    const label = parts.length ? parts.join("  ·  ") : `face ${Math.round(face.confidence * 100)}%`;
    drawLabelChip(label, rx, ry);

    cards.push(faceCardHtml(i + 1, face));
  });

  faceList.innerHTML = cards.length
    ? cards.join("")
    : '<p class="empty">No faces in frame right now.</p>';
}

function attrHtml(name, value, conf) {
  const pct = Math.round(conf * 100);
  return `<div class="attr">
    <div class="attr-row">
      <span class="k">${name}</span>
      <span class="v">${value} <span class="pct">${pct}%</span></span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

function faceCardHtml(n, face) {
  const emoji = face.emotion ? (EMOJI[face.emotion.label] || "🙂") : "🙂";
  let attrs = "";
  if (face.gender) attrs += attrHtml("Gender", face.gender.label, face.gender.confidence);
  if (face.age) attrs += attrHtml("Age", face.age.range + " yrs", face.age.confidence);
  if (face.emotion) attrs += attrHtml("Emotion", face.emotion.label, face.emotion.confidence);
  return `<div class="face-card">
    <div class="face-emoji">${emoji}</div>
    <div class="face-info">
      <div class="face-title">
        <span>Face #${n}</span>
        <span class="det-conf">${Math.round(face.confidence * 100)}% match</span>
      </div>
      ${attrs}
    </div>
  </div>`;
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
