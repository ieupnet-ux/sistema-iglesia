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
import "./theme.css";
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
  const [modal, setModal] = useState(null);
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

      const tsv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join("\t")).join("\n");
      const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `miembros_${today()}.tsv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MÓDULO VISITAS - CON PDF MEJORADO
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
        />
      )}
    </div>
  );
}

// ── Modal de visitas con PDF mejorado ─────────────────────────
function ModalVisita({ modal, miembros, usuario, onClose, onSaved }) {
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

  // ── FUNCIÓN MEJORADA DE GENERACIÓN DE PDF ─────────────────
  const generarPDF = async (tipo, datos) => {
    try {
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Márgenes y dimensiones
      const marginX = 20;
      const marginTop = 15;
      const pageWidth = 210;
      const contentWidth = pageWidth - (marginX * 2);
      let y = marginTop;

      // Colores corporativos
      const colorPrimario = [30, 45, 90];
      const colorSecundario = [100, 100, 100];
      const colorTexto = [40, 40, 40];

      // Cargar imágenes
      const cargarImagen = (src) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });

      const [escudoB64, firmaB64] = await Promise.all([
        cargarImagen("/escudo.jpg"),
        cargarImagen("/firma-pastor.jpg"),
      ]);

      // ── ENCABEZADO ────────────────────────────────────────
      if (escudoB64) {
        try {
          doc.addImage(escudoB64, "JPEG", marginX, y, 22, 22);
        } catch (e) {
          console.warn("No se pudo cargar escudo:", e);
        }
      }

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colorPrimario);
      doc.text((form.iglesia || "Unión Pentecostal").toUpperCase(), pageWidth / 2, y + 6, { align: "center" });

      y += 28;

      // Línea decorativa
      doc.setDrawColor(...colorPrimario);
      doc.setLineWidth(0.8);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 4;

      // Título del documento
      const tipoLabel = tipo === "acuse" ? "ACUSE DE RECIBO" : "CARTA DE RECOMENDACIÓN";
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colorPrimario);
      doc.text(tipoLabel, pageWidth / 2, y, { align: "center" });
      y += 7;

      // Línea decorativa inferior del encabezado
      doc.setLineWidth(0.5);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 8;

      // ── CUERPO DEL DOCUMENTO ──────────────────────────────
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...colorTexto);

      // Lugar y fecha
      const lugarFecha = `${form.ciudad || "(ciudad)"}${form.ciudad ? "," : ""} ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}`;
      doc.text(lugarFecha, marginX, y);
      y += 8;

      // Destinatario
      if (tipo === "acuse") {
        doc.setFont("helvetica", "normal");
        doc.text("Estimado/a Pastor/a", marginX, y);
        y += 5;
        const destinatarioText = `${form.iglesia_origen || "Iglesia de origen"}`;
        const destinatarioSplit = doc.splitTextToSize(destinatarioText, contentWidth);
        doc.text(destinatarioSplit, marginX, y);
        y += destinatarioSplit.length * 5 + 5;
      } else {
        doc.setFont("helvetica", "normal");
        doc.text("Estimado/a Pastor/a", marginX, y);
        y += 5;
        const destinatarioText = `${form.iglesia_destino || "Iglesia de destino"}`;
        const destinatarioSplit = doc.splitTextToSize(destinatarioText, contentWidth);
        doc.text(destinatarioSplit, marginX, y);
        y += destinatarioSplit.length * 5 + 5;
      }

      // Saludo introductorio
      const saludoText = tipo === "acuse"
        ? "Por medio de la presente, hacemos constar que hemos recibido la carta de presentación del hermano/a:"
        : "Por medio de la presente, y con el gozo que produce la comunión de los santos, nos es grato presentarle al hermano/a:";

      const saludoSplit = doc.splitTextToSize(saludoText, contentWidth);
      doc.text(saludoSplit, marginX, y);
      y += saludoSplit.length * 5 + 6;

      // Datos principales
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colorPrimario);
      doc.setFontSize(11);
      const nombre = `${modal.data?.nombres || ""} ${modal.data?.apellidos || ""}`.trim();
      doc.text(`NOMBRE: ${nombre}`, marginX, y);
      y += 7;

      // Información adicional
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...colorTexto);
      doc.setFontSize(10);

      if (tipo === "acuse") {
        if (modal.data?.numero_carta_recibida) {
          doc.text(`N° de Carta: ${modal.data.numero_carta_recibida}`, marginX, y);
          y += 5;
        }
        if (modal.data?.fecha_carta_recibida) {
          doc.text(`Fecha de Carta: ${fmtDate(modal.data.fecha_carta_recibida)}`, marginX, y);
          y += 5;
        }
        if (modal.data?.iglesia_origen) {
          doc.text(`Iglesia de Origen: ${modal.data.iglesia_origen}`, marginX, y);
          y += 5;
        }
        y += 3;

        // Contenido acuse
        const acuseText = "El hermano/a ha sido recibido/a en nuestra congregación con gozo y extendemos esta constancia como prueba de su presentación. Le recomendamos cordialmente al cuidado de Dios en este nuevo capítulo de su vida espiritual.";
        const acuseSplit = doc.splitTextToSize(acuseText, contentWidth);
        doc.text(acuseSplit, marginX, y);
        y += acuseSplit.length * 5 + 6;
      } else {
        if (modal.data?.numero_carta) {
          doc.text(`N° de Carta: ${modal.data.numero_carta}`, marginX, y);
          y += 5;
        }
        if (modal.data?.iglesia_destino) {
          doc.text(`Iglesia de Destino: ${modal.data.iglesia_destino}`, marginX, y);
          y += 5;
        }
        y += 3;

        // Descripción de la persona
        const descripcionText = "Es miembro activo de nuestra congregación y se caracteriza por su fidelidad a Dios, a su iglesia y a los principios bíblicos que nos unen como hermanos en la fe.";
        const descripcionSplit = doc.splitTextToSize(descripcionText, contentWidth);
        doc.text(descripcionSplit, marginX, y);
        y += descripcionSplit.length * 5 + 4;

        if (modal.data?.motivo) {
          doc.setFont("helvetica", "bold");
          doc.text("MOTIVO:", marginX, y);
          y += 5;
          doc.setFont("helvetica", "normal");
          const motivoSplit = doc.splitTextToSize(modal.data.motivo, contentWidth);
          doc.text(motivoSplit, marginX, y);
          y += motivoSplit.length * 5 + 4;
        }
      }

      // Observaciones si existen
      if (modal.data?.observaciones) {
        doc.setFont("helvetica", "bold");
        doc.text("OBSERVACIONES:", marginX, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        const obsSplit = doc.splitTextToSize(modal.data.observaciones, contentWidth);
        doc.text(obsSplit, marginX, y);
        y += obsSplit.length * 5 + 4;
      }

      // Cierre
      const cierreText = tipo === "acuse"
        ? "Esta constancia se extiende para los fines que considere conveniente."
        : "Le recomendamos cordialmente a este hermano/a y le pedimos lo reciba con el amor de Cristo.";
      const cierreSplit = doc.splitTextToSize(cierreText, contentWidth);
      doc.text(cierreSplit, marginX, y);
      y += cierreSplit.length * 5 + 8;

      // ── FIRMA ──────────────────────────────────────────────
      const yFirmaLinea = Math.min(y + 12, 240);

      // Si hay imagen de firma, mostrarla
      if (firmaB64 && y < 200) {
        try {
          doc.addImage(firmaB64, "JPEG", marginX + 30, yFirmaLinea - 20, 50, 25);
        } catch (e) {
          console.warn("No se pudo cargar firma:", e);
        }
      }

      // Línea de firma
      doc.setLineWidth(0.5);
      doc.setDrawColor(...colorPrimario);
      doc.line(marginX + 15, yFirmaLinea, marginX + 95, yFirmaLinea);

      // Datos del firmante
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...colorTexto);
      doc.text(form.pastor_firma || "Pastor/a", marginX + 55, yFirmaLinea + 5, { align: "center" });

      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...colorSecundario);
      doc.text(form.cargo_pastor || "Pastor", marginX + 55, yFirmaLinea + 10, { align: "center" });
      doc.text(form.iglesia || "Unión Pentecostal", marginX + 55, yFirmaLinea + 15, { align: "center" });

      // ── PIE DE PÁGINA ──────────────────────────────────────
      const yFooter = 270;
      doc.setLineWidth(0.5);
      doc.setDrawColor(...colorPrimario);
      doc.line(marginX, yFooter, pageWidth - marginX, yFooter);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...colorSecundario);

      doc.text(form.iglesia || "Unión Pentecostal", marginX, yFooter + 4);

      const hoy = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
      doc.text(`${hoy}`, pageWidth / 2, yFooter + 4, { align: "center" });

      if (modal.data?.numero_carta || modal.data?.numero_acuse) {
        const numDoc = modal.data.numero_carta || modal.data.numero_acuse;
        doc.text(`N°: ${numDoc}`, pageWidth - marginX, yFooter + 4, { align: "right" });
      }

      // ── DESCARGAR ──────────────────────────────────────────
      const apellido = modal.data?.apellidos || "documento";
      const tipoNombre = tipo === "acuse" ? "Acuse" : "Carta";
      const fechaArchivo = new Date().toISOString().split("T")[0];
      doc.save(`${tipoNombre}_${apellido}_${fechaArchivo}.pdf`);

      toast("PDF generado correctamente ✓", "ok");
    } catch (e) {
      console.error("Error PDF:", e);
      toast("Error al generar PDF: " + e.message, "error");
    }
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
    generarPDF("acuse", datos);
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
    generarPDF("recomendacion", datos);
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
            <Inp label="Nombre del pastor/a firmante" value={form.pastor_firma || ""} onChange={e => set("pastor_firma", e.target.value)} />
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
// STUB PARA OTROS MÓDULOS (RESUMIDOS)
// ─────────────────────────────────────────────────────────────
function ModuloAsistencia() { return <div style={{ padding: 20 }}><h2>Módulo de Asistencia (Versión stub)</h2><p>Implementar según necesidades</p></div>; }
function ModuloHistorial() { return <div style={{ padding: 20 }}><h2>Módulo Historial (Versión stub)</h2></div>; }
function ModuloTareas() { return <div style={{ padding: 20 }}><h2>Módulo Tareas (Versión stub)</h2></div>; }
function ModuloEstadisticasTareas() { return <div style={{ padding: 20 }}><h2>Módulo Estadísticas Tareas (Versión stub)</h2></div>; }
function ModuloLegajos() { return <div style={{ padding: 20 }}><h2>Módulo Legajos (Versión stub)</h2></div>; }
function ModuloReportes() { return <div style={{ padding: 20 }}><h2>Módulo Reportes (Versión stub)</h2></div>; }
function ModuloConfig() { return <div style={{ padding: 20 }}><h2>Módulo Configuración (Versión stub)</h2></div>; }

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

  const PAGES = {
    dashboard: Dashboard,
    miembros: ModuloMiembros,
    asistencia: ModuloAsistencia,
    historial: ModuloHistorial,
    tareas: ModuloTareas,
    estadisticas_tareas: ModuloEstadisticasTareas,
    visitas: ModuloVisitas,
    legajos: ModuloLegajos,
    reportes: ModuloReportes,
    config: ModuloConfig,
  };
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