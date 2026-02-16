FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN rm -rf dist/public && cp -r src/public dist/public

# ── Production stage ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
# Full install (prisma CLI needed for migrate deploy at startup)
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# wait-for-it functionality via shell loop
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
