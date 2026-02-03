FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
CMD ["node", "src/server.js"]
