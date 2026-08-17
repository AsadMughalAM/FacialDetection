---
title: Face Detection & Analysis
emoji: 👤
colorFrom: blue
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

# Face Detection & Analysis

Live web app: camera feed → face detection → age & emotion estimation, with confidence scores.

## Features

- 📷 Live camera access (browser `getUserMedia`)
- 👤 Face detection (MediaPipe, full-range model)
- 👥 Multiple faces at once
- 🎂 Approximate age estimation (ONNX GoogleNet age model, 8 age buckets)
- 😊 Emotion estimation (ONNX FER+ model, 8 emotions)
- 📊 Confidence scores for every prediction, live latency/FPS stats

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | HTML / CSS / vanilla JS (WebSocket streaming) |
| Backend | Python + FastAPI + Uvicorn |
| Detection | MediaPipe Face Detection |
| AI Models | ONNX Runtime (age_googlenet, emotion-ferplus-8) |
| Deployment | Docker + docker-compose |

## Architecture

```
Camera → Browser (canvas → JPEG) → WebSocket → FastAPI
       → MediaPipe face detection → crop faces
       → ONNX age model + ONNX emotion model
       → JSON results → Web UI overlay
```

The browser sends one downscaled JPEG frame at a time and waits for the reply
before sending the next (ping-pong), so the frame rate auto-adapts to server speed.

## Run locally (Windows)

```powershell
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
python download_models.py     # fetches the two ONNX models (~50 MB)
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 and press **Start Camera**.

> Note: browsers only allow camera access on `localhost` or HTTPS.

## Run with Docker

```bash
docker compose up --build
```

## API

- `GET /` — web UI
- `WS /ws` — send binary JPEG frame, receive JSON detections
- `POST /api/detect` — multipart image upload, returns the same JSON
- `GET /api/health` — server + model status

Example response:

```json
{
  "faces": [
    {
      "box": {"x": 182, "y": 94, "w": 128, "h": 128},
      "confidence": 0.93,
      "age": {"range": "25-32", "confidence": 0.61},
      "emotion": {"label": "happy", "confidence": 0.88}
    }
  ],
  "count": 1,
  "frame": {"w": 640, "h": 480},
  "latency_ms": 41.2,
  "models": {"age": true, "emotion": true}
}
```

## Notes

- Age is a rough estimate in buckets (`0-2, 4-6, 8-12, 15-20, 25-32, 38-43, 48-53, 60+`).
- Emotions: `neutral, happy, surprise, sad, angry, disgust, fear, contempt`.
- If the ONNX models are missing, detection still works; age/emotion show a warning in the UI.
