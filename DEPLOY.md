# Deployment Guide

> ⚠️ Camera sirf **HTTPS** par chalta hai (ya localhost par). Neeche ke sab options
> automatic HTTPS dete hain, is liye koi extra TLS setup nahi chahiye.

## Option 1 — Hugging Face Spaces (FREE, recommended) 🤗

ML demos ke liye best: free, 16 GB RAM, HTTPS + WebSocket support, credit card nahi chahiye.

1. Account banao: https://huggingface.co/join
2. New Space banao: https://huggingface.co/new-space
   - **Space name**: `face-detection`
   - **SDK**: **Docker** select karo
   - **Hardware**: CPU basic (free)
3. Apna code push karo (project folder mein):

```powershell
git init
git add .
git commit -m "Face detection app"
git remote add space https://huggingface.co/spaces/<YOUR_USERNAME>/face-detection
git push --force space master:main
```

Push par username + **Access Token** mangega — token yahan se banao:
https://huggingface.co/settings/tokens (type: **Write**)

4. Space khud build hoga (~5 min — Docker build me models download hote hain).
   App live hogi: `https://<YOUR_USERNAME>-face-detection.hf.space`

## Option 2 — Render.com (free tier available)

1. Code ko GitHub par push karo (public ya private repo)
2. https://render.com par sign up karo (GitHub se login)
3. **New → Web Service** → apna repo select karo
4. Render `render.yaml` + `Dockerfile` khud detect kar lega → **Deploy**
5. Live URL: `https://face-detection-xxxx.onrender.com`

> Free tier note: 512 MB RAM tight hai (app ~450 MB use karti hai), aur 15 min
> idle ke baad sleep ho jati hai (first request slow). Starter plan ($7/mo) smooth hai.

## Option 3 — Apna VPS (DigitalOcean / Hetzner / AWS EC2)

Server par (Ubuntu, Docker installed):

```bash
git clone <your-repo> facedetection && cd facedetection
docker compose up -d --build
```

HTTPS ke liye Caddy sab se aasaan hai (automatic Let's Encrypt certificate):

```bash
sudo apt install caddy
# /etc/caddy/Caddyfile:
#   yourdomain.com {
#       reverse_proxy localhost:8000
#   }
sudo systemctl reload caddy
```

Domain ka A-record server IP par point karo — bas. Caddy WebSockets bhi
automatically proxy kar deta hai.

## Checklist (kisi bhi platform ke liye)

- [x] Dockerfile `PORT` env variable respect karta hai
- [x] Models Docker build ke waqt download hote hain (git mein nahi)
- [x] Frontend HTTPS/WSS automatically use karta hai
- [x] Health check endpoint: `/api/health`
