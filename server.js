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

// ── Mapa global userId -> {uniqueId, nickname} ─────────────────────────────
const userMap = {};
function registerUser(data) {
  if (!data) return;
  const uid      = String(data.userId || data.id || "");
  const uniqueId = data.uniqueId || data.displayId || "";
  const nickname = data.nickname || data.displayName || data.name || "";
  if (uid && (uniqueId || nickname)) {
    userMap[uid] = {
      uniqueId: uniqueId || userMap[uid]?.uniqueId || "",
      nickname: nickname || userMap[uid]?.nickname  || "",
    };
  }
  if (uniqueId) userMap[uniqueId] = userMap[uid] || { uniqueId, nickname };
}

// ── Resolver userId numérico → uniqueId usando tiktok-live-connector ────────
// Se conecta brevemente al live del usuario para obtener su uniqueId real.
// Si el usuario no está en live, intentamos con la API pública de TikTok.
const pendingResolve = new Set(); // evitar peticiones duplicadas

async function resolveUserId(numericId, emitCallback) {
  if (!numericId || userMap[numericId]?.uniqueId) return; // ya lo tenemos
  if (pendingResolve.has(numericId)) return;             // ya está en proceso
  pendingResolve.add(numericId);

  console.log(`[resolve] Buscando username para userId: ${numericId}`);

  // Método 1: API pública de TikTok (no requiere autenticación para info básica)
  try {
    const url = `https://www.tiktok.com/api/user/detail/?uniqueId=&secUid=&userId=${numericId}&msToken=&X-Bogus=&_signature=`;
    // TikTok no tiene endpoint público por userId sin auth, intentar scraping básico
    // Usamos el endpoint que usa el propio TikTok en su web
    const res = await fetch(
      `https://www.tiktok.com/node/share/user/@id:${numericId}`,
      { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/"uniqueId":"([^"]+)"/);
      if (m && m[1]) {
        const uniqueId = m[1];
        const nm = text.match(/"nickname":"([^"]+)"/);
        const nickname = nm ? nm[1] : uniqueId;
        console.log(`[resolve] ✅ Método web: ${numericId} → @${uniqueId}`);
        userMap[numericId] = { uniqueId, nickname };
        userMap[uniqueId]  = { uniqueId, nickname };
        pendingResolve.delete(numericId);
        if (emitCallback) emitCallback(numericId, uniqueId, nickname);
        return;
      }
    }
  } catch(e) { console.log("[resolve] Método web falló:", e.message); }

  // Método 2: Intentar conectar brevemente al live del contrincante por userId
  // tiktok-live-connector acepta userId numérico como username en algunos casos
  try {
    const conn = new WebcastPushConnection(numericId, {
      processInitialData: true,
      enableExtendedGiftInfo: false,
      requestPollingIntervalMs: 99999,
    });
    const connectResult = await Promise.race([
      conn.connect(),
      new Promise((_,rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    // El roomInfo contiene info del host
    const roomInfo = connectResult?.roomInfo || connectResult?.room_info || {};
    const owner    = roomInfo.owner || roomInfo.host || {};
    const uniqueId = owner.uniqueId || owner.displayId || owner.unique_id || "";
    const nickname = owner.nickname || owner.display_name || uniqueId;
    try { conn.disconnect(); } catch(e) {}

    if (uniqueId) {
      console.log(`[resolve] ✅ Método live: ${numericId} → @${uniqueId}`);
      userMap[numericId] = { uniqueId, nickname };
      userMap[uniqueId]  = { uniqueId, nickname };
      pendingResolve.delete(numericId);
      if (emitCallback) emitCallback(numericId, uniqueId, nickname);
      return;
    }
  } catch(e) { console.log("[resolve] Método live falló:", e.message); }

  // Método 3: Buscar en la página de TikTok por userId via sigi_state
  try {
    const res = await fetch(
      `https://www.tiktok.com/@id:${numericId}`,
      { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15", "Accept-Language": "es-MX" },
        signal: AbortSignal.timeout(8000), redirect: "follow" }
    );
    const text = await res.text();
    // Buscar uniqueId en el JSON embebido de la página
    const patterns = [
      /"uniqueId":"([^"]{2,50})"/,
      /"unique_id":"([^"]{2,50})"/,
      /"@([a-zA-Z0-9_.]{2,30})"/,
    ];
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1] && !/^\d+$/.test(m[1])) {
        const uniqueId = m[1];
        const nm = text.match(/"nickname":"([^"]+)"/);
        const nickname = nm ? nm[1] : uniqueId;
        console.log(`[resolve] ✅ Método scrape: ${numericId} → @${uniqueId}`);
        userMap[numericId] = { uniqueId, nickname };
        userMap[uniqueId]  = { uniqueId, nickname };
        pendingResolve.delete(numericId);
        if (emitCallback) emitCallback(numericId, uniqueId, nickname);
        return;
      }
    }
  } catch(e) { console.log("[resolve] Método scrape falló:", e.message); }

  console.log(`[resolve] ❌ No se pudo resolver ${numericId}`);
  pendingResolve.delete(numericId);
}

