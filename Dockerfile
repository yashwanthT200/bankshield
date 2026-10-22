# Lightweight Alpine Linux with Node.js
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies if present, with clean cache
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy application source code
COPY . .

# Expose microservice ports
EXPOSE 3000 8001 8002

# Non-root user for security best practices
USER node

# Start the banking service
CMD ["node", "server.js"]
