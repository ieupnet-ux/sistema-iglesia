

 ============================================================
// SISTEMA DE GESTIÓN IGLESIA
// Stack: React + Supabase (PostgreSQL + Auth + Storage)
// ============================================================
// CONFIGURACIÓN INICIAL:
// 1. Crea un proyecto en https://supabase.com
// 2. Ejecuta el SQL de setup en el Editor SQL de Supabase
// 3. Reemplaza SUPABASE_URL y SUPABASE_ANON_KEY abajo
// 4. Crea un bucket "miembros" en Storage (público)
// 5. Crea el primer usuario en Supabase Auth y luego en la
//    tabla usuarios_sistema con rol superadmin
// ============================================================

import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";


// ── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = "https://yaywdqnatifscsyeobsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlheXdkcW5hdGlmc2NzeWVvYnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1Nzc2MzEsImV4cCI6MjA5ODE1MzYzMX0.pmI-kZLnaQvhKIlc7mopvRgLsEwcFFqUMiW_TKxwAUY";
const WA_API_URL = "https://api.callmebot.com/whatsapp.php"; // CallMeBot (gratis)
// Para CallMeBot cada miembro debe enviar "I allow callmebot to send me messages"
// al número +34 644 59 37 11 en WhatsApp


// ── CLIENTE SUPABASE (sin dependencias) ──────────────────────
const sb = {
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,
  authToken: null,
  userId: null,

  headers(extra = {}) {
    return {
      "Content-Type": "application/json",
      apikey: this.key,
      Authorization: `Bearer ${this.authToken || this.key}`,
      Prefer: "return=representation",
      ...extra,
    };
  },

  async signIn(email, password) {
    const r = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.key },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (d.access_token) {
      this.authToken = d.access_token;
      this.userId = d.user?.id;
      localStorage.setItem("iglesia_token", d.access_token);
      localStorage.setItem("iglesia_uid", d.user?.id);
    }
    return d;
  },

  async signOut() {
    await fetch(`${this.url}/auth/v1/logout`, { method: "POST", headers: this.headers() });
    this.authToken = null; this.userId = null;
    localStorage.removeItem("iglesia_token"); localStorage.removeItem("iglesia_uid");
  },

  async query(table, params = "") {
    const r = await fetch(`${this.url}/rest/v1/${table}${params}`, { headers: this.headers() });
    if (!r.ok) { const e = await r.json(); throw new Error(e.message || "Error"); }
    return r.json();
  },

  async insert(table, data) {
    const r = await fetch(`${this.url}/rest/v1/${table}`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify(Array.isArray(data) ? data : [data]),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.details || "Error al insertar");
    return d;
  },

  async update(table, id, data) {
    const r = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH", headers: this.headers(), body: JSON.stringify(data),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || "Error al actualizar");
    return d;
  },

  async delete(table, id) {
    const r = await fetch(`${this.url}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE", headers: this.headers({ Prefer: "" }),
    });
    return r.ok;
  },

  async upsert(table, data, onConflict) {
    const qs = onConflict ? `?on_conflict=${onConflict}` : "";
    const r = await fetch(`${this.url}/rest/v1/${table}${qs}`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(Array.isArray(data) ? data : [data]),
    });
    return r.json();
  },

  async uploadPhoto(file, path) {
    const r = await fetch(`${this.url}/storage/v1/object/miembros/${path}`, {
      method: "POST",
      headers: { apikey: this.key, Authorization: `Bearer ${this.authToken || this.key}`, "Content-Type": file.type },
      body: file,
    });
    if (r.ok) return `${this.url}/storage/v1/object/public/miembros/${path}`;
    return null;
  },

  restoreSession() {
    const token = localStorage.getItem("iglesia_token");
    const uid = localStorage.getItem("iglesia_uid");
    if (token) { this.authToken = token; this.userId = uid; return true; }
    return false;
  },
};

// ── CONTEXT ──────────────────────────────────────────────────
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// ── UTILS ────────────────────────────────────────────────────
const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const today = () => new Date().toISOString().split("T")[0];
const calcAge = (dob) => {
  if (!dob) return null;
  const b = new Date(dob + "T12:00:00"), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return age;
};
const isBirthdayToday = (dob) => {
  if (!dob) return false;
  const b = new Date(dob + "T12:00:00"), n = new Date();
  return b.getMonth() === n.getMonth() && b.getDate() === n.getDate();
};
const ESTADO_COLORS = { presente: "#10B981", ausente: "#EF4444", justificado: "#F59E0B", tarde: "#3B82F6" };
const PIE_COLORS = ["#178CC7","#17A57A","#D85A30","#8B5CF6","#F59E0B","#EF4444"];
const PERMS = { superadmin: ["todo"], admin: ["miembros","asistencia","reportes","config"], secretario: ["miembros","asistencia"], lector: ["reportes"] };
const canDo = (usuario, perm) => {
  if (!usuario) return false;
  const rol = usuario.roles_sistema?.nombre;
  const perms = PERMS[rol] || [];
  return perms.includes("todo") || perms.includes(perm);
};

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < breakpoint : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

// ─────────────────────────────────────────────────────────────
// COMPONENTES BASE
// ─────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3800); return () => clearTimeout(t); }, []);
  const roles = { error: "danger", warn: "warning", ok: "success", info: "accent" };
  const r = roles[type] || "success";
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: `var(--bg-${r})`, color: `var(--text-${r})`, border: `0.5px solid var(--border-${r})`, borderRadius: 10, padding: "10px 18px", fontSize: 14, maxWidth: 340, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isMobile ? "stretch" : "flex-start", justifyContent: "center", padding: isMobile ? 0 : "40px 16px", overflowY: "auto" }}>
      <div style={{ background: "var(--surface-2)", borderRadius: isMobile ? 0 : 14, border: isMobile ? "none" : "0.5px solid var(--border)", width: "100%", maxWidth: isMobile ? "100%" : (wide ? 900 : 580), minHeight: isMobile ? "100vh" : "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "0.5px solid var(--border)", position: "sticky", top: 0, background: "var(--surface-2)", borderRadius: isMobile ? 0 : "14px 14px 0 0", zIndex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--text-muted)", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ padding: isMobile ? 16 : 20 }}>{children}</div>
      </div>
    </div>
  );
}

function Badge({ label, role }) {
  const autoRole = { activo: "success", inactivo: "danger", visita: "warning", retirado: "danger", presente: "success", ausente: "danger", justificado: "warning", tarde: "accent" };
  const r = role || autoRole[label] || "accent";
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, background: `var(--bg-${r})`, color: `var(--text-${r})`, border: `0.5px solid var(--border-${r})`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Inp({ label, ...p }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</label>}
      <input {...p} style={{ width: "100%", boxSizing: "border-box", ...p.style }} />
    </div>
  );
}

function Sel({ label, children, ...p }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</label>}
      <select {...p} style={{ width: "100%", boxSizing: "border-box" }}>{children}</select>
    </div>
  );
}

function Btn({ children, variant = "secondary", small, icon, loading, ...p }) {
  const s = {
    primary: { background: "var(--fill-accent)", color: "var(--on-accent)", border: "none" },
    secondary: { background: "transparent", color: "var(--text-primary)", border: "0.5px solid var(--border-strong)" },
    danger: { background: "var(--bg-danger)", color: "var(--text-danger)", border: "0.5px solid var(--border-danger)" },
    success: { background: "var(--bg-success)", color: "var(--text-success)", border: "0.5px solid var(--border-success)" },
    ghost: { background: "transparent", color: "var(--text-secondary)", border: "none" },
    warning: { background: "var(--bg-warning)", color: "var(--text-warning)", border: "0.5px solid var(--border-warning)" },
  };
  return (
    <button {...p} disabled={loading || p.disabled} style={{ cursor: "pointer", borderRadius: "var(--radius)", fontFamily: "var(--font-sans)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: small ? 12 : 14, padding: small ? "4px 10px" : "8px 16px", fontWeight: 500, ...s[variant], ...p.style }}>
      {icon && <i className={`ti ti-${loading ? "loader-2" : icon}`} style={{ fontSize: small ? 13 : 15 }} aria-hidden />}
      {children}
    </button>
  );
}

function Spinner() {
  return <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}><i className="ti ti-loader-2" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />Cargando...</div>;
}

function SectionHeader({ title, icon, action, role = "accent" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: `var(--bg-${role})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className={`ti ti-${icon}`} style={{ fontSize: 18, color: `var(--text-${role})` }} aria-hidden />
        </span>
        {title}
      </h2>
      {action}
    </div>
  );
}

