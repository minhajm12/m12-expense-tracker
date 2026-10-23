# Multi-stage production build for M12 Expense Tracker API
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

# Install dependencies across all workspaces
RUN npm ci

# Copy source files
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

# Build shared package and Express API
RUN npm run build --workspace=@finora/shared
RUN npm run build --workspace=@finora/api

# Runner stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy built artifacts and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/ ./packages/shared/
COPY --from=builder /app/apps/api/package*.json ./apps/api/
COPY --from=builder /app/apps/api/dist/ ./apps/api/dist/

# Install only production dependencies
RUN npm ci --omit=dev

USER node

EXPOSE 5000

CMD ["node", "apps/api/dist/index.js"]
