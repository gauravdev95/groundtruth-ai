FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# NOTE: there is no client/public/ directory (the favicon lives in
# src/app/icon.svg and is served by Next.js itself). Do NOT re-add a
# `COPY ... /app/public` line here — COPY of a missing source fails the
# whole docker build.
EXPOSE 3000
CMD ["node", "server.js"]