function Avatar({ foto, nombre, size = 36 }) {
  const initials = nombre ? nombre.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() : "?";
  if (foto) return <img src={foto} alt={nombre} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "0.5px solid var(--border)" }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--bg-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 500, color: "var(--text-accent)", flexShrink: 0 }}>
      {initials}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState(""), [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const data = await sb.signIn(email, pass);
      if (!data.access_token) { setError(data.error_description || "Credenciales incorrectas"); return; }
      const usuarios = await sb.query("usuarios_sistema", `?auth_id=eq.${data.user.id}&select=*,roles_sistema(id,nombre,descripcion,permisos),templos(id,nombre)`);
      if (!usuarios.length) { setError("Usuario no autorizado. Contacta al administrador."); sb.signOut(); return; }
      if (!usuarios[0].activo) { setError("Tu cuenta está desactivada."); sb.signOut(); return; }
      onLogin(usuarios[0]);
    } catch (err) { setError(err.message || "Error de conexión"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-0)", padding: 20 }}>
      <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "40px 36px", width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, background: "var(--bg-accent)", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <i className="ti ti-building-church" style={{ fontSize: 32, color: "var(--text-accent)" }} />
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 500 }}>Sistema Iglesia</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Gestión integral de miembros y asistencia</p>
        </div>
        <form onSubmit={handleLogin}>
          <Inp label="Correo electrónico" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="usuario@iglesia.com" autoFocus />
          <Inp label="Contraseña" type="password" value={pass} onChange={e => setPass(e.target.value)} required placeholder="••••••••" />
          {error && <div style={{ fontSize: 13, color: "var(--text-danger)", background: "var(--bg-danger)", padding: "8px 12px", borderRadius: 8, marginBottom: 14 }}>{error}</div>}
          <Btn variant="primary" style={{ width: "100%", justifyContent: "center" }} loading={loading} icon="login">
            {loading ? "Ingresando..." : "Ingresar al sistema"}
          </Btn>
        </form>
        <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginTop: 24, marginBottom: 0 }}>¿Sin acceso? Contacta al administrador</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR NAVEGACIÓN
// ─────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: "dashboard", icon: "layout-dashboard", label: "Inicio", perm: null, role: "accent" },
  { id: "miembros", icon: "users", label: "Miembros", perm: "miembros", role: "pro" },
  { id: "asistencia", icon: "clipboard-check", label: "Asistencia", perm: "asistencia", role: "success" },
  { id: "historial", icon: "user-search", label: "Historial", perm: "asistencia", role: "warning" },
  { id: "reportes", icon: "chart-bar", label: "Reportes", perm: "reportes", role: "danger" },
  { id: "config", icon: "settings", label: "Configuración", perm: "config", role: "accent" },
];

