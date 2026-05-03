const { WebcastPushConnection } = require("tiktok-live-connector");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const https = require("https");

const app = express();
const server = http.createServer(app);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
let CURRENT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"; // Voz activa, cambia dinámicamente

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
      path: `/v1/text-to-speech/${CURRENT_VOICE_ID}`,
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
      const giftName = (data.giftName || "").toLowerCase();
      const nickname = data.nickname || data.uniqueId;
      const giftCount = data.repeatCount || 1;

      console.log(`🎁 Regalo recibido: "${data.giftName}" de @${nickname}`); // Para debug

      io.emit("event", {
        type: "gift", user: data.uniqueId, nickname,
        giftName: data.giftName, giftCount, diamondCount: data.diamondCount, timestamp: Date.now(),
      });

      if (ELEVENLABS_API_KEY) {
        try {
          let message = "";

          // Rosa (en varios idiomas que usa TikTok)
          if (giftName.includes("rosa") || giftName.includes("rose") || giftName.includes("flower") || giftName.includes("flor")) {
            message = `¡Bienvenido ${nickname} al live de Luz Álva! Gracias por tu hermosa rosa, qué bonito detalle!`;
          }
          // León
          else if (giftName.includes("leon") || giftName.includes("lion") || giftName.includes("leone")) {
            message = `¡Woow ${nickname} mandó un león! Muchas gracias por ese increíble regalo, eres lo máximo!`;
          }
          // Universo
          else if (giftName.includes("universo") || giftName.includes("universe") || giftName.includes("galaxy")) {
            message = `¡No puede ser! ¡${nickname} mandó el universo! Eso es demasiado generoso!`;
          }
          // Corazón
          else if (giftName.includes("corazon") || giftName.includes("heart") || giftName.includes("love")) {
            message = `¡Aww ${nickname} mandó un corazón! Gracias por tanto amor en el live de Luz Álva!`;
          }
          // Diamante
          else if (giftName.includes("diamante") || giftName.includes("diamond")) {
            message = `¡${nickname} es demasiado bueno! Mandó diamantes al live de Luz Álva, muchas gracias!`;
          }
          // Muchos regalos seguidos
          else if (giftCount >= 10) {
            message = `¡Increíble! ${nickname} mandó ${giftCount} ${data.giftName}. Gracias por tanto apoyo en el live de Luz Álva!`;
          }
          // Cualquier otro regalo
          else {
            message = `¡Gracias ${nickname} por el ${data.giftName}! Qué lindo apoyo en el live de Luz Álva!`;
          }

          console.log(`🔊 TTS: "${message}"`); // Para debug

          const audio = await textToSpeech(message);
          io.emit("tts_audio", { audio });
          io.emit("gift_alert", { message, nickname, giftName: data.giftName, giftCount });
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

app.post("/setvoice", (req, res) => {
  const { voiceId } = req.body;
  if (voiceId) {
    CURRENT_VOICE_ID = voiceId;
    console.log(`🎙️ Voz cambiada a: ${voiceId}`);
    res.json({ success: true, voiceId });
  } else {
    res.status(400).json({ error: "voiceId requerido" });
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
