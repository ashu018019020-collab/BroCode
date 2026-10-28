# BroCode Supertonic 3 voice — CPU inference, model cached on a mounted volume.
#
# Build from the repository root (Render does this with dockerfilePath/dockerContext):
#   docker build -f services/supertonic-tts/Dockerfile .
#   docker run -p 8000:8000 -v voice-models:/models -e TTS_SERVICE_SECRET=dev brocode-voice
#
# The image never contains the 398 MB checkpoint. On first boot the official SDK downloads it into
# SUPERTONIC_CACHE_DIR (/models/supertonic3 on Render's disk); later boots load it from disk.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SUPERTONIC_MODEL=supertonic-3 \
    SUPERTONIC_CACHE_DIR=/models/supertonic3 \
    SUPERTONIC_STYLE=F1 \
    SUPERTONIC_STEPS=8 \
    PORT=8000

# libsndfile is the only system library the SDK needs to encode WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/supertonic-tts/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/supertonic-tts/app.py ./app.py

EXPOSE 8000
# ONE worker: the model is ~400 MB in memory and ONNX sessions are serialized inside the app.
# Multiple workers would duplicate both the memory and the model load.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 75"]
