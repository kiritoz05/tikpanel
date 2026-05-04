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

const sessions = {};

// Mapa global userId -> {uniqueId, nickname} para resolver IDs numericos en batalla
const userMap = {};
function registerUser(data) {
  if (!data) return;
  const uid = String(data.userId || data.id || "");
  const uniqueId = data.uniqueId || data.displayId || "";
  const nickname = data.nickname || data.displayName || data.name || "";
  if (uid && (uniqueId || nickname)) {
    userMap[uid] = { uniqueId: uniqueId || userMap[uid]?.uniqueId || "", nickname: nickname || userMap[uid]?.nickname || "" };
  }
  // También indexar por uniqueId por si acaso
  if (uniqueId) {
    userMap[uniqueId] = userMap[uid] || { uniqueId, nickname };
  }
}

function cleanSession(username) {
  if (sessions[username]) {
    clearTimeout(sessions[username].retryTimer);
    try { sessions[username].tiktok.disconnect(); } catch (e) {}
    delete sessions[username];
  }
}

// Normalizar participante de batalla desde cualquier estructura posible
function normalizeBattleUser(u) {
  if (!u) return null;
  const hostName     = u.uniqueId   || u.displayId   || u.userId   || u.id || "?";
  const hostNickname = u.nickname   || u.displayName || u.name     || hostName;
  const points       = Number(u.battleScore || u.score || u.points || u.teamPoints || 0);
  if (hostName === "?") return null;
  return { hostName, hostNickname, points };
}

