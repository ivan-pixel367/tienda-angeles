import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, query, orderBy } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBynNS9k20lVkP-LBqK-Wh7h_p0rJQ2xiE",
  authDomain: "tienda-angeles.firebaseapp.com",
  projectId: "tienda-angeles",
  storageBucket: "tienda-angeles.appspot.com",
  messagingSenderId: "855025205449",
  appId: "1:855025205449:web:ea9fd83137ba8afdec4d18"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ROLES = { VENDEDOR: "vendedor", COMPRAS: "compras" };

const URGENCIA_CONFIG = {
  alta: { label: "Alta", color: "#FF4444", bg: "#FFF0F0" },
  media: { label: "Media", color: "#FF8C00", bg: "#FFF8F0" },
  baja: { label: "Baja", color: "#22AA66", bg: "#F0FFF6" },
};

const ESTADO_CONFIG = {
  pendiente: { label: "Pendiente", color: "#888", bg: "#F5F5F5" },
  en_proceso: { label: "En proceso", color: "#1A6FD4", bg: "#EDF4FF" },
  comprado: { label: "Comprado", color: "#22AA66", bg: "#F0FFF6" },
  recibido: { label: "Recibido ✓", color: "#22AA66", bg: "#E0FFE8" },
};

// ── QR Scanner ────────────────────────────────────────────────
function QRScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    let interval;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setScanning(true);
          if ("BarcodeDetector" in window) {
            const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
            interval = setInterval(async () => {
              if (videoRef.current?.readyState === 4) {
                try {
                  const codes = await detector.detect(videoRef.current);
                  if (codes.length > 0) { clearInterval(interval); onScan(codes[0].rawValue); }
                } catch {}
              }
            }, 400);
          } else { setError("Tu navegador no soporta escaneo nativo. Ingresá el producto manualmente."); }
        }
      } catch { setError("No se pudo acceder a la cámara. Verificá los permisos del navegador."); }
    };
    start();
    return () => { clearInterval(interval); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#e8c07d", fontFamily: "sans-serif", marginBottom: 16, fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>📷 Apuntá al código QR de la etiqueta</div>
      {error ? (
        <div style={{ color: "#FF8C00", background: "rgba(255,140,0,0.12)", padding: "16px 24px", borderRadius: 12, maxWidth: 300, textAlign: "center", fontSize: 14, border: "1px solid rgba(255,140,0,0.3)" }}>{error}</div>
      ) : (
        <div style={{ position: "relative", width: 280, height: 280, borderRadius: 16, overflow: "hidden" }}>
          <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
          {scanning && <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#e8c07d,transparent)", animation: "scan 2s linear infinite" }} />}
        </div>
      )}
      <button onClick={onClose} style={{ marginTop: 28, background: "rgba(255,255,255,0.13)", color: "#fff", border: "none", padding: "12px 32px", borderRadius: 30, fontSize: 15, cursor: "pointer" }}>Cancelar</button>
      <style>{`@keyframes scan { 0%{top:10px} 50%{top:260px} 100%{top:10px} }`}</style>
    </div>
  );
}

