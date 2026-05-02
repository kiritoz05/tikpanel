const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Guardar conexiones activas
const activeConnections = {};

// Ruta de salud
app.get("/", (req, res) => {
  res.json({ status: "TikPanel Server activo ✅", connections: Object.keys(activeConnections).length });
});

// Conectar a un usuario de TikTok
app.post("/connect", async (req, res) => {
  const { username } = req.body;

  if (!username) return res.status(400).json({ error: "Username requerido" });

  // Si ya hay conexión activa, desconectar primero
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

    // COMENTARIOS
    tiktokLive.on("chat", (data) => {
      io.emit("event", {
        type: "chat",
        user: data.uniqueId,
        nickname: data.nickname,
        comment: data.comment,
        avatar: data.profilePictureUrl,
        timestamp: Date.now(),
      });
    });

    // REGALOS
    tiktokLive.on("gift", (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.emit("event", {
        type: "gift",
        user: data.uniqueId,
        nickname: data.nickname,
        giftName: data.giftName,
        giftCount: data.repeatCount || 1,
        diamondCount: data.diamondCount,
        avatar: data.profilePictureUrl,
        timestamp: Date.now(),
      });
    });

    // NUEVOS SEGUIDORES
    tiktokLive.on("follow", (data) => {
      io.emit("event", {
        type: "follow",
        user: data.uniqueId,
        nickname: data.nickname,
        avatar: data.profilePictureUrl,
        timestamp: Date.now(),
      });
    });

    // LIKES
    tiktokLive.on("like", (data) => {
      io.emit("event", {
        type: "like",
        user: data.uniqueId,
        likeCount: data.likeCount,
        timestamp: Date.now(),
      });
    });

    // ESPECTADORES
    tiktokLive.on("roomUser", (data) => {
      io.emit("viewers", { count: data.viewerCount });
    });

    // DESCONEXIÓN
    tiktokLive.on("disconnected", () => {
      console.log(`❌ Desconectado de @${username}`);
      delete activeConnections[username];
      io.emit("disconnected", { username });
    });

    // ERROR
    tiktokLive.on("error", (err) => {
      console.error(`Error en @${username}:`, err);
      io.emit("error", { message: err.message });
    });

    res.json({ success: true, message: `Conectado a @${username}` });

  } catch (err) {
    console.error("Error al conectar:", err.message);
    res.status(500).json({ error: err.message || "No se pudo conectar. ¿El usuario está en LIVE?" });
  }
});

// Desconectar
app.post("/disconnect", (req, res) => {
  const { username } = req.body;
  if (activeConnections[username]) {
    try { activeConnections[username].disconnect(); } catch(e) {}
    delete activeConnections[username];
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 TikPanel Server corriendo en puerto ${PORT}`);
});
