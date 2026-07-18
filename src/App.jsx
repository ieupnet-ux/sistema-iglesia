// ============================================================
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
// ── GREEN API (WhatsApp) ──────────────────────────────────────
const GREENAPI_ID_INSTANCE = "710701669501";
const GREENAPI_API_TOKEN = "c315d8ed030f4b359ab49c293c2b8614ac27b7d8158a44aaac";
const GREENAPI_URL = `https://7107.api.greenapi.com/waInstance${GREENAPI_ID_INSTANCE}/sendMessage/${GREENAPI_API_TOKEN}`;

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
  const autoRole = { activo: "success", inactivo: "danger", visita: "warning", retirado: "danger", fallecido: "danger", presente: "success", ausente: "danger", justificado: "warning", tarde: "accent" };
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
          <div style={{ width: 120, height: 80, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/logo-navy.png" alt="Unión Pentecostal" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 500 }}>Unión Pentecostal</h1>
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
  { id: "tareas", icon: "checklist", label: "Tareas", perm: "asistencia", role: "danger" },
  { id: "estadisticas_tareas", icon: "chart-dots-3", label: "Estadísticas", perm: "asistencia", role: "pro" },
  { id: "visitas", icon: "mail", label: "Visitas", perm: "config", role: "warning" },
  { id: "legajos", icon: "folder-open", label: "Legajos", perm: "config", role: "pro" },
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
          <div style={{ width: 38, height: 38, background: "#1e2d5a", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 4 }}>
            <img src="/logo-white.png" alt="IEUP" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}>Unión Pentecostal</div>
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

  // Versículos de bendición para cumpleaños (rotan según el día del año)
  const MENSAJES_CUMPLEANOS = [
    '"Bendito seas tú, y bendita tu salida y bendita tu entrada." (Deuteronomio 28:6)\n\nQue en este nuevo año de vida el Señor te colme de salud, sabiduría y abundantes bendiciones.',
    '"El Señor te bendiga, y te guarde; el Señor haga resplandecer su rostro sobre ti, y tenga de ti misericordia." (Números 6:24-25)\n\nQue cada día de este nuevo año esté lleno del favor y la gracia de Dios sobre tu vida.',
    '"Porque yo sé los pensamientos que tengo acerca de vosotros, dice Jehová, pensamientos de paz, y no de mal." (Jeremías 29:11)\n\nQue Dios siga cumpliendo sus propósitos de bien en tu vida en este nuevo año.',
    '"Fiel es Dios, por el cual fuisteis llamados a la comunión con su Hijo Jesucristo nuestro Señor." (1 Corintios 1:9)\n\nQue tu vida siga siendo testimonio de la fidelidad de Dios en cada nuevo año.',
    '"Te alabaré; porque formidables, maravillosas son tus obras." (Salmos 139:14)\n\nHoy celebramos la vida maravillosa que Dios diseñó en ti.',
    '"Bueno es Jehová para con todos, y su misericordia sobre todas sus obras." (Salmos 145:9)\n\nQue su misericordia y bondad te acompañen siempre, hoy y en cada día de tu nuevo año.',
    '"Hasta vuestra vejez yo mismo, y hasta las canas os soportaré; yo hice, yo llevaré, yo soportaré y guardaré." (Isaías 46:4)\n\nDios mismo te sostiene y guarda en cada etapa de tu vida.',
  ];

  const obtenerMensajeDelDia = () => {
    const inicioAno = new Date(new Date().getFullYear(), 0, 0);
    const diaDelAno = Math.floor((Date.now() - inicioAno.getTime()) / 86400000);
    return MENSAJES_CUMPLEANOS[diaDelAno % MENSAJES_CUMPLEANOS.length];
  };

  // Enviar WhatsApp cumpleaños
  const enviarWA = async (m) => {
    if (!m.whatsapp) { toast("El miembro no tiene WhatsApp registrado", "warn"); return; }
    const edad = calcAge(m.fecha_nacimiento);
    const bendicion = obtenerMensajeDelDia();
    const msg = `🎉 ¡Feliz cumpleaños, ${m.nombres}! 🎂${edad ? ` Hoy cumples ${edad} años.` : ""}\n\n${bendicion}\n\nDe parte de toda tu familia en la iglesia, ¡que Dios te bendiga grandemente! 🙏✨`;
    try {
      let telefono = m.whatsapp.replace(/\D/g, "");
      if (telefono.startsWith("0")) telefono = telefono.substring(1);
      const resp = await fetch(GREENAPI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${telefono}@c.us`, message: msg }),
      });
      const ok = resp.ok;
      await sb.insert("log_whatsapp", { miembro_id: m.id, tipo: "cumpleanos", mensaje: msg, estado: ok ? "enviado" : "error" });
      if (ok) toast(`Felicitación enviada a ${m.nombres} por WhatsApp ✓`, "ok");
      else toast("Error al enviar WhatsApp", "error");
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
          <option value="fallecido">Fallecido</option>
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
              <option value="fallecido">Fallecido</option>
            </Sel>
            <Inp label="Fecha de ingreso" type="date" value={form.fecha_ingreso || ""} onChange={e => set("fecha_ingreso", e.target.value)} disabled={isView} />
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
  const [tabAsistencia, setTabAsistencia] = useState("tomar"); // "tomar" | "historial"

  // Historial de reuniones
  const [historialReuniones, setHistorialReuniones] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [reunionSeleccionada, setReunionSeleccionada] = useState(null);
  const [asistenciaReunion, setAsistenciaReunion] = useState([]);
  const [filtroHistorialTemplo, setFiltroHistorialTemplo] = useState("");
  const [filtroHistorialDesde, setFiltroHistorialDesde] = useState(new Date(Date.now() - 30*86400000).toISOString().split("T")[0]);
  const [filtroHistorialHasta, setFiltroHistorialHasta] = useState(today());

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

  const cargarHistorialReuniones = async () => {
    setLoadingHistorial(true);
    try {
      let q = `?fecha=gte.${filtroHistorialDesde}&fecha=lte.${filtroHistorialHasta}&select=*,tipos_reunion(nombre),templos(nombre)&order=fecha.desc`;
      if (filtroHistorialTemplo) q += `&templo_id=eq.${filtroHistorialTemplo}`;
      const rs = await sb.query("reuniones", q);
      setHistorialReuniones(rs);
      setReunionSeleccionada(null);
      setAsistenciaReunion([]);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoadingHistorial(false); }
  };

  const cargarAsistenciaReunion = async (reunion) => {
    setReunionSeleccionada(reunion);
    try {
      const as = await sb.query("asistencia", `?reunion_id=eq.${reunion.id}&select=*,miembros(id,nombres,apellidos,foto_url)&order=miembros(apellidos).asc`);
      setAsistenciaReunion(as);
    } catch (e) { toast(e.message, "error"); }
  };

  const cambiarEstadoAsistencia = async (asistenciaId, nuevoEstado) => {
    try {
      await sb.update("asistencia", asistenciaId, { estado: nuevoEstado, updated_at: new Date().toISOString() });
      setAsistenciaReunion(prev => prev.map(a => a.id === asistenciaId ? { ...a, estado: nuevoEstado } : a));
      toast("Estado actualizado ✓", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  const borrarRegistroAsistencia = async (asistenciaId, nombreMiembro) => {
    if (!window.confirm(`¿Borrar el registro de asistencia de ${nombreMiembro}?`)) return;
    try {
      await sb.delete("asistencia", asistenciaId);
      setAsistenciaReunion(prev => prev.filter(a => a.id !== asistenciaId));
      toast("Registro eliminado ✓", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

  const borrarReunionCompleta = async (reunion) => {
    if (!window.confirm(`¿Borrar la reunión "${reunion.tipos_reunion?.nombre}" del ${fmtDate(reunion.fecha)} y TODA su asistencia? Esta acción no se puede deshacer.`)) return;
    try {
      // Borrar asistencia primero
      await fetch(`${sb.url}/rest/v1/asistencia?reunion_id=eq.${reunion.id}`, { method: "DELETE", headers: sb.headers({ Prefer: "" }) });
      await sb.delete("reuniones", reunion.id);
      setHistorialReuniones(prev => prev.filter(r => r.id !== reunion.id));
      if (reunionSeleccionada?.id === reunion.id) { setReunionSeleccionada(null); setAsistenciaReunion([]); }
      toast("Reunión eliminada ✓", "ok");
    } catch (e) { toast(e.message, "error"); }
  };

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

      if (!navigator.onLine) {
        // Sin internet: guardar en IndexedDB para sincronizar después
        await guardarOffline(registros);
        toast(`Asistencia guardada sin conexión (${miembros.length} miembro(s)) — se sincronizará al volver la señal 📶`, "warn");
      } else {
        await sb.upsert("asistencia", registros, "reunion_id,miembro_id");
        // Si hay datos pendientes offline, sincronizarlos también
        await sincronizarOffline();
        toast(`Asistencia guardada: ${miembros.length} miembro(s) ✓`, "ok");
      }
    } catch (e) {
      // Si falla por error de red, guardar offline
      if (!navigator.onLine || e.message?.includes("fetch")) {
        const registros = Object.entries(asistenciaLocal).map(([miembro_id, estado]) => ({
          reunion_id: reunionActiva.id, miembro_id, estado,
          registrado_por: sb.userId, updated_at: new Date().toISOString(),
        }));
        await guardarOffline(registros);
        toast("Sin conexión — guardado localmente, se sincronizará automáticamente 📶", "warn");
      } else {
        toast(e.message, "error");
      }
    }
    finally { setGuardando(false); }
  };

  // Guardar asistencia en IndexedDB cuando no hay internet
  const guardarOffline = async (registros) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("iglesia-offline", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("pendientes")) {
          db.createObjectStore("pendientes", { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction("pendientes", "readwrite");
        const store = tx.objectStore("pendientes");
        const payload = {
          url: `${sb.url}/rest/v1/asistencia?on_conflict=reunion_id,miembro_id`,
          method: "POST",
          headers: JSON.stringify(sb.headers({ Prefer: "resolution=merge-duplicates,return=representation" })),
          body: JSON.stringify(registros),
          guardado_at: new Date().toISOString(),
        };
        store.add(payload);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  };

  // Sincronizar datos guardados offline cuando hay internet
  const sincronizarOffline = async () => {
    try {
      const req = indexedDB.open("iglesia-offline", 1);
      req.onsuccess = async (e) => {
        const db = e.target.result;
        const tx = db.transaction("pendientes", "readwrite");
        const store = tx.objectStore("pendientes");
        const todos = await new Promise((res) => { const r = store.getAll(); r.onsuccess = () => res(r.result); });
        for (const item of todos) {
          try {
            const resp = await fetch(item.url, {
              method: item.method,
              headers: JSON.parse(item.headers),
              body: item.body,
            });
            if (resp.ok) store.delete(item.id);
          } catch {}
        }
        if (todos.length > 0) toast(`${todos.length} registro(s) offline sincronizado(s) ✓`, "ok");
      };
    } catch {}
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
      <SectionHeader title="Asistencia" icon="clipboard-check" role="success" />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[
          { id: "tomar", icon: "clipboard-check", label: "Tomar asistencia" },
          { id: "historial", icon: "history", label: "Historial de reuniones" },
        ].map(t => (
          <button key={t.id} onClick={() => { setTabAsistencia(t.id); if (t.id === "historial") cargarHistorialReuniones(); }} style={{ padding: "8px 16px", borderRadius: 8, border: `0.5px solid ${tabAsistencia === t.id ? "var(--border-success)" : "var(--border)"}`, background: tabAsistencia === t.id ? "var(--bg-success)" : "transparent", color: tabAsistencia === t.id ? "var(--text-success)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <i className={`ti ti-${t.icon}`} style={{ fontSize: 15 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tabAsistencia === "historial" && (
        <div>
          {/* Filtros historial */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr auto", gap: 10, marginBottom: 16, alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Desde</label>
              <input type="date" value={filtroHistorialDesde} onChange={e => setFiltroHistorialDesde(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Hasta</label>
              <input type="date" value={filtroHistorialHasta} onChange={e => setFiltroHistorialHasta(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <select value={filtroHistorialTemplo} onChange={e => setFiltroHistorialTemplo(e.target.value)}>
              <option value="">Todos los templos</option>
              {templos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <Btn icon="search" variant="primary" small onClick={cargarHistorialReuniones} loading={loadingHistorial}>Buscar</Btn>
          </div>

          {loadingHistorial ? <Spinner /> : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : reunionSeleccionada ? "1fr 1fr" : "1fr", gap: 16 }}>
              {/* Lista de reuniones */}
              <div>
                {historialReuniones.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
                    <i className="ti ti-calendar-off" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
                    No hay reuniones en ese período
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {historialReuniones.map(r => (
                      <div key={r.id} style={{ background: reunionSeleccionada?.id === r.id ? "var(--bg-success)" : "var(--surface-2)", border: `0.5px solid ${reunionSeleccionada?.id === r.id ? "var(--border-success)" : "var(--border)"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" }}
                        onClick={() => cargarAsistenciaReunion(r)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{r.tipos_reunion?.nombre}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                              {fmtDate(r.fecha)} {r.hora ? `· ${r.hora.slice(0,5)}` : ""} · {r.templos?.nombre || "Todos los templos"}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                            <Btn small icon="eye" onClick={() => cargarAsistenciaReunion(r)} title="Ver asistencia" />
                            <Btn small icon="trash" variant="danger" onClick={() => borrarReunionCompleta(r)} title="Eliminar reunión completa" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Asistencia de la reunión seleccionada */}
              {reunionSeleccionada && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12, color: "var(--text-primary)" }}>
                    <i className="ti ti-users" style={{ marginRight: 6, color: "var(--text-success)" }} />
                    {reunionSeleccionada.tipos_reunion?.nombre} — {fmtDate(reunionSeleccionada.fecha)}
                    <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>({asistenciaReunion.length} registros)</span>
                  </div>
                  {asistenciaReunion.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>Sin registros de asistencia</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {asistenciaReunion.map(a => {
                        const ESTADOS_AS = [
                          { val: "presente", role: "success" },
                          { val: "ausente", role: "danger" },
                          { val: "justificado", role: "warning" },
                          { val: "tarde", role: "accent" },
                        ];
                        return (
                          <div key={a.id} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                            <Avatar foto={a.miembros?.foto_url} nombre={`${a.miembros?.nombres} ${a.miembros?.apellidos}`} size={30} />
                            <div style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {a.miembros?.apellidos}, {a.miembros?.nombres}
                            </div>
                            {/* Selector de estado */}
                            <select value={a.estado} onChange={e => cambiarEstadoAsistencia(a.id, e.target.value)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "0.5px solid var(--border)", background: "var(--surface-1)", color: "var(--text-primary)", cursor: "pointer" }}>
                              {ESTADOS_AS.map(e => <option key={e.val} value={e.val}>{e.val.charAt(0).toUpperCase() + e.val.slice(1)}</option>)}
                            </select>
                            <Btn small icon="trash" variant="danger" onClick={() => borrarRegistroAsistencia(a.id, `${a.miembros?.nombres} ${a.miembros?.apellidos}`)} title="Borrar este registro" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tabAsistencia === "tomar" && (
        <div>
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

      const todasReuniones = await sb.query("reuniones", qR);
      if (!todasReuniones.length) { toast("No hay reuniones en ese período", "warn"); setLoading(false); return; }

      const reunionIds = todasReuniones.map(r => r.id).join(",");
      const asistencia = await sb.query("asistencia", `?reunion_id=in.(${reunionIds})&select=reunion_id,estado`);

      if (!asistencia.length) { toast("No hay registros de asistencia en ese período", "warn"); setLoading(false); return; }

      // Solo incluir reuniones donde SE TOMÓ asistencia (tienen al menos 1 registro)
      const reunionesConAsistencia = new Set(asistencia.map(a => a.reunion_id));
      const reuniones = todasReuniones.filter(r => reunionesConAsistencia.has(r.id));

      // Agrupar por fecha — solo reuniones con asistencia real
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

      // Por tipo reunión — solo de reuniones con asistencia
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
      // Solo traer reuniones donde SE TOMÓ asistencia (tienen al menos 1 registro)
      // Primero buscar los IDs de reuniones donde el miembro tiene registro
      let qA = `?miembro_id=eq.${miembroId}&select=reunion_id,estado,observacion,created_at`;
      const todasAsistencias = await sb.query("asistencia", qA);

      if (!todasAsistencias.length) {
        setHistorial([]); setStats(null); setChartData([]);
        setLoading(false); return;
      }

      // Traer solo las reuniones que están en el período y tipo seleccionado
      const reunionIds = todasAsistencias.map(a => a.reunion_id).join(",");
      let qR = `?id=in.(${reunionIds})&fecha=gte.${desde}&fecha=lte.${hasta}&select=id,fecha,hora,tipos_reunion(id,nombre),templos(nombre)&order=fecha.desc`;
      if (tipoId || filtroTipo) qR += `&tipo_reunion_id=eq.${tipoId || filtroTipo}`;

      const reuniones = await sb.query("reuniones", qR);
      if (!reuniones.length) {
        setHistorial([]); setStats(null); setChartData([]);
        setLoading(false); return;
      }

      // Mapear asistencia por reunion_id
      const asistMap = {};
      todasAsistencias.forEach(a => { asistMap[a.reunion_id] = a; });

      // Armar filas — solo reuniones donde hay registro real
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
        const mes = f.fecha.slice(0, 7);
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
// MÓDULO TAREAS
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// MÓDULO ESTADÍSTICAS DE TAREAS
// ─────────────────────────────────────────────────────────────
function ModuloEstadisticasTareas() {
  const { toast } = useApp();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [datos, setDatos] = useState(null);
  const [filtroDesde, setFiltroDesde] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0]);
  const [filtroHasta, setFiltroHasta] = useState(today());
  const [filtroMiembro, setFiltroMiembro] = useState("");
  const [miembros, setMiembros] = useState([]);

  useEffect(() => {
    sb.query("miembros", "?select=id,nombres,apellidos&estado=neq.retirado&order=apellidos.asc")
      .then(setMiembros).catch(() => {});
  }, []);

  const COLORES_ESTADO = { pendiente: "#F59E0B", en_progreso: "#3B82F6", completada: "#10B981", cancelada: "#EF4444" };
  const COLORES_PRIO = { alta: "#EF4444", media: "#F59E0B", baja: "#10B981" };
  const COLORES_BAR = ["#178CC7","#17A57A","#D85A30","#8B5CF6","#F59E0B","#EF4444","#10B981","#3B82F6","#EC4899","#14B8A6"];

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      let qT = `?fecha_vencimiento=gte.${filtroDesde}&fecha_vencimiento=lte.${filtroHasta}&select=*,miembros(id,nombres,apellidos)`;
      if (filtroMiembro) qT += `&miembro_id=eq.${filtroMiembro}`;
      const tareas = await sb.query("tareas", qT);

      if (!tareas.length) { setDatos(null); setLoading(false); return; }

      // ── Totales por estado ───────────────────────────────
      const porEstado = { pendiente: 0, en_progreso: 0, completada: 0, cancelada: 0 };
      tareas.forEach(t => { if (porEstado[t.estado] !== undefined) porEstado[t.estado]++; });
      const pieEstado = Object.entries(porEstado).map(([name, value]) => ({ name, value, label: { pendiente: "Pendiente", en_progreso: "En progreso", completada: "Completada", cancelada: "Cancelada" }[name] }));

      // ── Totales por prioridad ────────────────────────────
      const porPrioridad = { alta: 0, media: 0, baja: 0 };
      tareas.forEach(t => { if (porPrioridad[t.prioridad] !== undefined) porPrioridad[t.prioridad]++; });
      const piePrioridad = Object.entries(porPrioridad).map(([name, value]) => ({ name, value, label: { alta: "Alta", media: "Media", baja: "Baja" }[name] }));

      // ── Tendencia mensual (creadas vs completadas) ───────
      const porMes = {};
      tareas.forEach(t => {
        const mes = t.created_at.slice(0, 7);
        if (!porMes[mes]) porMes[mes] = { mes, creadas: 0, completadas: 0, canceladas: 0, pendientes: 0 };
        porMes[mes].creadas++;
        if (t.estado === "completada") porMes[mes].completadas++;
        if (t.estado === "cancelada") porMes[mes].canceladas++;
        if (t.estado === "pendiente" || t.estado === "en_progreso") porMes[mes].pendientes++;
      });
      const lineData = Object.values(porMes)
        .sort((a, b) => a.mes.localeCompare(b.mes))
        .map(d => ({
          ...d,
          label: new Date(d.mes + "-15").toLocaleDateString("es-ES", { month: "short", year: "2-digit" }),
          pctCompletadas: d.creadas ? Math.round(d.completadas / d.creadas * 100) : 0,
        }));

      // ── Ranking: más tareas asignadas ────────────────────
      const asignadas = {};
      tareas.forEach(t => {
        if (!t.miembros) return;
        const key = t.miembro_id;
        if (!asignadas[key]) asignadas[key] = { nombre: `${t.miembros.apellidos}, ${t.miembros.nombres}`, total: 0, completadas: 0, pendientes: 0, canceladas: 0 };
        asignadas[key].total++;
        if (t.estado === "completada") asignadas[key].completadas++;
        if (t.estado === "pendiente" || t.estado === "en_progreso") asignadas[key].pendientes++;
        if (t.estado === "cancelada") asignadas[key].canceladas++;
      });

      const rankingAsignadas = Object.values(asignadas)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(d => ({ ...d, pct: d.total ? Math.round(d.completadas / d.total * 100) : 0 }));

      const rankingCompletadas = Object.values(asignadas)
        .filter(d => d.completadas > 0)
        .sort((a, b) => b.completadas - a.completadas)
        .slice(0, 10);

      // ── Tareas vencidas ──────────────────────────────────
      const hoy = today();
      const vencidas = tareas.filter(t => t.fecha_vencimiento && t.fecha_vencimiento < hoy && t.estado !== "completada" && t.estado !== "cancelada").length;
      const sinFecha = tareas.filter(t => !t.fecha_vencimiento && t.estado !== "completada" && t.estado !== "cancelada").length;

      // ── Tiempo promedio de completado (días) ─────────────
      const completadas = tareas.filter(t => t.estado === "completada" && t.fecha_vencimiento);
      const tiempoPromedio = completadas.length > 0
        ? Math.round(completadas.reduce((sum, t) => {
            const diff = (new Date(t.updated_at) - new Date(t.created_at)) / 86400000;
            return sum + diff;
          }, 0) / completadas.length)
        : null;

      setDatos({ tareas, porEstado, porPrioridad, pieEstado, piePrioridad, lineData, rankingAsignadas, rankingCompletadas, vencidas, sinFecha, tiempoPromedio, total: tareas.length });
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, [filtroDesde, filtroHasta, filtroMiembro]);

  useEffect(() => { cargar(); }, []);

  return (
    <div>
      <SectionHeader title="Estadísticas de tareas" icon="chart-dots-3" role="pro" />

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Vence desde</label>
          <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={{ boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Vence hasta</label>
          <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={{ boxSizing: "border-box" }} />
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Miembro</label>
          <select value={filtroMiembro} onChange={e => setFiltroMiembro(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
            <option value="">Todos los miembros</option>
            {miembros.map(m => <option key={m.id} value={m.id}>{m.apellidos}, {m.nombres}</option>)}
          </select>
        </div>
        <Btn icon="refresh" variant="primary" small onClick={cargar} loading={loading}>Actualizar</Btn>
        {filtroMiembro && <Btn icon="x" small onClick={() => setFiltroMiembro("")}>Limpiar</Btn>}
      </div>

      {loading ? <Spinner /> : !datos ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-chart-dots-3" style={{ fontSize: 40, display: "block", marginBottom: 10 }} />
          No hay tareas en el período seleccionado
        </div>
      ) : (
        <div>
          {/* ── Tarjetas resumen ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Total tareas", val: datos.total, icon: "checklist", role: "pro" },
              { label: "Completadas", val: datos.porEstado.completada, icon: "check", role: "success" },
              { label: "Pendientes", val: datos.porEstado.pendiente + datos.porEstado.en_progreso, icon: "clock", role: "warning" },
              { label: "Canceladas", val: datos.porEstado.cancelada, icon: "x", role: "danger" },
              { label: "Vencidas", val: datos.vencidas, icon: "alert-triangle", role: "danger" },
              { label: "Sin fecha", val: datos.sinFecha, icon: "calendar-off", role: "accent" },
              ...(datos.tiempoPromedio !== null ? [{ label: "Días prom. completar", val: `${datos.tiempoPromedio}d`, icon: "hourglass", role: "accent" }] : []),
              { label: "% Completadas", val: datos.total ? `${Math.round(datos.porEstado.completada / datos.total * 100)}%` : "0%", icon: "chart-pie", role: "success" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--surface-1)", borderRadius: 10, padding: "12px 14px", borderTop: `2px solid var(--border-${s.role})` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <i className={`ti ti-${s.icon}`} style={{ fontSize: 14, color: `var(--text-${s.role})` }} />
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</span>
                </div>
                <div style={{ fontSize: 24, fontWeight: 500, color: `var(--text-${s.role})` }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* ── Gráfico tendencia mensual ── */}
          {datos.lineData.length > 0 && (
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Tendencia mensual — tareas creadas vs completadas</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={datos.lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="creadas" stroke="#8B5CF6" name="Creadas" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="completadas" stroke="#10B981" name="Completadas" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="pendientes" stroke="#F59E0B" name="Pendientes/En progreso" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Pie charts estado y prioridad ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Distribución por estado</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={datos.pieEstado.filter(d => d.value > 0)} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="label"
                    label={({ label, percent }) => percent > 0.05 ? `${label} ${Math.round(percent * 100)}%` : ""} labelLine={false}>
                    {datos.pieEstado.map((e, i) => <Cell key={i} fill={COLORES_ESTADO[e.name] || PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Distribución por prioridad</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={datos.piePrioridad.filter(d => d.value > 0)} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="label"
                    label={({ label, percent }) => percent > 0.05 ? `${label} ${Math.round(percent * 100)}%` : ""} labelLine={false}>
                    {datos.piePrioridad.map((e, i) => <Cell key={i} fill={COLORES_PRIO[e.name] || PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Barra % completadas por mes ── */}
          {datos.lineData.length > 1 && (
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>% de tareas completadas por mes</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={datos.lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={v => `${v}%`} />
                  <Bar dataKey="pctCompletadas" name="% Completadas" fill="#10B981" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Rankings ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
            {/* Ranking: más tareas asignadas */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
                <i className="ti ti-sort-descending-numbers" style={{ marginRight: 6, color: "var(--text-pro)" }} />
                Top 10 — más tareas asignadas
              </div>
              {datos.rankingAsignadas.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 20 }}>Sin datos</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {datos.rankingAsignadas.map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: i < 3 ? "var(--bg-pro)" : "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, color: i < 3 ? "var(--text-pro)" : "var(--text-muted)", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nombre}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {m.completadas} completadas · {m.pendientes} pendientes
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-pro)" }}>{m.total}</div>
                        <div style={{ fontSize: 10, color: "var(--text-success)" }}>{m.pct}% ✓</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ranking: más tareas completadas */}
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>
                <i className="ti ti-trophy" style={{ marginRight: 6, color: "var(--text-success)" }} />
                Top 10 — más tareas completadas
              </div>
              {datos.rankingCompletadas.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 20 }}>Sin tareas completadas en el período</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {datos.rankingCompletadas.map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: i < 3 ? "var(--bg-success)" : "var(--surface-1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, color: i < 3 ? "var(--text-success)" : "var(--text-muted)", flexShrink: 0 }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nombre}</div>
                        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                          {/* Barra de progreso visual */}
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--surface-1)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${m.total ? (m.completadas / m.total * 100) : 0}%`, background: "var(--border-success)", borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.total ? Math.round(m.completadas / m.total * 100) : 0}%</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 500, color: "var(--text-success)", flexShrink: 0 }}>{m.completadas}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Bar chart por miembro (top 10 asignadas) ── */}
          {datos.rankingAsignadas.length > 0 && (
            <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Tareas por miembro (top 10)</div>
              <ResponsiveContainer width="100%" height={isMobile ? 300 : 240}>
                <BarChart data={datos.rankingAsignadas} layout="vertical" margin={{ left: isMobile ? 80 : 120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10 }} width={isMobile ? 80 : 120} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="completadas" name="Completadas" stackId="a" fill="#10B981" />
                  <Bar dataKey="pendientes" name="Pendientes" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="canceladas" name="Canceladas" stackId="a" fill="#EF4444" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModuloTareas() {
  const { usuario, toast } = useApp();
  const isMobile = useIsMobile();
  const canEdit = canDo(usuario, "asistencia");

  const [tareas, setTareas] = useState([]);
  const [miembros, setMiembros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | {mode:"new"|"edit"|"view"|"reporte", data}

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroPrioridad, setFiltroPrioridad] = useState("");
  const [filtroMiembro, setFiltroMiembro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtroDesde, setFiltroDesde] = useState(today());
  const [filtroHasta, setFiltroHasta] = useState("");

  const ESTADOS = [
    { val: "pendiente", label: "Pendiente", role: "warning" },
    { val: "en_progreso", label: "En progreso", role: "accent" },
    { val: "completada", label: "Completada", role: "success" },
    { val: "cancelada", label: "Cancelada", role: "danger" },
  ];

  const PRIORIDADES = [
    { val: "baja", label: "Baja", role: "success" },
    { val: "media", label: "Media", role: "warning" },
    { val: "alta", label: "Alta", role: "danger" },
  ];

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ts, ms] = await Promise.all([
        sb.query("tareas", "?select=*,miembros(id,nombres,apellidos,foto_url),asignado_por:usuarios_sistema!tareas_asignado_por_fkey(nombre)&order=fecha_vencimiento.asc.nullslast"),
        sb.query("miembros", "?select=id,nombres,apellidos,foto_url&estado=neq.retirado&order=apellidos.asc"),
      ]);
      setTareas(ts); setMiembros(ms);
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = tareas.filter(t => {
    const q = busqueda.toLowerCase();
    const matchQ = !q || t.titulo?.toLowerCase().includes(q) || `${t.miembros?.nombres} ${t.miembros?.apellidos}`.toLowerCase().includes(q);
    const matchE = !filtroEstado || t.estado === filtroEstado;
    const matchP = !filtroPrioridad || t.prioridad === filtroPrioridad;
    const matchM = !filtroMiembro || t.miembro_id === filtroMiembro;
    const matchDesde = !filtroDesde || (t.fecha_vencimiento && t.fecha_vencimiento >= filtroDesde);
    const matchHasta = !filtroHasta || (t.fecha_vencimiento && t.fecha_vencimiento <= filtroHasta);
    return matchQ && matchE && matchP && matchM && matchDesde && matchHasta;
  });

  const conteo = { pendiente: 0, en_progreso: 0, completada: 0, cancelada: 0 };
  tareas.forEach(t => { if (conteo[t.estado] !== undefined) conteo[t.estado]++; });

  const vencida = (t) => t.fecha_vencimiento && t.estado !== "completada" && t.estado !== "cancelada" && new Date(t.fecha_vencimiento) < new Date();

  const copiarReporte = () => {
    // Usa las tareas YA filtradas por todos los filtros activos (incluyendo período)
    const pendientes = filtradas.filter(t => t.estado === "pendiente" || t.estado === "en_progreso");
    const completadas = filtradas.filter(t => t.estado === "completada");

    if (filtradas.length === 0) { toast("No hay tareas con los filtros actuales", "warn"); return; }

    const hoy = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
    let encabezado = `📋 *Reporte de tareas — ${hoy}*`;

    // Indicar período si está filtrado
    if (filtroDesde || filtroHasta) {
      const desde = filtroDesde ? fmtDate(filtroDesde) : "inicio";
      const hasta = filtroHasta ? fmtDate(filtroHasta) : "hoy";
      encabezado += `\n📅 Período: ${desde} → ${hasta}`;
    }
    if (filtroMiembro) {
      const m = miembros.find(m => m.id === filtroMiembro);
      if (m) encabezado += `\n👤 Miembro: ${m.apellidos}, ${m.nombres}`;
    }
    if (filtroEstado) {
      const e = ESTADOS.find(e => e.val === filtroEstado);
      if (e) encabezado += `\n🔖 Estado: ${e.label}`;
    }
    if (filtroPrioridad) {
      const p = PRIORIDADES.find(p => p.val === filtroPrioridad);
      if (p) encabezado += `\n🎯 Prioridad: ${p.label}`;
    }

    let texto = encabezado + "\n\n";

    const enProgreso = pendientes.filter(t => t.estado === "en_progreso");
    const pendientesSolo = pendientes.filter(t => t.estado === "pendiente");

    if (enProgreso.length > 0) {
      texto += `🔄 *En progreso (${enProgreso.length})*\n`;
      enProgreso.forEach(t => {
        const nombre = `${t.miembros?.nombres} ${t.miembros?.apellidos}`;
        const vence = t.fecha_vencimiento ? ` · Vence: ${fmtDate(t.fecha_vencimiento)}` : "";
        const ev = vencida(t) ? " ⚠️ VENCIDA" : "";
        texto += `• ${t.titulo}\n  👤 ${nombre}${vence}${ev}\n`;
      });
      texto += "\n";
    }

    if (pendientesSolo.length > 0) {
      texto += `⏳ *Pendientes (${pendientesSolo.length})*\n`;
      pendientesSolo.forEach(t => {
        const nombre = `${t.miembros?.nombres} ${t.miembros?.apellidos}`;
        const vence = t.fecha_vencimiento ? ` · Vence: ${fmtDate(t.fecha_vencimiento)}` : "";
        const ev = vencida(t) ? " ⚠️ VENCIDA" : "";
        const prio = t.prioridad === "alta" ? " 🔴" : t.prioridad === "media" ? " 🟡" : " 🟢";
        texto += `• ${t.titulo}${prio}\n  👤 ${nombre}${vence}${ev}\n`;
      });
      texto += "\n";
    }

    if (completadas.length > 0) {
      texto += `✅ *Completadas (${completadas.length})*\n`;
      completadas.forEach(t => {
        const nombre = `${t.miembros?.nombres} ${t.miembros?.apellidos}`;
        const vence = t.fecha_vencimiento ? ` · ${fmtDate(t.fecha_vencimiento)}` : "";
        texto += `• ${t.titulo}\n  👤 ${nombre}${vence}\n`;
      });
      texto += "\n";
    }

    const vencidas = pendientes.filter(t => vencida(t)).length;
    if (vencidas > 0) texto += `⚠️ _${vencidas} tarea(s) vencida(s) requieren atención_\n`;

    texto += `\n_Total: ${filtradas.length} tarea(s)_`;

    navigator.clipboard.writeText(texto)
      .then(() => toast("Reporte copiado ✓ — incluye los filtros aplicados", "ok"))
      .catch(() => toast("No se pudo copiar automáticamente. Intentá manualmente.", "error"));
  };

  return (
    <div>
      <SectionHeader
        title="Tareas y comisiones"
        icon="checklist"
        role="danger"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn icon="clipboard-copy" small variant="secondary" onClick={copiarReporte}>Copiar reporte</Btn>
            {canEdit && <Btn icon="plus" variant="primary" small onClick={() => setModal({ mode: "new", data: null })}>Nueva tarea</Btn>}
          </div>
        }
      />

      {/* Contadores */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
        {ESTADOS.map(e => (
          <div key={e.val} onClick={() => setFiltroEstado(filtroEstado === e.val ? "" : e.val)} style={{ background: filtroEstado === e.val ? `var(--bg-${e.role})` : "var(--surface-1)", border: `0.5px solid ${filtroEstado === e.val ? `var(--border-${e.role})` : "var(--border)"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
            <div style={{ fontSize: 24, fontWeight: 500, color: `var(--text-${e.role})` }}>{conteo[e.val]}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
        <input placeholder="Buscar por título o miembro..." value={busqueda} onChange={e => setBusqueda(e.target.value)} style={{ boxSizing: "border-box" }} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
        </select>
        <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)}>
          <option value="">Todas las prioridades</option>
          {PRIORIDADES.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
        </select>
        <select value={filtroMiembro} onChange={e => setFiltroMiembro(e.target.value)}>
          <option value="">Todos los miembros</option>
          {miembros.map(m => <option key={m.id} value={m.id}>{m.apellidos}, {m.nombres}</option>)}
        </select>
      </div>

      {/* Filtro por período de vencimiento */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr auto", gap: 10, marginBottom: 16, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Vence desde</label>
          <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Vence hasta</label>
          <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        {(filtroDesde || filtroHasta || filtroEstado || filtroPrioridad || filtroMiembro || busqueda) && (
          <Btn small icon="x" onClick={() => { setFiltroDesde(""); setFiltroHasta(""); setFiltroEstado(""); setFiltroPrioridad(""); setFiltroMiembro(""); setBusqueda(""); }}>
            Limpiar filtros
          </Btn>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{filtradas.length} tarea(s){filtradas.length !== tareas.length ? ` de ${tareas.length} total` : ""}</div>

      {loading ? <Spinner /> : filtradas.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-checklist" style={{ fontSize: 40, display: "block", marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>No hay tareas{busqueda || filtroEstado || filtroPrioridad ? " con esos filtros" : " registradas"}</div>
        </div>
      ) : isMobile ? (
        /* Vista tarjetas mobile */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtradas.map(t => {
            const ev = vencida(t);
            const prioridad = PRIORIDADES.find(p => p.val === t.prioridad);
            const estado = ESTADOS.find(e => e.val === t.estado);
            return (
              <div key={t.id} style={{ background: ev ? "var(--bg-danger)" : "var(--surface-2)", border: `0.5px solid ${ev ? "var(--border-danger)" : "var(--border)"}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <Avatar foto={t.miembros?.foto_url} nombre={`${t.miembros?.nombres} ${t.miembros?.apellidos}`} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>{t.titulo}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.miembros?.apellidos}, {t.miembros?.nombres}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {estado && <Badge label={estado.label} role={estado.role} />}
                  {prioridad && <Badge label={prioridad.label} role={prioridad.role} />}
                  {ev && <Badge label="VENCIDA" role="danger" />}
                  {t.fecha_vencimiento && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Vence: {fmtDate(t.fecha_vencimiento)}</span>}
                </div>
                <div style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: "0.5px solid var(--border)", flexWrap: "wrap" }}>
                  <Btn small icon="eye" onClick={() => setModal({ mode: "view", data: t })} style={{ flex: 1, justifyContent: "center" }}>Ver</Btn>
                  {canEdit && <Btn small icon="edit" onClick={() => setModal({ mode: "edit", data: t })} style={{ flex: 1, justifyContent: "center" }}>Editar</Btn>}
                  {canEdit && <Btn small icon="file-text" variant="success" onClick={() => setModal({ mode: "reporte", data: t })} style={{ flex: 1, justifyContent: "center" }}>Reporte</Btn>}
                  {canEdit && t.estado !== "completada" && t.estado !== "cancelada" && (
                    <Btn small icon="user-share" variant="warning" onClick={() => setModal({ mode: "reasignar", data: t })} style={{ flex: 1, justifyContent: "center" }}>Reasignar</Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Vista tabla desktop */
        <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
            <thead>
              <tr style={{ background: "var(--surface-1)" }}>
                {["Tarea", "Asignado a", "Prioridad", "Estado", "Vencimiento", "Acciones"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", textAlign: "left", borderBottom: "0.5px solid var(--border)", width: [null, 180, 100, 110, 110, 200][i] }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map((t, idx) => {
                const ev = vencida(t);
                const prioridad = PRIORIDADES.find(p => p.val === t.prioridad);
                const estado = ESTADOS.find(e => e.val === t.estado);
                return (
                  <tr key={t.id} style={{ borderBottom: idx < filtradas.length - 1 ? "0.5px solid var(--border)" : "none", background: ev ? "var(--bg-danger)" : "transparent" }}
                    onMouseEnter={e => { if (!ev) e.currentTarget.style.background = "var(--surface-1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ev ? "var(--bg-danger)" : "transparent"; }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{t.titulo}</div>
                      {t.descripcion && <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.descripcion}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar foto={t.miembros?.foto_url} nombre={`${t.miembros?.nombres} ${t.miembros?.apellidos}`} size={28} />
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.miembros?.apellidos}, {t.miembros?.nombres}</div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>{prioridad && <Badge label={prioridad.label} role={prioridad.role} />}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {estado && <Badge label={estado.label} role={estado.role} />}
                        {ev && <Badge label="VENCIDA" role="danger" />}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: ev ? "var(--text-danger)" : "var(--text-secondary)" }}>{t.fecha_vencimiento ? fmtDate(t.fecha_vencimiento) : "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Btn small icon="eye" onClick={() => setModal({ mode: "view", data: t })} />
                        {canEdit && <Btn small icon="edit" onClick={() => setModal({ mode: "edit", data: t })} />}
                        {canEdit && <Btn small icon="file-text" variant="success" onClick={() => setModal({ mode: "reporte", data: t })} title="Agregar reporte" />}
                        {canEdit && t.estado !== "completada" && t.estado !== "cancelada" && (
                          <Btn small icon="user-share" variant="warning" onClick={() => setModal({ mode: "reasignar", data: t })} title="Reasignar tarea" />
                        )}
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
        <ModalTarea
          mode={modal.mode}
          data={modal.data}
          miembros={miembros}
          usuario={usuario}
          ESTADOS={ESTADOS}
          PRIORIDADES={PRIORIDADES}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MODAL TAREA (nuevo / editar / ver / reporte)
// ─────────────────────────────────────────────────────────────
function ModalTarea({ mode, data, miembros, usuario, ESTADOS, PRIORIDADES, onClose, onSaved }) {
  const { toast } = useApp();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    titulo: "", descripcion: "", miembro_id: "", prioridad: "media",
    estado: "pendiente", fecha_vencimiento: "", notas_internas: "",
    ...(data || {}),
  });
  const [reporteTexto, setReporteTexto] = useState("");
  const [reportes, setReportes] = useState([]);
  const [reasignaciones, setReasignaciones] = useState([]);
  const [loadingReportes, setLoadingReportes] = useState(false);

  useEffect(() => {
    if ((mode === "view" || mode === "reporte") && data?.id) {
      cargarReportes();
      cargarReasignaciones();
    }
  }, [mode, data]);

  const cargarReportes = async () => {
    setLoadingReportes(true);
    try {
      const rs = await sb.query("tarea_reportes", `?tarea_id=eq.${data.id}&select=*,usuarios_sistema(nombre)&order=created_at.desc`);
      setReportes(rs);
    } catch {}
    finally { setLoadingReportes(false); }
  };

  const cargarReasignaciones = async () => {
    try {
      const rs = await sb.query("tarea_reasignaciones",
        `?tarea_id=eq.${data.id}&select=*,miembro_anterior:miembros!tarea_reasignaciones_miembro_anterior_id_fkey(nombres,apellidos),miembro_nuevo:miembros!tarea_reasignaciones_miembro_nuevo_id_fkey(nombres,apellidos),reasignado_por:usuarios_sistema(nombre)&order=created_at.asc`
      );
      setReasignaciones(rs);
    } catch {}
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isView = mode === "view";
  const isReporte = mode === "reporte";

  const handleSave = async () => {
    if (!form.titulo?.trim()) { toast("El título es requerido", "warn"); return; }
    if (!form.miembro_id) { toast("Seleccioná un miembro", "warn"); return; }
    setSaving(true);
    try {
      const payload = {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion?.trim() || null,
        miembro_id: form.miembro_id,
        prioridad: form.prioridad,
        estado: form.estado,
        fecha_vencimiento: form.fecha_vencimiento || null,
        notas_internas: form.notas_internas?.trim() || null,
        asignado_por: usuario?.id,
        updated_at: new Date().toISOString(),
      };
      if (mode === "new") {
        await sb.insert("tareas", payload);
        toast("Tarea creada ✓", "ok");
      } else {
        await sb.update("tareas", data.id, payload);
        toast("Tarea actualizada ✓", "ok");
      }
      onSaved();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const handleReporte = async () => {
    if (!reporteTexto.trim()) { toast("Escribí el reporte antes de guardar", "warn"); return; }
    setSaving(true);
    try {
      await sb.insert("tarea_reportes", {
        tarea_id: data.id,
        texto: reporteTexto.trim(),
        reportado_por: usuario?.id,
      });
      // Actualizar estado si el reporte indica completado
      setReporteTexto("");
      await cargarReportes();
      toast("Reporte guardado ✓", "ok");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const [reasignarForm, setReasignarForm] = useState({ miembro_nuevo_id: "", motivo: "" });

  const handleReasignar = async () => {
    if (!reasignarForm.miembro_nuevo_id) { toast("Seleccioná el nuevo miembro", "warn"); return; }
    if (!reasignarForm.motivo?.trim()) { toast("Indicá el motivo de la reasignación", "warn"); return; }
    setSaving(true);
    try {
      // 1. Registrar el historial de reasignación
      await sb.insert("tarea_reasignaciones", {
        tarea_id: data.id,
        miembro_anterior_id: data.miembro_id,
        miembro_nuevo_id: reasignarForm.miembro_nuevo_id,
        motivo: reasignarForm.motivo.trim(),
        reasignado_por: usuario?.id,
      });
      // 2. Actualizar la tarea con el nuevo miembro y estado pendiente
      await sb.update("tareas", data.id, {
        miembro_id: reasignarForm.miembro_nuevo_id,
        estado: "pendiente",
        updated_at: new Date().toISOString(),
      });
      // 3. Agregar reporte automático explicando la reasignación
      const miembroAnterior = miembros.find(m => m.id === data.miembro_id);
      const miembroNuevo = miembros.find(m => m.id === reasignarForm.miembro_nuevo_id);
      await sb.insert("tarea_reportes", {
        tarea_id: data.id,
        texto: `🔄 Tarea reasignada de ${miembroAnterior?.nombres} ${miembroAnterior?.apellidos} → ${miembroNuevo?.nombres} ${miembroNuevo?.apellidos}. Motivo: ${reasignarForm.motivo.trim()}`,
        reportado_por: usuario?.id,
      });
      toast("Tarea reasignada con registro histórico ✓", "ok");
      onSaved();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const titulo = { new: "Nueva tarea", edit: "Editar tarea", view: "Ver tarea", reporte: "Reportes de avance", reasignar: "Reasignar tarea" }[mode];

  return (
    <Modal title={titulo} onClose={onClose} wide={isReporte || isView}>
      {(mode === "new" || mode === "edit") && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: isMobile ? "1" : "1 / -1" }}>
              <Inp label="Título *" value={form.titulo} onChange={e => set("titulo", e.target.value)} placeholder="Ej: Preparar estudio bíblico del domingo" />
            </div>
            <Sel label="Asignado a *" value={form.miembro_id} onChange={e => set("miembro_id", e.target.value)}>
              <option value="">— Seleccionar miembro —</option>
              {miembros.map(m => <option key={m.id} value={m.id}>{m.apellidos}, {m.nombres}</option>)}
            </Sel>
            <Inp label="Fecha de vencimiento" type="date" value={form.fecha_vencimiento || ""} onChange={e => set("fecha_vencimiento", e.target.value)} />
            <Sel label="Prioridad" value={form.prioridad} onChange={e => set("prioridad", e.target.value)}>
              {PRIORIDADES.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
            </Sel>
            <Sel label="Estado" value={form.estado} onChange={e => set("estado", e.target.value)}>
              {ESTADOS.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
            </Sel>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción</label>
            <textarea value={form.descripcion || ""} onChange={e => set("descripcion", e.target.value)} rows={3} placeholder="Detalle de la tarea..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Notas internas (solo visible para el equipo)</label>
            <textarea value={form.notas_internas || ""} onChange={e => set("notas_internas", e.target.value)} rows={2} placeholder="Notas privadas..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" icon="device-floppy" loading={saving} onClick={handleSave}>
              {saving ? "Guardando..." : "Guardar"}
            </Btn>
          </div>
        </div>
      )}

      {mode === "reasignar" && data && (
        <div>
          {/* Info tarea actual */}
          <div style={{ background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-warning)", marginBottom: 6 }}>
              <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} />
              Tarea a reasignar
            </div>
            <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>{data.titulo}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Actualmente asignada a: <strong>{data.miembros?.apellidos}, {data.miembros?.nombres}</strong>
            </div>
          </div>

          <Sel label="Reasignar a *" value={reasignarForm.miembro_nuevo_id}
            onChange={e => setReasignarForm(f => ({ ...f, miembro_nuevo_id: e.target.value }))}>
            <option value="">— Seleccionar nuevo responsable —</option>
            {miembros.filter(m => m.id !== data.miembro_id).map(m => (
              <option key={m.id} value={m.id}>{m.apellidos}, {m.nombres}</option>
            ))}
          </Sel>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
              Motivo de la reasignación * <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(queda registrado en el historial)</span>
            </label>
            <textarea
              value={reasignarForm.motivo}
              onChange={e => setReasignarForm(f => ({ ...f, motivo: e.target.value }))}
              rows={3}
              placeholder="Ej: El hermano no pudo completarla por motivos de salud, viaje, etc."
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }}
            />
          </div>

          <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
            <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
            Al reasignar: la tarea vuelve a estado <strong>Pendiente</strong>, el motivo queda registrado en el historial de reportes y se puede consultar en cualquier momento.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="warning" icon="user-share" loading={saving} onClick={handleReasignar}>
              {saving ? "Reasignando..." : "Confirmar reasignación"}
            </Btn>
          </div>
        </div>
      )}

      {(isView || isReporte) && data && (
        <div>
          {/* Info de la tarea */}
          <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 10 }}>{data.titulo}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {ESTADOS.find(e => e.val === data.estado) && <Badge label={ESTADOS.find(e => e.val === data.estado).label} role={ESTADOS.find(e => e.val === data.estado).role} />}
              {PRIORIDADES.find(p => p.val === data.prioridad) && <Badge label={`Prioridad ${PRIORIDADES.find(p => p.val === data.prioridad).label}`} role={PRIORIDADES.find(p => p.val === data.prioridad).role} />}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
              <div><strong>Asignado a:</strong> {data.miembros?.apellidos}, {data.miembros?.nombres}</div>
              <div><strong>Vencimiento:</strong> {data.fecha_vencimiento ? fmtDate(data.fecha_vencimiento) : "Sin fecha"}</div>
              {data.descripcion && <div style={{ gridColumn: "1 / -1" }}><strong>Descripción:</strong> {data.descripcion}</div>}
              {data.notas_internas && <div style={{ gridColumn: "1 / -1" }}><strong>Notas internas:</strong> {data.notas_internas}</div>}
            </div>
          </div>

          {/* Historial de reasignaciones */}
          {reasignaciones.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>
                <i className="ti ti-user-share" style={{ marginRight: 6, color: "var(--text-warning)" }} />
                Historial de reasignaciones ({reasignaciones.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {reasignaciones.map((r, i) => (
                  <div key={r.id} style={{ background: "var(--bg-warning)", border: "0.5px solid var(--border-warning)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 13, color: "var(--text-warning)", fontWeight: 500, marginBottom: 4 }}>
                      <i className="ti ti-arrow-right" style={{ marginRight: 4 }} />
                      {r.miembro_anterior?.nombres} {r.miembro_anterior?.apellidos} → {r.miembro_nuevo?.nombres} {r.miembro_nuevo?.apellidos}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
                      <strong>Motivo:</strong> {r.motivo}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      Reasignada por {r.reasignado_por?.nombre || "Sistema"} — {new Date(r.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reportes de avance */}
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>
            <i className="ti ti-message-report" style={{ marginRight: 6, color: "var(--text-success)" }} />
            Reportes de avance ({reportes.length})
          </div>

          {loadingReportes ? <Spinner /> : reportes.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 13 }}>
              <i className="ti ti-notes-off" style={{ fontSize: 28, display: "block", marginBottom: 8 }} />
              Aún no hay reportes de avance para esta tarea
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {reportes.map((r, i) => (
                <div key={r.id} style={{ background: "var(--surface-1)", borderRadius: 10, padding: "12px 14px", borderLeft: "3px solid var(--border-success)" }}>
                  <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 6, lineHeight: 1.5 }}>{r.texto}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {r.usuarios_sistema?.nombre || "Sistema"} — {new Date(r.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Agregar nuevo reporte */}
          {isReporte && (
            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 16 }}>
              <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>Agregar reporte de avance</label>
              <textarea value={reporteTexto} onChange={e => setReporteTexto(e.target.value)} rows={3} placeholder="Describí el avance, resultado o novedad de esta tarea..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)", marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                <Sel label="" value={form.estado} onChange={async e => {
                  set("estado", e.target.value);
                  try { await sb.update("tareas", data.id, { estado: e.target.value, updated_at: new Date().toISOString() }); toast("Estado actualizado ✓", "ok"); onSaved(); } catch {}
                }} style={{ marginBottom: 0, minWidth: 180 }}>
                  {ESTADOS.map(e => <option key={e.val} value={e.val}>{e.label}</option>)}
                </Sel>
                <Btn variant="success" icon="send" loading={saving} onClick={handleReporte}>
                  {saving ? "Guardando..." : "Guardar reporte"}
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO VISITAS (Cartas de presentación y recomendación)
// ─────────────────────────────────────────────────────────────
function ModuloVisitas() {
  const { usuario, toast } = useApp();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("entrantes");
  const [entrantes, setEntrantes] = useState([]);
  const [salientes, setSalientes] = useState([]);
  const [miembros, setMiembros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [e, s, ms] = await Promise.all([
        sb.query("visitas_entrantes", "?select=*,registrado_por:usuarios_sistema(nombre)&order=fecha_presentacion.desc"),
        sb.query("visitas_salientes", "?select=*,miembros(id,nombres,apellidos),emitido_por:usuarios_sistema(nombre)&order=fecha_emision.desc"),
        sb.query("miembros", "?select=id,nombres,apellidos&estado=eq.activo&order=apellidos.asc"),
      ]);
      setEntrantes(e); setSalientes(s); setMiembros(ms);
    } catch (err) { toast(err.message, "error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const TIPO_LABEL = { recomendacion: "Recomendación", traslado: "Traslado", visita_temporal: "Visita temporal" };

  // ── Generador de PDF ────────────────────────────────────────
  const generarPDF = async (tipo, datos) => {
    try {
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const mx = 25, aw = 160;
      let y = 15;

      // ── Cargar logo desde /logo-navy.png ─────────────────
      // ── Función para cargar imagen a base64 ──────────────
      const cargarImagen = (src) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width; canvas.height = img.height;
          canvas.getContext("2d").drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });

      const [escudoB64, firmaB64] = await Promise.all([
        cargarImagen("/escudo.jpg"),
        cargarImagen("/firma-pastor.jpg"),
      ]);

      // ── Encabezado con escudo ──────────────────────────────
      const dibujarEncabezado = (titulo, subtitulo) => {
        // Escudo arriba a la izquierda
        if (escudoB64) {
          try { doc.addImage(escudoB64, "JPEG", mx, y, 28, 28); } catch {}
        }
        // Nombre iglesia centrado
        doc.setFontSize(14); doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 45, 90);
        doc.text(datos.iglesia || "Unión Pentecostal", 105, y + 8, { align: "center" });
        // Línea separadora
        y += 32;
        doc.setDrawColor(30, 45, 90);
        doc.setLineWidth(0.5);
        doc.line(mx, y, mx + aw, y);
        y += 4;
        // Título del documento
        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 30, 30);
        doc.text(subtitulo, 105, y, { align: "center" });
        y += 8;
        doc.setDrawColor(200, 200, 200);
        doc.line(mx, y, mx + aw, y);
        y += 6;
      };

      const linea = (texto, alineacion = "left", bold = false, size = 10) => {
        doc.setFontSize(size);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setTextColor(30, 30, 30);
        if (alineacion === "center") {
          doc.text(texto, 105, y, { align: "center" });
        } else {
          const split = doc.splitTextToSize(texto, aw);
          doc.text(split, mx, y);
          y += (split.length - 1) * (size * 0.4);
        }
        y += size * 0.45;
      };

      const espacio = (n = 6) => { y += n; };

      // ── Pie de página con firma ────────────────────────────
      const dibujarPie = (numeroCarta) => {
        // Firma del pastor centrada
        const yFirma = 238;
        if (firmaB64) {
          try { doc.addImage(firmaB64, "JPEG", 80, yFirma, 50, 30); } catch {}
        }
        // Línea de firma
        const yLinea = yFirma + 32;
        doc.setDrawColor(30, 30, 30);
        doc.setLineWidth(0.3);
        doc.line(75, yLinea, 135, yLinea);
        // Nombre y cargo del pastor
        doc.setFontSize(9); doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 30, 30);
        doc.text(datos.pastor_firma || "Pastor/a", 105, yLinea + 5, { align: "center" });
        doc.setFontSize(8); doc.setFont("helvetica", "normal");
        doc.text(datos.cargo_pastor || "Pastor", 105, yLinea + 9, { align: "center" });
        doc.text(datos.iglesia || "Unión Pentecostal", 105, yLinea + 13, { align: "center" });
        // Línea separadora pie de página
        const yPie = 278;
        doc.setDrawColor(30, 45, 90);
        doc.setLineWidth(0.3);
        doc.line(mx, yPie, mx + aw, yPie);
        doc.setFontSize(8); doc.setFont("helvetica", "normal");
        doc.setTextColor(120, 120, 120);
        doc.text(datos.iglesia || "Unión Pentecostal", mx, yPie + 4);
        if (numeroCarta) doc.text(`N°: ${numeroCarta}`, mx + aw, yPie + 4, { align: "right" });
        doc.text(`Generado: ${new Date().toLocaleDateString("es-ES")}`, 105, yPie + 4, { align: "center" });
      };

      if (tipo === "acuse") {
        // ── ACUSE DE RECIBO ──
        dibujarEncabezado(datos.iglesia, "ACUSE DE RECIBO DE CARTA DE PRESENTACIÓN");
        linea(`${datos.ciudad || ""}, ${datos.fecha_acuse || new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}`, "left", false, 10);
        espacio(8);
        linea(`Estimado/a Pastor/a ${datos.pastor_origen || ""},`, "left", false, 10);
        linea(`${datos.iglesia_origen || ""}`, "left", false, 10);
        espacio();
        linea(`Por medio de la presente, la iglesia ${datos.iglesia || "Unión Pentecostal"} hace constar que hemos recibido la carta de presentación del/la hermano/a:`, "left", false, 10);
        espacio();
        linea(`NOMBRE: ${datos.nombres} ${datos.apellidos}`, "left", true, 11);
        if (datos.numero_socio) linea(`N° de Socio: ${datos.numero_socio}`, "left", false, 10);
        espacio();
        linea(`Carta N°: ${datos.numero_carta_recibida || "___"}     Fecha: ${datos.fecha_carta_recibida ? new Date(datos.fecha_carta_recibida + "T12:00:00").toLocaleDateString("es-ES") : "___"}`, "left", false, 10);
        espacio();
        if (datos.observaciones) {
          linea("OBSERVACIONES:", "left", true, 10);
          linea(datos.observaciones, "left", false, 10);
          espacio();
        }
        linea("El/la hermano/a ha sido recibido/a en nuestra congregación con gozo y le extendemos esta constancia como prueba de su presentación.", "left", false, 10);
        espacio(16);
        linea("_______________________________", "center", false, 10);
        linea(datos.pastor_firma || "Pastor/a", "center", false, 10);
        linea(datos.iglesia || "Unión Pentecostal", "center", false, 10);
        dibujarPie(datos.numero_acuse);

      } else if (tipo === "recomendacion") {
        // ── CARTA DE RECOMENDACIÓN ──
        const tipoTitulo = datos.tipo === "traslado" ? "CARTA DE TRASLADO" : datos.tipo === "visita_temporal" ? "CARTA DE VISITA TEMPORAL" : "CARTA DE RECOMENDACIÓN";
        dibujarEncabezado(datos.iglesia, tipoTitulo);
        linea(`${datos.ciudad || ""}, ${datos.fecha_emision || new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}`, "left", false, 10);
        espacio(8);
        linea(`Estimado/a Pastor/a ${datos.pastor_destino || ""},`, "left", false, 10);
        linea(`${datos.iglesia_destino || ""}`, "left", false, 10);
        if (datos.ciudad_destino) linea(datos.ciudad_destino, "left", false, 10);
        espacio();
        linea("Por medio de la presente, y con el gozo que produce la comunión de los santos, nos es grato presentarle al/la hermano/a:", "left", false, 10);
        espacio();
        linea(`NOMBRE: ${datos.nombres} ${datos.apellidos}`, "left", true, 11);
        if (datos.numero_socio) linea(`N° de Socio: ${datos.numero_socio}`, "left", false, 10);
        espacio();
        linea("Quien es miembro activo de nuestra congregación y se caracteriza por su fidelidad a Dios, a su iglesia y a los principios bíblicos que nos unen como domésticos de la fe.", "left", false, 10);
        espacio();
        if (datos.motivo) {
          linea("MOTIVO:", "left", true, 10);
          linea(datos.motivo, "left", false, 10);
          espacio();
        }
        if (datos.observaciones) {
          linea("OBSERVACIONES:", "left", true, 10);
          linea(datos.observaciones, "left", false, 10);
          espacio();
        }
        linea("Le recomendamos cordialmente a este/a hermano/a y le pedimos lo/la reciba con el amor de Cristo.", "left", false, 10);
        espacio(16);
        linea("_______________________________", "center", false, 10);
        linea(datos.pastor_firma || "Pastor/a", "center", false, 10);
        linea(datos.cargo_pastor || "Pastor", "center", false, 10);
        linea(datos.iglesia || "Unión Pentecostal", "center", false, 10);
        dibujarPie(datos.numero_carta);
      }

      const apellido = datos.apellidos || "carta";
      doc.save(`${tipo === "acuse" ? "Acuse" : "Carta_Recomendacion"}_${apellido}_${new Date().toISOString().split("T")[0]}.pdf`);
      toast("PDF generado ✓", "ok");
    } catch (e) { toast("Error al generar PDF: " + e.message, "error"); }
  };

  return (
    <div>
      <SectionHeader title="Visitas y cartas" icon="mail" role="warning" />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { id: "entrantes", icon: "mail-opened", label: "Visitas entrantes", badge: entrantes.length },
          { id: "salientes", icon: "send", label: "Cartas emitidas", badge: salientes.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "8px 16px", borderRadius: 8, border: `0.5px solid ${tab === t.id ? "var(--border-warning)" : "var(--border)"}`, background: tab === t.id ? "var(--bg-warning)" : "transparent", color: tab === t.id ? "var(--text-warning)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <i className={`ti ti-${t.icon}`} style={{ fontSize: 15 }} />
            {t.label}
            <span style={{ background: tab === t.id ? "var(--text-warning)" : "var(--text-muted)", color: "white", borderRadius: 20, fontSize: 11, padding: "1px 7px", fontWeight: 500 }}>{t.badge}</span>
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          {tab === "entrantes" && <Btn icon="plus" variant="primary" small onClick={() => setModal({ tipo: "nueva_entrante" })}>Registrar visita</Btn>}
          {tab === "salientes" && <Btn icon="send" variant="primary" small onClick={() => setModal({ tipo: "nueva_saliente" })}>Emitir carta</Btn>}
        </div>
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* VISITAS ENTRANTES */}
          {tab === "entrantes" && (
            <div>
              {entrantes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
                  <i className="ti ti-mail-opened" style={{ fontSize: 40, display: "block", marginBottom: 10 }} />
                  No hay visitas registradas
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {entrantes.map(v => (
                    <div key={v.id} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{v.apellidos}, {v.nombres}</div>
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
                            <i className="ti ti-building-church" style={{ marginRight: 4 }} />{v.iglesia_origen} {v.ciudad_origen ? `— ${v.ciudad_origen}` : ""}
                          </div>
                          {v.pastor_origen && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Pastor: {v.pastor_origen}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Presentación: {fmtDate(v.fecha_presentacion)}</span>
                            {v.numero_carta_recibida && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Carta N°: {v.numero_carta_recibida}</span>}
                            {v.acuse_emitido ? <Badge label="Acuse emitido" role="success" /> : <Badge label="Sin acuse" role="warning" />}
                          </div>
                          {v.observaciones && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6, fontStyle: "italic" }}>{v.observaciones}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Btn small icon="edit" onClick={() => setModal({ tipo: "editar_entrante", data: v })} />
                          <Btn small icon="file-type-pdf" variant="warning" onClick={() => setModal({ tipo: "acuse_pdf", data: v })}>
                            {isMobile ? "" : "Acuse PDF"}
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CARTAS SALIENTES */}
          {tab === "salientes" && (
            <div>
              {salientes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
                  <i className="ti ti-send" style={{ fontSize: 40, display: "block", marginBottom: 10 }} />
                  No hay cartas emitidas
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {salientes.map(v => (
                    <div key={v.id} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                            {v.miembros ? `${v.miembros.apellidos}, ${v.miembros.nombres}` : `${v.apellidos || ""}, ${v.nombres || ""}`}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
                            <i className="ti ti-send" style={{ marginRight: 4 }} />→ {v.iglesia_destino} {v.ciudad_destino ? `— ${v.ciudad_destino}` : ""}
                          </div>
                          {v.pastor_destino && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Pastor destino: {v.pastor_destino}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <Badge label={TIPO_LABEL[v.tipo] || v.tipo} role="accent" />
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Emitida: {fmtDate(v.fecha_emision)}</span>
                            {v.numero_carta && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>N°: {v.numero_carta}</span>}
                          </div>
                          {v.motivo && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>{v.motivo}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn small icon="file-type-pdf" variant="accent" onClick={() => setModal({ tipo: "recomendacion_pdf", data: v })}>
                            {isMobile ? "" : "Ver PDF"}
                          </Btn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modales */}
      {modal && (
        <ModalVisita
          modal={modal}
          miembros={miembros}
          usuario={usuario}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar(); }}
          onGenerarPDF={generarPDF}
        />
      )}
    </div>
  );
}

// ── Modal de visitas ─────────────────────────────────────────
function ModalVisita({ modal, miembros, usuario, onClose, onSaved, onGenerarPDF }) {
  const { toast } = useApp();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const TIPO_LABEL = { recomendacion: "Recomendación", traslado: "Traslado", visita_temporal: "Visita temporal" };
  const [form, setForm] = useState({
    iglesia: "Unión Pentecostal",
    ciudad: "",
    pastor_firma: "",
    cargo_pastor: "Pastor",
    ...modal.data,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const titles = {
    nueva_entrante: "Registrar visita entrante",
    editar_entrante: "Editar visita entrante",
    nueva_saliente: "Emitir carta de recomendación",
    acuse_pdf: "Generar acuse de recibo",
    recomendacion_pdf: "Generar carta de recomendación",
  };

  const handleSaveEntrante = async () => {
    if (!form.nombres?.trim() || !form.apellidos?.trim() || !form.iglesia_origen?.trim()) {
      toast("Nombre, apellido e iglesia de origen son requeridos", "warn"); return;
    }
    setSaving(true);
    try {
      const payload = {
        nombres: form.nombres, apellidos: form.apellidos,
        iglesia_origen: form.iglesia_origen, pastor_origen: form.pastor_origen || null,
        ciudad_origen: form.ciudad_origen || null,
        fecha_presentacion: form.fecha_presentacion || today(),
        numero_carta_recibida: form.numero_carta_recibida || null,
        fecha_carta_recibida: form.fecha_carta_recibida || null,
        acuse_emitido: form.acuse_emitido || false,
        fecha_acuse: form.fecha_acuse || null,
        numero_acuse: form.numero_acuse || null,
        observaciones: form.observaciones || null,
        registrado_por: usuario?.id,
      };
      if (modal.data?.id) {
        await sb.update("visitas_entrantes", modal.data.id, { ...payload, updated_at: new Date().toISOString() });
      } else {
        await sb.insert("visitas_entrantes", payload);
      }
      toast("Visita registrada ✓", "ok");
      onSaved();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const handleSaveSaliente = async () => {
    if (!form.iglesia_destino?.trim()) { toast("La iglesia de destino es requerida", "warn"); return; }
    if (!form.nombres?.trim() && !form.miembro_id) { toast("Indicá el nombre o seleccioná un miembro", "warn"); return; }
    setSaving(true);
    try {
      const miembroSel = form.miembro_id ? miembros.find(m => m.id === form.miembro_id) : null;
      await sb.insert("visitas_salientes", {
        miembro_id: form.miembro_id || null,
        nombres: miembroSel ? miembroSel.nombres : form.nombres,
        apellidos: miembroSel ? miembroSel.apellidos : form.apellidos,
        iglesia_destino: form.iglesia_destino,
        pastor_destino: form.pastor_destino || null,
        ciudad_destino: form.ciudad_destino || null,
        numero_carta: form.numero_carta || null,
        fecha_emision: form.fecha_emision || today(),
        motivo: form.motivo || null,
        tipo: form.tipo || "recomendacion",
        observaciones: form.observaciones || null,
        emitido_por: usuario?.id,
      });
      toast("Carta registrada ✓", "ok");
      onSaved();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const handleGenerarAcuse = () => {
    const datos = {
      ...form,
      nombres: modal.data?.nombres,
      apellidos: modal.data?.apellidos,
      iglesia_origen: modal.data?.iglesia_origen,
      pastor_origen: modal.data?.pastor_origen,
      numero_carta_recibida: modal.data?.numero_carta_recibida,
      fecha_carta_recibida: modal.data?.fecha_carta_recibida,
    };
    onGenerarPDF("acuse", datos);
    // Marcar acuse como emitido
    if (modal.data?.id && !modal.data?.acuse_emitido) {
      sb.update("visitas_entrantes", modal.data.id, { acuse_emitido: true, fecha_acuse: today(), updated_at: new Date().toISOString() });
    }
  };

  const handleGenerarRecomendacion = () => {
    const m = modal.data;
    const datos = {
      ...form,
      nombres: m.miembros?.nombres || m.nombres,
      apellidos: m.miembros?.apellidos || m.apellidos,
      iglesia_destino: m.iglesia_destino,
      pastor_destino: m.pastor_destino,
      ciudad_destino: m.ciudad_destino,
      numero_carta: m.numero_carta,
      fecha_emision: m.fecha_emision ? new Date(m.fecha_emision + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : null,
      motivo: m.motivo,
      observaciones: m.observaciones,
      tipo: m.tipo,
      numero_socio: form.numero_socio || m.numero_membresia || "",
    };
    onGenerarPDF("recomendacion", datos);
  };

  return (
    <Modal title={titles[modal.tipo]} onClose={onClose} wide={modal.tipo === "acuse_pdf" || modal.tipo === "recomendacion_pdf"}>

      {/* NUEVA / EDITAR ENTRANTE */}
      {(modal.tipo === "nueva_entrante" || modal.tipo === "editar_entrante") && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 12 }}>Datos del visitante</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Nombres *" value={form.nombres || ""} onChange={e => set("nombres", e.target.value)} />
            <Inp label="Apellidos *" value={form.apellidos || ""} onChange={e => set("apellidos", e.target.value)} />
            <Inp label="Iglesia de origen *" value={form.iglesia_origen || ""} onChange={e => set("iglesia_origen", e.target.value)} placeholder="Nombre de la iglesia que lo presenta" />
            <Inp label="Pastor de origen" value={form.pastor_origen || ""} onChange={e => set("pastor_origen", e.target.value)} />
            <Inp label="Ciudad de origen" value={form.ciudad_origen || ""} onChange={e => set("ciudad_origen", e.target.value)} />
            <Inp label="Fecha de presentación" type="date" value={form.fecha_presentacion || today()} onChange={e => set("fecha_presentacion", e.target.value)} />
            <Inp label="N° de carta recibida" value={form.numero_carta_recibida || ""} onChange={e => set("numero_carta_recibida", e.target.value)} />
            <Inp label="Fecha de la carta" type="date" value={form.fecha_carta_recibida || ""} onChange={e => set("fecha_carta_recibida", e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Observaciones</label>
            <textarea value={form.observaciones || ""} onChange={e => set("observaciones", e.target.value)} rows={3} placeholder="Observaciones sobre la visita..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, padding: "10px 12px", background: "var(--surface-1)", borderRadius: 8 }}>
            <input type="checkbox" id="acuse_emitido" checked={form.acuse_emitido || false} onChange={e => set("acuse_emitido", e.target.checked)} style={{ width: 16, height: 16 }} />
            <label htmlFor="acuse_emitido" style={{ fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>Acuse de recibo ya emitido</label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" icon="device-floppy" loading={saving} onClick={handleSaveEntrante}>Guardar</Btn>
          </div>
        </div>
      )}

      {/* NUEVA SALIENTE */}
      {modal.tipo === "nueva_saliente" && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 12 }}>Miembro que viaja</div>
          <Sel label="Seleccionar miembro (o completar manualmente abajo)" value={form.miembro_id || ""} onChange={e => set("miembro_id", e.target.value)}>
            <option value="">— Completar manualmente —</option>
            {miembros.map(m => <option key={m.id} value={m.id}>{m.apellidos}, {m.nombres}</option>)}
          </Sel>
          {!form.miembro_id && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <Inp label="Nombres" value={form.nombres || ""} onChange={e => set("nombres", e.target.value)} />
              <Inp label="Apellidos" value={form.apellidos || ""} onChange={e => set("apellidos", e.target.value)} />
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", margin: "16px 0 12px" }}>Iglesia de destino</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Iglesia de destino *" value={form.iglesia_destino || ""} onChange={e => set("iglesia_destino", e.target.value)} />
            <Inp label="Pastor de destino" value={form.pastor_destino || ""} onChange={e => set("pastor_destino", e.target.value)} />
            <Inp label="Ciudad de destino" value={form.ciudad_destino || ""} onChange={e => set("ciudad_destino", e.target.value)} />
            <Sel label="Tipo de carta" value={form.tipo || "recomendacion"} onChange={e => set("tipo", e.target.value)}>
              <option value="recomendacion">Carta de recomendación</option>
              <option value="traslado">Carta de traslado</option>
              <option value="visita_temporal">Visita temporal</option>
            </Sel>
            <Inp label="Fecha de emisión" type="date" value={form.fecha_emision || today()} onChange={e => set("fecha_emision", e.target.value)} />
            <Inp label="N° de carta" value={form.numero_carta || ""} onChange={e => set("numero_carta", e.target.value)} placeholder="Ej: 001/2026" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Motivo</label>
            <textarea value={form.motivo || ""} onChange={e => set("motivo", e.target.value)} rows={2} placeholder="Motivo del viaje..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Observaciones</label>
            <textarea value={form.observaciones || ""} onChange={e => set("observaciones", e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" icon="send" loading={saving} onClick={handleSaveSaliente}>Registrar carta</Btn>
          </div>
        </div>
      )}

      {/* ACUSE DE RECIBO PDF */}
      {modal.tipo === "acuse_pdf" && (
        <div>
          <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{modal.data?.apellidos}, {modal.data?.nombres}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Iglesia: {modal.data?.iglesia_origen} {modal.data?.ciudad_origen ? `— ${modal.data.ciudad_origen}` : ""}</div>
            {modal.data?.observaciones && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, fontStyle: "italic" }}>{modal.data.observaciones}</div>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 12 }}>Datos para el acuse</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Nombre de tu iglesia" value={form.iglesia || "Unión Pentecostal"} onChange={e => set("iglesia", e.target.value)} />
            <Inp label="Ciudad" value={form.ciudad || ""} onChange={e => set("ciudad", e.target.value)} />
            <Inp label="Fecha del acuse" value={form.fecha_acuse || new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })} onChange={e => set("fecha_acuse", e.target.value)} />
            <Inp label="N° de acuse" value={form.numero_acuse || ""} onChange={e => set("numero_acuse", e.target.value)} placeholder="Ej: ACU-001/2026" />
            <Inp label="N° de socio del visitante" value={form.numero_socio || ""} onChange={e => set("numero_socio", e.target.value)} placeholder="Si tiene número asignado" />
            <Inp label="Nombre del pastor firmante" value={form.pastor_firma || ""} onChange={e => set("pastor_firma", e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="danger" icon="file-type-pdf" onClick={handleGenerarAcuse}>Generar PDF</Btn>
          </div>
        </div>
      )}

      {/* CARTA RECOMENDACIÓN PDF */}
      {modal.tipo === "recomendacion_pdf" && (
        <div>
          <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              {modal.data?.miembros ? `${modal.data.miembros.apellidos}, ${modal.data.miembros.nombres}` : `${modal.data?.apellidos}, ${modal.data?.nombres}`}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>→ {modal.data?.iglesia_destino} {modal.data?.ciudad_destino ? `— ${modal.data.ciudad_destino}` : ""}</div>
            <Badge label={TIPO_LABEL[modal.data?.tipo] || modal.data?.tipo} role="accent" />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 12 }}>Datos para la carta</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Nombre de tu iglesia" value={form.iglesia || "Unión Pentecostal"} onChange={e => set("iglesia", e.target.value)} />
            <Inp label="Ciudad" value={form.ciudad || ""} onChange={e => set("ciudad", e.target.value)} />
            <Inp label="N° de socio del miembro" value={form.numero_socio || modal.data?.numero_membresia || ""} onChange={e => set("numero_socio", e.target.value)} placeholder="N° de membresía" />
            <div />
            <Inp label="Nombre del pastor firmante" value={form.pastor_firma || ""} onChange={e => set("pastor_firma", e.target.value)} />
            <Inp label="Cargo del firmante" value={form.cargo_pastor || "Pastor"} onChange={e => set("cargo_pastor", e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="danger" icon="file-type-pdf" onClick={handleGenerarRecomendacion}>Generar PDF</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO LEGAJOS
// ─────────────────────────────────────────────────────────────
function ModuloLegajos() {
  const { usuario, toast } = useApp();
  const isMobile = useIsMobile();
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState([]);
  const [miembroSel, setMiembroSel] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [tab, setTab] = useState("cargos");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ legajo: null, cargos: [], templos: [], documentos: [], disciplinas: [] });
  const [modal, setModal] = useState(null);
  const dropRef = useRef();

  const TABS = [
    { id: "cargos", icon: "briefcase", label: "Cargos/Ministerios" },
    { id: "documentos", icon: "file-certificate", label: "Documentos" },
    { id: "templos", icon: "building-church", label: "Cambios de templo" },
    { id: "disciplinas", icon: "shield-exclamation", label: "Disciplinas" },
    { id: "notas", icon: "notes", label: "Notas pastorales" },
    { id: "plantillas", icon: "file-text", label: "Generar documentos" },
  ];

  const TIPO_DOC = { bautismo: "Bautismo", membresia: "Membresía", matrimonio: "Matrimonio", ordenacion: "Ordenación", transferencia: "Transferencia", disciplina: "Disciplina", otro: "Otro" };
  const TIPO_DISC = { amonestacion: "Amonestación", suspension: "Suspensión", restauracion: "Restauración", otro: "Otro" };

  // Búsqueda de miembro
  useEffect(() => {
    if (busqueda.length < 2) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const q = busqueda.toLowerCase();
        const ms = await sb.query("miembros", `?or=(nombres.ilike.*${encodeURIComponent(q)}*,apellidos.ilike.*${encodeURIComponent(q)}*)&select=id,nombres,apellidos,foto_url,estado,templos(nombre)&order=apellidos.asc&limit=8`);
        setSugerencias(ms);
      } catch {}
      finally { setBuscando(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  const seleccionar = async (m) => {
    setMiembroSel(m);
    setBusqueda(`${m.apellidos}, ${m.nombres}`);
    setSugerencias([]);
    await cargarLegajo(m.id);
  };

  const cargarLegajo = async (miembroId) => {
    setLoading(true);
    try {
      const [legajos, cargos, templos, documentos, disciplinas] = await Promise.all([
        sb.query("legajos", `?miembro_id=eq.${miembroId}&select=*`),
        sb.query("legajo_cargos", `?miembro_id=eq.${miembroId}&select=*,usuarios_sistema(nombre)&order=fecha_inicio.desc`),
        sb.query("legajo_templos", `?miembro_id=eq.${miembroId}&select=*,usuarios_sistema(nombre)&order=fecha.desc`),
        sb.query("legajo_documentos", `?miembro_id=eq.${miembroId}&select=*,usuarios_sistema(nombre)&order=fecha.desc`),
        sb.query("legajo_disciplinas", `?miembro_id=eq.${miembroId}&select=*,usuarios_sistema(nombre)&order=fecha.desc`),
      ]);
      setData({ legajo: legajos[0] || null, cargos, templos, documentos, disciplinas });
    } catch (e) { toast(e.message, "error"); }
    finally { setLoading(false); }
  };

  const guardarNotas = async (notas, observaciones) => {
    try {
      if (data.legajo) {
        await sb.update("legajos", data.legajo.id, { notas_pastorales: notas, observaciones_confidenciales: observaciones, updated_at: new Date().toISOString() });
      } else {
        await sb.insert("legajos", { miembro_id: miembroSel.id, notas_pastorales: notas, observaciones_confidenciales: observaciones });
      }
      toast("Notas guardadas ✓", "ok");
      cargarLegajo(miembroSel.id);
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <div>
      <SectionHeader title="Legajos" icon="folder-open" role="pro" />

      {/* Buscador */}
      <div style={{ position: "relative", maxWidth: 480, marginBottom: 24 }} ref={dropRef}>
        <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>Buscar miembro</label>
        <div style={{ position: "relative" }}>
          <input value={busqueda} onChange={e => { setBusqueda(e.target.value); setMiembroSel(null); }} placeholder="Escribí nombre o apellido..." style={{ width: "100%", boxSizing: "border-box", paddingRight: 36 }} />
          <i className={`ti ti-${buscando ? "loader-2" : "search"}`} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 16, pointerEvents: "none" }} />
        </div>
        {sugerencias.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100, overflow: "hidden", marginTop: 4 }}>
            {sugerencias.map(m => (
              <button key={m.id} onClick={() => seleccionar(m)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)", textAlign: "left", borderBottom: "0.5px solid var(--border)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--surface-1)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <Avatar foto={m.foto_url} nombre={`${m.nombres} ${m.apellidos}`} size={32} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{m.apellidos}, {m.nombres}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{m.templos?.nombre} · <Badge label={m.estado} /></div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {!miembroSel && (
        <div style={{ textAlign: "center", padding: "56px 0", color: "var(--text-muted)" }}>
          <i className="ti ti-folder-open" style={{ fontSize: 44, display: "block", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Buscá un miembro para ver su legajo</div>
          <div style={{ fontSize: 13 }}>El legajo contiene el historial completo: cargos, documentos, disciplinas y notas pastorales</div>
        </div>
      )}

      {miembroSel && (
        <>
          {/* Card miembro */}
          <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Avatar foto={miembroSel.foto_url} nombre={`${miembroSel.nombres} ${miembroSel.apellidos}`} size={52} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 4 }}>{miembroSel.apellidos}, {miembroSel.nombres}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Badge label={miembroSel.estado} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{miembroSel.templos?.nombre}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{data.cargos.length} cargo(s) · {data.documentos.length} doc(s) · {data.disciplinas.length} disciplina(s)</span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 14px", borderRadius: 8, border: `0.5px solid ${tab === t.id ? "var(--border-pro)" : "var(--border)"}`, background: tab === t.id ? "var(--bg-pro)" : "transparent", color: tab === t.id ? "var(--text-pro)" : "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-sans)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <i className={`ti ti-${t.icon}`} style={{ fontSize: 14 }} />
                {t.label}
              </button>
            ))}
          </div>

          {loading ? <Spinner /> : (
            <>
              {/* CARGOS */}
              {tab === "cargos" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <Btn icon="plus" variant="primary" small onClick={() => setModal({ tipo: "cargo" })}>Agregar cargo</Btn>
                  </div>
                  {data.cargos.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Sin historial de cargos registrado</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {data.cargos.map(c => (
                        <div key={c.id} style={{ background: "var(--surface-2)", border: `0.5px solid ${c.activo ? "var(--border-success)" : "var(--border)"}`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <i className="ti ti-briefcase" style={{ fontSize: 18, color: c.activo ? "var(--text-success)" : "var(--text-muted)", marginTop: 2 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{c.cargo} {c.ministerio && <span style={{ fontSize: 13, color: "var(--text-muted)" }}>— {c.ministerio}</span>}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                              {c.fecha_inicio ? fmtDate(c.fecha_inicio) : "Sin fecha"} {c.fecha_fin ? `→ ${fmtDate(c.fecha_fin)}` : c.activo ? "→ Actual" : ""}
                              {c.observacion && ` · ${c.observacion}`}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Registrado por {c.usuarios_sistema?.nombre || "Sistema"}</div>
                          </div>
                          {c.activo && <Badge label="Activo" role="success" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DOCUMENTOS */}
              {tab === "documentos" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <Btn icon="plus" variant="primary" small onClick={() => setModal({ tipo: "documento" })}>Agregar documento</Btn>
                  </div>
                  {data.documentos.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Sin documentos registrados</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                      {data.documentos.map(d => (
                        <div key={d.id} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                            <i className="ti ti-file-certificate" style={{ fontSize: 20, color: "var(--text-accent)" }} />
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 500 }}>{d.titulo}</div>
                              <Badge label={TIPO_DOC[d.tipo] || d.tipo} role="accent" />
                            </div>
                          </div>
                          {d.descripcion && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>{d.descripcion}</div>}
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.fecha ? fmtDate(d.fecha) : "Sin fecha"} · {d.usuarios_sistema?.nombre}</div>
                          {d.archivo_url && <a href={d.archivo_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--text-accent)", display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}><i className="ti ti-download" />Ver archivo</a>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CAMBIOS DE TEMPLO */}
              {tab === "templos" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <Btn icon="plus" variant="primary" small onClick={() => setModal({ tipo: "templo" })}>Registrar cambio</Btn>
                  </div>
                  {data.templos.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Sin cambios de templo registrados</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {data.templos.map(t => (
                        <div key={t.id} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <i className="ti ti-building-church" style={{ fontSize: 18, color: "var(--text-accent)", marginTop: 2 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{t.templo_anterior || "—"} <i className="ti ti-arrow-right" style={{ fontSize: 13 }} /> {t.templo_nuevo || "—"}</div>
                            {t.motivo && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{t.motivo}</div>}
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{fmtDate(t.fecha)} · {t.usuarios_sistema?.nombre}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* DISCIPLINAS */}
              {tab === "disciplinas" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                    <Btn icon="plus" variant="primary" small onClick={() => setModal({ tipo: "disciplina" })}>Registrar disciplina</Btn>
                  </div>
                  {data.disciplinas.length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 13 }}>Sin disciplinas registradas</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {data.disciplinas.map(d => (
                        <div key={d.id} style={{ background: d.estado === "activo" ? "var(--bg-danger)" : "var(--surface-2)", border: `0.5px solid ${d.estado === "activo" ? "var(--border-danger)" : "var(--border)"}`, borderRadius: 10, padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                            <Badge label={TIPO_DISC[d.tipo] || d.tipo} role={d.estado === "activo" ? "danger" : "success"} />
                            <Badge label={d.estado === "activo" ? "Activa" : "Resuelta"} role={d.estado === "activo" ? "danger" : "success"} />
                          </div>
                          <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 4 }}>{d.descripcion}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Inicio: {fmtDate(d.fecha)} {d.fecha_resolucion ? `· Resolución: ${fmtDate(d.fecha_resolucion)}` : ""} · {d.usuarios_sistema?.nombre}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* NOTAS PASTORALES */}
              {tab === "notas" && (
                <FormNotas
                  legajo={data.legajo}
                  onGuardar={guardarNotas}
                />
              )}

              {tab === "plantillas" && (
                <GeneradorDocumentos miembro={miembroSel} />
              )}
            </>
          )}
        </>
      )}

      {/* Modales de ingreso */}
      {modal && (
        <ModalLegajo
          tipo={modal.tipo}
          miembroId={miembroSel?.id}
          usuario={usuario}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargarLegajo(miembroSel.id); toast("Guardado ✓", "ok"); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GENERADOR DE DOCUMENTOS (Sanción / Licencia)
// Genera PDF y DOCX directamente en el navegador
// ─────────────────────────────────────────────────────────────
function GeneradorDocumentos({ miembro }) {
  const [tipo, setTipo] = useState("sancion");
  const [generando, setGenerando] = useState(false);
  const [form, setForm] = useState({
    iglesia: "Unión Pentecostal",
    ciudad: "",
    fecha: new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }),
    pastor: "",
    cargo_pastor: "Pastor",
    // Sanción
    tipo_sancion: "amonestacion",
    motivo_sancion: "",
    descripcion_sancion: "",
    duracion: "",
    restricciones: "",
    condiciones_restauracion: "",
    // Licencia
    tipo_licencia: "vacaciones",
    motivo_licencia: "",
    fecha_inicio: "",
    fecha_fin: "",
    quien_reemplaza: "",
    observaciones: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const TIPOS_SANCION = [
    { val: "amonestacion", label: "Amonestación" },
    { val: "suspension", label: "Suspensión temporal" },
    { val: "separacion", label: "Separación del ministerio" },
    { val: "restauracion", label: "Acta de restauración" },
  ];

  const TIPOS_LICENCIA = [
    { val: "vacaciones", label: "Licencia vacacional" },
    { val: "enfermedad", label: "Licencia por enfermedad" },
    { val: "maternidad", label: "Licencia por maternidad/paternidad" },
    { val: "estudio", label: "Licencia por estudios" },
    { val: "ministerial", label: "Licencia ministerial" },
    { val: "otro", label: "Otra licencia" },
  ];

  const nombre = miembro ? `${miembro.nombres} ${miembro.apellidos}` : "—";

  // ── Generar texto del documento ──────────────────────────
  const buildTextoSancion = () => {
    const tipoLabel = TIPOS_SANCION.find(t => t.val === form.tipo_sancion)?.label || form.tipo_sancion;
    return [
      { texto: form.iglesia.toUpperCase(), estilo: "titulo" },
      { texto: `ACTA DE ${tipoLabel.toUpperCase()}`, estilo: "subtitulo" },
      { texto: "", estilo: "espacio" },
      { texto: `En la ciudad de ${form.ciudad || "___________"}, a ${form.fecha},`, estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: `La directiva pastoral de ${form.iglesia}, reunida en sesión formal, ha resuelto lo siguiente en relación al hermano/a:`, estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: `NOMBRE: ${nombre}`, estilo: "dato" },
      { texto: "", estilo: "espacio" },
      { texto: "MOTIVO:", estilo: "subtitulo_pequeño" },
      { texto: form.motivo_sancion || "___________________________________________", estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: "DESCRIPCIÓN:", estilo: "subtitulo_pequeño" },
      { texto: form.descripcion_sancion || "___________________________________________", estilo: "normal" },
      ...(form.tipo_sancion !== "restauracion" ? [
        { texto: "", estilo: "espacio" },
        { texto: "MEDIDA DISCIPLINARIA:", estilo: "subtitulo_pequeño" },
        { texto: `Se aplica ${tipoLabel}${form.duracion ? ` por un período de ${form.duracion}` : ""}.`, estilo: "normal" },
        ...(form.restricciones ? [
          { texto: "", estilo: "espacio" },
          { texto: "RESTRICCIONES:", estilo: "subtitulo_pequeño" },
          { texto: form.restricciones, estilo: "normal" },
        ] : []),
        ...(form.condiciones_restauracion ? [
          { texto: "", estilo: "espacio" },
          { texto: "CONDICIONES PARA LA RESTAURACIÓN:", estilo: "subtitulo_pequeño" },
          { texto: form.condiciones_restauracion, estilo: "normal" },
        ] : []),
      ] : []),
      { texto: "", estilo: "espacio" },
      { texto: "Esta resolución ha sido adoptada con el propósito de guiar al hermano/a hacia la restauración y el crecimiento espiritual, en el amor y la gracia de Dios.", estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: "", estilo: "espacio" },
      { texto: "_______________________________", estilo: "firma" },
      { texto: form.pastor || "Pastor/a", estilo: "firma" },
      { texto: form.cargo_pastor, estilo: "firma_cargo" },
      { texto: form.iglesia, estilo: "firma_cargo" },
    ];
  };

  const buildTextoLicencia = () => {
    const tipoLabel = TIPOS_LICENCIA.find(t => t.val === form.tipo_licencia)?.label || form.tipo_licencia;
    return [
      { texto: form.iglesia.toUpperCase(), estilo: "titulo" },
      { texto: `CONSTANCIA DE ${tipoLabel.toUpperCase()}`, estilo: "subtitulo" },
      { texto: "", estilo: "espacio" },
      { texto: `En la ciudad de ${form.ciudad || "___________"}, a ${form.fecha},`, estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: `Por medio de la presente, la dirección pastoral de ${form.iglesia} hace constar que:`, estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: `NOMBRE: ${nombre}`, estilo: "dato" },
      { texto: "", estilo: "espacio" },
      { texto: "Se le otorga la presente licencia por el siguiente motivo:", estilo: "normal" },
      { texto: form.motivo_licencia || "___________________________________________", estilo: "normal" },
      ...(form.fecha_inicio || form.fecha_fin ? [
        { texto: "", estilo: "espacio" },
        { texto: `PERÍODO: desde ${form.fecha_inicio ? new Date(form.fecha_inicio + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "___"} hasta ${form.fecha_fin ? new Date(form.fecha_fin + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "___"}`, estilo: "dato" },
      ] : []),
      ...(form.quien_reemplaza ? [
        { texto: "", estilo: "espacio" },
        { texto: `Durante su ausencia, será reemplazado/a por: ${form.quien_reemplaza}`, estilo: "normal" },
      ] : []),
      ...(form.observaciones ? [
        { texto: "", estilo: "espacio" },
        { texto: "OBSERVACIONES:", estilo: "subtitulo_pequeño" },
        { texto: form.observaciones, estilo: "normal" },
      ] : []),
      { texto: "", estilo: "espacio" },
      { texto: "Se extiende la presente constancia para los fines que el interesado estime conveniente.", estilo: "normal" },
      { texto: "", estilo: "espacio" },
      { texto: "", estilo: "espacio" },
      { texto: "_______________________________", estilo: "firma" },
      { texto: form.pastor || "Pastor/a", estilo: "firma" },
      { texto: form.cargo_pastor, estilo: "firma_cargo" },
      { texto: form.iglesia, estilo: "firma_cargo" },
    ];
  };

  // ── Generar PDF usando jsPDF (CDN) ───────────────────────
  const generarPDF = async () => {
    setGenerando(true);
    try {
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const margenX = 25;
      const anchoTexto = 160;
      let y = 15;

      // ── Cargar escudo y firma ─────────────────────────────
      const cargarImg = (src) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg"));
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
      const [escudoB64, firmaB64] = await Promise.all([cargarImg("/escudo.jpg"), cargarImg("/firma-pastor.jpg")]);

      // ── Encabezado con escudo ─────────────────────────────
      if (escudoB64) {
        try { doc.addImage(escudoB64, "JPEG", margenX, y, 28, 28); } catch {}
      }
      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 45, 90);
      doc.text(form.iglesia || "Unión Pentecostal", 105, y + 8, { align: "center" });
      y += 32;
      doc.setDrawColor(30, 45, 90); doc.setLineWidth(0.5);
      doc.line(margenX, y, margenX + anchoTexto, y);
      y += 6;

      const lineas = tipo === "sancion" ? buildTextoSancion() : buildTextoLicencia();

      // Filtrar lineas de firma — las ponemos con imagen al final
      const lineasSinFirma = lineas.filter(l => l.estilo !== "firma" && l.estilo !== "firma_cargo");
      const lineasFirma = lineas.filter(l => l.estilo === "firma" || l.estilo === "firma_cargo");

      for (const linea of lineasSinFirma) {
        if (linea.estilo === "espacio") { y += 6; continue; }
        if (y > 225) { doc.addPage(); y = 30; }
        doc.setTextColor(30, 30, 30);
        if (linea.estilo === "titulo") {
          doc.setFontSize(13); doc.setFont("helvetica", "bold");
          doc.text(linea.texto, 105, y, { align: "center" }); y += 8;
        } else if (linea.estilo === "subtitulo") {
          doc.setFontSize(11); doc.setFont("helvetica", "bold");
          doc.text(linea.texto, 105, y, { align: "center" }); y += 7;
        } else if (linea.estilo === "subtitulo_pequeño") {
          doc.setFontSize(10); doc.setFont("helvetica", "bold");
          doc.text(linea.texto, margenX, y); y += 6;
        } else if (linea.estilo === "dato") {
          doc.setFontSize(11); doc.setFont("helvetica", "bold");
          const split = doc.splitTextToSize(linea.texto, anchoTexto);
          doc.text(split, margenX, y); y += split.length * 6;
        } else {
          doc.setFontSize(10); doc.setFont("helvetica", "normal");
          const split = doc.splitTextToSize(linea.texto, anchoTexto);
          doc.text(split, margenX, y); y += split.length * 5.5;
        }
      }

      // ── Firma con imagen ──────────────────────────────────
      const yFirma = Math.max(y + 10, 235);
      if (firmaB64) {
        try { doc.addImage(firmaB64, "JPEG", 80, yFirma - 28, 50, 30); } catch {}
      }
      doc.setDrawColor(30, 30, 30); doc.setLineWidth(0.3);
      doc.line(75, yFirma, 135, yFirma);
      doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30);
      if (lineasFirma[0]) { doc.text(lineasFirma[0].texto, 105, yFirma + 5, { align: "center" }); }
      doc.setFontSize(8); doc.setFont("helvetica", "italic");
      if (lineasFirma[1]) { doc.text(lineasFirma[1].texto, 105, yFirma + 9, { align: "center" }); }
      if (lineasFirma[2]) { doc.text(lineasFirma[2].texto, 105, yFirma + 13, { align: "center" }); }

      // ── Pie de página ─────────────────────────────────────
      const yPie = 278;
      doc.setDrawColor(30, 45, 90); doc.setLineWidth(0.3);
      doc.line(margenX, yPie, margenX + anchoTexto, yPie);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 120, 120);
      doc.text(form.iglesia || "Unión Pentecostal", margenX, yPie + 4);
      doc.text(`Generado: ${new Date().toLocaleDateString("es-ES")}`, 105, yPie + 4, { align: "center" });

      const tipoLabel = tipo === "sancion" ? "Sancion" : "Licencia";
      const apellido = miembro?.apellidos || "miembro";
      doc.save(`${tipoLabel}_${apellido}_${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (e) {
      alert("Error al generar PDF: " + e.message);
    }
    setGenerando(false);
  };

  // ── Generar DOCX ─────────────────────────────────────────
  const generarDOCX = () => {
    const lineas = tipo === "sancion" ? buildTextoSancion() : buildTextoLicencia();
    // Construir RTF simplificado que Word puede abrir como .doc
    let rtf = "{\\rtf1\\ansi\\deff0\\deflang3082\n";
    rtf += "{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss Arial;}}\n";
    rtf += "\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\n";

    for (const l of lineas) {
      if (l.estilo === "espacio") { rtf += "\\par\n"; continue; }
      let texto = l.texto.replace(/[\\{}]/g, "\\$&");
      // Convertir caracteres especiales
      texto = texto.replace(/á/g, "\\'e1").replace(/é/g, "\\'e9").replace(/í/g, "\\'ed")
        .replace(/ó/g, "\\'f3").replace(/ú/g, "\\'fa").replace(/ñ/g, "\\'f1")
        .replace(/Á/g, "\\'c1").replace(/É/g, "\\'c9").replace(/Í/g, "\\'cd")
        .replace(/Ó/g, "\\'d3").replace(/Ú/g, "\\'da").replace(/Ñ/g, "\\'d1")
        .replace(/ü/g, "\\'fc").replace(/Ü/g, "\\'dc");

      if (l.estilo === "titulo") {
        rtf += `\\pard\\qc\\f1\\fs28\\b ${texto}\\b0\\par\n`;
      } else if (l.estilo === "subtitulo") {
        rtf += `\\pard\\qc\\f1\\fs24\\b ${texto}\\b0\\par\n`;
      } else if (l.estilo === "subtitulo_pequeño") {
        rtf += `\\pard\\f1\\fs20\\b ${texto}\\b0\\par\n`;
      } else if (l.estilo === "dato") {
        rtf += `\\pard\\f1\\fs22\\b ${texto}\\b0\\par\n`;
      } else if (l.estilo === "firma") {
        rtf += `\\pard\\qc\\f1\\fs20 ${texto}\\par\n`;
      } else if (l.estilo === "firma_cargo") {
        rtf += `\\pard\\qc\\f1\\fs18\\i ${texto}\\i0\\par\n`;
      } else {
        rtf += `\\pard\\f0\\fs20 ${texto}\\par\n`;
      }
    }
    rtf += "}";

    const blob = new Blob([rtf], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const tipoLabel = tipo === "sancion" ? "Sancion" : "Licencia";
    const apellido = miembro?.apellidos || "miembro";
    a.href = url;
    a.download = `${tipoLabel}_${apellido}_${new Date().toISOString().split("T")[0]}.doc`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isMobile = useIsMobile();

  return (
    <div>
      {/* Selector de tipo */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {[{ val: "sancion", label: "📋 Sanción / Disciplina", role: "danger" }, { val: "licencia", label: "📄 Licencia pastoral", role: "accent" }].map(t => (
          <button key={t.val} onClick={() => setTipo(t.val)} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: `0.5px solid ${tipo === t.val ? `var(--border-${t.role})` : "var(--border)"}`, background: tipo === t.val ? `var(--bg-${t.role})` : "transparent", color: tipo === t.val ? `var(--text-${t.role})` : "var(--text-secondary)", fontSize: 14, fontWeight: tipo === t.val ? 500 : 400, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Datos comunes */}
      <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 12 }}>Datos del encabezado</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Inp label="Nombre de la iglesia" value={form.iglesia} onChange={e => set("iglesia", e.target.value)} />
          <Inp label="Ciudad" value={form.ciudad} onChange={e => set("ciudad", e.target.value)} />
          <Inp label="Fecha del documento" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          <Inp label="Nombre del pastor/a firmante" value={form.pastor} onChange={e => set("pastor", e.target.value)} />
          <Inp label="Cargo del firmante" value={form.cargo_pastor} onChange={e => set("cargo_pastor", e.target.value)} />
        </div>
      </div>

      {/* Datos específicos sanción */}
      {tipo === "sancion" && (
        <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-danger)", marginBottom: 12 }}>Datos de la sanción</div>
          <Sel label="Tipo de sanción" value={form.tipo_sancion} onChange={e => set("tipo_sancion", e.target.value)}>
            {TIPOS_SANCION.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
          </Sel>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Motivo (breve)</label>
            <textarea value={form.motivo_sancion} onChange={e => set("motivo_sancion", e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} placeholder="Ej: Conducta contraria a los principios bíblicos..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción detallada</label>
            <textarea value={form.descripcion_sancion} onChange={e => set("descripcion_sancion", e.target.value)} rows={4} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} placeholder="Descripción completa de la situación y decisión tomada..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Duración (si aplica)" value={form.duracion} onChange={e => set("duracion", e.target.value)} placeholder="Ej: 3 meses, indefinido..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Restricciones</label>
            <textarea value={form.restricciones} onChange={e => set("restricciones", e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} placeholder="Ej: No participar en el ministerio de alabanza..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Condiciones para la restauración</label>
            <textarea value={form.condiciones_restauracion} onChange={e => set("condiciones_restauracion", e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} placeholder="Ej: Completar consejería pastoral, restitución..." />
          </div>
        </div>
      )}

      {/* Datos específicos licencia */}
      {tipo === "licencia" && (
        <div style={{ background: "var(--surface-1)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-accent)", marginBottom: 12 }}>Datos de la licencia</div>
          <Sel label="Tipo de licencia" value={form.tipo_licencia} onChange={e => set("tipo_licencia", e.target.value)}>
            {TIPOS_LICENCIA.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
          </Sel>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Motivo</label>
            <textarea value={form.motivo_licencia} onChange={e => set("motivo_licencia", e.target.value)} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} placeholder="Descripción del motivo de la licencia..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Fecha de inicio" type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} />
            <Inp label="Fecha de fin" type="date" value={form.fecha_fin} onChange={e => set("fecha_fin", e.target.value)} />
          </div>
          <Inp label="Quien reemplaza durante la ausencia" value={form.quien_reemplaza} onChange={e => set("quien_reemplaza", e.target.value)} placeholder="Nombre del responsable reemplazante" />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Observaciones adicionales</label>
            <textarea value={form.observaciones} onChange={e => set("observaciones", e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
        </div>
      )}

      {/* Botones de generación */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Btn variant="danger" icon="file-type-pdf" loading={generando} onClick={generarPDF} style={{ flex: 1, justifyContent: "center", minWidth: 160 }}>
          {generando ? "Generando PDF..." : "Descargar PDF"}
        </Btn>
        <Btn variant="accent" icon="file-type-doc" onClick={generarDOCX} style={{ flex: 1, justifyContent: "center", minWidth: 160 }}>
          Descargar Word (.doc)
        </Btn>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", background: "var(--surface-1)", borderRadius: 8, padding: "8px 12px" }}>
        <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
        El documento se genera con los datos completados arriba y se descarga directamente. El archivo Word puede editarse antes de imprimir.
      </div>
    </div>
  );
}

// Formulario de notas pastorales
function FormNotas({ legajo, onGuardar }) {
  const [notas, setNotas] = useState(legajo?.notas_pastorales || "");
  const [obs, setObs] = useState(legajo?.observaciones_confidenciales || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotas(legajo?.notas_pastorales || "");
    setObs(legajo?.observaciones_confidenciales || "");
  }, [legajo]);

  const handleSave = async () => {
    setSaving(true);
    await onGuardar(notas, obs);
    setSaving(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
          <i className="ti ti-notes" style={{ marginRight: 6 }} />Notas pastorales
        </label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={5} placeholder="Observaciones pastorales, visitas, seguimiento espiritual..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
          <i className="ti ti-lock" style={{ marginRight: 6 }} />Observaciones confidenciales <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(solo visible para admin)</span>
        </label>
        <textarea value={obs} onChange={e => setObs(e.target.value)} rows={4} placeholder="Situaciones confidenciales, contexto familiar, necesidades específicas..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border-danger)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="primary" icon="device-floppy" loading={saving} onClick={handleSave}>
          {saving ? "Guardando..." : "Guardar notas"}
        </Btn>
      </div>
    </div>
  );
}

// Modal para agregar registros al legajo
function ModalLegajo({ tipo, miembroId, usuario, onClose, onSaved }) {
  const { toast } = useApp();
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const titles = { cargo: "Agregar cargo/ministerio", documento: "Agregar documento", templo: "Registrar cambio de templo", disciplina: "Registrar disciplina" };

  const handleSave = async () => {
    setSaving(true);
    try {
      const base = { miembro_id: miembroId, registrado_por: usuario?.id };
      if (tipo === "cargo") {
        if (!form.cargo?.trim()) { toast("El cargo es requerido", "warn"); return; }
        await sb.insert("legajo_cargos", { ...base, ...form, activo: form.fecha_fin ? false : true });
      } else if (tipo === "documento") {
        if (!form.titulo?.trim() || !form.tipo) { toast("Título y tipo son requeridos", "warn"); return; }
        await sb.insert("legajo_documentos", { ...base, ...form });
      } else if (tipo === "templo") {
        if (!form.templo_nuevo?.trim()) { toast("El nuevo templo es requerido", "warn"); return; }
        await sb.insert("legajo_templos", { ...base, ...form, fecha: form.fecha || today() });
      } else if (tipo === "disciplina") {
        if (!form.tipo || !form.descripcion?.trim()) { toast("Tipo y descripción son requeridos", "warn"); return; }
        await sb.insert("legajo_disciplinas", { ...base, ...form, estado: form.fecha_resolucion ? "resuelto" : "activo" });
      }
      onSaved();
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={titles[tipo]} onClose={onClose}>
      {tipo === "cargo" && (
        <div>
          <Inp label="Cargo *" value={form.cargo || ""} onChange={e => set("cargo", e.target.value)} placeholder="Ej: Pastor, Diácono, Líder de alabanza..." />
          <Inp label="Ministerio" value={form.ministerio || ""} onChange={e => set("ministerio", e.target.value)} placeholder="Ej: Ministerio de Jóvenes" />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Fecha inicio" type="date" value={form.fecha_inicio || ""} onChange={e => set("fecha_inicio", e.target.value)} />
            <Inp label="Fecha fin (si ya no está activo)" type="date" value={form.fecha_fin || ""} onChange={e => set("fecha_fin", e.target.value)} />
          </div>
          <Inp label="Observación" value={form.observacion || ""} onChange={e => set("observacion", e.target.value)} placeholder="Notas adicionales..." />
        </div>
      )}
      {tipo === "documento" && (
        <div>
          <Sel label="Tipo de documento *" value={form.tipo || ""} onChange={e => set("tipo", e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="bautismo">Bautismo</option>
            <option value="membresia">Membresía</option>
            <option value="matrimonio">Matrimonio</option>
            <option value="ordenacion">Ordenación</option>
            <option value="transferencia">Transferencia</option>
            <option value="disciplina">Disciplina</option>
            <option value="otro">Otro</option>
          </Sel>
          <Inp label="Título *" value={form.titulo || ""} onChange={e => set("titulo", e.target.value)} placeholder="Ej: Carta de bautismo, Certificado de membresía..." />
          <Inp label="Fecha del documento" type="date" value={form.fecha || ""} onChange={e => set("fecha", e.target.value)} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción</label>
            <textarea value={form.descripcion || ""} onChange={e => set("descripcion", e.target.value)} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <Inp label="URL del archivo (opcional)" value={form.archivo_url || ""} onChange={e => set("archivo_url", e.target.value)} placeholder="https://drive.google.com/..." />
        </div>
      )}
      {tipo === "templo" && (
        <div>
          <Inp label="Templo anterior" value={form.templo_anterior || ""} onChange={e => set("templo_anterior", e.target.value)} placeholder="Nombre del templo anterior" />
          <Inp label="Templo nuevo *" value={form.templo_nuevo || ""} onChange={e => set("templo_nuevo", e.target.value)} placeholder="Nombre del templo al que se transfiere" />
          <Inp label="Fecha del cambio" type="date" value={form.fecha || today()} onChange={e => set("fecha", e.target.value)} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Motivo</label>
            <textarea value={form.motivo || ""} onChange={e => set("motivo", e.target.value)} rows={3} placeholder="Motivo del cambio..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
        </div>
      )}
      {tipo === "disciplina" && (
        <div>
          <Sel label="Tipo de disciplina *" value={form.tipo || ""} onChange={e => set("tipo", e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="amonestacion">Amonestación</option>
            <option value="suspension">Suspensión</option>
            <option value="restauracion">Restauración</option>
            <option value="otro">Otro</option>
          </Sel>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>Descripción *</label>
            <textarea value={form.descripcion || ""} onChange={e => set("descripcion", e.target.value)} rows={4} placeholder="Describe la situación, motivo y acciones tomadas..." style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "0.5px solid var(--border)", padding: "8px 10px", fontSize: 14, fontFamily: "var(--font-sans)", background: "var(--surface-2)", color: "var(--text-primary)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Inp label="Fecha de inicio" type="date" value={form.fecha || today()} onChange={e => set("fecha", e.target.value)} />
            <Inp label="Fecha de resolución (si ya fue resuelta)" type="date" value={form.fecha_resolucion || ""} onChange={e => set("fecha_resolucion", e.target.value)} />
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" icon="device-floppy" loading={saving} onClick={handleSave}>
          {saving ? "Guardando..." : "Guardar"}
        </Btn>
      </div>
    </Modal>
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
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isMobile = useIsMobile();

  const toast = useCallback((msg, type = "ok") => setToastData({ msg, type, key: Date.now() }), []);

  // Registrar Service Worker y detectar conexión
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(reg => {
          // Cuando vuelve la señal, sincronizar automáticamente
          window.addEventListener("online", () => {
            setIsOnline(true);
            if ("sync" in reg) {
              reg.sync.register("sync-asistencia").catch(() => {});
            }
            // Trigger manual sync
            navigator.serviceWorker.controller?.postMessage({ type: "SYNC_NOW" });
          });
          window.addEventListener("offline", () => setIsOnline(false));
        })
        .catch(() => {});
    }
    // También detectar cambios de conexión sin SW
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

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
    <AppCtx.Provider value={{ usuario: null, toast, isOnline }}>
      <LoginPage onLogin={setUsuario} />
      {toastData && <Toast key={toastData.key} msg={toastData.msg} type={toastData.type} onClose={() => setToastData(null)} />}
    </AppCtx.Provider>
  );

  const PAGES = { dashboard: Dashboard, miembros: ModuloMiembros, asistencia: ModuloAsistencia, historial: ModuloHistorial, tareas: ModuloTareas, estadisticas_tareas: ModuloEstadisticasTareas, visitas: ModuloVisitas, legajos: ModuloLegajos, reportes: ModuloReportes, config: ModuloConfig };
  const PageComp = PAGES[page] || Dashboard;
  const currentNav = NAV_ITEMS.find(n => n.id === page);

  return (
    <AppCtx.Provider value={{ usuario, toast, isOnline }}>
      <div style={{ display: "flex", minHeight: "100vh", background: "var(--surface-0)" }}>
        <Sidebar active={page} onChange={handlePageChange} usuario={usuario} onLogout={handleLogout} isMobile={isMobile} isOpen={menuOpen} onCloseMenu={() => setMenuOpen(false)} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Banner sin internet */}
          {!isOnline && (
            <div style={{ background: "var(--bg-warning)", borderBottom: "0.5px solid var(--border-warning)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-warning)" }}>
              <i className="ti ti-wifi-off" style={{ fontSize: 16 }} />
              <strong>Sin conexión</strong> — Podés tomar asistencia, se sincronizará automáticamente cuando vuelva la señal.
            </div>
          )}
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