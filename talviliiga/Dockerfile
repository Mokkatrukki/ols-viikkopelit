FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src
COPY views ./views
COPY public ./public

# Data (games.json, stats.json) lives on the mounted volume; fetched from Google Sheets at runtime
RUN mkdir -p data

RUN addgroup -g 1001 -S bunjs && adduser -S bunjs -u 1001 -G bunjs && chown -R bunjs:bunjs /app
USER bunjs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/app.ts"]
