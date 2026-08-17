FROM python:3.10-slim

WORKDIR /app

# System libs needed by OpenCV / MediaPipe
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Download ONNX models at build time (skipped if already copied in)
RUN python download_models.py

# Hosting platforms (Render/Railway/HF Spaces) inject PORT; default 8000 locally.
EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
