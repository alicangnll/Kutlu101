#!/bin/bash

# Docker Build Script for Kutlu101
# This script builds and runs the Docker containers for the project

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Kutlu101 Docker Build Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if .env exists, if not copy from .env.example
if [ ! -f .env ]; then
    echo -e "${YELLOW}.env file not found, creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env file with your configuration${NC}"
    exit 1
fi

# Parse command line arguments
COMMAND=${1:-"build"}

case $COMMAND in
    build)
        echo -e "${GREEN}Cleaning up old Kutlu101 containers and images...${NC}"
        docker-compose down --rmi all --volumes --remove-orphans 2>/dev/null || true

        echo -e "${GREEN}Building Docker images...${NC}"
        docker-compose build --no-cache
        echo -e "${GREEN}Build completed successfully!${NC}"
        echo -e "${YELLOW}Run './build-docker.sh up' to start the containers${NC}"
        ;;

    up)
        echo -e "${GREEN}Cleaning old Kutlu101 containers before starting...${NC}"
        docker-compose down --volumes --remove-orphans 2>/dev/null || true

        echo -e "${GREEN}Starting containers...${NC}"
        docker-compose up -d
        echo -e "${GREEN}Containers started successfully!${NC}"
        echo -e "${YELLOW}Client: http://localhost${NC}"
        echo -e "${YELLOW}Server: http://localhost:3001${NC}"
        ;;

    down)
        echo -e "${GREEN}Stopping Kutlu101 containers...${NC}"
        docker-compose down --volumes --remove-orphans
        echo -e "${GREEN}Containers stopped successfully!${NC}"
        ;;

    restart)
        echo -e "${GREEN}Restarting containers...${NC}"
        docker-compose restart
        echo -e "${GREEN}Containers restarted successfully!${NC}"
        ;;

    logs)
        echo -e "${GREEN}Showing logs...${NC}"
        docker-compose logs -f
        ;;

    rebuild)
        echo -e "${GREEN}Rebuilding Kutlu101 with clean setup...${NC}"
        docker-compose down --rmi all --volumes --remove-orphans
        docker-compose build --no-cache
        docker-compose up -d
        echo -e "${GREEN}Containers rebuilt and started successfully!${NC}"
        ;;

    clean)
        echo -e "${YELLOW}Cleaning up Kutlu101 resources...${NC}"
        docker-compose down --rmi all --volumes --remove-orphans
        echo -e "${GREEN}Kutlu101 cleanup completed!${NC}"
        echo -e "${YELLOW}(Other Docker resources untouched)${NC}"
        ;;

    *)
        echo -e "${RED}Usage: ./build-docker.sh [command]${NC}"
        echo ""
        echo "Commands:"
        echo "  build    - Build Docker images"
        echo "  up       - Start containers"
        echo "  down     - Stop containers"
        echo "  restart  - Restart containers"
        echo "  logs     - Show container logs"
        echo "  rebuild  - Rebuild and start containers"
        echo "  clean    - Remove containers and clean up"
        exit 1
        ;;
esac
