import { useState, useEffect } from "react";

const MOCK_USERS = {
  "admin@tikpanel.com": { password: "admin123", name: "Admin", plan: "Pro" },
  "usuario@tikpanel.com": { password: "pass123", name: "StreamerPro", plan: "Free" },
};

const VOICES = ["Español (España)", "Español (México)", "Español (Argentina)"];
const GIFT_SOUNDS = ["Chime", "Bell", "Coin", "Applause", "Fanfare"];

export default function App() {
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");

  // Dashboard state
  const [tiktokUser, setTiktokUser] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState(VOICES[0]);
  const [ttsVolume, setTtsVolume] = useState(80);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [selectedSound, setSelectedSound] = useState(GIFT_SOUNDS[0]);
  const [chatFilter, setChatFilter] = useState("");
  const [liveStats, setLiveStats] = useState({ viewers: 0, gifts: 0, follows: 0, messages: 0 });
  const [activityLog, setActivityLog] = useState([]);
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      setLiveStats(prev => ({
        viewers: prev.viewers + Math.floor(Math.random() * 5),
        gifts: prev.gifts + (Math.random() > 0.7 ? 1 : 0),
        follows: prev.follows + (Math.random() > 0.8 ? 1 : 0),
        messages: prev.messages + Math.floor(Math.random() * 3),
      }));
      const events = [
        { type: "gift", text: `🎁 @user${Math.floor(Math.random()*1000)} envió una Rosa` },
        { type: "follow", text: `➕ @streamer${Math.floor(Math.random()*999)} te siguió` },
        { type: "message", text: `💬 @fan${Math.floor(Math.random()*500)}: ¡Hola desde el LIVE!` },
        { type: "tts", text: `🔊 TTS: "Gracias por el regalo!"` },
      ];
      if (Math.random() > 0.5) {
        setActivityLog(prev => [events[Math.floor(Math.random() * events.length)], ...prev].slice(0, 20));
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isConnected]);

  useEffect(() => {
    if (!isConnecting) return;
    const interval = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    return () => clearInterval(interval);
  }, [isConnecting]);

  const handleLogin = () => {
    setLoginError("");
    const found = MOCK_USERS[email.toLowerCase()];
    if (found && found.password === password) {
      setUser({ email, name: found.name, plan: found.plan });
      setScreen("app");
    } else {
      setLoginError("Credenciales incorrectas. Contacta al administrador.");
    }
  };

  const handleConnect = () => {
    if (!tiktokUser.trim()) return;
    setIsConnecting(true);
    setTimeout(() => {
      setIsConnecting(false);
      setIsConnected(true);
      setLiveStats({ viewers: 12, gifts: 0, follows: 0, messages: 0 });
      setActivityLog([{ type: "system", text: `✅ Conectado a @${tiktokUser}` }]);
    }, 3000);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setActivityLog([]);
    setLiveStats({ viewers: 0, gifts: 0, follows: 0, messages: 0 });
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "⚡" },
    { id: "tts", label: "TTS", icon: "🔊" },
    { id: "alerts", label: "Alertas", icon: "🔔" },
    { id: "chat", label: "Chat Bot", icon: "💬" },
  ];

  if (screen === "login") {
    return (
      <div style={styles.loginBg}>
        <div style={styles.loginGlow} />
        <div style={styles.loginCard}>
          <div style={styles.loginLogo}>
            <span style={styles.logoMark}>T</span>
            <span style={styles.logoText}>ikPanel</span>
          </div>
          <p style={styles.loginSub}>Plataforma exclusiva para streamers</p>
          <div style={styles.badge}>🔒 Acceso solo por invitación</div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Correo electrónico</label>
            <input
              style={styles.input}
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Contraseña</label>
            <input
              style={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          {loginError && <div style={styles.error}>{loginError}</div>}
          <button style={styles.loginBtn} onClick={handleLogin}>
            Ingresar →
          </button>
          <p style={styles.loginHint}>¿No tienes acceso? Solicítalo al administrador.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.appBg}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <span style={styles.logoMark}>T</span>
          <span style={styles.logoText}>ikPanel</span>
        </div>

        <div style={styles.userCard}>
          <div style={styles.avatar}>{user.name[0]}</div>
          <div>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userPlan}>{user.plan}</div>
          </div>
        </div>

        <div style={styles.statusPill(isConnected)}>
          <span style={styles.statusDot(isConnected)} />
          {isConnected ? `@${tiktokUser}` : "Sin conexión"}
        </div>

        <nav style={styles.nav}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              style={styles.navBtn(activeTab === tab.id)}
              onClick={() => setActiveTab(tab.id)}
            >
              <span style={{ fontSize: 18 }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <button style={styles.logoutBtn} onClick={() => { setScreen("login"); setIsConnected(false); setUser(null); }}>
          Cerrar sesión
        </button>
      </div>

      {/* Main */}
      <div style={styles.main}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.pageTitle}>
              {tabs.find(t => t.id === activeTab)?.icon} {tabs.find(t => t.id === activeTab)?.label}
            </h1>
            <p style={styles.pageSubtitle}>
              {activeTab === "dashboard" && "Estado de tu LIVE en tiempo real"}
              {activeTab === "tts" && "Configura el texto a voz"}
              {activeTab === "alerts" && "Personaliza tus alertas"}
              {activeTab === "chat" && "Automatiza respuestas del chat"}
            </p>
          </div>
          {isConnected && (
            <div style={styles.liveTag}>
              <span style={styles.liveDot} />
              EN VIVO
            </div>
          )}
        </div>

        {/* Content */}
        <div style={styles.content}>

          {/* DASHBOARD TAB */}
          {activeTab === "dashboard" && (
            <div>
              {/* Connect card */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>🎯 Conectar al LIVE</h3>
                <div style={styles.connectRow}>
                  <div style={styles.tiktokInputWrap}>
                    <span style={styles.atSign}>@</span>
                    <input
                      style={styles.tiktokInput}
                      placeholder="tu_usuario_tiktok"
                      value={tiktokUser}
                      onChange={e => setTiktokUser(e.target.value)}
                      disabled={isConnected || isConnecting}
                    />
                  </div>
                  {!isConnected ? (
                    <button
                      style={styles.connectBtn(!isConnecting && tiktokUser)}
                      onClick={handleConnect}
                      disabled={isConnecting || !tiktokUser}
                    >
                      {isConnecting ? `Conectando${dots}` : "Conectar"}
                    </button>
                  ) : (
                    <button style={styles.disconnectBtn} onClick={handleDisconnect}>
                      Desconectar
                    </button>
                  )}
                </div>
                {isConnecting && (
                  <div style={styles.connectingBar}>
                    <div style={styles.connectingFill} />
                  </div>
                )}
              </div>

              {/* Stats */}
              <div style={styles.statsGrid}>
                {[
                  { label: "Espectadores", value: liveStats.viewers, icon: "👁️" },
                  { label: "Regalos", value: liveStats.gifts, icon: "🎁" },
                  { label: "Nuevos seguidores", value: liveStats.follows, icon: "➕" },
                  { label: "Mensajes", value: liveStats.messages, icon: "💬" },
                ].map(stat => (
                  <div key={stat.label} style={styles.statCard}>
                    <div style={styles.statIcon}>{stat.icon}</div>
                    <div style={styles.statValue}>{stat.value.toLocaleString()}</div>
                    <div style={styles.statLabel}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Activity log */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>📋 Actividad en tiempo real</h3>
                <div style={styles.logBox}>
                  {activityLog.length === 0 ? (
                    <div style={styles.logEmpty}>
                      {isConnected ? "Esperando actividad..." : "Conecta tu LIVE para ver la actividad"}
                    </div>
                  ) : (
                    activityLog.map((item, i) => (
                      <div key={i} style={styles.logItem(item.type)}>
                        {item.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TTS TAB */}
          {activeTab === "tts" && (
            <div>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>🔊 Texto a Voz (TTS)</h3>
                <div style={styles.toggleRow}>
                  <span style={styles.settingLabel}>Activar TTS</span>
                  <div style={styles.toggle(ttsEnabled)} onClick={() => setTtsEnabled(!ttsEnabled)}>
                    <div style={styles.toggleKnob(ttsEnabled)} />
                  </div>
                </div>

                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Voz</label>
                  <select style={styles.select} value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} disabled={!ttsEnabled}>
                    {VOICES.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>

                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Volumen: {ttsVolume}%</label>
                  <input
                    type="range" min="0" max="100"
                    value={ttsVolume}
                    onChange={e => setTtsVolume(Number(e.target.value))}
                    style={styles.range}
                    disabled={!ttsEnabled}
                  />
                </div>

                <div style={styles.infoBox}>
                  <strong>¿Cómo funciona?</strong><br />
                  Cuando un espectador envía un mensaje o regalo durante el LIVE, TTS lo lee en voz alta automáticamente. Puedes configurar qué eventos activan el TTS.
                </div>

                <div style={styles.checkGroup}>
                  {["Regalos", "Mensajes del chat", "Nuevos seguidores", "Suscripciones"].map(opt => (
                    <label key={opt} style={styles.checkLabel}>
                      <input type="checkbox" defaultChecked style={{ accentColor: "#fe2c55" }} disabled={!ttsEnabled} />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>

              <div style={styles.card}>
                <h3 style={styles.cardTitle}>🎤 Probar TTS</h3>
                <input style={styles.input} placeholder="Escribe un texto para probar..." />
                <button style={styles.testBtn}>▶ Reproducir prueba</button>
              </div>
            </div>
          )}

          {/* ALERTS TAB */}
          {activeTab === "alerts" && (
            <div>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>🔔 Alertas de Sonido</h3>
                <div style={styles.toggleRow}>
                  <span style={styles.settingLabel}>Activar alertas</span>
                  <div style={styles.toggle(alertsEnabled)} onClick={() => setAlertsEnabled(!alertsEnabled)}>
                    <div style={styles.toggleKnob(alertsEnabled)} />
                  </div>
                </div>

                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Sonido de regalo</label>
                  <select style={styles.select} value={selectedSound} onChange={e => setSelectedSound(e.target.value)} disabled={!alertsEnabled}>
                    {GIFT_SOUNDS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>

                <div style={styles.alertsList}>
                  {[
                    { event: "Nuevo seguidor", icon: "➕", color: "#25f4ee" },
                    { event: "Regalo recibido", icon: "🎁", color: "#fe2c55" },
                    { event: "Suscripción", icon: "⭐", color: "#ffd700" },
                    { event: "Compartir LIVE", icon: "📤", color: "#7c3aed" },
                  ].map(item => (
                    <div key={item.event} style={styles.alertItem}>
                      <div style={{ ...styles.alertIcon, background: item.color + "22", color: item.color }}>
                        {item.icon}
                      </div>
                      <span style={styles.settingLabel}>{item.event}</span>
                      <input type="checkbox" defaultChecked style={{ accentColor: "#fe2c55", marginLeft: "auto" }} disabled={!alertsEnabled} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CHATBOT TAB */}
          {activeTab === "chat" && (
            <div>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>💬 Chat Bot Automático</h3>
                <div style={styles.infoBox}>
                  El bot responde automáticamente a palabras clave en el chat de tu LIVE.
                </div>

                <div style={styles.settingItem}>
                  <label style={styles.settingLabel}>Filtrar por palabra clave</label>
                  <input
                    style={styles.input}
                    placeholder="Ej: !comando, hola, precio..."
                    value={chatFilter}
                    onChange={e => setChatFilter(e.target.value)}
                  />
                </div>

                <div style={styles.commandsList}>
                  {[
                    { trigger: "!hola", response: "¡Hola! Bienvenido al LIVE 🎉" },
                    { trigger: "!precio", response: "Revisa el link en mi bio 👆" },
                    { trigger: "!redes", response: "Sígueme en todas mis redes como @usuario" },
                  ].map((cmd, i) => (
                    <div key={i} style={styles.commandItem}>
                      <div style={styles.commandTrigger}>{cmd.trigger}</div>
                      <div style={styles.commandArrow}>→</div>
                      <div style={styles.commandResponse}>{cmd.response}</div>
                    </div>
                  ))}
                </div>

                <button style={styles.testBtn}>+ Añadir comando</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────
const styles = {
  loginBg: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#0a0a0f", fontFamily: "'Syne', sans-serif", position: "relative", overflow: "hidden",
  },
  loginGlow: {
    position: "absolute", width: 600, height: 600, borderRadius: "50%",
    background: "radial-gradient(circle, rgba(254,44,85,0.15) 0%, transparent 70%)",
    top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none",
  },
  loginCard: {
    background: "#13131a", border: "1px solid #2a2a3a", borderRadius: 24,
    padding: "48px 40px", width: "100%", maxWidth: 420,
    boxShadow: "0 32px 80px rgba(0,0,0,0.6)", position: "relative", zIndex: 1,
  },
  loginLogo: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  logoMark: {
    background: "linear-gradient(135deg, #fe2c55, #25f4ee)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    fontSize: 36, fontWeight: 900, lineHeight: 1,
  },
  logoText: { color: "#fff", fontSize: 28, fontWeight: 800, letterSpacing: -1 },
  loginSub: { color: "#666", fontSize: 14, marginBottom: 20, marginTop: 4 },
  badge: {
    display: "inline-block", background: "rgba(254,44,85,0.1)",
    border: "1px solid rgba(254,44,85,0.3)", color: "#fe2c55",
    borderRadius: 20, padding: "4px 14px", fontSize: 12, marginBottom: 28,
  },
  inputGroup: { marginBottom: 16 },
  label: { display: "block", color: "#888", fontSize: 12, marginBottom: 6, letterSpacing: 0.5 },
  input: {
    width: "100%", background: "#0d0d15", border: "1px solid #2a2a3a",
    borderRadius: 10, padding: "12px 16px", color: "#fff", fontSize: 14,
    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
    transition: "border-color 0.2s",
  },
  error: {
    background: "rgba(254,44,85,0.1)", border: "1px solid rgba(254,44,85,0.3)",
    borderRadius: 8, padding: "10px 14px", color: "#fe2c55", fontSize: 13, marginBottom: 16,
  },
  loginBtn: {
    width: "100%", background: "linear-gradient(135deg, #fe2c55, #ff6b81)",
    border: "none", borderRadius: 10, padding: "14px", color: "#fff",
    fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 8, fontFamily: "inherit",
    letterSpacing: 0.5,
  },
  loginHint: { color: "#444", fontSize: 12, textAlign: "center", marginTop: 20 },

  // APP
  appBg: {
    display: "flex", minHeight: "100vh",
    background: "#0a0a0f", fontFamily: "'Syne', sans-serif", color: "#fff",
  },
  sidebar: {
    width: 240, background: "#10101a", borderRight: "1px solid #1e1e2e",
    display: "flex", flexDirection: "column", padding: "24px 16px",
    position: "sticky", top: 0, height: "100vh", boxSizing: "border-box",
  },
  sidebarLogo: { display: "flex", alignItems: "center", gap: 6, marginBottom: 24, paddingLeft: 8 },
  userCard: {
    display: "flex", alignItems: "center", gap: 10,
    background: "#1a1a2a", borderRadius: 12, padding: "12px 14px", marginBottom: 16,
  },
  avatar: {
    width: 36, height: 36, borderRadius: "50%",
    background: "linear-gradient(135deg, #fe2c55, #25f4ee)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 16, flexShrink: 0,
  },
  userName: { color: "#fff", fontSize: 13, fontWeight: 700 },
  userPlan: { color: "#fe2c55", fontSize: 11, fontWeight: 600, marginTop: 2 },
  statusPill: (on) => ({
    display: "flex", alignItems: "center", gap: 8,
    background: on ? "rgba(37,244,238,0.08)" : "rgba(255,255,255,0.05)",
    border: `1px solid ${on ? "rgba(37,244,238,0.3)" : "#2a2a3a"}`,
    borderRadius: 20, padding: "6px 14px", fontSize: 12,
    color: on ? "#25f4ee" : "#666", marginBottom: 24,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  }),
  statusDot: (on) => ({
    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
    background: on ? "#25f4ee" : "#444",
    boxShadow: on ? "0 0 8px #25f4ee" : "none",
  }),
  nav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navBtn: (active) => ({
    display: "flex", alignItems: "center", gap: 12,
    background: active ? "rgba(254,44,85,0.12)" : "transparent",
    border: active ? "1px solid rgba(254,44,85,0.25)" : "1px solid transparent",
    borderRadius: 10, padding: "11px 14px", color: active ? "#fff" : "#666",
    cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 500,
    fontFamily: "inherit", textAlign: "left", transition: "all 0.15s",
  }),
  logoutBtn: {
    background: "transparent", border: "1px solid #2a2a3a",
    borderRadius: 10, padding: "10px 14px", color: "#555",
    cursor: "pointer", fontSize: 13, fontFamily: "inherit", marginTop: 8,
  },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "auto" },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "28px 32px 0", borderBottom: "1px solid #1e1e2e", paddingBottom: 20,
  },
  pageTitle: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.5 },
  pageSubtitle: { color: "#555", fontSize: 13, marginTop: 4, marginBottom: 0 },
  liveTag: {
    display: "flex", alignItems: "center", gap: 8,
    background: "rgba(254,44,85,0.12)", border: "1px solid rgba(254,44,85,0.3)",
    borderRadius: 20, padding: "6px 16px", color: "#fe2c55",
    fontWeight: 800, fontSize: 12, letterSpacing: 1,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: "50%", background: "#fe2c55",
    boxShadow: "0 0 10px #fe2c55", animation: "pulse 1s infinite",
  },
  content: { padding: 32, flex: 1 },

  // Cards
  card: {
    background: "#13131a", border: "1px solid #1e1e2e",
    borderRadius: 16, padding: "24px", marginBottom: 20,
  },
  cardTitle: { fontSize: 15, fontWeight: 700, margin: "0 0 20px", color: "#fff" },

  // Connect
  connectRow: { display: "flex", gap: 12, alignItems: "center" },
  tiktokInputWrap: {
    display: "flex", alignItems: "center", flex: 1,
    background: "#0d0d15", border: "1px solid #2a2a3a", borderRadius: 10, overflow: "hidden",
  },
  atSign: { color: "#fe2c55", fontWeight: 800, padding: "0 12px", fontSize: 16 },
  tiktokInput: {
    flex: 1, background: "transparent", border: "none", padding: "12px 12px 12px 0",
    color: "#fff", fontSize: 14, outline: "none", fontFamily: "inherit",
  },
  connectBtn: (active) => ({
    background: active ? "linear-gradient(135deg, #fe2c55, #ff6b81)" : "#2a2a3a",
    border: "none", borderRadius: 10, padding: "12px 24px",
    color: active ? "#fff" : "#555", fontSize: 14, fontWeight: 700,
    cursor: active ? "pointer" : "not-allowed", fontFamily: "inherit", whiteSpace: "nowrap",
  }),
  disconnectBtn: {
    background: "rgba(254,44,85,0.1)", border: "1px solid rgba(254,44,85,0.3)",
    borderRadius: 10, padding: "12px 24px", color: "#fe2c55",
    fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  },
  connectingBar: {
    height: 3, background: "#1e1e2e", borderRadius: 2, marginTop: 16, overflow: "hidden",
  },
  connectingFill: {
    height: "100%", width: "60%",
    background: "linear-gradient(90deg, #25f4ee, #fe2c55)",
    borderRadius: 2, animation: "slide 1.5s ease-in-out infinite",
  },

  // Stats
  statsGrid: {
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20,
  },
  statCard: {
    background: "#13131a", border: "1px solid #1e1e2e",
    borderRadius: 16, padding: "20px", textAlign: "center",
  },
  statIcon: { fontSize: 24, marginBottom: 8 },
  statValue: { fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1 },
  statLabel: { color: "#555", fontSize: 11, marginTop: 4, fontWeight: 600, letterSpacing: 0.5 },

  // Log
  logBox: {
    background: "#0d0d15", borderRadius: 10, padding: 16,
    height: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6,
  },
  logEmpty: { color: "#444", fontSize: 13, textAlign: "center", marginTop: 70 },
  logItem: (type) => ({
    fontSize: 12, padding: "6px 10px", borderRadius: 6,
    background: type === "gift" ? "rgba(254,44,85,0.08)"
      : type === "follow" ? "rgba(37,244,238,0.08)"
      : type === "system" ? "rgba(124,58,237,0.08)"
      : "rgba(255,255,255,0.04)",
    color: type === "gift" ? "#fe2c55"
      : type === "follow" ? "#25f4ee"
      : type === "system" ? "#a78bfa"
      : "#888",
    borderLeft: `2px solid ${type === "gift" ? "#fe2c55" : type === "follow" ? "#25f4ee" : type === "system" ? "#a78bfa" : "#333"}`,
  }),

  // Settings
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  toggle: (on) => ({
    width: 44, height: 24, borderRadius: 12, cursor: "pointer", position: "relative",
    background: on ? "#fe2c55" : "#2a2a3a", transition: "background 0.2s",
  }),
  toggleKnob: (on) => ({
    position: "absolute", top: 3, left: on ? 23 : 3,
    width: 18, height: 18, borderRadius: "50%", background: "#fff",
    transition: "left 0.2s",
  }),
  settingItem: { marginBottom: 20 },
  settingLabel: { color: "#aaa", fontSize: 13, display: "block", marginBottom: 8 },
  select: {
    width: "100%", background: "#0d0d15", border: "1px solid #2a2a3a",
    borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14,
    outline: "none", fontFamily: "inherit",
  },
  range: { width: "100%", accentColor: "#fe2c55" },
  infoBox: {
    background: "rgba(37,244,238,0.06)", border: "1px solid rgba(37,244,238,0.15)",
    borderRadius: 10, padding: "14px 16px", color: "#aaa", fontSize: 13,
    lineHeight: 1.6, marginBottom: 20,
  },
  checkGroup: { display: "flex", flexDirection: "column", gap: 12 },
  checkLabel: { display: "flex", alignItems: "center", gap: 10, color: "#aaa", fontSize: 14, cursor: "pointer" },
  testBtn: {
    background: "rgba(254,44,85,0.12)", border: "1px solid rgba(254,44,85,0.25)",
    borderRadius: 10, padding: "10px 20px", color: "#fe2c55",
    fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 4,
  },

  // Alerts
  alertsList: { display: "flex", flexDirection: "column", gap: 10, marginTop: 4 },
  alertItem: { display: "flex", alignItems: "center", gap: 14, padding: "10px 0" },
  alertIcon: { width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 },

  // Commands
  commandsList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  commandItem: { display: "flex", alignItems: "center", gap: 12, background: "#0d0d15", borderRadius: 10, padding: "12px 14px" },
  commandTrigger: { color: "#25f4ee", fontWeight: 700, fontSize: 13, minWidth: 80 },
  commandArrow: { color: "#444" },
  commandResponse: { color: "#aaa", fontSize: 13 },
};
