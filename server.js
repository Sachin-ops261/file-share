const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket"] // force WebSocket only, skip long-polling
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Track which room this socket is in (fixes the roomId scope bug)
  let currentRoomId = null;

  socket.on("join-room", (roomId) => {
    console.log(`Socket ${socket.id} joined room: ${roomId}`);
    currentRoomId = roomId;
    socket.join(roomId);
    socket.to(roomId).emit("user-joined");
  });

  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", data);
  });

  // Fixed: roomId is now in scope via currentRoomId
  socket.on("test-message", (msg) => {
    console.log("test-message:", msg);
    if (currentRoomId) {
      socket.to(currentRoomId).emit("test-message", msg);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
});