function cleanSession(username) {
  if (sessions[username]) {
    clearTimeout(sessions[username].retryTimer);
    try { sessions[username].tiktok.disconnect(); } catch (e) {}
    delete sessions[username];
  }
}

// Normalizar participante
function normalizeBattleUser(u) {
  if (!u) return null;
  const hostName     = u.uniqueId || u.displayId || u.userId || u.id || "?";
  const hostNickname = u.nickname || u.displayName || u.name || hostName;
  const points       = Number(u.battleScore || u.score || u.points || u.teamPoints || 0);
  if (hostName === "?") return null;
  return { hostName, hostNickname, points };
}

// Extraer equipos
function extractTeams(data) {
  if (Array.isArray(data.battleArmies) && data.battleArmies.length > 0) {
    return data.battleArmies.map(army => {
      const pts        = Number(army.points || army.teamPoints || army.score || 0);
      const hostUserId = String(army.hostUserId || army.hostId || "");

      let hostName     = hostUserId || "?";
      let hostNickname = hostName;

      if (Array.isArray(army.participants) && army.participants.length > 0) {
        const hostParticipant = army.participants.find(p =>
          String(p.userId)   === String(hostUserId) ||
          String(p.uniqueId) === String(hostUserId) ||
          String(p.id)       === String(hostUserId)
        ) || null;

        if (hostParticipant) {
          hostNickname = hostParticipant.nickname || hostParticipant.displayName || hostParticipant.name || hostName;
          if (hostParticipant.uniqueId) hostName = hostParticipant.uniqueId;
        } else {
          const mapped = userMap[hostUserId];
          if (mapped?.uniqueId) {
            hostName     = mapped.uniqueId;
            hostNickname = mapped.nickname || mapped.uniqueId;
          } else {
            hostName = hostUserId || "?";
            hostNickname = hostName;
          }
        }
      } else if (army.hostUser) {
        hostName     = army.hostUser.uniqueId || army.hostUser.userId || hostName;
        hostNickname = army.hostUser.nickname  || army.hostUser.name  || hostName;
      }

      return { hostName, hostNickname, userId: hostUserId, points: pts };
    }).filter(t => t.hostNickname !== "?");
  }

  if (Array.isArray(data.battleUsers) && data.battleUsers.length > 0) {
    return data.battleUsers.map(u => ({
      hostName:     u.uniqueId   || u.displayId || u.userId || "?",
      hostNickname: u.nickname   || u.displayName || u.uniqueId || "?",
      userId:       String(u.userId || u.id || ""),
      points:       Number(u.battleScore || u.score || u.points || 0),
    })).filter(t => t.hostName !== "?");
  }

  const candidates = [data.battleItems, data.users, data.armies, data.items, data.teams].filter(Array.isArray);
  for (const arr of candidates) {
    const teams = arr.map(item => {
      const u    = item.hostUser || item.host || item.user || item;
      const base = normalizeBattleUser(u);
      if (!base) return null;
      const pts  = Number(item.points || item.battleScore || item.score || base.points || 0);
      return { ...base, userId: String(u.userId || u.id || ""), points: pts };
    }).filter(Boolean);
    if (teams.length > 0) return teams;
  }
  return [];
}

// Emitir batalla actualizada cuando se resuelva un ID
function emitUpdatedBattle(ownerUsername, lastTeams, status) {
  return function(resolvedUserId, uniqueId, nickname) {
    const updated = lastTeams.map(t => {
      if (String(t.userId) === String(resolvedUserId) || t.hostName === resolvedUserId) {
        return { ...t, hostName: uniqueId, hostNickname: nickname };
      }
      return t;
    });
    io.emit("battle", { status, teams: updated, ownerUsername, timestamp: Date.now() });
    console.log(`[battle-update] Re-emitido con @${uniqueId} resuelto`);
  };
}

