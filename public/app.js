const socket = io();

const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("join");
const fileInput = document.getElementById("file");
const connectionStatus = document.getElementById("connectionStatus");
connectionStatus.textContent = "❌ Not Connected";

let peer;
let roomId;
let receivedChunks = [];
let expectedFileName = "";
let expectedFileSize = 0;
let receivedBytes = 0;
let receiveStartTime = 0;
let sendStartTime = 0;

console.log("app.js loaded");

async function waitForBuffer(peer) {
  const LIMIT = 1024 * 1024; // 1 MB

  while (peer._channel && peer._channel.bufferedAmount > LIMIT) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function sendFileInChunks(peer, file) {
  const CHUNK_SIZE = 64 * 1024;

  let offset = 0;

  while (offset < file.size) {
    await waitForBuffer(peer);

    const chunk = await readChunk(file, offset, offset + CHUNK_SIZE);

    peer.send(chunk);

    offset += CHUNK_SIZE;

    const elapsedSeconds = (Date.now() - sendStartTime) / 1000;

    const speedMBps = offset / 1024 / 1024 / Math.max(elapsedSeconds, 1);

    const remainingMB = (file.size - offset) / 1024 / 1024;

    const etaSeconds = remainingMB / speedMBps;

    const percent = (offset / file.size) * 100;

    if (offset % (1024 * 1024) < CHUNK_SIZE) {
      const percent = (offset / file.size) * 100;

      statusDiv.textContent =
        `Sending ${percent.toFixed(1)}% | ` +
        `${speedMBps.toFixed(1)} MB/s | ` +
        `ETA ${etaSeconds.toFixed(0)}s`;

      progressBar.value = percent;
    }
  }

  peer.send(
    JSON.stringify({
      type: "file-end",
    }),
  );

  console.log("Finished sending");

  statusDiv.textContent = "File Sent ✅";

  progressBar.value = 100;
}

const statusDiv = document.getElementById("status");

const progressBar = document.getElementById("progressBar");


statusDiv.textContent = "Waiting for file...";
connectionStatus.textContent = "❌ Not Connected";
progressBar.value = 0;

async function readChunk(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = reject;

    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

function setupDataHandler(peer) {
  peer.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "file-info") {
        expectedFileName = message.name;
        expectedFileSize = message.size;

        receivedBytes = 0;
        receivedChunks = [];
        receiveStartTime = Date.now();

        console.log(`Incoming file: ${message.name}`);

        return;
      }

      if (message.type === "file-end") {
        const blob = new Blob(receivedChunks);

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");

        a.href = url;
        a.download = expectedFileName;
        a.textContent = `Download ${expectedFileName}`;

        document.body.appendChild(a);

        console.log("File received completely");

        statusDiv.textContent = "Transfer Complete ✅";

        progressBar.value = 100;

        return;
      }
    } catch {}

    receivedChunks.push(data);

    receivedBytes += data.byteLength;

    const elapsedSeconds = (Date.now() - receiveStartTime) / 1000;

    const speedMBps = receivedBytes / 1024 / 1024 / Math.max(elapsedSeconds, 1);

    const remainingMB = (expectedFileSize - receivedBytes) / 1024 / 1024;

    const etaSeconds = remainingMB / speedMBps;

    const percent = (receivedBytes / expectedFileSize) * 100;

    statusDiv.textContent =
      `Receiving ${percent.toFixed(1)}% | ` +
      `${speedMBps.toFixed(1)} MB/s | ` +
      `ETA ${etaSeconds.toFixed(0)}s`;

    progressBar.value = percent;
  });
}

joinBtn.onclick = () => {
  roomId = roomInput.value;

  console.log("Join clicked");

  socket.emit("join-room", roomId);
};

socket.on("user-joined", () => {
  console.log("Another user joined");

  peer = new SimplePeer({
    initiator: true,
    trickle: false,
  });

  peer.on("signal", (data) => {
    console.log("Generated signal");

    socket.emit("signal", {
      roomId,
      data,
    });
  });

  peer.on("connect", () => {
    console.log("WEBRTC CONNECTED");

    connectionStatus.textContent = "✅ Connected to peer";
  });
  peer.on("close", () => {
    console.log("Peer disconnected");

    connectionStatus.textContent = "❌ Peer disconnected";
  });

  peer.on("error", (err) => {
    console.error(err);

    connectionStatus.textContent = "⚠️ Connection error";
  });

  if (!peer) {
    alert("No peer connected.");

    return;
  }

  setupDataHandler(peer);
});

socket.on("signal", (data) => {
  console.log("Received signal");

  if (!peer) {
    peer = new SimplePeer({
      initiator: false,
      trickle: false,
    });

    peer.on("signal", (answerData) => {
      socket.emit("signal", {
        roomId,
        data: answerData,
      });
    });

    peer.on("connect", () => {
      console.log("WEBRTC CONNECTED");

      connectionStatus.textContent = "✅ Connected to peer";
    });
    peer.on("close", () => {
      console.log("Peer disconnected");

      connectionStatus.textContent = "❌ Peer disconnected";
    });

    peer.on("error", (err) => {
      console.error(err);

      connectionStatus.textContent = "⚠️ Connection error";
    });

    if (!peer) {
      alert("No peer connected.");

      return;
    }

    setupDataHandler(peer);
  }

  peer.signal(data);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];

  if (!file || !peer) return;

  console.log("Sending file:", file.name);

  peer.send(
    JSON.stringify({
      type: "file-info",
      name: file.name,
      size: file.size,
    }),
  );

  sendStartTime = Date.now();

  await sendFileInChunks(peer, file);
});
