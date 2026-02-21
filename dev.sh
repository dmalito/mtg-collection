#!/bin/bash

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${BLUE}🔧 Starting MTG Collection in Development Mode${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${BLUE}Shutting down...${NC}"
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}Starting backend on port 3001...${NC}"
cd backend
npm run dev &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend
echo -e "${GREEN}Starting frontend on port 5173...${NC}"
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo -e "${GREEN}✅ Development servers running!${NC}"
echo -e "${GREEN}Frontend: http://192.168.0.16:5173${NC}"
echo -e "${GREEN}Backend:  http://192.168.0.16:3001/api/health${NC}"
echo -e "${BLUE}Press Ctrl+C to stop both servers${NC}"

# Wait for processes
wait