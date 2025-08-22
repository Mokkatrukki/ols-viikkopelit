# 🚀 ULTRA-OPTIMIZED + SECURITY-HARDENED DOCKERFILE
# Combines performance optimizations + latest security patches

# ===============================
# STAGE 1: BUILD ENVIRONMENT 
# ===============================
FROM node:22-alpine AS build

# Native build tools for any transitive native deps (throwaway stage)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dev deps for TypeScript/Tailwind/PostCSS build
COPY package*.json ./
RUN npm ci --include=dev

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Build: tsc + Tailwind + CSS minify (as in your scripts)
RUN npm run build

# Prune to production-only and drop cache (ChatGPT optimization!)
RUN npm prune --omit=dev && npm cache clean --force

# ===============================
# STAGE 2: TINY PRODUCTION RUNTIME
# ===============================
FROM node:22-alpine AS runtime

WORKDIR /usr/src/app

# Environment variables
ENV NODE_ENV=production \
    APP_PERSISTENT_STORAGE_PATH=/data/app_files

# Copy app with correct ownership in one go (ChatGPT optimization!)
COPY --chown=node:node --from=build /app/dist         ./dist
COPY --chown=node:node --from=build /app/public       ./public
COPY --chown=node:node --from=build /app/views        ./views
COPY --chown=node:node --from=build /app/package*.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules

# Create data directory as root, then switch to node user
RUN mkdir -p /data/app_files && \
    chown -R node:node /data/app_files

# Switch to non-root user (using built-in 'node' user)
USER node

# Expose port
EXPOSE 3002

# Modern healthcheck using Node's built-in fetch (ChatGPT optimization!)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Use built-in init handling (no dumb-init needed)
CMD ["node", "dist/app.js"] 