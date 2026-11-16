# Render worker image: Node + Chromium system libraries for Remotion.
# Build context is the repo root (the worker imports convex/_generated and remotion/).

FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 \
      libxdamage1 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Download Remotion's headless Chrome at build time, not on first job.
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('browser ready'))"

RUN chown -R node:node /app
USER node
CMD ["node", "render-worker/worker.mjs"]
