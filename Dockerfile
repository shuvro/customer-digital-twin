FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN rm -rf dist/public && cp -r src/public dist/public

# ── Production stage ──────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY prisma.config.ts ./

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
