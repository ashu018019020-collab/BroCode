# BroCode voice service — Supertonic 3, CPU, server-side.
#
# The image deliberately contains NO model weights: they are fetched into /models on first boot (or
# mounted from a volume). That keeps the image small, makes the model revision explicit, and means a
# redeploy does not re-download 398 MB.
#
#   docker build -t brocode-voice -f voice-service/Dockerfile .
#   docker run -p 8080:8080 -e TTS_SERVICE_SECRET=... -v brocode-voice-models:/models brocode-voice
FROM node:24-slim

WORKDIR /app

# Only the layout the engine reads: the shared model contract (TypeScript, run through Node's type
# stripping), the inference module, and the HTTP service. No React, no Vite, no frontend code.
# `onnxruntime-node` (the native CPU runtime, installed from that manifest) is what executes the
# four ONNX graphs; the model contract itself is plain TypeScript below.
COPY voice-service/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY src/core/ai/supertonic.ts ./src/core/ai/supertonic.ts
COPY server/supertonic-tts.mjs ./server/supertonic-tts.mjs
COPY scripts/voice-model.mjs ./scripts/voice-model.mjs
COPY voice-service/server.mjs ./voice-service/server.mjs

ENV NODE_ENV=production \
    PORT=8080 \
    SUPERTONIC_MODEL_DIR=/models/supertonic-3 \
    SUPERTONIC_STYLE=F1 \
    SUPERTONIC_AUTO_FETCH=1

# Weights + ONNX Runtime need real memory; 2 GB is the honest floor for this model.
VOLUME ["/models"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "voice-service/server.mjs"]
