/* Camera -> WebSocket -> FastAPI -> detection overlay */

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const placeholder = document.getElementById("placeholder");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
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

function setStatus(text, live = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("live", live);
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
    setStatus("backend not reachable — start the server on port 8000");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setStatus("camera permission denied");
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
    setStatus("live", true);
    sendFrame();
  };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (!data.error) render(data);
    if (running) sendFrame(); // ping-pong: next frame only after reply
  };
  ws.onclose = () => { if (running) setStatus("connection lost"); };
  ws.onerror = () => setStatus("connection error");
}

function stop() {
  running = false;
  if (ws) { ws.close(); ws = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.hidden = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("stopped");
  faceCountEl.textContent = "0";
  latencyEl.textContent = "–";
  fpsEl.textContent = "–";
  faceList.innerHTML = '<p class="empty">No faces detected yet.</p>';
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

function render(data) {
  // fps tracking
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((t) => now - t < 2000);
  fpsEl.textContent = (frameTimes.length / 2).toFixed(1);
  latencyEl.textContent = Math.round(now - lastSent);
  faceCountEl.textContent = data.count;
  modelWarning.hidden = data.models.age && data.models.emotion;

  // scale factor: detection ran on the downscaled frame
  const sx = overlay.width / data.frame.w;
  const sy = overlay.height / data.frame.h;

  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.textBaseline = "bottom";

  const cards = [];
  data.faces.forEach((face, i) => {
    const { x, y, w, h } = face.box;
    const rx = x * sx, ry = y * sy, rw = w * sx, rh = h * sy;

    ctx.strokeStyle = "#3ddc84";
    ctx.strokeRect(rx, ry, rw, rh);

    const parts = [];
    if (face.age) parts.push(`age ${face.age.range}`);
    if (face.emotion) parts.push(face.emotion.label);
    const label = `#${i + 1} ${parts.join(" · ")} (${Math.round(face.confidence * 100)}%)`;

    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(rx, ry - 24, tw, 24);
    ctx.fillStyle = "#3ddc84";
    ctx.fillText(label, rx + 5, ry - 4);

    cards.push(faceCardHtml(i + 1, face));
  });

  faceList.innerHTML = cards.length
    ? cards.join("")
    : '<p class="empty">No faces detected.</p>';
}

function faceCardHtml(n, face) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const age = face.age
    ? `<div class="row"><span>Age</span><span class="val">${face.age.range} <span class="conf">${pct(face.age.confidence)}</span></span></div>`
    : "";
  const emo = face.emotion
    ? `<div class="row"><span>Emotion</span><span class="val">${face.emotion.label} <span class="conf">${pct(face.emotion.confidence)}</span></span></div>`
    : "";
  return `<div class="face-card">
    <div class="row"><span>Face #${n}</span><span class="conf">detect ${pct(face.confidence)}</span></div>
    ${age}${emo}
  </div>`;
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
