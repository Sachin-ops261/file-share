const socket = io();

const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("join");
const fileInput = document.getElementById("file");
const connectionStatus = document.getElementById("connectionStatus");
const statusDiv = document.getElementById("status");
const progressBar = document.getElementById("progressBar");
const acceptBtn = document.getElementById("acceptBtn");

connectionStatus.textContent = "❌ Not Connected";
statusDiv.textContent = "Waiting for file...";
progressBar.value = 0;
acceptBtn.style.display = "none";

let peer = null;
let peerDestroyed = true;
let roomId;

// --- Receive state ---
let fileWritableStream = null;
let expectedFileName = "";
let expectedFileSize = 0;
let receivedBytes = 0;
let receiveStartTime = 0;
let pendingChunks = [];
let acceptReady = false;

// --- Send state ---
let sendStartTime = 0;

console.log("app.js loaded");

// ─── Helpers ────────────────────────────────────────────────────────────────

async function waitForBuffer(peer) {
  const LIMIT = 512 * 1024;
  while (peer._channel && peer._channel.bufferedAmount > LIMIT) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function readChunk(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

// ─── Destroy existing peer safely ────────────────────────────────────────────

function destroyPeer() {
  if (peer && !peerDestroyed) {
    peerDestroyed = true;
    try { peer.destroy(); } catch (_) {}
  }
  peer = null;
  peerDestroyed = true;
}

// ─── Send ────────────────────────────────────────────────────────────────────

async function sendFileInChunks(peer, file) {
  const CHUNK_SIZE = 256 * 1024;
  let offset = 0;

  let nextChunk = await readChunk(file, 0, Math.min(CHUNK_SIZE, file.size));

  while (offset < file.size) {
    if (peerDestroyed) {
      statusDiv.textContent = "❌ Transfer cancelled — peer disconnected.";
      return;
    }

    const chunk = nextChunk;
    const nextOffset = offset + chunk.byteLength;

    const nextRead =
      nextOffset < file.size
        ? readChunk(file, nextOffset, Math.min(nextOffset + CHUNK_SIZE, file.size))
        : Promise.resolve(null);

    await waitForBuffer(peer);

    if (peerDestroyed) {
      statusDiv.textContent = "❌ Transfer cancelled — peer disconnected.";
      return;
    }

    peer.send(chunk);
    offset = nextOffset;
    nextChunk = await nextRead;

    const elapsedSeconds = (Date.now() - sendStartTime) / 1000;
    const speedMBps = offset / 1024 / 1024 / Math.max(elapsedSeconds, 0.001);
    const remainingMB = (file.size - offset) / 1024 / 1024;
    const etaSeconds = speedMBps > 0 ? remainingMB / speedMBps : 0;
    const percent = (offset / file.size) * 100;

    statusDiv.textContent =
      `Sending ${percent.toFixed(1)}% | ` +
      `${speedMBps.toFixed(1)} MB/s | ` +
      `ETA ${etaSeconds.toFixed(0)}s`;
    progressBar.value = percent;
  }

  if (!peerDestroyed) {
    peer.send(JSON.stringify({ type: "file-end" }));
    statusDiv.textContent = "File Sent ✅";
    progressBar.value = 100;
    console.log("Finished sending");
  }
}

// ─── Receive ─────────────────────────────────────────────────────────────────

acceptBtn.addEventListener("click", async () => {
  acceptBtn.style.display = "none";
  statusDiv.textContent = "Opening save dialog...";

  try {
    const fileHandle = await window.showSaveFilePicker({ suggestedName: expectedFileName });
    fileWritableStream = await fileHandle.createWritable();

    for (const chunk of pendingChunks) {
      await fileWritableStream.write(chunk);
    }
    pendingChunks = [];
    acceptReady = true;

    statusDiv.textContent = `Receiving ${expectedFileName}...`;
  } catch (err) {
    console.warn("Save dialog cancelled:", err);
    acceptReady = false;
    statusDiv.textContent = "⚠️ Save cancelled – will download when complete.";
  }
});

function setupDataHandler(peer) {
  let fallbackChunks = [];
  let transferEnded = false;

  peer.on("data", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "file-info") {
        expectedFileName = message.name;
        expectedFileSize = message.size;
        receivedBytes = 0;
        receiveStartTime = Date.now();
        pendingChunks = [];
        fallbackChunks = [];
        acceptReady = false;
        fileWritableStream = null;
        transferEnded = false;

        console.log(`Incoming: ${message.name} (${(message.size / 1024 / 1024).toFixed(1)} MB)`);
        acceptBtn.textContent = `💾 Accept & Save "${message.name}"`;
        acceptBtn.style.display = "inline-block";
        statusDiv.textContent = `Incoming file: ${message.name}`;
        return;
      }

      if (message.type === "file-end") {
        transferEnded = true;

        if (fileWritableStream) {
          await fileWritableStream.close();
          fileWritableStream = null;
          statusDiv.textContent = "Transfer Complete ✅ (saved to disk)";
        } else if (!acceptReady) {
          const allChunks = [...pendingChunks, ...fallbackChunks];
          const blob = new Blob(allChunks);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = expectedFileName;
          a.textContent = `⬇️ Download ${expectedFileName}`;
          a.style.cssText = "display:block;margin-top:10px;color:#7c5cff;";
          document.body.appendChild(a);
          statusDiv.textContent = "Transfer Complete ✅ (click link to download)";
        }

        progressBar.value = 100;
        console.log("File received completely");
        return;
      }
    } catch {
      // Binary chunk — fall through
    }

    receivedBytes += data.byteLength;

    if (fileWritableStream && acceptReady) {
      await fileWritableStream.write(data);
    } else if (!transferEnded) {
      pendingChunks.push(data);
    }

    const elapsedSeconds = (Date.now() - receiveStartTime) / 1000;
    const speedMBps = receivedBytes / 1024 / 1024 / Math.max(elapsedSeconds, 0.001);
    const remainingMB = (expectedFileSize - receivedBytes) / 1024 / 1024;
    const etaSeconds = speedMBps > 0 ? remainingMB / speedMBps : 0;
    const percent = (receivedBytes / expectedFileSize) * 100;

    statusDiv.textContent =
      `Receiving ${percent.toFixed(1)}% | ` +
      `${speedMBps.toFixed(1)} MB/s | ` +
      `ETA ${etaSeconds.toFixed(0)}s`;
    progressBar.value = percent;
  });
}