// Extraer equipos — estructura real del conector tiktok-live-connector:
// linkMicArmies -> data.battleArmies = [{hostUserId, points, participants:[{userId,nickname,...}]}]
// linkMicBattle -> data.battleUsers  = [{uniqueId, nickname, battleScore}]
function extractTeams(data) {

  // ── CASO 1: linkMicArmies (tick por segundo, estructura más común) ────
  // data.battleArmies = [{ hostUserId:"696...", points:2137, participants:[{userId,nickname,...}] }]
  if (Array.isArray(data.battleArmies) && data.battleArmies.length > 0) {
    return data.battleArmies.map(army => {
      const pts = Number(army.points || army.teamPoints || army.score || 0);
      const hostUserId = String(army.hostUserId || army.hostId || "");

      let hostName     = hostUserId || "?";
      let hostNickname = hostName;

      // Buscar al host en participants usando su userId (comparar como strings)
      if (Array.isArray(army.participants) && army.participants.length > 0) {
        const hostParticipant = army.participants.find(p =>
          String(p.userId)   === String(hostUserId) ||
          String(p.uniqueId) === String(hostUserId) ||
          String(p.id)       === String(hostUserId)
        ) || null; // NO fallback al primero (ese sería un MVP, no el host)

        if (hostParticipant) {
          hostNickname = hostParticipant.nickname || hostParticipant.displayName || hostParticipant.name || hostName;
          // Usar uniqueId como hostName si existe (es el @username), sino el userId numérico
          if (hostParticipant.uniqueId && hostParticipant.uniqueId.length > 0) {
            hostName = hostParticipant.uniqueId;
          }
        } else {
          // El host no está en participants — buscar en userMap global
          const mapped = userMap[hostUserId] || userMap[String(hostUserId)];
          if (mapped && (mapped.uniqueId || mapped.nickname)) {
            hostName     = mapped.uniqueId || hostUserId;
            hostNickname = mapped.nickname || mapped.uniqueId || hostUserId;
          } else {
            // Último recurso: mostrar el ID numérico (se resolverá cuando llegue más data)
            hostName = hostUserId || "?";
            hostNickname = hostName;
          }
        }
      } else if (army.hostUser) {
        hostName     = army.hostUser.uniqueId || army.hostUser.userId || hostName;
        hostNickname = army.hostUser.nickname || army.hostUser.name   || hostName;
      }

      return { hostName, hostNickname, points: pts };
    }).filter(t => t.hostNickname !== "?");
  }

  // ── CASO 2: linkMicBattle (evento inicial) ────────────────────────────
  // data.battleUsers = [{ uniqueId, nickname, battleScore }]
  if (Array.isArray(data.battleUsers) && data.battleUsers.length > 0) {
    return data.battleUsers.map(u => ({
      hostName:     u.uniqueId   || u.displayId || u.userId || "?",
      hostNickname: u.nickname   || u.displayName || u.uniqueId || "?",
      points:       Number(u.battleScore || u.score || u.points || 0),
    })).filter(t => t.hostName !== "?");
  }

  // ── CASO 3: fallback genérico ─────────────────────────────────────────
  const candidates = [data.battleItems, data.users, data.armies, data.items, data.teams].filter(Array.isArray);
  for (const arr of candidates) {
    const teams = arr.map(item => {
      const u = item.hostUser || item.host || item.user || item;
      const base = normalizeBattleUser(u);
      if (!base) return null;
      const pts = Number(item.points || item.battleScore || item.score || base.points || 0);
      return { ...base, points: pts };
    }).filter(Boolean);
    if (teams.length > 0) return teams;
  }
  return [];
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
    registerUser(data);
    io.emit("event", {
      type: "chat",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      comment: data.comment,
      timestamp: Date.now(),
    });
  });

  tiktok.on("gift", (data) => {
    registerUser(data);
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
    registerUser(data);
    io.emit("event", {
      type: "follow",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      timestamp: Date.now(),
    });
  });

  tiktok.on("like", (data) => {
    registerUser(data);
    io.emit("event", {
      type: "like",
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      likeCount: data.likeCount || 1,
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
    // Registrar todos los usuarios del roomUser para resolver IDs de batalla
    if (Array.isArray(data.topViewers)) {
      data.topViewers.forEach(v => registerUser(v.user || v));
    }
    io.emit("viewers", {
      count: data.viewerCount || 0,
      // topViewers viene como array de usuarios activos en algunas versiones del conector
      topViewers: (data.topViewers || []).map(v => ({
        user:     v.user?.uniqueId    || v.uniqueId    || v.userId    || "?",
        nickname: v.user?.nickname    || v.nickname    || v.displayName || "?",
        viewers:  v.memberCount || v.viewerCount || 0,
      })).filter(v => v.user !== "?").slice(0, 50),
    });
  });

  // ── ESPECTADORES: alguien entra al live ────────────────────────────────
  tiktok.on("member", (data) => {
    registerUser(data);
    io.emit("member", {
      user: data.uniqueId,
      nickname: data.nickname || data.uniqueId,
      timestamp: Date.now(),
    });
  });

  // ── BATALLA: linkMicBattle ─────────────────────────────────────────────
  tiktok.on("linkMicBattle", (data) => {
    // Registrar usuarios de la batalla
    if (Array.isArray(data.battleUsers)) data.battleUsers.forEach(u => registerUser(u));
    console.log("[linkMicBattle] raw keys:", Object.keys(data));
    console.log("[linkMicBattle] raw:", JSON.stringify(data).slice(0, 800));

    const teams = extractTeams(data);
    console.log("[linkMicBattle] teams parsed:", JSON.stringify(teams));

    io.emit("battle", {
      status: data.battleStatus || 1,
      teams,
      _raw: JSON.stringify(data).slice(0, 600), // para debug en cliente
      timestamp: Date.now(),
    });
  });

  // ── BATALLA: linkMicArmies (tick por segundo con puntos) ───────────────
  tiktok.on("linkMicArmies", (data) => {
    // Registrar todos los participantes de cada army para resolver IDs
    if (Array.isArray(data.battleArmies)) {
      data.battleArmies.forEach(army => {
        if (Array.isArray(army.participants)) army.participants.forEach(p => registerUser(p));
        if (army.hostUser) registerUser(army.hostUser);
      });
    }
    console.log("[linkMicArmies] raw keys:", Object.keys(data));
    console.log("[linkMicArmies] raw:", JSON.stringify(data).slice(0, 800));

    const teams = extractTeams(data);
    console.log("[linkMicArmies] teams parsed:", JSON.stringify(teams));

    if (teams.length === 0) return; // no emitir vacío
    io.emit("battle", {
      status: 1,
      teams,
      _raw: JSON.stringify(data).slice(0, 600),
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
