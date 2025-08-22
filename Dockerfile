# 🚀 OPTIMIZED DOCKERFILE FOR MINIMAL SIZE & FAST COLD STARTS
# Based on performance analysis principles - targeting <50MB final image

# ===============================
# STAGE 1: BUILD ENVIRONMENT 
# ===============================
FROM node:18-alpine AS builder

# Install build tools needed for native dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Copy package files first (Docker layer caching)
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
COPY tsconfig.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Build the application
RUN npm run build

# ===============================
# STAGE 2: PRODUCTION RUNTIME
# ===============================
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

WORKDIR /usr/src/app

# Define persistent storage path
ENV APP_PERSISTENT_STORAGE_PATH=/data/app_files
ENV NODE_ENV=production

# Copy package.json for production dependencies only
COPY package*.json ./

# Install ONLY production dependencies (much smaller)
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /build/dist/ ./dist/
COPY --from=builder /build/public/ ./public/
COPY --from=builder /build/views/ ./views/

# Create data directory and set permissions
RUN mkdir -p /data/app_files && \
    chown -R appuser:nodejs /usr/src/app /data/app_files

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3002

# Health check for faster startup detection
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

# Use dumb-init for proper signal handling and faster shutdowns
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/app.js"] 