async function startTikTokConnection(username) {
  const tiktok = new WebcastPushConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
  });

  await tiktok.connect();
  const ownerUsername = username.replace(/^@/, "").toLowerCase();
  sessions[username]  = { tiktok, retryTimer: null, ownerUsername };
  console.log(`✅ Conectado a @${username}`);

  tiktok.on("chat", (data) => {
    registerUser(data);
    io.emit("event", { type:"chat", user:data.uniqueId, nickname:data.nickname||data.uniqueId, comment:data.comment, timestamp:Date.now() });
  });

  tiktok.on("gift", (data) => {
    registerUser(data);
    if (data.giftType === 1 && !data.repeatEnd) return;
    io.emit("event", { type:"gift", user:data.uniqueId, nickname:data.nickname||data.uniqueId, giftName:data.giftName||"", giftId:data.giftId||0, giftCount:data.repeatCount||1, diamondCount:data.diamondCount||0, timestamp:Date.now() });
  });

  tiktok.on("follow",    (data) => { registerUser(data); io.emit("event", { type:"follow",  user:data.uniqueId, nickname:data.nickname||data.uniqueId, timestamp:Date.now() }); });
  tiktok.on("like",      (data) => { registerUser(data); io.emit("event", { type:"like",    user:data.uniqueId, nickname:data.nickname||data.uniqueId, likeCount:data.likeCount||1, timestamp:Date.now() }); });
  tiktok.on("subscribe", (data) => {                     io.emit("event", { type:"sub",     user:data.uniqueId, nickname:data.nickname||data.uniqueId, timestamp:Date.now() }); });
  tiktok.on("share",     (data) => {                     io.emit("event", { type:"share",   user:data.uniqueId, nickname:data.nickname||data.uniqueId, timestamp:Date.now() }); });

  tiktok.on("roomUser", (data) => {
    if (Array.isArray(data.topViewers)) data.topViewers.forEach(v => registerUser(v.user || v));
    io.emit("viewers", {
      count: data.viewerCount || 0,
      topViewers: (data.topViewers || []).map(v => ({
        user:     v.user?.uniqueId  || v.uniqueId  || v.userId    || "?",
        nickname: v.user?.nickname  || v.nickname  || v.displayName || "?",
        viewers:  v.memberCount || v.viewerCount || 0,
      })).filter(v => v.user !== "?").slice(0, 50),
    });
  });

  tiktok.on("member", (data) => {
    registerUser(data);
    io.emit("member", { user:data.uniqueId, nickname:data.nickname||data.uniqueId, timestamp:Date.now() });
  });

  // ── linkMicBattle ──────────────────────────────────────────────────────
  tiktok.on("linkMicBattle", (data) => {
    if (Array.isArray(data.battleUsers)) data.battleUsers.forEach(u => registerUser(u));
    console.log("[linkMicBattle] raw:", JSON.stringify(data).slice(0, 600));

    const teams  = extractTeams(data);
    const status = data.battleStatus || 1;
    console.log("[linkMicBattle] teams:", JSON.stringify(teams));

    io.emit("battle", { status, teams, ownerUsername, timestamp: Date.now() });

    // Resolver IDs numéricos automáticamente
    const cb = emitUpdatedBattle(ownerUsername, teams, status);
    teams.forEach(t => {
      if (/^\d{8,}$/.test(t.hostName)) resolveUserId(t.hostName, cb);
      if (/^\d{8,}$/.test(t.userId))   resolveUserId(t.userId,   cb);
    });
  });

  // ── linkMicArmies ──────────────────────────────────────────────────────
  let lastTeams  = [];
  let lastStatus = 1;

  tiktok.on("linkMicArmies", (data) => {
    if (Array.isArray(data.battleArmies)) {
      data.battleArmies.forEach(army => {
        if (Array.isArray(army.participants)) army.participants.forEach(p => registerUser(p));
        if (army.hostUser) registerUser(army.hostUser);
      });
    }

    const teams = extractTeams(data);
    if (teams.length === 0) return;

    lastTeams  = teams;
    lastStatus = 1;

    io.emit("battle", { status: 1, teams, ownerUsername, timestamp: Date.now() });

    // Resolver IDs numéricos automáticamente en background
    const cb = emitUpdatedBattle(ownerUsername, teams, 1);
    teams.forEach(t => {
      if (/^\d{8,}$/.test(t.hostName)) resolveUserId(t.hostName, cb);
      if (/^\d{8,}$/.test(t.userId))   resolveUserId(t.userId,   cb);
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

app.get("/", (req, res) => res.json({ status:"TikPanel Server ✅", connections:Object.keys(sessions).length, users:Object.keys(sessions) }));
app.get("/status/:username", (req, res) => res.json({ connected: !!sessions[req.params.username]?.tiktok }));

app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error:"Username requerido" });
  cleanSession(username);
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await startTikTokConnection(username);
      return res.json({ success:true, message:`Conectado a @${username}` });
    } catch(err) {
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
  res.json({ success:true });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 TikPanel Server en puerto ${PORT}`));
