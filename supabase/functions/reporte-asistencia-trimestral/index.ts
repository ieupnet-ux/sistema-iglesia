// ============================================================
// EDGE FUNCTION: reporte-asistencia-trimestral
// Se ejecuta cada 3 meses (vía cron job)
// 1) Envía al pastor/administrador un reporte completo con
//    estadísticas y el ranking de los 5 miembros con más
//    inasistencias (para seguimiento pastoral)
// 2) Envía a cada uno de esos 5 miembros un mensaje personal,
//    cálido y de aliento bíblico para animarlos a congregarse,
//    SIN mostrarles el ranking ni datos comparativos
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CONFIGURACIÓN ────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GREENAPI_ID_INSTANCE = Deno.env.get("GREENAPI_ID_INSTANCE");
const GREENAPI_API_TOKEN = Deno.env.get("GREENAPI_API_TOKEN");

// Número(s) de WhatsApp del pastor/administrador que reciben el
// reporte completo. Formato: código de país + número, sin 0 ni +.
// Se puede poner más de uno separados por coma.
const NUMEROS_PASTORALES = (Deno.env.get("NUMEROS_PASTORALES") || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// ── VERSÍCULOS DE ÁNIMO PARA CONGREGARSE ─────────────────────
// Mensajes cálidos, nunca acusadores. Rotan para variar.
const MENSAJES_ANIMO = [
  {
    versiculo: '"No dejando de congregarnos, como algunos tienen por costumbre, sino exhortándonos; y tanto más, cuanto veis que aquel día se acerca." (Hebreos 10:25)',
    texto: "Te extrañamos en la congregación. Tu lugar entre nosotros es importante y siempre tienes las puertas abiertas."
  },
  {
    versiculo: '"Como el ciervo brama por las corrientes de las aguas, así clama por ti, oh Dios, el alma mía." (Salmos 42:1)',
    texto: "Queremos que sepas que oramos por ti. Nos encantaría volver a verte pronto en la casa de Dios."
  },
  {
    versiculo: '"Venid a mí todos los que estáis trabajados y cargados, y yo os haré descansar." (Mateo 11:28)',
    texto: "Si has estado pasando un tiempo difícil, queremos acompañarte. La iglesia es tu familia y te esperamos con los brazos abiertos."
  },
  {
    versiculo: '"Una cosa he demandado a Jehová, ésta buscaré; que esté yo en la casa de Jehová todos los días de mi vida." (Salmos 27:4)',
    texto: "Tu presencia en la congregación nos alegra. Esperamos verte pronto, ¡te extrañamos!"
  },
  {
    versiculo: '"Y considerémonos unos a otros para estimularnos al amor y a las buenas obras." (Hebreos 10:24)',
    texto: "Eres parte importante de esta familia de fe. Nos encantaría que nos acompañes en los próximos encuentros."
  },
];

function obtenerMensajeAnimoDelDia() {
  const diaDelAno = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return MENSAJES_ANIMO[diaDelAno % MENSAJES_ANIMO.length];
}

function construirMensajePersonal(nombre) {
  const m = obtenerMensajeAnimoDelDia();
  return `Hola ${nombre}, ¡la paz de Cristo sea contigo! 🙏\n\n${m.versiculo}\n\n${m.texto}\n\nCon cariño, tu familia en la iglesia. ✨`;
}

async function enviarWhatsApp(telefono, mensaje) {
  const url = `https://7107.api.greenapi.com/waInstance${GREENAPI_ID_INSTANCE}/sendMessage/${GREENAPI_API_TOKEN}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: `${telefono}@c.us`, message: mensaje }),
  });
  return resp.ok;
}

function limpiarTelefono(num) {
  let t = (num || "").replace(/\D/g, "");
  if (t.startsWith("0")) t = t.substring(1);
  return t;
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Período: últimos 3 meses (90 días) hasta hoy
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setDate(desde.getDate() - 90);
    const desdeStr = desde.toISOString().split("T")[0];
    const hastaStr = hoy.toISOString().split("T")[0];

    // 1. Traer todas las reuniones del período
    const { data: reuniones, error: errR } = await supabase
      .from("reuniones")
      .select("id, fecha, templo_id")
      .gte("fecha", desdeStr)
      .lte("fecha", hastaStr);
    if (errR) throw errR;

    const totalReuniones = reuniones.length;
    const reunionIds = reuniones.map((r) => r.id);

    if (totalReuniones === 0) {
      return new Response(
        JSON.stringify({ mensaje: "No hubo reuniones registradas en este período. No se envió reporte." }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Traer todos los miembros activos con whatsapp
    const { data: miembros, error: errM } = await supabase
      .from("miembros")
      .select("id, nombres, apellidos, whatsapp, estado, templo_id, templos(nombre)")
      .neq("estado", "retirado")
      .not("whatsapp", "is", null);
    if (errM) throw errM;

    // 3. Traer toda la asistencia de esas reuniones
    const { data: asistencia, error: errA } = await supabase
      .from("asistencia")
      .select("miembro_id, estado, reunion_id")
      .in("reunion_id", reunionIds);
    if (errA) throw errA;

    // 4. Calcular estadísticas por miembro
    const statsPorMiembro = {};
    miembros.forEach((m) => {
      statsPorMiembro[m.id] = {
        miembro: m,
        presentes: 0,
        ausentes: 0,
        justificados: 0,
        tardes: 0,
        totalRegistros: 0,
      };
    });

    asistencia.forEach((a) => {
      const s = statsPorMiembro[a.miembro_id];
      if (!s) return;
      s.totalRegistros++;
      if (a.estado === "presente") s.presentes++;
      else if (a.estado === "ausente") s.ausentes++;
      else if (a.estado === "justificado") s.justificados++;
      else if (a.estado === "tarde") s.tardes++;
    });

    // Reuniones sin registro de asistencia = se consideran ausencia (criterio "ausente por defecto" del sistema)
    Object.values(statsPorMiembro).forEach((s) => {
      const sinRegistro = totalReuniones - s.totalRegistros;
      s.ausentes += sinRegistro;
      s.totalRegistros = totalReuniones;
      s.pctAsistencia = totalReuniones > 0 ? Math.round((s.presentes / totalReuniones) * 100) : 0;
    });

    // 5. Ranking: los 5 con MÁS inasistencias (mayor cantidad de ausentes)
    const ranking = Object.values(statsPorMiembro)
      .filter((s) => s.totalRegistros > 0)
      .sort((a, b) => b.ausentes - a.ausentes)
      .slice(0, 5);

    // Estadísticas generales de la iglesia
    const totalPresentes = asistencia.filter((a) => a.estado === "presente").length;
    const totalAusentes = Object.values(statsPorMiembro).reduce((sum, s) => sum + s.ausentes, 0);
    const totalPosible = Object.values(statsPorMiembro).reduce((sum, s) => sum + s.totalRegistros, 0);
    const pctGeneral = totalPosible > 0 ? Math.round((totalPresentes / totalPosible) * 100) : 0;

    const resultados = { pastoral: [], miembros: [] };

    // 6. Construir y enviar el reporte completo al pastor/administrador
    if (NUMEROS_PASTORALES.length > 0) {
      let textoRanking = ranking
        .map((s, i) => {
          const nombreCompleto = `${s.miembro.nombres} ${s.miembro.apellidos}`;
          return `${i + 1}. ${nombreCompleto} — ${s.ausentes} ausencias (${s.pctAsistencia}% asistencia) — ${s.miembro.templos?.nombre || "sin templo"}`;
        })
        .join("\n");

      const reportePastoral =
        `📊 *Reporte trimestral de asistencia*\n` +
        `Período: ${desdeStr} al ${hastaStr}\n` +
        `Reuniones registradas: ${totalReuniones}\n` +
        `Asistencia general de la iglesia: ${pctGeneral}%\n\n` +
        `*Top 5 con más inasistencias (para seguimiento pastoral):*\n${textoRanking}\n\n` +
        `Se envió un mensaje individual de ánimo a cada uno de estos 5 miembros, sin mencionar el ranking, invitándolos a congregarse nuevamente. 🙏`;

      for (const numero of NUMEROS_PASTORALES) {
        const ok = await enviarWhatsApp(limpiarTelefono(numero), reportePastoral);
        resultados.pastoral.push({ numero, estado: ok ? "enviado ✓" : "error" });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // 7. Enviar mensaje individual de ánimo a cada uno de los 5, SIN el ranking
    for (const s of ranking) {
      const m = s.miembro;
      if (!m.whatsapp) {
        resultados.miembros.push({ miembro: m.nombres, estado: "sin whatsapp, omitido" });
        continue;
      }
      const telefono = limpiarTelefono(m.whatsapp);
      const mensaje = construirMensajePersonal(m.nombres);

      try {
        const ok = await enviarWhatsApp(telefono, mensaje);

        await supabase.from("log_whatsapp").insert({
          miembro_id: m.id,
          tipo: "animo_asistencia",
          mensaje,
          estado: ok ? "enviado" : "error",
        });

        resultados.miembros.push({ miembro: `${m.nombres} ${m.apellidos}`, estado: ok ? "enviado ✓" : "error" });
      } catch (e) {
        resultados.miembros.push({ miembro: `${m.nombres} ${m.apellidos}`, estado: "error: " + e.message });
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    return new Response(
      JSON.stringify({
        periodo: { desde: desdeStr, hasta: hastaStr },
        totalReuniones,
        pctAsistenciaGeneral: pctGeneral,
        ranking: ranking.map((s) => ({
          nombre: `${s.miembro.nombres} ${s.miembro.apellidos}`,
          ausencias: s.ausentes,
          pctAsistencia: s.pctAsistencia,
        })),
        resultados,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});