FROM node:20-slim

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npx tsc || true

# Expose dashboard port
EXPOSE 3001

# Start with PM2
CMD ["pm2-runtime", "ecosystem.config.cjs"]
