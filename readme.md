

## How to update code + container + Portainer

Whenever you change something:

1. **Update code locally**

   * Edit `app.py`, `index.html`, `static/styles.css`, `static/js/*.js`, etc.
   * Test locally:

     ```bash
     source venv/bin/activate
     python app.py
     ```

     Hit `http://localhost:8000`.

2. **Commit and push to GitHub**

   ```bash
   git status
   git add .
   git commit -m "Describe your change"
   git push origin main
   ```

3. **Build and push new image to GHCR**

   Login (only needed on a new machine / after logout):

   ```bash
   echo "<YOUR_GHCR_PAT>" | docker login ghcr.io -u n-moody --password-stdin
   ```

   Build **linux/amd64** image and push:

   ```bash

    docker build -t ghcr.io/n-moody/number-bot:latest .
    docker push ghcr.io/n-moody/number-bot:latest


   docker buildx build \
     --platform linux/amd64 \
     -t ghcr.io/n-moody/number-bot:latest \
     --push .
   ```

4. **Redeploy in Portainer**

   * Go to **Stacks → number-bot → Editor**.
   * Make sure the compose uses:

     ```yaml
     image: ghcr.io/n-moody/number-bot:latest
     ```
   * Click **Deploy the stack** (or **Update the stack**).
   * Portainer will pull the new `latest` and restart the container.

That’s the full loop.

---

## `README.md`

Here’s a README you can paste into `README.md` in the repo:

````markdown
# Number Bot

Voice–driven counting and kid–friendly math assistant for my 5-year-old.

- Frontend: vanilla HTML/CSS/JS, optimized for tablet.
- Backend: FastAPI + OpenAI (Whisper for STT, GPT for logic, TTS for speech).
- Containerized and deployed via Portainer using images from GitHub Container Registry (GHCR).

---

## Project Structure

```text
.
├─ app.py                 # FastAPI app, /chat + /speak + static serving
├─ index.html             # Main UI shell
├─ prompt.txt             # System prompt for the model
├─ knowledge.json         # Reference data (big number names etc.)
├─ Dockerfile
├─ static/
│  ├─ styles.css          # All styling for Number Bot UI
│  ├─ favicon.png         # Favicon
│  └─ js/
│     ├─ main.js          # Wiring, dad mode, shared UI helpers
│     ├─ recorder.js      # Mic logic, /chat, /speak streaming
│     └─ number-pad.js    # On–screen number pad + BigInt → words
└─ .env                   # Local dev only (NOT committed)
````

---

## Environment Variables

The app expects these env vars:

* `OPENAI_API_KEY` – required.
* `OPENAI_MODEL` – default: `gpt-4o`
* `OPENAI_TTS_MODEL` – default: `gpt-4o-mini-tts`
* `OPENAI_TTS_VOICE` – default: `nova`
* `OPENAI_TRANSCRIBE_MODEL` – default: `whisper-1`
* `PORT` – default: `8000`

For **local dev**, put them in `.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=nova
OPENAI_TRANSCRIBE_MODEL=whisper-1
PORT=8000
```

---

## Local Development

### 1. Create and activate venv

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
# or, if missing:
# pip install fastapi uvicorn openai python-dotenv python-multipart
```

### 3. Run the app

```bash
python app.py
```

Open:

* `http://localhost:8000` → UI
* `http://localhost:8000/health` → health check

---

## Docker & GHCR

Images are hosted at:

* `ghcr.io/n-moody/number-bot:latest`

### 1. Build and push image

From repo root:

```bash
# Login to GHCR (only needed once per machine / after logout)
echo "<YOUR_GHCR_PAT>" | docker login ghcr.io -u n-moody --password-stdin

# Build linux/amd64 image and push to GHCR
docker buildx build \
  --platform linux/amd64 \
  -t ghcr.io/n-moody/number-bot:latest \
  --push .
```

This is the one command you run whenever you want to update the container image after code changes.

### 2. Run locally with Docker (optional test)

```bash
docker run --rm \
  -p 8000:8000 \
  -e OPENAI_API_KEY="sk-..." \
  -e OPENAI_MODEL="gpt-4o" \
  -e OPENAI_TTS_MODEL="gpt-4o-mini-tts" \
  -e OPENAI_TTS_VOICE="nova" \
  -e OPENAI_TRANSCRIBE_MODEL="whisper-1" \
  ghcr.io/n-moody/number-bot:latest
```

Then hit `http://localhost:8000`.

---

## Portainer / Stack Deployment

Example `docker-compose.yml` used by the stack:

```yaml
version: "3.8"

services:
  number-bot:
    image: ghcr.io/n-moody/number-bot:latest
    container_name: number-bot
    restart: unless-stopped
    environment:
      OPENAI_API_KEY: "sk-..."        # change to your real key
      OPENAI_MODEL: "gpt-4o"
      OPENAI_TTS_MODEL: "gpt-4o-mini-tts"
      OPENAI_TTS_VOICE: "nova"
      OPENAI_TRANSCRIBE_MODEL: "whisper-1"
      PORT: "8000"
    ports:
      - "8005:8000"                   # external:internal
```

### Update flow in Portainer:

1. In Portainer, go to **Stacks → number-bot**.
2. Ensure the stack uses the image:

   ```yaml
   image: ghcr.io/n-moody/number-bot:latest
   ```
3. Click **Update the stack**.
4. Portainer pulls the latest image from GHCR and restarts the container.

---

## Everyday Workflow (Future Nate)

When you want to change behavior / UI:

1. **Edit code locally**

   * Backend: `app.py`, `prompt.txt`, `knowledge.json`.
   * Frontend: `index.html`, `static/styles.css`, `static/js/*.js`.

2. **Test locally**

   ```bash
   source venv/bin/activate
   python app.py
   # visit http://localhost:8000
   ```

3. **Commit and push**

   ```bash
   git status
   git add .
   git commit -m "Tweak UI / behavior"
   git push origin main
   ```

4. **Build + push new container**

   ```bash
   docker buildx build \
     --platform linux/amd64 \
     -t ghcr.io/n-moody/number-bot:latest \
     --push .
   ```

5. **Redeploy in Portainer**

   * Open the `number-bot` stack.
   * Click **Update the stack** to pull the new image.
   * Test from:

     * Your server: `http://<server-ip>:8005`
     * Kid’s tablet: same URL in Chrome.

That’s the whole loop.
