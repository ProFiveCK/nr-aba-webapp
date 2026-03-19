FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY app/backend/package.json app/backend/package-lock.json* ./
RUN npm install --production

RUN python3 -m pip install --break-system-packages --no-cache-dir pandas openpyxl

COPY app/backend/src ./src
COPY app/backend/scripts ./scripts
COPY scripts/reformat_payroll.py ./scripts/reformat_payroll.py

ENV NODE_ENV=production
CMD ["node", "src/server.js"]
