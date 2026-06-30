// ============================================================
// EDGE FUNCTION: cumpleanos-whatsapp
// Se ejecuta automáticamente todos los días (vía cron job)
// Busca miembros que cumplen años HOY y les envía un mensaje
// de felicitación con bendición y versículo bíblico por WhatsApp
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CONFIGURACIÓN ────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CALLMEBOT_APIKEY = Deno.env.get("CALLMEBOT_APIKEY"); // se configura como secret

// ── VERSÍCULOS Y MENSAJES DE BENDICIÓN ───────────────────────
// Rotan automáticamente para que no sea siempre el mismo mensaje
const MENSAJES_CUMPLEANOS = [
  {
    versiculo: '"Bendito seas tú, y bendita tu salida y bendita tu entrada." (Deuteronomio 28:6)',
    texto: "Que en este nuevo año de vida el Señor te colme de salud, sabiduría y abundantes bendiciones."
  },
  {
    versiculo: '"El Señor te bendiga, y te guarde; el Señor haga resplandecer su rostro sobre ti, y tenga de ti misericordia." (Números 6:24-25)',
    texto: "Que cada día de este nuevo año esté lleno del favor y la gracia de Dios sobre tu vida."
  },
  {
    versiculo: '"Porque yo sé los pensamientos que tengo acerca de vosotros, dice Jehová, pensamientos de paz, y no de mal, para daros el fin que esperáis." (Jeremías 29:11)',
    texto: "Que Dios siga cumpliendo sus propósitos de bien en tu vida en este nuevo año."
  },
  {
    versiculo: '"Fiel es Dios, por el cual fuisteis llamados a la comunión con su Hijo Jesucristo nuestro Señor." (1 Corintios 1:9)',
    texto: "Que tu vida siga siendo testimonio de la fidelidad de Dios en cada nuevo año."
  },
  {
    versiculo: '"Te alabaré; porque formidables, maravillosas son tus obras; estoy maravillado, y mi alma lo sabe muy bien." (Salmos 139:14)',
    texto: "Hoy celebramos la vida maravillosa que Dios diseñó en ti."
  },
  {
    versiculo: '"Bueno es Jehová para con todos, y su misericordia sobre todas sus obras." (Salmos 145:9)',
    texto: "Que su misericordia y bondad te acompañen siempre, hoy y en cada día de tu nuevo año."
  },
  {
    versiculo: '"Hasta vuestra vejez yo mismo, y hasta las canas os soportaré; yo hice, yo llevaré, yo soportaré y guardaré." (Isaías 46:4)',
    texto: "Dios mismo te sostiene y guarda en cada etapa de tu vida."
  },
];

function obtenerMensajeDelDia() {
  // Selecciona un mensaje distinto según el día del año, para variar automáticamente
  const diaDelAno = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const idx = diaDelAno % MENSAJES_CUMPLEANOS.length;
  return MENSAJES_CUMPLEANOS[idx];
}

function construirMensaje(nombre, edad) {
  const m = obtenerMensajeDelDia();
  const edadTexto = edad ? ` Hoy cumples ${edad} años.` : "";
  return `🎉 ¡Feliz cumpleaños, ${nombre}! 🎂${edadTexto}\n\n${m.versiculo}\n\n${m.texto}\n\nDe parte de toda tu familia en la iglesia, ¡que Dios te bendiga grandemente! 🙏✨`;
}

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const hoy = new Date();
  const nacimiento = new Date(fechaNacimiento + "T12:00:00");
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
  return edad;
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fecha de hoy en formato MM-DD para comparar mes y día (sin importar el año)
    const hoy = new Date();
    const mesHoy = hoy.getMonth() + 1;
    const diaHoy = hoy.getDate();

    // Traer todos los miembros activos con fecha de nacimiento y whatsapp
    const { data: miembros, error } = await supabase
      .from("miembros")
      .select("id, nombres, apellidos, fecha_nacimiento, whatsapp, estado")
      .not("fecha_nacimiento", "is", null)
      .not("whatsapp", "is", null)
      .neq("estado", "retirado");

    if (error) throw error;

    // Filtrar quienes cumplen años HOY (comparando mes y día)
    const cumpleaneros = miembros.filter((m) => {
      const f = new Date(m.fecha_nacimiento + "T12:00:00");
      return f.getMonth() + 1 === mesHoy && f.getDate() === diaHoy;
    });

    const resultados = [];

    for (const m of cumpleaneros) {
      const telefono = m.whatsapp.replace(/\D/g, ""); // solo números
      const edad = calcularEdad(m.fecha_nacimiento);
      const mensaje = construirMensaje(m.nombres, edad);

      // Verificar que no se le haya enviado ya hoy (evita duplicados si el cron corre 2 veces)
      const inicioHoy = new Date();
      inicioHoy.setHours(0, 0, 0, 0);
      const { data: yaEnviado } = await supabase
        .from("log_whatsapp")
        .select("id")
        .eq("miembro_id", m.id)
        .eq("tipo", "cumpleanos")
        .gte("enviado_at", inicioHoy.toISOString())
        .limit(1);

      if (yaEnviado && yaEnviado.length > 0) {
        resultados.push({ miembro: m.nombres, estado: "ya enviado hoy, omitido" });
        continue;
      }

      try {
        const url = `https://api.callmebot.com/whatsapp.php?phone=${telefono}&text=${encodeURIComponent(mensaje)}&apikey=${CALLMEBOT_APIKEY}`;
        const resp = await fetch(url);
        const ok = resp.ok;

        await supabase.from("log_whatsapp").insert({
          miembro_id: m.id,
          tipo: "cumpleanos",
          mensaje,
          estado: ok ? "enviado" : "error",
        });

        resultados.push({ miembro: `${m.nombres} ${m.apellidos}`, estado: ok ? "enviado ✓" : "error al enviar" });
      } catch (e) {
        await supabase.from("log_whatsapp").insert({
          miembro_id: m.id,
          tipo: "cumpleanos",
          mensaje,
          estado: "error: " + e.message,
        });
        resultados.push({ miembro: `${m.nombres} ${m.apellidos}`, estado: "error: " + e.message });
      }

      // Pequeña pausa entre envíos para no saturar la API gratuita
      await new Promise((r) => setTimeout(r, 2000));
    }

    return new Response(
      JSON.stringify({
        fecha: hoy.toISOString().split("T")[0],
        total_cumpleaneros: cumpleaneros.length,
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