function Sidebar({ active, onChange, usuario, onLogout, isMobile, isOpen, onCloseMenu }) {
  const rol = usuario?.roles_sistema?.nombre;

  const handleNavClick = (id) => {
    onChange(id);
    if (isMobile) onCloseMenu();
  };

  const sidebarContent = (
    <div style={{ width: isMobile ? 260 : 220, background: "var(--surface-1)", borderRight: "0.5px solid var(--border)", display: "flex", flexDirection: "column", height: "100vh", flexShrink: 0, position: isMobile ? "fixed" : "sticky", top: 0, left: 0, zIndex: 1100, transform: isMobile ? (isOpen ? "translateX(0)" : "translateX(-100%)") : "none", transition: "transform 0.25s ease" }}>
      <div style={{ padding: "20px 18px 16px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, background: "var(--bg-accent)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-building-church" style={{ fontSize: 20, color: "var(--text-accent)" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>Mi Iglesia</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{usuario?.templos?.nombre || "Sistema"}</div>
          </div>
        </div>
        {isMobile && (
          <button onClick={onCloseMenu} aria-label="Cerrar menú" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--text-muted)", padding: 4, lineHeight: 1 }}>×</button>
        )}
      </div>

      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {NAV_ITEMS.map(item => {
          if (item.perm && !canDo(usuario, item.perm)) return null;
          const isActive = active === item.id;
          return (
            <button key={item.id} onClick={() => handleNavClick(item.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: isActive ? 500 : 400, background: isActive ? `var(--bg-${item.role})` : "transparent", color: isActive ? `var(--text-${item.role})` : "var(--text-secondary)", marginBottom: 2, textAlign: "left", fontFamily: "var(--font-sans)" }}>
              <i className={`ti ti-${item.icon}`} style={{ fontSize: 17, flexShrink: 0, color: isActive ? `var(--text-${item.role})` : "var(--text-muted)" }} aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: "12px 10px", borderTop: "0.5px solid var(--border)" }}>
        <div style={{ padding: "8px 12px", marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{usuario?.nombre}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{rol}</div>
        </div>
        <button onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: "transparent", color: "var(--text-muted)", fontFamily: "var(--font-sans)" }}>
          <i className="ti ti-logout" style={{ fontSize: 15 }} aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  if (!isMobile) return sidebarContent;

  return (
    <>
      {isOpen && (
        <div onClick={onCloseMenu} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1050 }} />
      )}
      {sidebarContent}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
function Dashboard() {
  const { usuario } = useApp();
  const [stats, setStats] = useState(null);
  const [cumple, setCumple] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [miembros, reuniones, asistencia] = await Promise.all([
          sb.query("miembros", "?select=id,estado,fecha_nacimiento&estado=neq.retirado"),
          sb.query("reuniones", `?fecha=gte.${new Date(Date.now() - 30*86400000).toISOString().split("T")[0]}&select=id,fecha`),
          sb.query("asistencia", `?created_at=gte.${new Date(Date.now() - 30*86400000).toISOString()}&select=estado`),
        ]);
        const activos = miembros.filter(m => m.estado === "activo").length;
        const visitas = miembros.filter(m => m.estado === "visita").length;
        const presentes = asistencia.filter(a => a.estado === "presente").length;
        const pct = asistencia.length ? Math.round(presentes / asistencia.length * 100) : 0;
        const hoy = cumpleañosHoy(miembros);
        setCumple(hoy);
        setStats({ total: miembros.length, activos, visitas, reuniones: reuniones.length, pct });
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const cumpleañosHoy = (ms) => ms.filter(m => isBirthdayToday(m.fecha_nacimiento));

  if (loading) return <Spinner />;

  return (
    <div>
      <h2 style={{ margin: "0 0 20px", fontSize: 20, fontWeight: 500 }}>
        Bienvenido, {usuario?.nombre?.split(" ")[0]} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>— {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span>
      </h2>

      {cumple.length > 0 && (
        <div style={{ background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <i className="ti ti-cake" style={{ fontSize: 22, color: "var(--text-warning)" }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-warning)" }}>🎂 Cumpleaños hoy</div>
            <div style={{ fontSize: 13, color: "var(--text-warning)" }}>{cumple.length} miembro(s) de cumpleaños — ve a Miembros para enviar felicitaciones</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Total miembros", val: stats?.total || 0, icon: "users", role: "accent" },
          { label: "Activos", val: stats?.activos || 0, icon: "user-check", role: "success" },
          { label: "Visitas", val: stats?.visitas || 0, icon: "user-plus", role: "warning" },
          { label: "Reuniones (30d)", val: stats?.reuniones || 0, icon: "calendar-event", role: "pro" },
          { label: "Asistencia (30d)", val: `${stats?.pct || 0}%`, icon: "chart-line", role: "accent" },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--surface-1)", borderRadius: 12, padding: "14px 16px", borderTop: `2px solid var(--border-${s.role})` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <i className={`ti ti-${s.icon}`} style={{ fontSize: 16, color: `var(--text-${s.role})` }} aria-hidden />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 500, color: `var(--text-${s.role})` }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--surface-1)", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Acceso rápido</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Usa el menú lateral para navegar entre módulos del sistema.</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO MIEMBROS
// ─────────────────────────────────────────────────────────────
function ModuloMiembros() {
  const { usuario, toast } = useApp();
  const [miembros, setMiembros] = useState([]);
  const [templos, setTemplos] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroTemplo, setFiltroTemplo] = useState("");
  const [filtroCargo, setFiltroCargo] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [modal, setModal] = useState(null); // null | {mode:"new"|"edit"|"view", data}
  const [exportando, setExportando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ms, ts, cs, gs] = await Promise.all([
        sb.query("miembros", "?select=*,templos(id,nombre),miembro_cargos(id,activo,cargos(id,nombre)),miembro_grupos(id,activo,grupos(id,nombre))&order=apellidos.asc,nombres.asc"),
        sb.query("templos", "?activo=eq.true&order=nombre"),
        sb.query("cargos", "?activo=eq.true&order=nombre"),
        sb.query("grupos", "?activo=eq.true&order=nombre"),
      ]);
      setMiembros(ms); setTemplos(ts); setCargos(cs); setGrupos(gs);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = miembros.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = !q || `${m.nombres} ${m.apellidos} ${m.cedula || ""} ${m.celular || ""} ${m.email || ""}`.toLowerCase().includes(q);
    const matchEstado = !filtroEstado || m.estado === filtroEstado;
    const matchTemplo = !filtroTemplo || m.templo_id === filtroTemplo;
    const matchCargo = !filtroCargo || m.miembro_cargos?.some(mc => mc.activo && mc.cargos?.id === filtroCargo);
    const matchGrupo = !filtroGrupo || m.miembro_grupos?.some(mg => mg.activo && mg.grupos?.id === filtroGrupo);
    return matchSearch && matchEstado && matchTemplo && matchCargo && matchGrupo;
  });

  // Enviar WhatsApp cumpleaños
  const enviarWA = async (m) => {
    if (!m.whatsapp) { toast("El miembro no tiene WhatsApp registrado", "warn"); return; }
    const edad = calcAge(m.fecha_nacimiento);
    const msg = `¡Feliz cumpleaños ${m.nombres}! ${edad ? `Que Dios te bendiga en este día tan especial. ¡${edad} años!` : "Que Dios te bendiga en tu día especial."} 🎂🙏`;
    const url = `${WA_API_URL}?phone=${m.whatsapp.replace(/\D/g,"")}&text=${encodeURIComponent(msg)}&apikey=TU_CALLMEBOT_APIKEY`;
    try {
      await fetch(url);
      await sb.insert("log_whatsapp", { miembro_id: m.id, tipo: "cumpleanos", mensaje: msg, estado: "enviado" });
      toast(`Felicitación enviada a ${m.nombres} por WhatsApp ✓`, "ok");
    } catch { toast("Error al enviar WhatsApp", "error"); }
  };

  // Exportar a Google Sheets
  const exportarGoogleSheets = async () => {
    setExportando(true);
    try {
      const rows = [
        ["N°", "Membresía", "Apellidos", "Nombres", "Cédula", "Fecha Nacimiento", "Edad", "Género", "Teléfono", "Celular", "WhatsApp", "Email", "Dirección", "Ciudad", "Templo", "Cargos", "Grupos", "Estado", "Fecha Ingreso", "Notas"],
      ];
      filtrados.forEach((m, i) => {
        const cargosStr = (m.miembro_cargos || []).filter(mc => mc.activo).map(mc => mc.cargos?.nombre).filter(Boolean).join(", ");
        const gruposStr = (m.miembro_grupos || []).filter(mg => mg.activo).map(mg => mg.grupos?.nombre).filter(Boolean).join(", ");
        rows.push([
          i + 1, m.numero_membresia || "", m.apellidos, m.nombres, m.cedula || "",
          m.fecha_nacimiento || "", calcAge(m.fecha_nacimiento) || "", m.genero || "",
          m.telefono || "", m.celular || "", m.whatsapp || "", m.email || "",
          m.direccion || "", m.ciudad || "", m.templos?.nombre || "",
          cargosStr, gruposStr, m.estado, m.fecha_ingreso || "", m.notas || "",
        ]);
      });

      // Crear TSV para pegar en Google Sheets
      const tsv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join("\t")).join("\n");
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `miembros_${today()}.tsv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Abrir Google Sheets en blanco
      window.open("https://sheets.new", "_blank");
      toast("Archivo descargado. Abre el archivo .tsv en Google Sheets o pégalo con Ctrl+V después de importar.", "info");
    } catch (e) { toast("Error al exportar: " + e.message, "error"); }
    finally { setExportando(false); }
  };

  const canEdit = canDo(usuario, "miembros");
  const isMobile = useIsMobile();

  return (
    <div>
      <SectionHeader
        title="Miembros"
        icon="users"
        role="pro"
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn icon="file-spreadsheet" small onClick={exportarGoogleSheets} loading={exportando} variant="success">
              {isMobile ? "Sheets" : "Exportar a Sheets"}
            </Btn>
            {canEdit && <Btn icon="user-plus" variant="primary" small onClick={() => setModal({ mode: "new", data: null })}>{isMobile ? "Nuevo" : "Nuevo miembro"}</Btn>}
          </div>
        }
      />

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        <input placeholder="Buscar por nombre, cédula, teléfono..." value={search} onChange={e => setSearch(e.target.value)} style={{ boxSizing: "border-box" }} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
          <option value="visita">Visita</option>
          <option value="retirado">Retirado</option>
        </select>
        <select value={filtroTemplo} onChange={e => setFiltroTemplo(e.target.value)}>
          <option value="">Todos los templos</option>
          {templos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
        <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}>
          <option value="">Todos los cargos</option>
          {cargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroGrupo} onChange={e => setFiltroGrupo(e.target.value)}>
          <option value="">Todos los grupos</option>
          {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{filtrados.length} miembro(s)</div>

      {loading ? <Spinner /> : filtrados.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-users-off" style={{ fontSize: 36, display: "block", marginBottom: 10 }} />
          No se encontraron miembros
        </div>
      ) : isMobile ? (
        /* Vista de tarjetas para móvil */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtrados.map(m => {
            const cumple = isBirthdayToday(m.fecha_nacimiento);
            const cargosActivos = (m.miembro_cargos || []).filter(mc => mc.activo).map(mc => mc.cargos?.nombre).filter(Boolean);
            return (
              <div key={m.id} style={{ background: cumple ? "var(--bg-warning)" : "var(--surface-2)", border: `0.5px solid ${cumple ? "var(--border-warning)" : "var(--border)"}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <Avatar foto={m.foto_url} nombre={`${m.nombres} ${m.apellidos}`} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{m.apellidos}, {m.nombres}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{m.celular || m.telefono || m.email || "—"} {m.templos?.nombre ? `· ${m.templos.nombre}` : ""}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                      <Badge label={m.estado} />
                      {cargosActivos.map(c => <Badge key={c} label={c} role="accent" />)}
                    </div>
                    {m.fecha_nacimiento && (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        <i className="ti ti-cake" style={{ fontSize: 13, marginRight: 4 }} aria-hidden />
                        {fmtDate(m.fecha_nacimiento)} {cumple && "🎂"}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "0.5px solid var(--border)" }}>
                  {cumple && m.whatsapp && (
                    <Btn small variant="success" icon="brand-whatsapp" onClick={() => enviarWA(m)} style={{ flex: 1, justifyContent: "center" }}>Felicitar</Btn>
                  )}
                  <Btn small icon="eye" onClick={() => setModal({ mode: "view", data: m })} style={{ flex: 1, justifyContent: "center" }}>Ver</Btn>
                  {canEdit && <Btn small icon="edit" onClick={() => setModal({ mode: "edit", data: m })} style={{ flex: 1, justifyContent: "center" }}>Editar</Btn>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "var(--surface-1)" }}>
                {["", "Nombre", "Templo", "Cargos", "Estado", "Cumpleaños", "Acciones"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", textAlign: i === 6 ? "right" : "left", borderBottom: "0.5px solid var(--border)", width: [48, 220, 130, 200, 90, 110, 110][i] }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(m => {
                const cumple = isBirthdayToday(m.fecha_nacimiento);
                const cargosActivos = (m.miembro_cargos || []).filter(mc => mc.activo).map(mc => mc.cargos?.nombre).filter(Boolean);
                return (
                  <tr key={m.id} style={{ borderBottom: "0.5px solid var(--border)", background: cumple ? "var(--bg-warning)" : "transparent" }}
                    onMouseEnter={e => { if (!cumple) e.currentTarget.style.background = "var(--surface-1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = cumple ? "var(--bg-warning)" : "transparent"; }}>
                    <td style={{ padding: "8px 12px" }}>
                      <Avatar foto={m.foto_url} nombre={`${m.nombres} ${m.apellidos}`} size={32} />
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{m.apellidos}, {m.nombres}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.celular || m.telefono || m.email || "—"}</div>
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{m.templos?.nombre || "—"}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {cargosActivos.slice(0, 2).map(c => <Badge key={c} label={c} role="accent" />)}
                        {cargosActivos.length > 2 && <Badge label={`+${cargosActivos.length - 2}`} role="accent" />}
                        {cargosActivos.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px 12px" }}><Badge label={m.estado} /></td>
                    <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                      {m.fecha_nacimiento ? (
                        <span>{fmtDate(m.fecha_nacimiento)} {cumple && "🎂"}</span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {cumple && m.whatsapp && (
                          <Btn small variant="success" icon="brand-whatsapp" onClick={() => enviarWA(m)} title="Enviar felicitación" />
                        )}
                        <Btn small icon="eye" onClick={() => setModal({ mode: "view", data: m })} />
                        {canEdit && <Btn small icon="edit" onClick={() => setModal({ mode: "edit", data: m })} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ModalMiembro
          mode={modal.mode}
          data={modal.data}
          templos={templos}
          cargos={cargos}
          grupos={grupos}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MODAL MIEMBRO
// ─────────────────────────────────────────────────────────────
function ModalMiembro({ mode, data, templos, cargos, grupos, onClose, onSaved }) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    numero_membresia: "", nombres: "", apellidos: "", cedula: "", fecha_nacimiento: "",
    genero: "", telefono: "", celular: "", whatsapp: "", email: "", direccion: "", ciudad: "",
    templo_id: "", estado: "activo", fecha_ingreso: today(), notas: "", foto_url: "",
    ...(data || {}),
  });
  const [cargosSeleccionados, setCargosSeleccionados] = useState([]);
  const [gruposSeleccionados, setGruposSeleccionados] = useState([]);
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(data?.foto_url || "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (data) {
      setCargosSeleccionados(
        (data.miembro_cargos || []).filter(mc => mc.activo).map(mc => mc.cargos?.id).filter(Boolean)
      );
      setGruposSeleccionados(
        (data.miembro_grupos || []).filter(mg => mg.activo).map(mg => mg.grupos?.id).filter(Boolean)
      );
    }
  }, [data]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleFoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFotoFile(file);
    const reader = new FileReader();
    reader.onload = ev => setFotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const toggleCargo = (id) => {
    setCargosSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleGrupo = (id) => {
    setGruposSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!form.nombres.trim() || !form.apellidos.trim()) { toast("Nombre y apellido son requeridos", "warn"); return; }
    setSaving(true);
    try {
      let foto_url = form.foto_url;
      if (fotoFile) {
        const path = `${Date.now()}_${fotoFile.name.replace(/\s/g,"_")}`;
        const url = await sb.uploadPhoto(fotoFile, path);
        if (url) foto_url = url;
      }
      const payload = { ...form, foto_url, updated_at: new Date().toISOString() };
      delete payload.templos; delete payload.miembro_cargos; delete payload.miembro_grupos;

      let miembroId = data?.id;
      if (mode === "new") {
        const res = await sb.insert("miembros", payload);
        miembroId = res[0]?.id;
      } else {
        await sb.update("miembros", miembroId, payload);
        // Eliminar cargos y grupos actuales
        await fetch(`${sb.url}/rest/v1/miembro_cargos?miembro_id=eq.${miembroId}`, { method: "DELETE", headers: sb.headers({ Prefer: "" }) });
        await fetch(`${sb.url}/rest/v1/miembro_grupos?miembro_id=eq.${miembroId}`, { method: "DELETE", headers: sb.headers({ Prefer: "" }) });
      }

      // Insertar cargos seleccionados
      if (cargosSeleccionados.length > 0) {
        await sb.insert("miembro_cargos", cargosSeleccionados.map(cid => ({ miembro_id: miembroId, cargo_id: cid, activo: true })));
      }
      // Insertar grupos seleccionados
      if (gruposSeleccionados.length > 0) {
        await sb.insert("miembro_grupos", gruposSeleccionados.map(gid => ({ miembro_id: miembroId, grupo_id: gid, activo: true })));
      }

      toast(mode === "new" ? "Miembro registrado ✓" : "Miembro actualizado ✓", "ok");
      onSaved();
    } catch (e) { toast(e.message || "Error al guardar", "error"); }
    finally { setSaving(false); }
  };

  const isView = mode === "view";
  const isMobile = useIsMobile();

  return (
    <Modal title={isView ? "Ver miembro" : mode === "new" ? "Nuevo miembro" : "Editar miembro"} onClose={onClose} wide>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "160px 1fr", gap: isMobile ? 16 : 24, alignItems: "start" }}>
        {/* Foto */}
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 120, height: 120, borderRadius: "50%", overflow: "hidden", border: "2px solid var(--border)", margin: "0 auto 12px", background: "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {fotoPreview ? <img src={fotoPreview} alt="foto" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-user" style={{ fontSize: 48, color: "var(--text-muted)" }} />}
          </div>
          {!isView && (
            <>
              <input type="file" ref={fileRef} accept="image/*" style={{ display: "none" }} onChange={handleFoto} />
              <Btn small icon="camera" onClick={() => fileRef.current.click()}>Cambiar foto</Btn>
            </>
          )}
          {data && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {data.numero_membresia && <div><strong>N°:</strong> {data.numero_membresia}</div>}
              {data.fecha_ingreso && <div><strong>Ingreso:</strong> {fmtDate(data.fecha_ingreso)}</div>}
              {data.fecha_nacimiento && <div><strong>Edad:</strong> {calcAge(data.fecha_nacimiento)} años</div>}
            </div>
          )}
        </div>

        {/* Formulario */}
        <div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Nombres *" value={form.nombres} onChange={e => set("nombres", e.target.value)} disabled={isView} />
            <Inp label="Apellidos *" value={form.apellidos} onChange={e => set("apellidos", e.target.value)} disabled={isView} />
            <Inp label="Cédula / DNI" value={form.cedula || ""} onChange={e => set("cedula", e.target.value)} disabled={isView} />
            <Inp label="N° Membresía" value={form.numero_membresia || ""} onChange={e => set("numero_membresia", e.target.value)} disabled={isView} />
            <Inp label="Fecha de nacimiento" type="date" value={form.fecha_nacimiento || ""} onChange={e => set("fecha_nacimiento", e.target.value)} disabled={isView} />
            <Sel label="Género" value={form.genero || ""} onChange={e => set("genero", e.target.value)} disabled={isView}>
              <option value="">— Seleccionar —</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
              <option value="otro">Otro</option>
            </Sel>
            <Inp label="Teléfono" value={form.telefono || ""} onChange={e => set("telefono", e.target.value)} disabled={isView} />
            <Inp label="Celular" value={form.celular || ""} onChange={e => set("celular", e.target.value)} disabled={isView} />
            <Inp label="WhatsApp (con código país)" value={form.whatsapp || ""} onChange={e => set("whatsapp", e.target.value)} disabled={isView} placeholder="+5491112345678" />
            <Inp label="Correo electrónico" type="email" value={form.email || ""} onChange={e => set("email", e.target.value)} disabled={isView} />
            <Inp label="Dirección" value={form.direccion || ""} onChange={e => set("direccion", e.target.value)} disabled={isView} />
            <Inp label="Ciudad" value={form.ciudad || ""} onChange={e => set("ciudad", e.target.value)} disabled={isView} />
            <Sel label="Templo" value={form.templo_id || ""} onChange={e => set("templo_id", e.target.value)} disabled={isView}>
              <option value="">— Sin templo —</option>
              {templos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Sel>
            <Sel label="Estado" value={form.estado} onChange={e => set("estado", e.target.value)} disabled={isView}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="visita">Visita</option>
              <option value="retirado">Retirado</option>
            </Sel>
          </div>

          {/* Cargos */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>Cargos (puede tener varios)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {cargos.map(c => {
                const sel = cargosSeleccionados.includes(c.id);
                return (
                  <button key={c.id} onClick={() => !isView && toggleCargo(c.id)} disabled={isView} style={{ cursor: isView ? "default" : "pointer", padding: "4px 12px", borderRadius: 20, border: `0.5px solid ${sel ? "var(--border-accent)" : "var(--border)"}`, background: sel ? "var(--bg-accent)" : "transparent", color: sel ? "var(--text-accent)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)" }}>
                    {sel && <i className="ti ti-check" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />}
                    {c.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grupos */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>Grupos</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {grupos.map(g => {
                const sel = gruposSeleccionados.includes(g.id);
                return (
                  <button key={g.id} onClick={() => !isView && toggleGrupo(g.id)} disabled={isView} style={{ cursor: isView ? "default" : "pointer", padding: "4px 12px", borderRadius: 20, border: `0.5px solid ${sel ? "var(--border-success)" : "var(--border)"}`, background: sel ? "var(--bg-success)" : "transparent", color: sel ? "var(--text-success)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)" }}>
                    {sel && <i className="ti ti-check" style={{ fontSize: 12, marginRight: 4 }} aria-hidden />}
                    {g.nombre}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Notas</label>
            <textarea value={form.notas || ""} onChange={e => set("notas", e.target.value)} disabled={isView} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>

          {!isView && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <Btn onClick={onClose}>Cancelar</Btn>
              <Btn variant="primary" icon="device-floppy" loading={saving} onClick={handleSave}>
                {saving ? "Guardando..." : "Guardar"}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO ASISTENCIA
// ─────────────────────────────────────────────────────────────
function ModuloAsistencia() {
  const { usuario, toast } = useApp();
  const [templos, setTemplos] = useState([]);
  const [tiposReunion, setTiposReunion] = useState([]);
  const [miembros, setMiembros] = useState([]);
  const [reuniones, setReuniones] = useState([]);
  const [asistencia, setAsistencia] = useState([]);
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Filtros selección de sesión
  const [filtroTemplo, setFiltroTemplo] = useState("");
  const [filtroFecha, setFiltroFecha] = useState(today());
  const [filtroTipoReunion, setFiltroTipoReunion] = useState("");
  const [filtroCargo, setFiltroCargo] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [cargos, setCargos] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [reunionActiva, setReunionActiva] = useState(null);
  const [asistenciaLocal, setAsistenciaLocal] = useState({});
  const [sesionAbierta, setSesionAbierta] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ts, trs, cs, gs] = await Promise.all([
          sb.query("templos", "?activo=eq.true&order=nombre"),
          sb.query("tipos_reunion", "?activo=eq.true&order=nombre"),
          sb.query("cargos", "?activo=eq.true&order=nombre"),
          sb.query("grupos", "?activo=eq.true&order=nombre"),
        ]);
        setTemplos(ts); setTiposReunion(trs); setCargos(cs); setGrupos(gs);
        if (usuario?.templo_id) setFiltroTemplo(usuario.templo_id);
      } catch (e) { toast(e.message, "error"); }
    })();
  }, []);

  const abrirSesion = async () => {
    if (!filtroTipoReunion) { toast("Selecciona el tipo de reunión", "warn"); return; }
    setLoading(true);
    try {
      // Buscar o crear reunión (templo_id puede ser null = todos los templos)
      let reunion = null;
      let qExisting = `?tipo_reunion_id=eq.${filtroTipoReunion}&fecha=eq.${filtroFecha}&select=*`;
      qExisting += filtroTemplo ? `&templo_id=eq.${filtroTemplo}` : `&templo_id=is.null`;
      const existing = await sb.query("reuniones", qExisting);
      if (existing.length > 0) {
        reunion = existing[0];
      } else {
        const tipoR = tiposReunion.find(t => t.id === filtroTipoReunion);
        const res = await sb.insert("reuniones", {
          tipo_reunion_id: filtroTipoReunion,
          templo_id: filtroTemplo || null,
          fecha: filtroFecha,
          hora: tipoR?.hora_defecto || null,
          created_by: sb.userId,
        });
        reunion = res[0];
      }
      setReunionActiva(reunion);

      // Cargar miembros filtrados (de un templo o de todos)
      let qMiembros = filtroTemplo
        ? `?templo_id=eq.${filtroTemplo}&select=id,nombres,apellidos,foto_url,estado,templos(nombre),miembro_cargos(cargo_id,activo),miembro_grupos(grupo_id,activo)&estado=neq.retirado&order=apellidos.asc`
        : `?select=id,nombres,apellidos,foto_url,estado,templos(nombre),miembro_cargos(cargo_id,activo),miembro_grupos(grupo_id,activo)&estado=neq.retirado&order=apellidos.asc`;
      const ms = await sb.query("miembros", qMiembros);

      // Filtrar por cargo/grupo si aplica
      const msFiltrados = ms.filter(m => {
        if (filtroCargo) {
          const tieneC = (m.miembro_cargos || []).some(mc => mc.activo && mc.cargo_id === filtroCargo);
          if (!tieneC) return false;
        }
        if (filtroGrupo) {
          const tieneG = (m.miembro_grupos || []).some(mg => mg.activo && mg.grupo_id === filtroGrupo);
          if (!tieneG) return false;
        }
        return true;
      });
      setMiembros(msFiltrados);

      // Cargar asistencia existente para esta reunión
      const asist = await sb.query("asistencia", `?reunion_id=eq.${reunion.id}&select=*`);
      const asistMap = {};
      asist.forEach(a => { asistMap[a.miembro_id] = a; });

      // Inicializar ausentes por defecto para miembros sin registro
      const localInit = {};
      msFiltrados.forEach(m => {
        localInit[m.id] = asistMap[m.id]?.estado || "ausente";
      });
      setAsistenciaLocal(localInit);
      setAsistencia(asist);
      setSesionAbierta(true);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  const cambiarEstado = (miembroId, estado) => {
    setAsistenciaLocal(prev => ({ ...prev, [miembroId]: estado }));
  };

  const guardarAsistencia = async () => {
    if (!reunionActiva) return;
    setGuardando(true);
    try {
      const registros = Object.entries(asistenciaLocal).map(([miembro_id, estado]) => ({
        reunion_id: reunionActiva.id,
        miembro_id,
        estado,
        registrado_por: sb.userId,
        updated_at: new Date().toISOString(),
      }));
      await sb.upsert("asistencia", registros, "reunion_id,miembro_id");
      toast(`Asistencia guardada: ${miembros.length} miembro(s) ✓`, "ok");
    } catch (e) { toast(e.message, "error"); }
    finally { setGuardando(false); }
  };

  const cerrarSesion = () => { setSesionAbierta(false); setReunionActiva(null); setMiembros([]); setAsistenciaLocal({}); };

  const conteo = { presente: 0, ausente: 0, justificado: 0, tarde: 0 };
  Object.values(asistenciaLocal).forEach(e => { if (conteo[e] !== undefined) conteo[e]++; });

  const ESTADOS = [
    { val: "presente", label: "Presente", color: "success" },
    { val: "ausente", label: "Ausente", color: "danger" },
    { val: "justificado", label: "Justificado", color: "warning" },
    { val: "tarde", label: "Tarde", color: "accent" },
  ];

  const isMobile = useIsMobile();

  return (
    <div>
      <SectionHeader title="Tomar asistencia" icon="clipboard-check" role="success" />

      {!sesionAbierta ? (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: isMobile ? 16 : 24, maxWidth: 600 }}>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 16, color: "var(--text-primary)" }}>Configurar sesión de asistencia</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Sel label="Templo" value={filtroTemplo} onChange={e => setFiltroTemplo(e.target.value)}>
              <option value="">Todos los templos</option>
              {templos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Sel>
            <Inp label="Fecha *" type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} />
            <Sel label="Tipo de reunión *" value={filtroTipoReunion} onChange={e => setFiltroTipoReunion(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {tiposReunion.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Sel>
            {!isMobile && <div />}
            <Sel label="Filtrar por cargo (opcional)" value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}>
              <option value="">Todos los cargos</option>
              {cargos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Sel>
            <Sel label="Filtrar por grupo (opcional)" value={filtroGrupo} onChange={e => setFiltroGrupo(e.target.value)}>
              <option value="">Todos los grupos</option>
              {grupos.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </Sel>
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn variant="primary" icon="clipboard-check" loading={loading} onClick={abrirSesion}>
              {loading ? "Abriendo sesión..." : "Abrir sesión de asistencia"}
            </Btn>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, marginBottom: 0 }}>
            Nota: Si ya existe una reunión de ese tipo para esa fecha y templo, se continuará editando la existente.
          </p>
        </div>
      ) : (
        <div>
          {/* Header sesión activa */}
          <div style={{ background: "var(--bg-accent)", border: "0.5px solid var(--border-accent)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--text-accent)" }}>
              <i className="ti ti-calendar-event" style={{ marginRight: 6 }} />
              <strong>{tiposReunion.find(t => t.id === filtroTipoReunion)?.nombre}</strong>
              {" · "}{filtroTemplo ? templos.find(t => t.id === filtroTemplo)?.nombre : "Todos los templos"}
              {" · "}{fmtDate(filtroFecha)}
              {" · "}<strong>{miembros.length} miembro(s)</strong>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn small icon="device-floppy" variant="primary" loading={guardando} onClick={guardarAsistencia} style={isMobile ? { flex: 1, justifyContent: "center" } : {}}>Guardar</Btn>
              <Btn small icon="x" onClick={cerrarSesion} style={isMobile ? { flex: 1, justifyContent: "center" } : {}}>Cerrar</Btn>
            </div>
          </div>

          {/* Contadores */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            {ESTADOS.map(e => (
              <div key={e.val} style={{ background: `var(--bg-${e.color})`, border: `0.5px solid var(--border-${e.color})`, borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: `var(--text-${e.color})` }}>{conteo[e.val]}</div>
                <div style={{ fontSize: 12, color: `var(--text-${e.color})` }}>{e.label}</div>
              </div>
            ))}
          </div>

          {/* Lista miembros */}
          <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {miembros.map((m, idx) => {
              const estado = asistenciaLocal[m.id] || "ausente";
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 10 : 14, padding: "12px 16px", borderBottom: idx < miembros.length - 1 ? "0.5px solid var(--border)" : "none", background: estado === "presente" ? "rgba(16,185,129,0.05)" : estado === "ausente" ? "rgba(239,68,68,0.04)" : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar foto={m.foto_url} nombre={`${m.nombres} ${m.apellidos}`} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{m.apellidos}, {m.nombres}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {!filtroTemplo && m.templos?.nombre ? `${m.templos.nombre} · ` : ""}{m.estado}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "none", gridAutoFlow: isMobile ? "row" : "column", gap: 6 }}>
                    {ESTADOS.map(e => (
                      <button key={e.val} onClick={() => cambiarEstado(m.id, e.val)} style={{ cursor: "pointer", padding: isMobile ? "6px 4px" : "4px 10px", borderRadius: isMobile ? 8 : 20, border: `0.5px solid ${estado === e.val ? `var(--border-${e.color})` : "var(--border)"}`, background: estado === e.val ? `var(--bg-${e.color})` : "transparent", color: estado === e.val ? `var(--text-${e.color})` : "var(--text-muted)", fontSize: isMobile ? 11 : 12, fontFamily: "var(--font-sans)", fontWeight: estado === e.val ? 500 : 400, transition: "all 0.15s", textAlign: "center" }}>
                        {e.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <Btn variant="primary" icon="device-floppy" loading={guardando} onClick={guardarAsistencia} style={isMobile ? { width: "100%", justifyContent: "center" } : {}}>
              {guardando ? "Guardando..." : "Guardar asistencia"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO REPORTES
// ─────────────────────────────────────────────────────────────
function ModuloReportes() {
  const { toast } = useApp();
  const [templos, setTemplos] = useState([]);
  const [tiposReunion, setTiposReunion] = useState([]);
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filtros, setFiltros] = useState({
    desde: new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0],
    hasta: today(),
    templo_id: "",
    tipo_reunion_id: "",
  });

  useEffect(() => {
    (async () => {
      const [ts, trs] = await Promise.all([
        sb.query("templos", "?activo=eq.true&order=nombre"),
        sb.query("tipos_reunion", "?activo=eq.true&order=nombre"),
      ]);
      setTemplos(ts); setTiposReunion(trs);
    })();
  }, []);

  const generarReporte = async () => {
    setLoading(true);
    try {
      let qR = `?fecha=gte.${filtros.desde}&fecha=lte.${filtros.hasta}&select=id,fecha,templos(nombre),tipos_reunion(nombre)`;
      if (filtros.templo_id) qR += `&templo_id=eq.${filtros.templo_id}`;
      if (filtros.tipo_reunion_id) qR += `&tipo_reunion_id=eq.${filtros.tipo_reunion_id}`;
      qR += "&order=fecha.asc";

      const reuniones = await sb.query("reuniones", qR);
      if (!reuniones.length) { toast("No hay reuniones en ese período", "warn"); setLoading(false); return; }

      const reunionIds = reuniones.map(r => r.id).join(",");
      const asistencia = await sb.query("asistencia", `?reunion_id=in.(${reunionIds})&select=reunion_id,estado`);

      // Agrupar por fecha
      const porFecha = {};
      reuniones.forEach(r => {
        const fecha = r.fecha;
        if (!porFecha[fecha]) porFecha[fecha] = { fecha, presente: 0, ausente: 0, justificado: 0, tarde: 0, total: 0 };
      });
      asistencia.forEach(a => {
        const r = reuniones.find(x => x.id === a.reunion_id);
        if (!r) return;
        const fd = porFecha[r.fecha];
        if (!fd) return;
        fd[a.estado] = (fd[a.estado] || 0) + 1;
        fd.total++;
      });

      // Totales estado
      const totales = { presente: 0, ausente: 0, justificado: 0, tarde: 0 };
      asistencia.forEach(a => { totales[a.estado] = (totales[a.estado] || 0) + 1; });

      const pieData = Object.entries(totales).map(([name, value]) => ({ name, value }));
      const lineData = Object.values(porFecha).map(d => ({
        ...d,
        fecha: new Date(d.fecha + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
        pct: d.total ? Math.round(d.presente / d.total * 100) : 0,
      }));

      // Por tipo reunión
      const porTipo = {};
      asistencia.forEach(a => {
        const r = reuniones.find(x => x.id === a.reunion_id);
        const tipo = r?.tipos_reunion?.nombre || "Otro";
        if (!porTipo[tipo]) porTipo[tipo] = { tipo, presente: 0, total: 0 };
        porTipo[tipo].total++;
        if (a.estado === "presente") porTipo[tipo].presente++;
      });
      const barData = Object.values(porTipo).map(d => ({ ...d, pct: d.total ? Math.round(d.presente / d.total * 100) : 0 }));

      setDatos({ totales, pieData, lineData, barData, totalReuniones: reuniones.length });
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  const setF = (k, v) => setFiltros(f => ({ ...f, [k]: v }));
  const isMobile = useIsMobile();

  return (
    <div>
      <SectionHeader title="Reportes y gráficos" icon="chart-bar" role="danger" />

      <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: isMobile ? 16 : 20, marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <Inp label="Desde" type="date" value={filtros.desde} onChange={e => setF("desde", e.target.value)} />
          <Inp label="Hasta" type="date" value={filtros.hasta} onChange={e => setF("hasta", e.target.value)} />
          <Sel label="Templo" value={filtros.templo_id} onChange={e => setF("templo_id", e.target.value)}>
            <option value="">Todos los templos</option>
            {templos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Sel>
          <Sel label="Tipo reunión" value={filtros.tipo_reunion_id} onChange={e => setF("tipo_reunion_id", e.target.value)}>
            <option value="">Todos los tipos</option>
            {tiposReunion.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Sel>
          <Btn variant="primary" icon="search" loading={loading} onClick={generarReporte} style={{ marginBottom: 14, gridColumn: isMobile ? "1 / -1" : "auto", justifyContent: "center" }}>
            Generar
          </Btn>
        </div>
      </div>

      {loading && <Spinner />}

      {datos && !loading && (
        <div>
          {/* Tarjetas resumen */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 28 }}>
            {[
              { label: "Reuniones", val: datos.totalReuniones, role: "accent" },
              { label: "Presentes", val: datos.totales.presente, role: "success" },
              { label: "Ausentes", val: datos.totales.ausente, role: "danger" },
              { label: "Justificados", val: datos.totales.justificado, role: "warning" },
              { label: "% Asistencia", val: datos.totales.presente + datos.totales.ausente + datos.totales.justificado + datos.totales.tarde > 0 ? `${Math.round(datos.totales.presente / (datos.totales.presente + datos.totales.ausente + datos.totales.justificado + datos.totales.tarde) * 100)}%` : "—", role: "accent" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--surface-1)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 500, color: `var(--text-${s.role})` }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Gráfico línea: tendencia */}
          <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Tendencia de asistencia por fecha</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={datos.lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="presente" stroke="#10B981" name="Presentes" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ausente" stroke="#EF4444" name="Ausentes" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pct" stroke="#178CC7" name="% Asistencia" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
            {/* Pie chart estados */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Distribución de estados</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={datos.pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false}>
                    {datos.pieData.map((entry, i) => <Cell key={i} fill={ESTADO_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar chart por tipo */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>% Asistencia por tipo de reunión</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={datos.barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="tipo" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="pct" name="% Asistencia" fill="#178CC7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {!datos && !loading && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-chart-bar" style={{ fontSize: 40, display: "block", marginBottom: 10 }} />
          Configura los filtros y presiona "Generar" para ver los reportes
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────
function ModuloConfig() {
  const { usuario, toast } = useApp();
  const [tab, setTab] = useState("templos");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newHora, setNewHora] = useState("");

  const TABS = [
    { id: "templos", label: "Templos", icon: "building-church" },
    { id: "cargos", label: "Cargos", icon: "briefcase" },
    { id: "grupos", label: "Grupos", icon: "users-group" },
    { id: "tipos_reunion", label: "Tipos de reunión", icon: "calendar-event" },
    { id: "usuarios_sistema", label: "Usuarios", icon: "shield" },
  ];

  const cargar = async () => {
    setLoading(true);
    try {
      let q = "?order=nombre";
      if (tab === "tipos_reunion") q = "?order=nombre&select=*";
      if (tab === "usuarios_sistema") q = "?select=*,roles_sistema(nombre),templos(nombre)&order=nombre";
      const data = await sb.query(tab, q);
      setItems(data);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargar(); setNewName(""); setNewDesc(""); setNewHora(""); }, [tab]);

  const agregar = async () => {
    if (!newName.trim()) { toast("El nombre es requerido", "warn"); return; }
    try {
      const payload = { nombre: newName.trim(), activo: true };
      if (tab === "templos") {
        payload.direccion = newDesc.trim() || null;
      } else {
        payload.descripcion = newDesc.trim() || null;
      }
      if (tab === "tipos_reunion" && newHora) payload.hora_defecto = newHora;
      await sb.insert(tab, payload);
      toast("Agregado ✓", "ok");
      setNewName(""); setNewDesc(""); setNewHora("");
      cargar();
    } catch (e) { toast(e.message, "error"); }
  };

  const toggleActivo = async (item) => {
    try {
      await sb.update(tab, item.id, { activo: !item.activo });
      cargar();
    } catch (e) { toast(e.message, "error"); }
  };

  const canEdit = canDo(usuario, "config");

  return (
    <div>
      <SectionHeader title="Configuración" icon="settings" />

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 8, border: `0.5px solid ${tab === t.id ? "var(--border-accent)" : "var(--border)"}`, background: tab === t.id ? "var(--bg-accent)" : "transparent", color: tab === t.id ? "var(--text-accent)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <i className={`ti ti-${t.icon}`} style={{ fontSize: 14 }} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {canEdit && tab !== "usuarios_sistema" && (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: "var(--text-secondary)" }}>
            Agregar {TABS.find(t => t.id === tab)?.label.slice(0, -1).toLowerCase()}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 160px" }}>
              <Inp label="Nombre *" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre..." />
            </div>
            <div style={{ flex: "2 1 200px" }}>
              <Inp label={tab === "templos" ? "Dirección" : "Descripción"} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder={tab === "templos" ? "Dirección (opcional)" : "Descripción (opcional)"} />
            </div>
            {tab === "tipos_reunion" && (
              <div style={{ flex: "1 1 120px" }}>
                <Inp label="Hora por defecto" type="time" value={newHora} onChange={e => setNewHora(e.target.value)} />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <Btn variant="primary" icon="plus" onClick={agregar}>Agregar</Btn>
            </div>
          </div>
        </div>
      )}

      {loading ? <Spinner /> : (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>No hay registros</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: idx < items.length - 1 ? "0.5px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 16px" }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{item.nombre}</div>
                      {item.descripcion && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.descripcion}</div>}
                      {item.direccion && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.direccion}{item.ciudad ? ` — ${item.ciudad}` : ""}</div>}
                      {item.hora_defecto && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Hora: {item.hora_defecto}</div>}
                      {tab === "usuarios_sistema" && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {item.email} · {item.roles_sistema?.nombre} · {item.templos?.nombre || "Sin templo"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>
                      {item.activo !== undefined && (
                        <Badge label={item.activo ? "activo" : "inactivo"} />
                      )}
                    </td>
                    {canEdit && tab !== "usuarios_sistema" && (
                      <td style={{ padding: "10px 16px", textAlign: "right", width: 100 }}>
                        <Btn small variant={item.activo ? "danger" : "success"} onClick={() => toggleActivo(item)}>
                          {item.activo ? "Desactivar" : "Activar"}
                        </Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "tipos_reunion" && (
        <div style={{ marginTop: 16, padding: 14, background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 10, fontSize: 13, color: "var(--text-warning)" }}>
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
          El sistema previene registros duplicados: no se puede tomar asistencia dos veces para el mismo tipo de reunión, templo y fecha.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO HISTORIAL INDIVIDUAL
// ─────────────────────────────────────────────────────────────
function ModuloHistorial() {
  const { toast } = useApp();

  // Búsqueda de miembro
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [miembroSel, setMiembroSel] = useState(null);
  const [buscando, setBuscando] = useState(false);

  // Filtros del historial
  const [desde, setDesde] = useState(new Date(Date.now() - 180 * 86400000).toISOString().split("T")[0]);
  const [hasta, setHasta] = useState(today());
  const [filtroTipo, setFiltroTipo] = useState("");
  const [tiposReunion, setTiposReunion] = useState([]);

  // Datos historial
  const [historial, setHistorial] = useState([]);
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);

  // Ref para cerrar dropdown
  const dropRef = useRef();

  useEffect(() => {
    sb.query("tipos_reunion", "?activo=eq.true&order=nombre").then(setTiposReunion).catch(() => {});
  }, []);

  // Buscar miembros mientras escribe
  useEffect(() => {
    if (busqueda.length < 2) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const q = busqueda.toLowerCase();
        const ms = await sb.query("miembros",
          `?or=(nombres.ilike.*${encodeURIComponent(q)}*,apellidos.ilike.*${encodeURIComponent(q)}*,cedula.ilike.*${encodeURIComponent(q)}*)&select=id,nombres,apellidos,foto_url,estado,templos(nombre),miembro_cargos(activo,cargos(nombre))&order=apellidos.asc&limit=8`
        );
        setSugerencias(ms);
      } catch {}
      finally { setBuscando(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const seleccionarMiembro = (m) => {
    setMiembroSel(m);
    setBusqueda(`${m.apellidos}, ${m.nombres}`);
    setSugerencias([]);
    cargarHistorial(m.id);
  };

  const cargarHistorial = async (miembroId, tipoId) => {
    setLoading(true);
    try {
      // Reuniones en el período
      let qR = `?fecha=gte.${desde}&fecha=lte.${hasta}&select=id,fecha,hora,tipos_reunion(id,nombre),templos(nombre)&order=fecha.desc`;
      if (tipoId || filtroTipo) qR += `&tipo_reunion_id=eq.${tipoId || filtroTipo}`;

      const reuniones = await sb.query("reuniones", qR);
      if (!reuniones.length) {
        setHistorial([]); setStats(null); setChartData([]);
        setLoading(false); return;
      }

      const ids = reuniones.map(r => r.id).join(",");
      const asistencia = await sb.query("asistencia",
        `?miembro_id=eq.${miembroId}&reunion_id=in.(${ids})&select=reunion_id,estado,observacion,created_at`
      );

      // Mapear asistencia por reunion_id
      const asistMap = {};
      asistencia.forEach(a => { asistMap[a.reunion_id] = a; });

      // Combinar: para cada reunión, el miembro estuvo ausente si no hay registro
      const filas = reuniones.map(r => ({
        ...r,
        estado: asistMap[r.id]?.estado || "ausente",
        observacion: asistMap[r.id]?.observacion || "",
        registrado: !!asistMap[r.id],
      }));

      setHistorial(filas);

      // Stats
      const conteo = { presente: 0, ausente: 0, justificado: 0, tarde: 0 };
      filas.forEach(f => { conteo[f.estado] = (conteo[f.estado] || 0) + 1; });
      const total = filas.length;
      const pct = total ? Math.round(conteo.presente / total * 100) : 0;
      const racha = calcularRacha(filas);
      setStats({ ...conteo, total, pct, racha });

      // Chart: agrupado por mes
      const porMes = {};
      filas.forEach(f => {
        const mes = f.fecha.slice(0, 7); // YYYY-MM
        if (!porMes[mes]) porMes[mes] = { mes, presente: 0, ausente: 0, justificado: 0, tarde: 0, total: 0 };
        porMes[mes][f.estado]++;
        porMes[mes].total++;
      });
      const meses = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)).map(d => ({
        ...d,
        label: new Date(d.mes + "-15").toLocaleDateString("es-ES", { month: "short", year: "2-digit" }),
        pct: d.total ? Math.round(d.presente / d.total * 100) : 0,
      }));
      setChartData(meses);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  const calcularRacha = (filas) => {
    // Racha actual de presencias consecutivas (más reciente primero)
    let racha = 0;
    for (const f of filas) {
      if (f.estado === "presente") racha++;
      else break;
    }
    return racha;
  };

  const handleFiltrar = () => {
    if (miembroSel) cargarHistorial(miembroSel.id);
  };

  const ESTADO_CFG = [
    { val: "presente", label: "Presentes", role: "success" },
    { val: "ausente", label: "Ausentes", role: "danger" },
    { val: "justificado", label: "Justificados", role: "warning" },
    { val: "tarde", label: "Tardes", role: "accent" },
  ];

  const cargosActivos = (miembroSel?.miembro_cargos || []).filter(mc => mc.activo).map(mc => mc.cargos?.nombre).filter(Boolean);

  return (
    <div>
      <SectionHeader title="Historial de asistencia individual" icon="user-search" role="warning" />

      {/* Buscador de miembro */}
      <div style={{ position: "relative", maxWidth: 480, marginBottom: 24 }} ref={dropRef}>
        <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
          Buscar miembro por nombre o cédula
        </label>
        <div style={{ position: "relative" }}>
          <input
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setMiembroSel(null); }}
            placeholder="Escribe al menos 2 caracteres..."
            style={{ width: "100%", boxSizing: "border-box", paddingRight: 36 }}
          />
          <i className={`ti ti-${buscando ? "loader-2" : "search"}`} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 16, pointerEvents: "none" }} />
        </div>

        {sugerencias.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden", marginTop: 4 }}>
            {sugerencias.map(m => (
              <button key={m.id} onClick={() => seleccionarMiembro(m)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)", textAlign: "left", borderBottom: "0.5px solid var(--border)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface-1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <Avatar foto={m.foto_url} nombre={`${m.nombres} ${m.apellidos}`} size={32} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{m.apellidos}, {m.nombres}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.templos?.nombre || "Sin templo"} · <Badge label={m.estado} /></div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Card del miembro seleccionado */}
      {miembroSel && (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Avatar foto={miembroSel.foto_url} nombre={`${miembroSel.nombres} ${miembroSel.apellidos}`} size={52} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
              {miembroSel.apellidos}, {miembroSel.nombres}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Badge label={miembroSel.estado} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{miembroSel.templos?.nombre}</span>
              {cargosActivos.slice(0, 3).map(c => <Badge key={c} label={c} role="accent" />)}
              {cargosActivos.length > 3 && <Badge label={`+${cargosActivos.length - 3} cargos`} role="accent" />}
            </div>
          </div>
        </div>
      )}

      {/* Filtros período */}
      {miembroSel && (
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <Inp label="Desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <Inp label="Hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
            <div style={{ flex: "2 1 180px" }}>
              <Sel label="Tipo de reunión" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
                <option value="">Todos los tipos</option>
                {tiposReunion.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </Sel>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Btn variant="primary" icon="search" loading={loading} onClick={handleFiltrar}>Filtrar</Btn>
            </div>
          </div>
        </div>
      )}

      {loading && <Spinner />}

      {/* Stats del miembro */}
      {stats && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
            <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 500, color: "var(--text-primary)" }}>{stats.total}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Reuniones</div>
            </div>
            {ESTADO_CFG.map(e => (
              <div key={e.val} style={{ background: `var(--bg-${e.role})`, border: `0.5px solid var(--border-${e.role})`, borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 500, color: `var(--text-${e.role})` }}>{stats[e.val]}</div>
                <div style={{ fontSize: 12, color: `var(--text-${e.role})` }}>{e.label}</div>
              </div>
            ))}
            <div style={{ background: "var(--bg-accent)", border: "0.5px solid var(--border-accent)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 500, color: "var(--text-accent)" }}>{stats.pct}%</div>
              <div style={{ fontSize: 12, color: "var(--text-accent)" }}>% Asistencia</div>
            </div>
            <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 500, color: "var(--text-success)" }}>{stats.racha}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Racha actual 🔥</div>
            </div>
          </div>

          {/* Gráfico por mes */}
          {chartData.length > 1 && (
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Asistencia mensual</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="presente" name="Presente" fill="#10B981" stackId="a" radius={[0,0,0,0]} />
                  <Bar dataKey="tarde" name="Tarde" fill="#3B82F6" stackId="a" />
                  <Bar dataKey="justificado" name="Justificado" fill="#F59E0B" stackId="a" />
                  <Bar dataKey="ausente" name="Ausente" fill="#EF4444" stackId="a" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Calendario visual de asistencia */}
          <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Mapa de asistencia</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[...historial].reverse().map((h, i) => {
                const colorMap = { presente: "#10B981", ausente: "#EF4444", justificado: "#F59E0B", tarde: "#3B82F6" };
                const col = colorMap[h.estado] || "#ccc";
                return (
                  <div key={i} title={`${fmtDate(h.fecha)} — ${h.tipos_reunion?.nombre} — ${h.estado}${h.observacion ? ` — ${h.observacion}` : ""}`}
                    style={{ width: 14, height: 14, borderRadius: 3, background: col, opacity: 0.85, cursor: "default", flexShrink: 0 }} />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              {[["#10B981","Presente"],["#EF4444","Ausente"],["#F59E0B","Justificado"],["#3B82F6","Tarde"]].map(([col, lbl]) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: col }} />
                  {lbl}
                </div>
              ))}
            </div>
          </div>

          {/* Tabla detalle */}
          <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>Detalle de reuniones ({historial.length})</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Más reciente primero</span>
            </div>
            {historial.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No hay reuniones en el período seleccionado
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr style={{ background: "var(--surface-1)" }}>
                    {["Fecha", "Tipo de reunión", "Templo", "Estado", "Observación"].map(h => (
                      <th key={h} style={{ padding: "9px 14px", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left", borderBottom: "0.5px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h, i) => (
                    <tr key={i} style={{ borderBottom: i < historial.length - 1 ? "0.5px solid var(--border)" : "none" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--surface-1)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                        {fmtDate(h.fecha)}
                        {h.hora && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>{h.hora.slice(0,5)}</span>}
                      </td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--text-secondary)" }}>{h.tipos_reunion?.nombre || "—"}</td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--text-secondary)" }}>{h.templos?.nombre || "—"}</td>
                      <td style={{ padding: "9px 14px" }}><Badge label={h.estado} /></td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: "var(--text-muted)", fontStyle: h.observacion ? "normal" : "italic" }}>
                        {h.observacion || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}

      {!miembroSel && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-user-search" style={{ fontSize: 44, display: "block", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Busca un miembro para ver su historial</div>
          <div style={{ fontSize: 13 }}>Escribe el nombre o cédula en el campo de búsqueda</div>
        </div>
      )}

      {miembroSel && !loading && !stats && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", fontSize: 13 }}>
          <i className="ti ti-calendar-off" style={{ fontSize: 36, display: "block", marginBottom: 10 }} />
          No hay reuniones registradas para este miembro en el período seleccionado
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [toastData, setToastData] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const toast = useCallback((msg, type = "ok") => setToastData({ msg, type, key: Date.now() }), []);

  useEffect(() => {
    const ok = sb.restoreSession();
    if (ok) {
      sb.query("usuarios_sistema", `?auth_id=eq.${sb.userId}&select=*,roles_sistema(id,nombre,descripcion,permisos),templos(id,nombre)`)
        .then(us => { if (us.length && us[0].activo) setUsuario(us[0]); })
        .catch(() => {})
        .finally(() => setCheckingSession(false));
    } else {
      setCheckingSession(false);
    }
  }, []);

  const handleLogout = async () => { await sb.signOut(); setUsuario(null); setPage("dashboard"); };
  const handlePageChange = (p) => { setPage(p); setMenuOpen(false); };

  if (checkingSession) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spinner />
    </div>
  );

  if (!usuario) return (
    <AppCtx.Provider value={{ usuario: null, toast }}>
      <LoginPage onLogin={setUsuario} />
      {toastData && <Toast key={toastData.key} msg={toastData.msg} type={toastData.type} onClose={() => setToastData(null)} />}
    </AppCtx.Provider>
  );

  const PAGES = { dashboard: Dashboard, miembros: ModuloMiembros, asistencia: ModuloAsistencia, historial: ModuloHistorial, reportes: ModuloReportes, config: ModuloConfig };
  const PageComp = PAGES[page] || Dashboard;
  const currentNav = NAV_ITEMS.find(n => n.id === page);

  return (
    <AppCtx.Provider value={{ usuario, toast }}>
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--surface-0)" }}>
        <Sidebar active={page} onChange={handlePageChange} usuario={usuario} onLogout={handleLogout} isMobile={isMobile} isOpen={menuOpen} onCloseMenu={() => setMenuOpen(false)} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {isMobile && (
            <div style={{ position: "sticky", top: 0, zIndex: 900, background: "var(--surface-2)", borderBottom: "0.5px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => setMenuOpen(true)} aria-label="Abrir menú" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--text-primary)", display: "flex" }}>
                <i className="ti ti-menu-2" style={{ fontSize: 22 }} aria-hidden />
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {currentNav && (
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: `var(--bg-${currentNav.role})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`ti ti-${currentNav.icon}`} style={{ fontSize: 14, color: `var(--text-${currentNav.role})` }} aria-hidden />
                  </span>
                )}
                <span style={{ fontSize: 15, fontWeight: 500 }}>{currentNav?.label || "Sistema"}</span>
              </div>
            </div>
          )}
          <main style={{ flex: 1, padding: isMobile ? 16 : 28, overflowY: "auto", minWidth: 0, overflowX: "hidden" }}>
            <PageComp />
          </main>
        </div>
      </div>
      {toastData && <Toast key={toastData.key} msg={toastData.msg} type={toastData.type} onClose={() => setToastData(null)} />}
    </AppCtx.Provider>
  );
}
