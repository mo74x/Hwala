# ==========================================
# Stage 1: Base image with system dependencies
# ==========================================
FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# ==========================================
# Stage 2: Install production dependencies
# ==========================================
FROM base AS deps

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npm cache clean --force

# ==========================================
# Stage 3: Build application
# ==========================================
FROM base AS build

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

# ==========================================
# Stage 4: Production image
# ==========================================
FROM base AS production

LABEL org.opencontainers.image.title="Hawala Core" \
      org.opencontainers.image.description="Enterprise-grade multi-tenant digital wallet & financial ledger engine" \
      org.opencontainers.image.vendor="Hawala Team" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production \
    PORT=3000

# Copy node_modules from deps stage (production dependencies only)
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# Copy built application and generated prisma client from build stage
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/generated ./generated
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
