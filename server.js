const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const https = require("https");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());

// ------------------------- CONFIGURACIÓN -------------------------
const PORT = process.env.PORT || 3001;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "sk_7ce64db43c8f99ea1c7270939973862901e3a5f5385f54aa";
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Bella (español natural)

// Almacenamiento en memoria
const activeConnections = {};     // username -> TikTokLive connection
const activeVoices = {};          // username -> voiceId (para TTS)
const liveStats = {};             // username -> { diamonds: { user: total }, likes: { user: total }, totalLikes, totalDiamonds }
const ttsCooldown = new Map();    // username -> lastCallTime

// ------------------------- FUNCIÓN TTS CON THROTTLE -------------------------
async function textToSpeech(text, voiceId) {
  if (!ELEVENLABS_API_KEY) return null;
  const finalVoice = voiceId || DEFAULT_VOICE_ID;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${finalVoice}`,
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      }
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function throttledTTS(username, text, voiceId) {
  if (!ELEVENLABS_API_KEY) return;
  const now = Date.now();
  const last = ttsCooldown.get(username) || 0;
  if (now - last < 2000) return; // 2 segundos entre TTS
  ttsCooldown.set(username, now);
  try {
    const audioBase64 = await textToSpeech(text, voiceId);
    if (audioBase64) {
      io.to(username).emit("tts_audio", { audio: audioBase64 });
    }
  } catch (err) {
    console.error(`TTS error for ${username}:`, err.message);
  }
}

// ------------------------- INICIALIZAR ESTADÍSTICAS DE UN LIVE -------------------------
function initLiveStats(username) {
  if (!liveStats[username]) {
    liveStats[username] = {
      diamonds: new Map(),   // user -> total diamonds
      likes: new Map(),      // user -> total likes
      totalLikes: 0,
      totalDiamonds: 0,
    };
  }
}

// ------------------------- ENDPOINTS -------------------------
app.get("/", (req, res) => {
  res.json({ status: "TikPanel Server activo ✅", connections: Object.keys(activeConnections).length });
});

// Conectar a un LIVE de TikTok
app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requerido" });

  // Desconectar sesión previa si existe
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
    activeVoices[username] = activeVoices[username] || DEFAULT_VOICE_ID;
    initLiveStats(username);

    console.log(`✅ Conectado a @${username}`);

    // Unir el socket a una sala con el nombre del usuario para enviarle eventos específicos
    io.sockets.sockets.forEach(socket => {
      if (socket.liveUser === username) {
        socket.join(username);
      }
    });

    // Enviar estadísticas actuales al cliente que acaba de conectar (se hace después de que el socket se una)
    setTimeout(() => {
      sendCurrentRanking(username);
    }, 500);

    // ---- EVENTOS DEL LIVE ----
    tiktokLive.on("chat", async (data) => {
      io.emit("event", {
        type: "chat", user: data.uniqueId, nickname: data.nickname,
        comment: data.comment, timestamp: Date.now(),
      });
      const voice = activeVoices[username] || DEFAULT_VOICE_ID;
      await throttledTTS(username, `${data.nickname} dice: ${data.comment}`, voice);
    });

    tiktokLive.on("gift", async (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      const giftCount = data.repeatCount || 1;
      const diamonds = data.diamondCount || 0;
      const totalDiamondsAdded = diamonds * giftCount;

      // Actualizar estadísticas
      const stats = liveStats[username];
      const userDiamonds = stats.diamonds.get(data.uniqueId) || 0;
      stats.diamonds.set(data.uniqueId, userDiamonds + totalDiamondsAdded);
      stats.totalDiamonds += totalDiamondsAdded;

      io.emit("event", {
        type: "gift", user: data.uniqueId, nickname: data.nickname,
        giftName: data.giftName, giftCount: giftCount,
        diamondCount: totalDiamondsAdded, timestamp: Date.now(),
      });
      sendCurrentRanking(username); // actualizar ranking para todos los clientes

      const voice = activeVoices[username] || DEFAULT_VOICE_ID;
      await throttledTTS(username, `${data.nickname} envió ${giftCount} ${data.giftName}`, voice);
    });

    tiktokLive.on("follow", async (data) => {
      io.emit("event", {
        type: "follow", user: data.uniqueId,
        nickname: data.nickname, timestamp: Date.now(),
      });
      const voice = activeVoices[username] || DEFAULT_VOICE_ID;
      await throttledTTS(username, `${data.nickname} te siguió`, voice);
    });

    tiktokLive.on("like", (data) => {
      const likeCount = data.likeCount || 1;
      const stats = liveStats[username];
      const userLikes = stats.likes.get(data.uniqueId) || 0;
      stats.likes.set(data.uniqueId, userLikes + likeCount);
      stats.totalLikes += likeCount;

      io.emit("event", {
        type: "like", user: data.uniqueId, nickname: data.nickname,
        likeCount: likeCount, timestamp: Date.now(),
      });
      sendCurrentRanking(username);
    });

    tiktokLive.on("roomUser", (data) => {
      io.emit("viewers", { count: data.viewerCount });
    });

    tiktokLive.on("disconnected", () => {
      delete activeConnections[username];
      io.emit("disconnected", { username });
      delete activeVoices[username];
      // No borramos liveStats para que si vuelve a conectar se mantengan
    });

    tiktokLive.on("error", (err) => {
      io.emit("error", { message: err.message });
    });

    res.json({ success: true, message: `Conectado a @${username}` });
  } catch (err) {
    console.error(`Error conectando a ${username}:`, err);
    res.status(500).json({ error: err.message || "No se pudo conectar. ¿El usuario está en LIVE?" });
  }
});

// Desconectar un LIVE
app.post("/disconnect", (req, res) => {
  const { username } = req.body;
  if (activeConnections[username]) {
    try { activeConnections[username].disconnect(); } catch(e) {}
    delete activeConnections[username];
  }
  res.json({ success: true });
});

// Cambiar la voz TTS para un LIVE específico
app.post("/setvoice", (req, res) => {
  const { username, voiceId } = req.body;
  if (!username || !voiceId) {
    return res.status(400).json({ error: "Faltan username o voiceId" });
  }
  activeVoices[username] = voiceId;
  console.log(`🔊 Voz cambiada para @${username} a: ${voiceId}`);
  res.json({ success: true });
});

// Enviar ranking actual a todos los clientes conectados a ese LIVE
function sendCurrentRanking(username) {
  const stats = liveStats[username];
  if (!stats) return;

  // Convertir Map a array ordenado
  const diamondsRanking = Array.from(stats.diamonds.entries())
    .map(([user, diamonds]) => ({ user, nickname: user, diamonds }))
    .sort((a,b) => b.diamonds - a.diamonds)
    .slice(0, 10);

  const likesRanking = Array.from(stats.likes.entries())
    .map(([user, count]) => ({ user, nickname: user, count }))
    .sort((a,b) => b.count - a.count)
    .slice(0, 10);

  io.to(username).emit("ranking_update", {
    diamonds: diamondsRanking,
    likes: likesRanking,
    totalDiamonds: stats.totalDiamonds,
    totalLikes: stats.totalLikes,
  });
}

// Cuando un socket se conecta, lo añadimos a la sala correspondiente si ya tiene un live activo
io.on("connection", (socket) => {
  socket.on("join_live", (username) => {
    socket.liveUser = username;
    socket.join(username);
    if (activeConnections[username]) {
      sendCurrentRanking(username);
    }
  });
});

// ------------------------- INICIAR SERVIDOR -------------------------
server.listen(PORT, () => console.log(`🚀 TikPanel Server en puerto ${PORT}`));
