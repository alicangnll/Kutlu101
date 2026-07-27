FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including tsx for TypeScript execution)
RUN npm ci --production

# Copy source files
COPY . .

# Expose port
EXPOSE 3001

# Run the server using tsx
CMD ["npx", "tsx", "server.ts"]
