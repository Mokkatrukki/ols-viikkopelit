# Use an official Node.js LTS image (e.g., Node 18 or 20)
FROM node:18-slim

# Set environment variable for Puppeteer to use installed Chromium and skip download
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install necessary dependencies for Puppeteer (Debian-based)
# Including fonts needed for rendering PDFs correctly, if applicable
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
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Define the path for persistent storage within the container
# This path should correspond to where a Fly Volume will be mounted.
ENV APP_PERSISTENT_STORAGE_PATH=/data/app_files

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

# Expose the port the admin app runs on (e.g., 3003, different from main app's 3002)
EXPOSE 3003

# Command to run the application
# This runs the 'start' script defined in admin_app/package.json
CMD ["npm", "start"]
