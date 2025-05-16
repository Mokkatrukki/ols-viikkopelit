# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies for build and extract scripts)
RUN npm install

# Copy the rest of your app's source code
COPY . .

# Ensure the target PDF is present for the extract script if it's not committed
# If Viikkopelit_15_5_2025.pdf is always the same and committed, this is fine.
# If it changes, you'll need a way to get it into the build context or into the container.

# First, generate parsed_pdf_data.json from the PDF
RUN node --loader ts-node/esm src/pdfParser.ts

# Generate the extracted_games_output.json
RUN npm run extract

# Build the project (compile TypeScript and Tailwind CSS)
RUN npm run build

# Prune devDependencies after build and extract are complete
RUN npm prune --production

# Make port 3002 available to the world outside this container
EXPOSE 3002

# Define environment variables (if any, e.g. PORT)
# ENV PORT=3002 # Uncomment and set if your app uses process.env.PORT

# Run the app when the container launches
CMD [ "npm", "start" ] 