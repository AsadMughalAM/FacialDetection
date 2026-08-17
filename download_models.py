"""Download pre-trained ONNX models for age and emotion estimation.

Run once before starting the server:
    python download_models.py
"""
import os
import sys

import requests

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

MODELS = {
    "age_googlenet.onnx": [
        "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/age_gender/models/age_googlenet.onnx",
        "https://github.com/onnx/models/raw/master/vision/body_analysis/age_gender/models/age_googlenet.onnx",
    ],
    "gender_googlenet.onnx": [
        "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/age_gender/models/gender_googlenet.onnx",
        "https://github.com/onnx/models/raw/master/vision/body_analysis/age_gender/models/gender_googlenet.onnx",
    ],
    "emotion-ferplus-8.onnx": [
        "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx",
        "https://github.com/onnx/models/raw/master/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx",
    ],
}


def download(name: str, urls: list[str]) -> bool:
    dest = os.path.join(MODELS_DIR, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        print(f"[skip] {name} already exists ({os.path.getsize(dest) / 1e6:.1f} MB)")
        return True

    for url in urls:
        try:
            print(f"[down] {name} <- {url}")
            resp = requests.get(url, stream=True, timeout=120)
            resp.raise_for_status()
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
            size = os.path.getsize(tmp)
            if size < 1_000_000:  # sanity check: real models are tens of MB
                os.remove(tmp)
                print(f"[warn] {name}: response too small ({size} bytes), trying next URL")
                continue
            os.replace(tmp, dest)
            print(f"[ ok ] {name} ({size / 1e6:.1f} MB)")
            return True
        except Exception as exc:
            print(f"[fail] {url}: {exc}")
    return False


def main() -> int:
    os.makedirs(MODELS_DIR, exist_ok=True)
    ok = all(download(name, urls) for name, urls in MODELS.items())
    if not ok:
        print("\nSome models failed to download. Age/emotion will be disabled "
              "until they are present in ./models/")
        return 1
    print("\nAll models ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
