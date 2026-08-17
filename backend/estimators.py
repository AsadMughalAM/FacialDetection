"""Age and emotion estimation using ONNX Runtime models.

Models (see download_models.py):
  - age_googlenet.onnx      : 8 age buckets, 224x224 BGR input, Caffe mean subtraction
  - emotion-ferplus-8.onnx  : 8 emotions, 64x64 grayscale input
"""
import os

import cv2
import numpy as np

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

AGE_BUCKETS = ["0-2", "4-6", "8-12", "15-20", "25-32", "38-43", "48-53", "60+"]
EMOTIONS = ["neutral", "happy", "surprise", "sad", "angry", "disgust", "fear", "contempt"]


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


class _OnnxModel:
    def __init__(self, filename: str):
        self.session = None
        path = os.path.join(MODELS_DIR, filename)
        if ort is not None and os.path.exists(path):
            self.session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            self.input_name = self.session.get_inputs()[0].name

    @property
    def available(self) -> bool:
        return self.session is not None


class AgeEstimator(_OnnxModel):
    def __init__(self):
        super().__init__("age_googlenet.onnx")

    def predict(self, face_bgr: np.ndarray) -> tuple[str, float]:
        """Returns (age_range, confidence)."""
        if not self.available:
            return "?", 0.0
        blob = cv2.resize(face_bgr, (224, 224)).astype(np.float32)
        blob -= np.array([104.0, 117.0, 123.0], dtype=np.float32)  # Caffe BGR means
        blob = blob.transpose(2, 0, 1)[np.newaxis]  # NCHW
        scores = self.session.run(None, {self.input_name: blob})[0][0]
        probs = _softmax(scores)
        idx = int(np.argmax(probs))
        return AGE_BUCKETS[idx], float(probs[idx])


class EmotionEstimator(_OnnxModel):
    def __init__(self):
        super().__init__("emotion-ferplus-8.onnx")

    def predict(self, face_bgr: np.ndarray) -> tuple[str, float]:
        """Returns (emotion, confidence)."""
        if not self.available:
            return "?", 0.0
        gray = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2GRAY)
        blob = cv2.resize(gray, (64, 64)).astype(np.float32)
        blob = blob[np.newaxis, np.newaxis]  # 1x1x64x64
        scores = self.session.run(None, {self.input_name: blob})[0][0]
        probs = _softmax(scores)
        idx = int(np.argmax(probs))
        return EMOTIONS[idx], float(probs[idx])
