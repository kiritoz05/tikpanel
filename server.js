const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
  perMessageDeflate: false,
});

app.use(cors());
app.use(express.json());

const activeConnections = {};

app.get("/", (req, res) => {
  res.json({ status: "TikPanel Server activo ✅", connections: Object.keys(activeConnections).length });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), connections: Object.keys(activeConnections).length });
});

app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requerido" });

  if (activeConnections[username]) {
    try { activeConnections[username].disconnect(); } catch(e) {}
    delete activeConnections[username];
  }

  try {
    const tiktokLive = new WebcastPushConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: true,
      enableWebsocketUpgrade: true,
      requestPollingIntervalMs: 2000,
    });

    await tiktokLive.connect();
    activeConnections[username] = tiktokLive;
    console.log(`✅ Conectado a @${username}`);

    // Solo emite eventos SIN TTS automático
    tiktokLive.on("chat", (data) => {
      io.emit("event", {
        type: "chat", user: data.uniqueId, nickname: data.nickname,
        comment: data.comment, timestamp: Date.now(),
      });
    });

    tiktokLive.on("gift", (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.emit("event", {
        type: "gift", user: data.uniqueId, nickname: data.nickname || data.uniqueId,
        giftName: data.giftName || "", giftCount: data.repeatCount || 1,
        diamondCount: data.diamondCount, timestamp: Date.now(),
      });
    });

    tiktokLive.on("follow", (data) => {
      io.emit("event", {
        type: "follow", user: data.uniqueId,
        nickname: data.nickname, timestamp: Date.now(),
      });
    });

    tiktokLive.on("like", (data) => {
      io.emit("event", {
        type: "like",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        likeCount: data.likeCount || 1,
        timestamp: Date.now()
      });
    });

    tiktokLive.on("roomUser", (data) => {
      io.emit("viewers", { count: data.viewerCount });
    });

    tiktokLive.on("disconnected", () => {
      delete activeConnections[username];
      io.emit("disconnected", { username });
    });

    tiktokLive.on("error", (err) => {
      io.emit("error", { message: err.message });
    });

    res.json({ success: true, message: `Conectado a @${username}` });
  } catch (err) {
    res.status(500).json({ error: err.message || "No se pudo conectar. ¿El usuario está en LIVE?" });
  }
});

app.post("/disconnect", (req, res) => {
  const { username } = req.body;
  if (activeConnections[username]) {
    try { activeConnections[username].disconnect(); } catch(e) {}
    delete activeConnections[username];
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 TikPanel Server en puerto ${PORT}`));
