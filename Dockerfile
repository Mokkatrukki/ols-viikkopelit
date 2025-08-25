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
# STAGE 2: TINY PRODUCTION RUNTIME WITH LITEFS
# ===============================
FROM node:22-alpine AS runtime

# Install LiteFS dependencies
RUN apk add --no-cache ca-certificates fuse3 sqlite

# Install LiteFS binary
COPY --from=flyio/litefs:0.5 /usr/local/bin/litefs /usr/local/bin/litefs

# Enable user_allow_other for FUSE
RUN echo "user_allow_other" >> /etc/fuse.conf

WORKDIR /usr/src/app

# Environment variables
ENV NODE_ENV=production \
    SHARED_GAMES_DB_PATH=/litefs/games.db

# Copy app with correct ownership (but run as root for LiteFS)
COPY --from=build /app/dist         ./dist
COPY --from=build /app/public       ./public
COPY --from=build /app/views        ./views
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules

# Copy LiteFS configuration
COPY litefs.yml /etc/litefs.yml

# Create LiteFS directories - run as root since we need FUSE permissions
RUN mkdir -p /litefs /var/lib/litefs && \
    chmod 755 /litefs /var/lib/litefs

# DO NOT set USER - LiteFS must run as root for FUSE mounts
# LiteFS will handle running our app via exec configuration

# Expose LiteFS proxy port (instead of app port directly)
EXPOSE 8080

# Modern healthcheck using LiteFS proxy port
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Use LiteFS as entrypoint
ENTRYPOINT ["litefs", "mount"] 