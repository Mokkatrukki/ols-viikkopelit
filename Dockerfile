# Use an official Node.js LTS image (e.g., Node 18 or 20)
FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Define the path for persistent storage within the container
# This path should correspond to where a Fly Volume will be mounted.
ENV APP_PERSISTENT_STORAGE_PATH=/data/app_files

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install dependencies using npm ci for cleaner, reproducible builds
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the application (compiles TypeScript, Tailwind CSS, etc.)
RUN npm run build

# Expose the port the app runs on (ensure this matches your app's configuration)
EXPOSE 3002

# Command to run the application
# This runs the 'start' script defined in your package.json
CMD ["npm", "start"] 