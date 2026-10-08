const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('[Socket Connected]:', socket.id);

  socket.on('join-room', (rawRoomId) => {
    if (!rawRoomId || typeof rawRoomId !== 'string') return;
    const roomId = rawRoomId.trim().toUpperCase();

    // Leave any previous rooms (except socket's own private room)
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.leave(room);
        socket.to(room).emit('user-left', { socketId: socket.id });
      }
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    const numClients = room ? room.size : 0;

    // Up to 4 users in Mesh topology
    if (numClients >= 4) {
      console.log(`[Room Full] Room ${roomId} has ${numClients} users. Rejecting ${socket.id}`);
      socket.emit('full', roomId);
      return;
    }

    // Get list of existing users in the room before joining
    const existingUsers = room ? Array.from(room) : [];

    socket.join(roomId);
    console.log(`[User Joined] ${socket.id} joined ${roomId}. Existing users:`, existingUsers);

    socket.emit('room-joined', { roomId, existingUsers });

    // Notify existing peers that a new user joined
    socket.to(roomId).emit('user-joined', { socketId: socket.id });
  });

  // Relay targeted WebRTC signaling messages
  socket.on('offer', ({ target, offer }) => {
    if (target && offer) {
      io.to(target).emit('offer', { sender: socket.id, offer });
    }
  });

  socket.on('answer', ({ target, answer }) => {
    if (target && answer) {
      io.to(target).emit('answer', { sender: socket.id, answer });
    }
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    if (target && candidate) {
      io.to(target).emit('ice-candidate', { sender: socket.id, candidate });
    }
  });

  // Real-time In-Call Chat Relay
  socket.on('send-message', ({ roomId, senderName, message, timestamp }) => {
    if (!roomId || !message || typeof message !== 'string') return;
    const cleanRoom = roomId.trim().toUpperCase();
    const payload = {
      senderId: socket.id,
      senderName: senderName || `User (${socket.id.substring(0, 5)})`,
      message: message.trim(),
      timestamp: timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    console.log(`[Chat Message] [${cleanRoom}] from ${socket.id}: ${payload.message}`);
    // Broadcast to everyone in the room (including sender)
    io.to(cleanRoom).emit('receive-message', payload);
  });

  // Hand-Raising Feature Relay
  socket.on('toggle-hand', ({ roomId, isHandRaised }) => {
    if (!roomId) return;
    const cleanRoom = roomId.trim().toUpperCase();
    console.log(`[Hand Toggled] [${cleanRoom}] ${socket.id}: ${isHandRaised ? 'RAISED' : 'LOWERED'}`);
    socket.to(cleanRoom).emit('hand-toggled', {
      socketId: socket.id,
      isHandRaised: !!isHandRaised
    });
  });

  // User explicitly leaves the room (e.g. clicks Leave Call)
  socket.on('leave-room', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        socket.leave(roomId);
        socket.to(roomId).emit('user-left', { socketId: socket.id });
        console.log(`[User Left via Leave-Room] ${socket.id} left ${roomId}`);
      }
    }
  });

  // Handle disconnection
  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        socket.to(roomId).emit('user-left', { socketId: socket.id });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket Disconnected]:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` LinkClick Mesh Server with Chat & Hand-Raise ready!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});