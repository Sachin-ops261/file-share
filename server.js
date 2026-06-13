const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("User connected");

    socket.on("join-room", (roomId) => {

    console.log(`Joined room: ${roomId}`);

    socket.join(roomId);

    socket.to(roomId).emit("user-joined");
    });

    socket.on("signal", ({ roomId, data }) => {
        socket.to(roomId).emit("signal", data);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });
    socket.on("test-message", (msg) => {
    
        console.log(msg);
    
        socket.broadcast.emit("test-message", msg);
    
    });
});


server.listen(process.env.PORT || 3000, () => {
    console.log("Server running");
});