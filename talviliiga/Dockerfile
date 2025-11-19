# Multi-stage build for minimal image size
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tailwind.config.js ./

# Install dependencies (optionalDependencies like canvas will be skipped if they fail)
RUN npm ci --omit=optional

# Copy source files
COPY src ./src
COPY views ./views
COPY public ./public

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --chown=nodejs:nodejs views ./views
COPY --chown=nodejs:nodejs data ./data

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3003

# Modern healthcheck using Node's built-in fetch (optimized for fast cold start)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the application
CMD ["node", "dist/src/app.js"]
