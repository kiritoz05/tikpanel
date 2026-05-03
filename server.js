const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 10000,
  pingTimeout: 5000,
  connectTimeout: 15000,
});

app.use(cors());
app.use(express.json());

// Mapa: username -> { tiktok, retryTimer }
const sessions = {};

function cleanSession(username) {
  if (sessions[username]) {
    clearTimeout(sessions[username].retryTimer);
    try { sessions[username].tiktok.disconnect(); } catch (e) {}
    delete sessions[username];
  }
}

async function startTikTokConnection(username) {
  const tiktok = new WebcastPushConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
  });

  await tiktok.connect();

  sessions[username] = { tiktok, retryTimer: null };

  console.log(`✅ Conectado a @${username}`);

  tiktok.on("chat", (data) => {
    io.emit("event", {
      type: "chat",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      comment: data.comment,
      timestamp: Date.now(),
    });
  });

  tiktok.on("gift", (data) => {
    if (data.giftType === 1 && !data.repeatEnd) return;
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

  tiktok.on("follow", (data) => {
    io.emit("event", {
      type: "follow",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      timestamp: Date.now(),
    });
  });

  tiktok.on("like", (data) => {
    io.emit("event", {
      type: "like",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      // likeCount = total acumulado del live para este usuario (no delta)
      // totalLikeCount = total del live completo
      likeCount: data.likeCount || 1,
      totalLikeCount: data.totalLikeCount || 0,
      timestamp: Date.now(),
    });
  });

  tiktok.on("subscribe", (data) => {
    io.emit("event", {
      type: "sub",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      timestamp: Date.now(),
    });
  });

  tiktok.on("share", (data) => {
    io.emit("event", {
      type: "share",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      timestamp: Date.now(),
    });
  });

  tiktok.on("roomUser", (data) => {
    io.emit("viewers", { count: data.viewerCount });
  });

  // ── BATALLA / VERSUS ──────────────────────────────────────────────────────
  // El evento "linkMicBattle" llega cuando hay puntos de batalla en progreso
  tiktok.on("linkMicBattle", (data) => {
    // data.battleUsers = array con info de cada participante
    // data.battleStatus = 1=en curso, 2=finalizado
    const teams = (data.battleUsers || []).map((u) => ({
      hostName: u.uniqueId || u.displayId || "?",
      hostNickname: u.nickname || u.uniqueId || "?",
      points: u.battleScore || 0,
    }));
    io.emit("battle", {
      status: data.battleStatus || 1,
      teams,
      timestamp: Date.now(),
    });
  });

  // El evento "linkMicArmies" llega cada segundo con puntos actualizados
  tiktok.on("linkMicArmies", (data) => {
    const teams = (data.battleItems || []).map((item) => ({
      hostName: item.hostUser?.uniqueId || item.hostUser?.displayId || "?",
      hostNickname: item.hostUser?.nickname || item.hostUser?.uniqueId || "?",
      points: item.points || 0,
    }));
    io.emit("battle", {
      status: 1,
      teams,
      timestamp: Date.now(),
    });
  });

  tiktok.on("disconnected", () => {
    console.log(`❌ Desconectado de @${username}`);
    if (sessions[username]) delete sessions[username].tiktok;
    io.emit("tiktok_disconnected", { username });
  });

  tiktok.on("error", (err) => {
    console.error(`Error @${username}:`, err.message);
    io.emit("tiktok_error", { username, message: err.message });
  });

  return tiktok;
}

app.get("/", (req, res) => {
  res.json({
    status: "TikPanel Server ✅",
    connections: Object.keys(sessions).length,
    users: Object.keys(sessions),
  });
});

// ── NUEVO: verificar si un usuario está conectado ──────────────────────────
app.get("/status/:username", (req, res) => {
  const { username } = req.params;
  res.json({ connected: !!sessions[username]?.tiktok });
});

app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requerido" });

  cleanSession(username);

  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await startTikTokConnection(username);
      return res.json({ success: true, message: `Conectado a @${username}` });
    } catch (err) {
      lastErr = err.message || "Error desconocido";
      console.warn(`Intento ${attempt}/3 fallido para @${username}: ${lastErr}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  res.status(500).json({ error: lastErr || "No se pudo conectar. ¿Estás en LIVE?" });
});

app.post("/disconnect", (req, res) => {
  const { username } = req.body;
  if (username) cleanSession(username);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 TikPanel Server en puerto ${PORT}`));
