const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const https = require("https");

const app = express();
const server = http.createServer(app);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Bella - voz natural en español

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());

const activeConnections = {};

// ElevenLabs TTS
async function textToSpeech(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
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

app.get("/", (req, res) => {
  res.json({ status: "TikPanel Server activo ✅", connections: Object.keys(activeConnections).length });
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

    // COMENTARIOS
    tiktokLive.on("chat", async (data) => {
      io.emit("event", {
        type: "chat", user: data.uniqueId, nickname: data.nickname,
        comment: data.comment, timestamp: Date.now(),
      });
      if (ELEVENLABS_API_KEY) {
        try {
          const audio = await textToSpeech(`${data.nickname} dice: ${data.comment}`);
          io.emit("tts_audio", { audio });
        } catch(e) { console.error("TTS error:", e.message); }
      }
    });

    // REGALOS
    tiktokLive.on("gift", async (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.emit("event", {
        type: "gift", user: data.uniqueId, nickname: data.nickname,
        giftName: data.giftName, giftCount: data.repeatCount || 1,
        diamondCount: data.diamondCount, timestamp: Date.now(),
      });
      if (ELEVENLABS_API_KEY) {
        try {
          const audio = await textToSpeech(`${data.nickname} envió ${data.repeatCount || 1} ${data.giftName}`);
          io.emit("tts_audio", { audio });
        } catch(e) { console.error("TTS error:", e.message); }
      }
    });

    // SEGUIDORES
    tiktokLive.on("follow", async (data) => {
      io.emit("event", {
        type: "follow", user: data.uniqueId,
        nickname: data.nickname, timestamp: Date.now(),
      });
      if (ELEVENLABS_API_KEY) {
        try {
          const audio = await textToSpeech(`${data.nickname} te siguió`);
          io.emit("tts_audio", { audio });
        } catch(e) { console.error("TTS error:", e.message); }
      }
    });

    // LIKES y ESPECTADORES
    tiktokLive.on("like", (data) => {
      io.emit("event", { type: "like", user: data.uniqueId, likeCount: data.likeCount, timestamp: Date.now() });
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
