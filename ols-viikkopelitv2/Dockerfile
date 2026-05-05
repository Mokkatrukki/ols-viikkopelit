FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN bun install --production

# Copy application files
COPY src ./src
COPY views ./views
COPY public ./public

# Data directory (populated at runtime via /api/refresh)
RUN mkdir -p data

# Non-root user
RUN addgroup -g 1001 -S bunjs && adduser -S bunjs -u 1001 -G bunjs
RUN chown -R bunjs:bunjs /app
USER bunjs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/app.ts"]