function ImagenVisor({ src, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
      <img src={src} alt="Comprobante" style={{ maxWidth: "92vw", maxHeight: "80vh", borderRadius: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }} />
      <div style={{ color: "#aaa", marginTop: 16, fontSize: 13 }}>Tocá para cerrar</div>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────
export default function App() {
  const [rol, setRol] = useState(null);
  const [pedirPassword, setPedirPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [errorPassword, setErrorPassword] = useState(false);
  const [faltantes, setFaltantes] = useState([]);
  const [vista, setVista] = useState("lista");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [editando, setEditando] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [imagenVista, setImagenVista] = useState(null);
  const [notif, setNotif] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [form, setForm] = useState({
    producto: "", precio: "", descripcion: "", cantidad: "",
    urgencia: "media", vendedor: "", tieneSeña: false, comprobante: null, comprobanteNombre: "",
  });
  const [formCompras, setFormCompras] = useState({ fecha_llegada: "", nota_compras: "", estado: "" });

  // ── Cargar faltantes desde Firebase en tiempo real ──
  useEffect(() => {
    const q = query(collection(db, "faltantes"), orderBy("fecha_reporte", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const datos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setFaltantes(datos);
      setCargando(false);
    }, (error) => {
      console.error("Error cargando faltantes:", error);
      setCargando(false);
    });
    return () => unsubscribe();
  }, []);

  const mostrarNotif = (msg, tipo = "ok") => { setNotif({ msg, tipo }); setTimeout(() => setNotif(null), 3000); };

  const handleQRScan = (raw) => {
    setShowScanner(false);
    const partes = raw.split("|");
    setForm(f => ({ ...f, producto: partes[0]?.trim() || raw.trim(), precio: partes[1]?.trim() || f.precio }));
    setVista("nuevo");
    mostrarNotif("✅ Producto cargado desde QR");
  };

  const handleFoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { mostrarNotif("La imagen no puede superar 8MB", "err"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setForm(f => ({ ...f, comprobante: ev.target.result, comprobanteNombre: file.name }));
    reader.readAsDataURL(file);
  };

  const enviarFaltante = async () => {
    if (!form.producto || !form.vendedor || !form.cantidad) { mostrarNotif("Completá producto, vendedor y cantidad", "err"); return; }
    if (form.tieneSeña && !form.comprobante) { mostrarNotif("Adjuntá la foto de la factura para registrar la seña", "err"); return; }
    try {
      await addDoc(collection(db, "faltantes"), {
        ...form,
        fecha_reporte: new Date().toISOString().slice(0, 10),
        estado: "pendiente",
        fecha_llegada: null,
        nota_compras: "",
        timestamp: Date.now(),
      });
      setForm({ producto: "", precio: "", descripcion: "", cantidad: "", urgencia: "media", vendedor: "", tieneSeña: false, comprobante: null, comprobanteNombre: "" });
      setVista("lista");
      mostrarNotif("¡Faltante reportado!");
    } catch (e) {
      mostrarNotif("Error al guardar. Revisá la conexión.", "err");
      console.error(e);
    }
  };

  const actualizarFaltante = async (id) => {
    try {
      await updateDoc(doc(db, "faltantes", id), formCompras);
      setEditando(null);
      mostrarNotif("Estado actualizado");
    } catch (e) {
      mostrarNotif("Error al actualizar", "err");
      console.error(e);
    }
  };

  const abrirEdicion = (f) => {
    setEditando(f.id);
    setFormCompras({ fecha_llegada: f.fecha_llegada || "", nota_compras: f.nota_compras || "", estado: f.estado });
  };

  const filtrados = faltantes.filter(f => filtroEstado === "todos" ? true : f.estado === filtroEstado);
  const counts = {
    pendiente: faltantes.filter(f => f.estado === "pendiente").length,
    en_proceso: faltantes.filter(f => f.estado === "en_proceso").length,
    comprado: faltantes.filter(f => f.estado === "comprado").length,
  };
  const esCompras = rol === ROLES.COMPRAS;

  const inp = (extra = {}) => ({
    style: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #E8E4DF", fontSize: 15, outline: "none", fontFamily: "inherit", ...extra },
    onFocus: e => e.target.style.borderColor = "#c9943c",
    onBlur: e => e.target.style.borderColor = "#E8E4DF",
  });

  if (!rol) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Sans+3:wght@300;400;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0} .bh{transition:all .22s;cursor:pointer;border:none} .bh:hover{transform:translateY(-3px);box-shadow:0 14px 40px rgba(0,0,0,.45)}
      `}</style>
      <div style={{ textAlign: "center", maxWidth: 440, width: "100%" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#e8c07d,#c9943c)", margin: "0 auto 22px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>🧵</div>
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 34, color: "#fff", fontWeight: 900, marginBottom: 6 }}>Tienda Los Ángeles</h1>
        <p style={{ color: "#a0b4cc", fontFamily: "'Source Sans 3',sans-serif", fontSize: 15, marginBottom: 48 }}>Sistema de gestión de faltantes</p>
        {!pedirPassword ? (
          <>
            <p style={{ color: "#c9d8e8", fontFamily: "'Source Sans 3',sans-serif", fontSize: 12, marginBottom: 20, letterSpacing: 2, textTransform: "uppercase" }}>¿Con qué perfil ingresás?</p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button className="bh" onClick={() => setRol(ROLES.VENDEDOR)} style={{ padding: "20px 30px", background: "linear-gradient(135deg,#e8c07d,#c9943c)", borderRadius: 16, color: "#1a1a2e", fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, minWidth: 150 }}>
                🛍️<br /><span style={{ fontSize: 14, fontFamily: "'Source Sans 3',sans-serif", fontWeight: 600 }}>Vendedor/a</span>
              </button>
              <button className="bh" onClick={() => { setPedirPassword(true); setPasswordInput(""); setErrorPassword(false); }} style={{ padding: "20px 30px", background: "linear-gradient(135deg,#4a9eff,#2176d4)", borderRadius: 16, color: "#fff", fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, minWidth: 150 }}>
                📦<br /><span style={{ fontSize: 14, fontFamily: "'Source Sans 3',sans-serif", fontWeight: 600 }}>Compras</span>
              </button>
            </div>
          </>
        ) : (
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: 28, maxWidth: 340, margin: "0 auto" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <p style={{ color: "#fff", fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Panel de Compras</p>
            <p style={{ color: "#a0b4cc", fontSize: 13, marginBottom: 22 }}>Ingresá la contraseña para continuar</p>
            <input type="password" placeholder="Contraseña" value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setErrorPassword(false); }}
              onKeyDown={e => { if (e.key === "Enter") { if (passwordInput === "comprastienda") { setPedirPassword(false); setPasswordInput(""); setRol(ROLES.COMPRAS); } else setErrorPassword(true); } }}
              style={{ width: "100%", padding: "13px 16px", borderRadius: 12, border: errorPassword ? "2px solid #FF4444" : "2px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 16, outline: "none", marginBottom: 8, fontFamily: "inherit", letterSpacing: 2 }}
              autoFocus />
            {errorPassword && <p style={{ color: "#FF6B6B", fontSize: 13, marginBottom: 12 }}>Contraseña incorrecta</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button className="bh" onClick={() => { setPedirPassword(false); setPasswordInput(""); setErrorPassword(false); }} style={{ flex: 1, padding: "11px", borderRadius: 10, background: "rgba(255,255,255,0.1)", color: "#ccc", fontSize: 14, fontWeight: 600 }}>Volver</button>
              <button className="bh" onClick={() => { if (passwordInput === "comprastienda") { setPedirPassword(false); setPasswordInput(""); setRol(ROLES.COMPRAS); } else setErrorPassword(true); }} style={{ flex: 1, padding: "11px", borderRadius: 10, background: "linear-gradient(135deg,#4a9eff,#2176d4)", color: "#fff", fontSize: 14, fontWeight: 700 }}>Ingresar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F7F5F2", fontFamily: "'Source Sans 3',Georgia,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Source+Sans+3:wght@300;400;600&display=swap');
        *{box-sizing:border-box} .ba{transition:all .15s;cursor:pointer;border:none} .ba:hover{opacity:.85;transform:translateY(-1px)}
        .card{transition:box-shadow .2s} .card:hover{box-shadow:0 8px 32px rgba(0,0,0,.1)} input,textarea,select{font-family:inherit}
      `}</style>

      <div style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)", padding: "0 20px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🧵</span>
            <div>
              <div style={{ fontFamily: "'Playfair Display',serif", color: "#fff", fontSize: 17, fontWeight: 700 }}>Tienda Los Ángeles</div>
              <div style={{ color: "#a0b4cc", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>{esCompras ? "Panel de Compras" : "Panel de Vendedor"}</div>
            </div>
          </div>
          <button className="ba" onClick={() => setRol(null)} style={{ background: "rgba(255,255,255,.12)", color: "#fff", padding: "6px 14px", borderRadius: 8, fontSize: 13 }}>Salir</button>
        </div>
      </div>

      {notif && (
        <div style={{ position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", background: notif.tipo === "err" ? "#FF4444" : "#22AA66", color: "#fff", padding: "11px 22px", borderRadius: 12, fontWeight: 600, fontSize: 14, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,.2)", whiteSpace: "nowrap" }}>
          {notif.msg}
        </div>
      )}

      {showScanner && <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />}
      {imagenVista && <ImagenVisor src={imagenVista} onClose={() => setImagenVista(null)} />}

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px" }}>
        {cargando && (
          <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            <div>Cargando faltantes...</div>
          </div>
        )}

        {esCompras && !cargando && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Pendientes", val: counts.pendiente, color: "#FF8C00", icon: "⏳" },
              { label: "En proceso", val: counts.en_proceso, color: "#1A6FD4", icon: "🔄" },
              { label: "Comprados", val: counts.comprado, color: "#22AA66", icon: "✅" },
            ].map(s => (
              <div key={s.label} style={{ background: "#fff", borderRadius: 14, padding: "14px 10px", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,.06)" }}>
                <div style={{ fontSize: 20 }}>{s.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color, fontFamily: "'Playfair Display',serif" }}>{s.val}</div>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <button className="ba" onClick={() => setVista("lista")} style={{ padding: "10px 18px", borderRadius: 10, fontWeight: 600, fontSize: 14, background: vista === "lista" ? "#1a1a2e" : "#fff", color: vista === "lista" ? "#fff" : "#444", boxShadow: "0 2px 8px rgba(0,0,0,.07)" }}>
            📋 {esCompras ? "Faltantes" : "Ver faltantes"}
          </button>
          {!esCompras && (
            <>
              <button className="ba" onClick={() => setVista("nuevo")} style={{ padding: "10px 18px", borderRadius: 10, fontWeight: 600, fontSize: 14, background: vista === "nuevo" ? "#e8c07d" : "#fff", color: vista === "nuevo" ? "#1a1a2e" : "#444", boxShadow: "0 2px 8px rgba(0,0,0,.07)" }}>
                ✏️ Cargar manualmente
              </button>
              <button className="ba" onClick={() => setShowScanner(true)} style={{ padding: "10px 18px", borderRadius: 10, fontWeight: 600, fontSize: 14, background: "#1a1a2e", color: "#e8c07d", boxShadow: "0 2px 8px rgba(0,0,0,.07)" }}>
                📷 Escanear QR
              </button>
            </>
          )}
        </div>

        {vista === "nuevo" && !esCompras && (
          <div style={{ background: "#fff", borderRadius: 18, padding: 22, boxShadow: "0 2px 20px rgba(0,0,0,.08)", marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 21, marginBottom: 20, color: "#1a1a2e" }}>Reportar producto faltante</h2>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 600, display: "block", marginBottom: 6 }}>Producto / Tela *</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} placeholder="Ej: Tela lino beige 150cm" {...inp()} style={{ ...inp().style, flex: 1 }} onFocus={inp().onFocus} onBlur={inp().onBlur} />
                  <button className="ba" onClick={() => setShowScanner(true)} title="Escanear QR" style={{ padding: "0 16px", borderRadius: 10, background: "#1a1a2e", color: "#e8c07d", fontSize: 20, flexShrink: 0 }}>📷</button>
                </div>
              </div>
              {form.precio && <div style={{ background: "#F0FFF6", border: "1.5px solid #22AA66", borderRadius: 8, padding: "8px 14px", fontSize: 14, color: "#22AA66", fontWeight: 600 }}>💰 Precio del QR: {form.precio}</div>}
              <div>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 600, display: "block", marginBottom: 6 }}>Tu nombre *</label>
                <input value={form.vendedor} onChange={e => setForm({ ...form, vendedor: e.target.value })} placeholder="Ej: María González" {...inp()} />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 600, display: "block", marginBottom: 6 }}>Cantidad a pedir *</label>
                <input value={form.cantidad} onChange={e => setForm({ ...form, cantidad: e.target.value })} placeholder="Ej: 5 rollos, 20 metros..." {...inp()} />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 600, display: "block", marginBottom: 6 }}>Urgencia</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {Object.entries(URGENCIA_CONFIG).map(([key, cfg]) => (
                    <button key={key} className="ba" onClick={() => setForm({ ...form, urgencia: key })} style={{ flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 600, fontSize: 13, background: form.urgencia === key ? cfg.bg : "#F7F5F2", color: form.urgencia === key ? cfg.color : "#888", border: `2px solid ${form.urgencia === key ? cfg.color : "transparent"}` }}>{cfg.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 600, display: "block", marginBottom: 6 }}>Observación</label>
                <textarea value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Color específico, detalle, etc." rows={2} {...inp({ resize: "none" })} />
              </div>
              <div style={{ borderTop: "2px dashed #E8E4DF", paddingTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setForm(f => ({ ...f, tieneSeña: !f.tieneSeña, comprobante: null, comprobanteNombre: "" }))}>
                  <div style={{ width: 46, height: 26, borderRadius: 13, background: form.tieneSeña ? "#c9943c" : "#ddd", position: "relative", transition: "background .2s", flexShrink: 0 }}>
                    <div style={{ position: "absolute", top: 3, left: form.tieneSeña ? 22 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,.25)" }} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#333", userSelect: "none" }}>🧾 El cliente dejó una seña</span>
                </div>
                {form.tieneSeña && (
                  <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                    <div style={{ background: "#FFF8F0", border: "1.5px solid #FF8C00", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#AA5500" }}>⚠️ Adjuntá la foto de la <b>factura del ERP</b> como comprobante.</div>
                    {!form.comprobante ? (
                      <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "20px 14px", borderRadius: 12, border: "2px dashed #c9943c", cursor: "pointer", background: "#FFFBF5", color: "#c9943c", fontWeight: 600, fontSize: 14, textAlign: "center" }}>
                        <span style={{ fontSize: 32 }}>📸</span> Tocá para sacar foto o elegir de galería
                        <span style={{ fontSize: 12, color: "#aaa", fontWeight: 400 }}>Factura del ERP</span>
                        <input type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: "none" }} />
                      </label>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <img src={form.comprobante} alt="Factura" onClick={() => setImagenVista(form.comprobante)} style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 10, cursor: "zoom-in", border: "2px solid #22AA66", display: "block" }} />
                        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
                          <span style={{ background: "#22AA66", color: "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>✓ Adjunta</span>
                          <button className="ba" onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, comprobante: null, comprobanteNombre: "" })); }} style={{ background: "#FF4444", color: "#fff", borderRadius: 20, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button className="ba" onClick={enviarFaltante} style={{ background: "linear-gradient(135deg,#e8c07d,#c9943c)", color: "#1a1a2e", padding: 14, borderRadius: 12, fontWeight: 700, fontSize: 16, fontFamily: "'Playfair Display',serif" }}>
                Enviar aviso de faltante
              </button>
            </div>
          </div>
        )}

        {vista === "lista" && !cargando && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {[["todos","Todos"],["pendiente","Pendientes"],["en_proceso","En proceso"],["comprado","Comprado"],["recibido","Recibidos"]].map(([val, label]) => (
                <button key={val} className="ba" onClick={() => setFiltroEstado(val)} style={{ padding: "7px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, background: filtroEstado === val ? "#1a1a2e" : "#fff", color: filtroEstado === val ? "#fff" : "#666", boxShadow: "0 1px 6px rgba(0,0,0,.07)" }}>
                  {label}
                </button>
              ))}
            </div>
            {filtrados.length === 0 && (
              <div style={{ textAlign: "center", padding: 56, color: "#aaa" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
                <div style={{ fontSize: 16 }}>{faltantes.length === 0 ? "Aún no hay faltantes reportados" : "No hay faltantes en esta categoría"}</div>
              </div>
            )}
            {filtrados.map(f => {
              const urg = URGENCIA_CONFIG[f.urgencia];
              const est = ESTADO_CONFIG[f.estado];
              return (
                <div key={f.id} className="card" style={{ background: "#fff", borderRadius: 16, padding: 18, marginBottom: 14, boxShadow: "0 2px 12px rgba(0,0,0,.06)", borderLeft: `4px solid ${urg?.color || "#ccc"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
                        <h3 style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#1a1a2e", margin: 0 }}>{f.producto}</h3>
                        {urg && <span style={{ background: urg.bg, color: urg.color, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{urg.label}</span>}
                        {est && <span style={{ background: est.bg, color: est.color, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{est.label}</span>}
                        {f.tieneSeña && <span style={{ background: "#FFF8F0", color: "#c9943c", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: "1px solid #e8c07d" }}>🧾 Con seña</span>}
                      </div>
                      {f.descripcion && <p style={{ color: "#666", fontSize: 13, margin: "0 0 8px" }}>{f.descripcion}</p>}
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "#888" }}>📦 <b style={{ color: "#444" }}>{f.cantidad}</b></span>
                        <span style={{ fontSize: 13, color: "#888" }}>👤 <b style={{ color: "#444" }}>{f.vendedor}</b></span>
                        <span style={{ fontSize: 13, color: "#888" }}>📅 {f.fecha_reporte}</span>
                        {f.precio && <span style={{ fontSize: 13, color: "#888" }}>💰 <b style={{ color: "#444" }}>{f.precio}</b></span>}
                        {f.fecha_llegada && <span style={{ fontSize: 13, color: "#22AA66" }}>🚚 Llega: <b>{f.fecha_llegada}</b></span>}
                      </div>
                      {f.nota_compras && (
                        <div style={{ marginTop: 10, background: "#EDF4FF", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#1A6FD4" }}>
                          💬 <b>Compras:</b> {f.nota_compras}
                        </div>
                      )}
                      {f.tieneSeña && f.comprobante && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>📄 Factura / Comprobante de seña</div>
                          <img src={f.comprobante} alt="Comprobante" onClick={() => setImagenVista(f.comprobante)} style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, cursor: "zoom-in", border: "2px solid #e8c07d", display: "block" }} />
                        </div>
                      )}
                    </div>
                    {esCompras && (
                      <button className="ba" onClick={() => editando === f.id ? setEditando(null) : abrirEdicion(f)} style={{ background: editando === f.id ? "#F7F5F2" : "#1a1a2e", color: editando === f.id ? "#444" : "#fff", padding: "8px 14px", borderRadius: 10, fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {editando === f.id ? "Cancelar" : "✏️ Gestionar"}
                      </button>
                    )}
                  </div>
                  {esCompras && editando === f.id && (
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "2px dashed #E8E4DF", display: "grid", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>Estado del pedido</label>
                        <select value={formCompras.estado} onChange={e => setFormCompras({ ...formCompras, estado: e.target.value })} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "2px solid #E8E4DF", fontSize: 15, background: "#fff" }}>
                          <option value="pendiente">⏳ Pendiente</option>
                          <option value="en_proceso">🔄 En proceso</option>
                          <option value="comprado">✅ Comprado</option>
                          <option value="recibido">📬 Recibido</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>Fecha estimada de llegada</label>
                        <input type="date" value={formCompras.fecha_llegada} onChange={e => setFormCompras({ ...formCompras, fecha_llegada: e.target.value })} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "2px solid #E8E4DF", fontSize: 15 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>Nota para el equipo</label>
                        <textarea value={formCompras.nota_compras} onChange={e => setFormCompras({ ...formCompras, nota_compras: e.target.value })} placeholder="Ej: Pedido a Textil Norte, llega el jueves..." rows={2} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "2px solid #E8E4DF", fontSize: 14, resize: "none" }} />
                      </div>
                      <button className="ba" onClick={() => actualizarFaltante(f.id)} style={{ background: "linear-gradient(135deg,#4a9eff,#2176d4)", color: "#fff", padding: 12, borderRadius: 10, fontWeight: 700, fontSize: 15 }}>
                        Guardar cambios
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