// ─── Peer factory ─────────────────────────────────────────────────────────────

function createPeer(initiator) {
  destroyPeer();
  peerDestroyed = false;

  const p = new SimplePeer({
    initiator,
    trickle: false,
    config: {
      iceServers: [
        { urls: "stun:stun.relay.metered.ca:80" },
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "cc0288dfa1c46de5e3f7e59c",
          credential: "ZrRCBpFN+WNHje8r",
        },
        {
          urls: "turn:global.relay.metered.ca:80?transport=tcp",
          username: "cc0288dfa1c46de5e3f7e59c",
          credential: "ZrRCBpFN+WNHje8r",
        },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "cc0288dfa1c46de5e3f7e59c",
          credential: "ZrRCBpFN+WNHje8r",
        },
        {
          urls: "turns:global.relay.metered.ca:443?transport=tcp",
          username: "cc0288dfa1c46de5e3f7e59c",
          credential: "ZrRCBpFN+WNHje8r",
        },
      ],
    },
  });

  p.on("signal", (data) => {
    socket.emit("signal", { roomId, data });
  });

  p.on("connect", () => {
    console.log("WebRTC connected");
    connectionStatus.textContent = "✅ Connected to peer";
  });

  p.on("close", () => {
    console.log("Peer disconnected");
    peerDestroyed = true;
    connectionStatus.textContent = "❌ Peer disconnected";
  });

  p.on("error", (err) => {
    console.error(err);
    peerDestroyed = true;
    connectionStatus.textContent = "⚠️ Connection error";
  });

  setupDataHandler(p);
  return p;
}

// ─── Socket events ────────────────────────────────────────────────────────────

joinBtn.onclick = () => {
  roomId = roomInput.value.trim();
  if (!roomId) return;
  destroyPeer();
  socket.emit("join-room", roomId);
  connectionStatus.textContent = "⏳ Waiting for peer...";
};

socket.on("user-joined", () => {
  console.log("user-joined — creating initiator peer");
  peer = createPeer(true);
});

socket.on("signal", (data) => {
  if (peer && peer.connected) {
    console.log("Ignored signal — already connected");
    return;
  }

  if (!peer || peerDestroyed) {
    peer = createPeer(false);
  }

  try {
    peer.signal(data);
  } catch (err) {
    console.warn("Ignored bad signal:", err.message);
  }
});

// ─── File input ───────────────────────────────────────────────────────────────

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (!peer || !peer.connected) {
    alert("No peer connected yet.");
    return;
  }

  peer.send(JSON.stringify({ type: "file-info", name: file.name, size: file.size }));
  sendStartTime = Date.now();
  await sendFileInChunks(peer, file);
});