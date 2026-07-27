# Docker Deployment Guide for Kutlu101

## Overview
This guide covers deploying Kutlu101 using Docker containers for both the frontend (React/Vite) and backend (Node.js/Express) services.

## Prerequisites
- Docker installed on your system
- Docker Compose installed (usually comes with Docker Desktop)

## Quick Start

### 1. Configure Environment Variables

```bash
# Copy the example .env file
cp .env.example .env

# Edit .env with your configuration
nano .env  # or use your preferred editor
```

### 2. Build and Run

```bash
# Make the build script executable (first time only)
chmod +x build-docker.sh

# Build the Docker images
./build-docker.sh build

# Start the containers
./build-docker.sh up
```

### 3. Access the Application
- **Frontend**: http://localhost
- **Backend**: http://localhost:3001

## Build Script Commands

| Command | Description |
|---------|-------------|
| `./build-docker.sh build` | Build Docker images |
| `./build-docker.sh up` | Start containers in detached mode |
| `./build-docker.sh down` | Stop and remove containers |
| `./build-docker.sh restart` | Restart running containers |
| `./build-docker.sh logs` | View container logs (follow mode) |
| `./build-docker.sh rebuild` | Rebuild and restart containers |
| `./build-docker.sh clean` | Remove containers and clean up |

## Manual Docker Commands

### Using Docker Compose

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild with no cache
docker-compose build --no-cache
```

### Individual Service Commands

```bash
# Start only the server
docker-compose up -d server

# Start only the client
docker-compose up -d client

# View server logs
docker-compose logs -f server

# View client logs
docker-compose logs -f client
```

## Environment Variables

### Server Variables (.env)
- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment mode (development/production)

### Client Variables (.env)
- `VITE_SERVER_URL`: WebSocket server URL for socket.io connection
- `CLIENT_PORT`: Frontend exposed port (default: 80)

## Production Deployment

### Change Server URL for Production

Edit `.env`:
```env
VITE_SERVER_URL=https://your-domain.com
```

Then rebuild:
```bash
./build-docker.sh rebuild
```

### Using Different Ports

Edit `.env`:
```env
PORT=3001
CLIENT_PORT=8080
```

Then restart:
```bash
./build-docker.sh restart
```

## Troubleshooting

### Containers won't start
```bash
# Check container logs
docker-compose logs

# Check specific service logs
docker-compose logs server
docker-compose logs client
```

### Port already in use
Edit `.env` and change the port numbers, then:
```bash
./build-docker.sh down
./build-docker.sh up
```

### Need to clean everything
```bash
./build-docker.sh clean
```

### Socket connection issues
Ensure `VITE_SERVER_URL` in `.env` matches your server's actual URL:
- Local: `http://localhost:3001` or `http://server:3001` (within Docker network)
- Production: `https://your-domain.com`

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Nginx (80)    │────>│  React Client   │
│                 │     │  (Vite Build)   │
└─────────────────┘     └─────────────────┘
                                │
                                │ socket.io
                                ↓
┌─────────────────┐     ┌─────────────────┐
│  Express (3001) │<────│  Socket.IO       │
│  Server         │     └─────────────────┘
└─────────────────┘
```

## Development vs Production

### Development (with hot reload)
Use the standard npm commands instead of Docker:
```bash
# Terminal 1 - Server
cd server
npm run dev

# Terminal 2 - Client
npm run dev
```

### Production (Docker)
Use the Docker setup as described above for optimized, containerized deployment.
