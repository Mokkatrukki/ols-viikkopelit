# Use an official Node.js LTS image (e.g., Node 18 or 20) with LiteFS support
FROM node:18-slim

# Set environment variable for Puppeteer to use installed Chromium and skip download
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install necessary dependencies for Puppeteer AND LiteFS
RUN apt-get update && apt-get install -y \
    chromium \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libgconf-2-4 \
    libfontconfig1 \
    libxss1 \
    ca-certificates \
    fonts-liberation \
    xdg-utils \
    fuse3 \
    sqlite3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install LiteFS binary
COPY --from=flyio/litefs:0.5 /usr/local/bin/litefs /usr/local/bin/litefs

# Enable user_allow_other for FUSE
RUN echo "user_allow_other" >> /etc/fuse.conf

# Set working directory
WORKDIR /usr/src/app

# Define paths for LiteFS and file storage
ENV APP_PERSISTENT_STORAGE_PATH=/litefs \
    APP_FILE_STORAGE_PATH=/data/app_files

# Copy package.json and package-lock.json (or yarn.lock)
# These will be specific to the admin_app
COPY package*.json ./

# Install dependencies using npm ci for cleaner, reproducible builds
RUN npm ci

# Copy the rest of the application code from admin_app context
COPY . .

# Build the application (compiles TypeScript, Tailwind CSS, etc.)
# This will run the build script from admin_app/package.json
RUN npm run build

# Copy LiteFS configuration
COPY litefs.yml /etc/litefs.yml

# Create LiteFS directories and file storage directory
RUN mkdir -p /litefs /var/lib/litefs /data/app_files && \
    chmod 755 /litefs /var/lib/litefs /data/app_files

# DO NOT set USER - LiteFS must run as root for FUSE mounts
# LiteFS will handle running our app via exec configuration

# Expose LiteFS proxy port (instead of app port directly)
EXPOSE 8080

# Use LiteFS as entrypoint - it runs as root and handles our app
ENTRYPOINT ["litefs", "mount"]
