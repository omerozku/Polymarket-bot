FROM node:20-slim

WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2

# Copy package files
COPY package*.json ./

# Install ALL dependencies
RUN npm install

# Force install telegraf (may not be in lock file)
RUN npm install telegraf

# Copy source code
COPY . .

# Build dashboard frontend
RUN cd dashboard && npm install && npm run build

# Create logs directory
RUN mkdir -p logs

# Expose dashboard port
EXPOSE 3001

# Start with PM2
CMD ["pm2-runtime", "ecosystem.config.cjs"]
