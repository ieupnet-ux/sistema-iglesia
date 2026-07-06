// ============================================================
// SERVICE WORKER — Sistema Iglesia
// Permite tomar asistencia sin internet y sincronizar después
// ============================================================

const CACHE_NAME = "iglesia-v1";
const SYNC_TAG = "sync-asistencia";

// Archivos que se cachean para funcionar offline
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/logo-iglesia.jpg",
  "/static/js/main.js",
];

// ── INSTALACIÓN: cachear archivos estáticos ──────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Si algún asset falla, seguimos igual
      });
    })
  );
  self.skipWaiting();
});

// ── ACTIVACIÓN: limpiar cachés viejos ────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estrategia network-first con fallback a caché ─────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Las llamadas a Supabase nunca se cachean (datos en tiempo real)
  if (url.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Sin internet: devolver error para que la app lo maneje
        return new Response(
          JSON.stringify({ error: "Sin conexión", offline: true }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  // Para el resto (archivos estáticos): network-first, fallback caché
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Guardar copia en caché si es exitoso
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── BACKGROUND SYNC: sincronizar asistencia offline ──────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(sincronizarAsistencia());
  }
});

async function sincronizarAsistencia() {
  try {
    // Leer datos offline del IndexedDB (guardados por la app)
    const db = await abrirDB();
    const pendientes = await obtenerPendientes(db);

    if (pendientes.length === 0) return;

    // Intentar sincronizar cada registro
    for (const registro of pendientes) {
      try {
        const resp = await fetch(registro.url, {
          method: registro.method,
          headers: registro.headers,
          body: registro.body,
        });
        if (resp.ok) {
          await eliminarPendiente(db, registro.id);
        }
      } catch {
        // Si falla, queda para el próximo intento
      }
    }
  } catch (err) {
    console.error("Error sincronizando:", err);
  }
}

// ── INDEXEDDB para guardar asistencia offline ────────────────
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("iglesia-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pendientes")) {
        db.createObjectStore("pendientes", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function obtenerPendientes(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readonly");
    const req = tx.objectStore("pendientes").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function eliminarPendiente(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readwrite");
    const req = tx.objectStore("pendientes").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── MENSAJE desde la app: guardar registro offline ───────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "GUARDAR_OFFLINE") {
    abrirDB().then((db) => {
      const tx = db.transaction("pendientes", "readwrite");
      tx.objectStore("pendientes").add(event.data.payload);
    });
  }
  if (event.data?.type === "SYNC_NOW") {
    sincronizarAsistencia();
  }
});