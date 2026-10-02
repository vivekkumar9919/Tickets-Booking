# Stage 1: Dependency resolution and build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Minimal production runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY migrations ./migrations
COPY src ./src

# Use non-root node user for security
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]

