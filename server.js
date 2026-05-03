const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

app.use(cors());
app.use(express.json());

const activeConnections = {};

app.get("/", (req, res) => {
  res.json({ status: "TikPanel Server ✅", connections: Object.keys(activeConnections).length });
});

app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requerido" });

  if (activeConnections[username]) {
    try { activeConnections[username].disconnect(); } catch(e) {}
    delete activeConnections[username];
  }

  try {
    const tiktok = new WebcastPushConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: true,
      enableWebsocketUpgrade: true,
      requestPollingIntervalMs: 2000,
    });

    await tiktok.connect();
    activeConnections[username] = tiktok;
    console.log(`✅ Conectado a @${username}`);

    // COMENTARIOS — solo emite el evento, el panel decide si hace TTS
    tiktok.on("chat", (data) => {
      io.emit("event", {
        type: "chat",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        comment: data.comment,
        timestamp: Date.now(),
      });
    });

    // REGALOS — solo emite el evento, sin mensajes automáticos
    tiktok.on("gift", (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      console.log(`🎁 Regalo: "${data.giftName}" x${data.repeatCount||1} de @${data.uniqueId}`);
      io.emit("event", {
        type: "gift",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        giftName: data.giftName || "",
        giftId: data.giftId || 0,
        giftCount: data.repeatCount || 1,
        diamondCount: data.diamondCount || 0,
        timestamp: Date.now(),
      });
    });

    // SEGUIDORES — solo emite el evento
    tiktok.on("follow", (data) => {
      io.emit("event", {
        type: "follow",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        timestamp: Date.now(),
      });
    });

    // LIKES
    tiktok.on("like", (data) => {
      io.emit("event", {
        type: "like",
        user: data.uniqueId,
        likeCount: data.likeCount || 1,
        timestamp: Date.now(),
      });
    });

    // SUSCRIPCIONES
    tiktok.on("subscribe", (data) => {
      io.emit("event", {
        type: "sub",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        timestamp: Date.now(),
      });
    });

    // COMPARTIR
    tiktok.on("share", (data) => {
      io.emit("event", {
        type: "share",
        user: data.uniqueId,
        nickname: data.nickname || data.uniqueId,
        timestamp: Date.now(),
      });
    });

    // ESPECTADORES
    tiktok.on("roomUser", (data) => {
      io.emit("viewers", { count: data.viewerCount });
    });

    tiktok.on("disconnected", () => {
      console.log(`❌ Desconectado de @${username}`);
      delete activeConnections[username];
      io.emit("disconnected", { username });
    });

    tiktok.on("error", (err) => {
      console.error(`Error @${username}:`, err.message);
      io.emit("error", { message: err.message });
    });

    res.json({ success: true, message: `Conectado a @${username}` });
  } catch (err) {
    console.error("Error al conectar:", err.message);
    res.status(500).json({ error: err.message || "No se pudo conectar. ¿Estás en LIVE?" });
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
