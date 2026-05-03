/**
 * gift-sounds.js — Módulo de alertas de sonido para TikPanel
 * ─────────────────────────────────────────────────────────────
 * Integración con tikpanel.html:
 *
 *   1. Agrega este script en tu tikpanel.html:
 *      <script src="gift-sounds.js"></script>
 *
 *   2. En el handler de eventos de Socket.IO, cuando llega un gift:
 *
 *      socket.on("event", (data) => {
 *        if(data.type === "gift") {
 *          GiftSounds.play(data.giftName, data.diamondCount);
 *        }
 *      });
 *
 *   3. Abre gift-sound-alerts.html en otra pestaña para configurar
 *      los sonidos. Los ajustes se comparten via localStorage.
 * ─────────────────────────────────────────────────────────────
 */

const GiftSounds = (() => {

  // ── Mapeo nombre de regalo → id interno ──────────────────────
  const GIFT_MAP = [
    { id: "rose",      keywords: ["rosa", "rose", "flor"] },
    { id: "heart",     keywords: ["corazon", "heart", "amor"] },
    { id: "ice_cream", keywords: ["helado", "ice cream", "icecream"] },
    { id: "perfume",   keywords: ["perfume", "blossom"] },
    { id: "diamond",   keywords: ["diamante", "diamond"] },
    { id: "car",       keywords: ["carro", "car", "sport", "lambo"] },
    { id: "lion",      keywords: ["leon", "lion"] },
    { id: "universe",  keywords: ["universo", "universe", "galaxy", "galaxia"] },
    { id: "rocket",    keywords: ["cohete", "rocket"] },
    { id: "crown",     keywords: ["corona", "crown"] },
    { id: "castle",    keywords: ["castillo", "castle", "palacio"] },
  ];

  // ── Estado interno ────────────────────────────────────────────
  let config = null;
  let audioQueue = [];
  let isPlaying = false;

  // Cargar config desde localStorage (compartida con gift-sound-alerts.html)
  function loadConfig() {
    try {
      const raw = localStorage.getItem("tikpanel_gift_sounds");
      if (raw) config = JSON.parse(raw);
    } catch (e) {
      console.warn("[GiftSounds] No se pudo cargar config:", e);
      config = null;
    }
  }

  // Encontrar ID del regalo por nombre
  function resolveGiftId(giftName) {
    const lname = (giftName || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quitar acentos

    for (const entry of GIFT_MAP) {
      if (entry.keywords.some(kw => lname.includes(kw))) {
        return entry.id;
      }
    }
    return "other"; // fallback
  }

  // Obtener datos de audio de la config
  function getAudioData(giftId) {
    if (!config) return null;

    // 1. Buscar en personalizados primero (mayor prioridad)
    if (config.customGifts) {
      const custom = config.customGifts.find(
        g => g.enabled && g.audioData && g.name &&
          giftId.toLowerCase().includes(g.name.toLowerCase())
      );
      if (custom) return { audioData: custom.audioData, volume: custom.volume ?? 80 };
    }

    // 2. Buscar en predefinidos
    const s = config.state?.[giftId];
    if (s?.enabled && s?.audioData) {
      return { audioData: s.audioData, volume: s.volume ?? 80 };
    }

    // 3. Fallback "other"
    const other = config.state?.other;
    if (other?.enabled && other?.audioData) {
      return { audioData: other.audioData, volume: other.volume ?? 80 };
    }

    return null;
  }

  // Reproducir siguiente de la cola
  function playNext() {
    if (isPlaying || audioQueue.length === 0) return;
    isPlaying = true;

    const { audioData, volume } = audioQueue.shift();
    const masterVol = config?.masterVol ?? 80;
    const effectiveVol = Math.min(1, (masterVol / 100) * (volume / 100));

    const audio = new Audio(audioData);
    audio.volume = effectiveVol;
    audio.onended = () => { isPlaying = false; playNext(); };
    audio.onerror = () => { isPlaying = false; playNext(); };
    audio.play().catch(() => { isPlaying = false; playNext(); });
  }

  // ── API pública ───────────────────────────────────────────────

  /**
   * play(giftName, diamondCount?)
   * Llama esto cuando llega un regalo real de TikTok.
   *
   * Ejemplo:
   *   GiftSounds.play("rosa")        → busca sonido de "Rosa"
   *   GiftSounds.play("Lion", 500)   → busca sonido de "León"
   *   GiftSounds.play("Regalo raro") → usa sonido "Cualquier otro"
   */
  function play(giftName, diamondCount) {
    loadConfig(); // refrescar config cada vez (el usuario puede cambiarla en otra pestaña)

    if (!config) {
      console.info("[GiftSounds] Sin configuración. Abre gift-sound-alerts.html para configurar sonidos.");
      return false;
    }

    const giftId = resolveGiftId(giftName);
    const audioInfo = getAudioData(giftId);

    if (!audioInfo) {
      console.info(`[GiftSounds] Sin sonido configurado para "${giftName}" (id: ${giftId})`);
      return false;
    }

    // Encolar (para no pisar audios cuando hay muchos regalos seguidos)
    audioQueue.push(audioInfo);
    playNext();
    return true;
  }

  /**
   * setMasterVolume(0-100)
   * Cambia el volumen maestro programáticamente.
   */
  function setMasterVolume(vol) {
    loadConfig();
    if (config) {
      config.masterVol = Math.max(0, Math.min(100, vol));
      try { localStorage.setItem("tikpanel_gift_sounds", JSON.stringify(config)); } catch(e){}
    }
  }

  /**
   * test(giftId?)
   * Prueba un sonido manualmente desde consola.
   * Ejemplo: GiftSounds.test("lion")
   */
  function test(giftId = "rose") {
    loadConfig();
    const audioInfo = getAudioData(giftId);
    if (!audioInfo) { console.warn(`[GiftSounds] Sin audio para "${giftId}"`); return; }
    audioQueue.push(audioInfo);
    playNext();
    console.info(`[GiftSounds] Reproduciendo prueba: "${giftId}"`);
  }

  /**
   * clearQueue()
   * Vacía la cola de audio pendiente.
   */
  function clearQueue() {
    audioQueue = [];
    console.info("[GiftSounds] Cola vaciada");
  }

  return { play, test, setMasterVolume, clearQueue };
})();

// ── Integración automática con TikPanel ──────────────────────────────────────
// Si tikpanel.html ya tiene un socket activo, lo conectamos automáticamente.
// (Funciona si gift-sounds.js se carga DESPUÉS del socket en tikpanel.html)
if (typeof window !== "undefined") {
  window.GiftSounds = GiftSounds;

  // Hook automático: interceptar eventos de Socket.IO si ya están definidos
  const origIO = window.io;
  if (origIO) {
    const origConnect = origIO;
    // Escucha el evento "event" globalmente para capturar regalos
    document.addEventListener("tikpanel:gift", (e) => {
      const { giftName, diamondCount } = e.detail || {};
      if (giftName) GiftSounds.play(giftName, diamondCount);
    });
  }

  console.info(
    "%c🎁 GiftSounds cargado",
    "color:#fe2c55;font-weight:bold;font-size:14px",
    "\nUso: GiftSounds.play('rosa') · GiftSounds.test('lion')"
  );
}
