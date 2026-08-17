"""FastAPI app: camera frames in -> face boxes + age + emotion out.

Run:  uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from backend.detector import FaceDetector
from backend.estimators import AgeEstimator, EmotionEstimator, GenderEstimator

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT, "frontend")

app = FastAPI(title="Face Detection & Analysis")

# Allow the UI to reach this API even when the page is opened from file://
# or served by an IDE live-preview server on another port.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = FaceDetector(min_confidence=0.5)
age_model = AgeEstimator()
gender_model = GenderEstimator()
emotion_model = EmotionEstimator()


def _crop_with_margin(frame: np.ndarray, x: int, y: int, w: int, h: int,
                      margin: float = 0.2) -> np.ndarray:
    """Crop a face box expanded by `margin` on each side, clamped to the frame."""
    ih, iw = frame.shape[:2]
    mx, my = int(w * margin), int(h * margin)
    x0, y0 = max(0, x - mx), max(0, y - my)
    x1, y1 = min(iw, x + w + mx), min(ih, y + h + my)
    return frame[y0:y1, x0:x1]


def analyze_frame(frame_bgr: np.ndarray) -> dict:
    start = time.perf_counter()
    faces = detector.detect(frame_bgr)
    results = []
    for face in faces:
        crop = _crop_with_margin(frame_bgr, face.x, face.y, face.w, face.h)
        entry = {
            "box": {"x": face.x, "y": face.y, "w": face.w, "h": face.h},
            "confidence": round(face.confidence, 3),
            "age": None,
            "gender": None,
            "emotion": None,
        }
        if crop.size > 0:
            if age_model.available:
                age, age_conf = age_model.predict(crop)
                entry["age"] = {"range": age, "confidence": round(age_conf, 3)}
            if gender_model.available:
                gender, g_conf = gender_model.predict(crop)
                entry["gender"] = {"label": gender, "confidence": round(g_conf, 3)}
            if emotion_model.available:
                emo, emo_conf = emotion_model.predict(crop)
                entry["emotion"] = {"label": emo, "confidence": round(emo_conf, 3)}
        results.append(entry)
    return {
        "faces": results,
        "count": len(results),
        "frame": {"w": frame_bgr.shape[1], "h": frame_bgr.shape[0]},
        "latency_ms": round((time.perf_counter() - start) * 1000, 1),
        "models": {"age": age_model.available, "gender": gender_model.available, "emotion": emotion_model.available},
    }


def _decode_jpeg(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return frame


@app.websocket("/ws")
async def ws_detect(ws: WebSocket):
    """Receives binary JPEG frames, replies with JSON detection results."""
    await ws.accept()
    try:
        while True:
            data = await ws.receive_bytes()
            frame = _decode_jpeg(data)
            if frame is None:
                await ws.send_json({"error": "could not decode frame"})
                continue
            await ws.send_json(analyze_frame(frame))
    except WebSocketDisconnect:
        pass


@app.post("/api/detect")
async def detect_image(file: UploadFile = File(...)):
    """Single-image detection endpoint (for testing / non-streaming clients)."""
    frame = _decode_jpeg(await file.read())
    if frame is None:
        return {"error": "could not decode image"}
    return analyze_frame(frame)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "models": {"age": age_model.available, "gender": gender_model.available, "emotion": emotion_model.available},
    }


# Serve the frontend at root (index.html, style.css, app.js).
# Registered last so the API routes above take precedence.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
