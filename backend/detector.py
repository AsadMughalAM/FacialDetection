"""Face detection using MediaPipe."""
from dataclasses import dataclass

import mediapipe as mp
import numpy as np


@dataclass
class Face:
    x: int
    y: int
    w: int
    h: int
    confidence: float


class FaceDetector:
    def __init__(self, min_confidence: float = 0.5):
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1,  # full-range model, better for multiple faces
            min_detection_confidence=min_confidence,
        )

    def detect(self, frame_bgr: np.ndarray) -> list[Face]:
        """Detect faces in a BGR frame. Returns pixel-space boxes."""
        ih, iw = frame_bgr.shape[:2]
        rgb = frame_bgr[:, :, ::-1]
        results = self._detector.process(rgb)
        faces: list[Face] = []
        if not results.detections:
            return faces
        for det in results.detections:
            box = det.location_data.relative_bounding_box
            x = max(0, int(box.xmin * iw))
            y = max(0, int(box.ymin * ih))
            w = min(int(box.width * iw), iw - x)
            h = min(int(box.height * ih), ih - y)
            if w <= 0 or h <= 0:
                continue
            faces.append(Face(x=x, y=y, w=w, h=h, confidence=float(det.score[0])))
        return faces

    def close(self):
        self._detector.close()
