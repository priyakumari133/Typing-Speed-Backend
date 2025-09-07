// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/typingapp')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Simple in-memory storage for rooms (for simplicity)
const rooms = new Map();
const activeGames = new Map();

// Sample text for typing
const sampleTexts = [
  "The quick brown fox jumps over the lazy dog. This pangram contains every letter of the alphabet at least once.",
  "To be or not to be, that is the question. Whether 'tis nobler in the mind to suffer the slings and arrows.",
  "In a hole in the ground there lived a hobbit. Not a nasty, dirty, wet hole filled with the ends of worms.",
  "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.",
  "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse."
];

// Import SoloResult model
const SoloResult = require('./models/SoloResult');

// API routes
const leaderboardRoutes = require('./routes/leaderboard');
app.use('/api', leaderboardRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create room
  socket.on('createRoom', (data) => {
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    const room = {
      code: roomCode,
      creator: data.username,
      players: [{ id: socket.id, username: data.username, ready: false }],
      maxPlayers: 5,
      gameStarted: false,
      gameText: sampleTexts[Math.floor(Math.random() * sampleTexts.length)],
      startTime: null,
      duration: 60 // 60 seconds
    };
    
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, room });
    console.log(`Room created: ${roomCode}`);
  });

  // Join room
  socket.on('joinRoom', (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', 'Room is full');
      return;
    }
    
    if (room.gameStarted) {
      socket.emit('error', 'Game already started');
      return;
    }

    room.players.push({ id: socket.id, username: data.username, ready: false });
    socket.join(data.roomCode);
    
    io.to(data.roomCode).emit('roomUpdated', room);
    socket.emit('roomJoined', room);
    console.log(`${data.username} joined room: ${data.roomCode}`);
  });

  // Player ready
  socket.on('playerReady', (data) => {
    const room = rooms.get(data.roomCode);
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.ready = true;
        io.to(data.roomCode).emit('roomUpdated', room);
        
        // Check if all players are ready (minimum 1 player for testing)
        if (room.players.every(p => p.ready) && room.players.length >= 1) {
          startRoomGame(data.roomCode);
        }
      }
    }
  });

  // Start room game
  function startRoomGame(roomCode) {
    const room = rooms.get(roomCode);
    if (room) {
      room.gameStarted = true;
      room.startTime = Date.now();
      
      // Initialize game state for each player
      room.players.forEach(player => {
        player.typedText = '';
        player.currentIndex = 0;
  player.errorCount = 0;
        player.finished = false;
      });
      
      activeGames.set(roomCode, {
        players: new Map(),
        startTime: room.startTime,
        duration: room.duration
      });
      
      io.to(roomCode).emit('gameStarted', {
        text: room.gameText,
        startTime: room.startTime,
        duration: room.duration
      });
      
      // Set timer for game end
      setTimeout(() => {
        endRoomGame(roomCode);
      }, room.duration * 1000);
    }
  }

  // Handle typing progress
  socket.on('typingProgress', (data) => {
    const room = rooms.get(data.roomCode);
    if (room && room.gameStarted) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.typedText = data.typedText;
        player.currentIndex = data.currentIndex;
  player.errorCount = data.errorCount;
        
        // Broadcast typing progress to other players in the room
        socket.to(data.roomCode).emit('playerTypingUpdate', {
          playerId: socket.id,
          username: player.username,
          typedText: data.typedText,
          currentIndex: data.currentIndex
        });
      }
    }
  });

  // End room game
  function endRoomGame(roomCode) {
    const room = rooms.get(roomCode);
    if (room) {
      const gameResults = room.players.map(player => {
        const wordsTyped = player.typedText.trim().split(' ').length;
        const timeElapsed = room.duration; // Full duration
        const wpm = Math.round((wordsTyped / timeElapsed) * 60);
  const accuracy = Math.round(((player.typedText.length - player.errorCount) / player.typedText.length) * 100) || 0;
        
        return {
          username: player.username,
          wpm,
          accuracy,
          errorCount: player.errorCount,
          score: wpm * (accuracy / 100) // Simple scoring system
        };
      });
      
      // Sort by score (descending)
      gameResults.sort((a, b) => b.score - a.score);
      
      room.gameStarted = false;
      activeGames.delete(roomCode);
      
      io.to(roomCode).emit('gameEnded', { results: gameResults });
    }
  }

  // Get solo game text
  socket.on('getSoloText', () => {
    const text = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
    socket.emit('soloTextReceived', { text });
  });


  // Submit solo game result
  socket.on('submitSoloResult', async (data) => {
    try {
      const result = new SoloResult(data);
      await result.save();
      console.log('Solo game result saved:', data);
      socket.emit('soloResultSaved', { success: true });
    } catch (err) {
      console.error('Error saving solo result:', err);
      socket.emit('soloResultSaved', { success: false, error: 'Database error' });
    }
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove player from all rooms
    for (let [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          // Delete empty room
          rooms.delete(roomCode);
          activeGames.delete(roomCode);
        } else {
          // Notify remaining players
          io.to(roomCode).emit('roomUpdated', room);
        }
      }
    }
  });
});

// REST API Routes
app.get('/api/leaderboard', (req, res) => {
  // Mock leaderboard data (in real app, get from database)
  const leaderboard = [
    { username: 'SpeedTyper1', wpm: 85, accuracy: 98 },
    { username: 'FastFingers', wpm: 82, accuracy: 96 },
    { username: 'KeyboardMaster', wpm: 79, accuracy: 99 },
    { username: 'TypingPro', wpm: 76, accuracy: 94 },
    { username: 'QuickType', wpm: 73, accuracy: 97 }
  ];
  res.json(leaderboard);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});