import Anthropic from "@anthropic-ai/sdk";
import { cleanDeep } from "./quality.js";

const client = new Anthropic();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Todas las llamadas devuelven JSON validado contra un esquema (structured outputs).
// Si el modelo rechaza la petición, la API reintenta con un modelo alternativo ("fallbacks").
async function ask({ system = SYSTEM, prompt, schema, effort = "medium", maxTokens = 16000 }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("La IA no pudo completar esta petición.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de la IA se cortó; inténtalo de nuevo.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return cleanDeep(JSON.parse(text));
}

const str = { type: "string" };
const int = { type: "integer" };
const strs = { type: "array", items: str };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const SYSTEM = `Eres el estratega de contenido de una agencia de Instagram para negocios.
Escribes en el idioma de la marca (por defecto, español de España) y como habla la marca de verdad: frases cortas, palabras normales, nada que haya que ensayar para decirlo.
Prohibido: rayas largas (—), frases de plantilla ("en el mundo actual", "lleva tu negocio al siguiente nivel", "descubre", "sígueme para más", "no es solo X, es Y"), saludos y presentaciones al inicio, listas con emojis.
Nunca inventas cifras, clientes, testimonios ni resultados. Si hace falta un dato que no consta, deja un hueco {{así}} para que el cliente lo rellene.
Respetas las afirmaciones permitidas y prohibidas del cerebro de marca.`;

// Fórmulas de gancho (nombre y plantilla) que el modelo usa como repertorio.
export const HOOK_FORMULAS = [
  [1, "Confesión de coste", "{Cantidad concreta} es lo que me costó {un error}."],
  [2, "Orden en negativo", "Deja de {acción habitual}. Haz {alternativa}."],
  [3, "Nadie te lo cuenta", "Nadie te cuenta que {verdad incómoda sobre lo que quieren}."],
  [4, "El sustituto", "{Esto} sustituyó a {algo caro} por {precio}."],
  [5, "Colapso de tiempo", "Antes tardaba {mucho}. Ahora, {poco}."],
  [6, "El recibo", "Hice {cosa} durante {N días}. Estos son los números reales."],
  [7, "Mal y bien", "Estás haciendo {cosa} mal, y no es culpa tuya. {Arreglo}."],
  [8, "Desde dentro", "Pasé {N años} dentro de {sector}. Esto nunca lo decimos en voz alta."],
  [9, "Róbalo", "Róbame esta {plantilla}. Me costó {tiempo} dejarla así."],
  [10, "Si te pasa esto", "Si {situación concreta}, esto lo arregla en {poco tiempo}."],
  [11, "Lista con favorito", "{N} {cosas} que {resultado}. La {k} es la que nadie usa."],
  [12, "La objeción", "\"{Objeción real}\". Vale. Así funciona igualmente."],
  [13, "Antes y después en pantalla", "{Lo de antes}. {Lo de ahora}. {La palanca en una frase}."],
  [14, "Llamada directa", "{Grupo concreto}, esto es lo que estás ignorando."],
  [15, "Los fracasos", "Mis primeros {N} {intentos} no sirvieron. Esto cambió en el {N+1}."],
  [16, "La pregunta literal", "\"{Pregunta tal cual la hacen}\". Me la hacen cada semana."],
  [17, "Cara a cara", "{A} contra {B}. Probé los dos {tiempo} y no hubo color."],
  [18, "Demo en frío", "{Empieza a mitad de la acción}. Mira lo que hace esto."],
  [19, "La fecha límite", "{Algo} cambia el {fecha}. Haz {acción} antes."],
  [20, "Permiso", "No necesitas {lo que todo el mundo dice que necesitas}."],
  [21, "A mitad de frase", "...y ahí fue cuando {el giro}."],
  [22, "Refrán al revés", "{Dicho conocido, invertido}."],
  [23, "La estadística", "El {N}% de {grupo} {dato sorprendente}."],
  [24, "La presentación", "Este es el nuevo {cosa}."],
  [25, "El resultado de otro", "Un {cliente} consiguió {resultado} en {tiempo}."],
  [26, "El superlativo", "Lo {más rápido / único} para {cosa} es {respuesta}."],
];
const FORMULAS_TEXT = HOOK_FORMULAS.map(([id, n, t]) => `#${id} ${n}: ${t}`).join("\n");

// ---------- Cerebro de marca ----------
export const BRAIN_SCHEMA = obj({
  business: str,
  offer: strs,
  audience: str,
  tone: str,
  voice_rules: strs,
  language: str,
  timezone: str,
  colors: strs,
  pillars: strs,
  search_terms: strs,
  claims_allowed: strs,
  claims_avoid: strs,
  main_cta: str,
});

export function buildBrain({ name, website, siteText, igProfile, igCaptions }) {
  return ask({
    schema: BRAIN_SCHEMA,
    prompt: `Construye el "cerebro de marca" de este negocio.
- business: qué hace, en 1-2 frases.
- offer: productos o servicios concretos.
- audience: para quién es, con detalle (quién, qué problema, en qué momento).
- tone: cómo habla la marca. voice_rules: 4-8 reglas prácticas de voz (qué dice, qué nunca dice, tú/usted, humor sí/no).${igCaptions?.length ? " Sácalas sobre todo de sus captions reales de Instagram." : ""}
- language e timezone (IANA, p. ej. Europe/Madrid) de su público.
- colors: colores de marca en hex detectados; si no hay, propuestas coherentes.
- pillars: 3-5 temas por los que quiere ser conocida.
- search_terms: 4-8 frases que su cliente escribiría en el buscador de Instagram.
- claims_allowed / claims_avoid: qué se puede afirmar y qué no (salud, dinero, garantías, comparativas).
- main_cta: la acción principal que queremos del público.

Marca: ${name}
Web: ${website}
${igProfile ? `Perfil de Instagram: ${JSON.stringify(igProfile)}\n` : ""}${igCaptions?.length ? `Captions recientes:\n${igCaptions.join("\n---\n")}\n` : ""}
Contenido de la web:
${siteText}`,
  });
}

// ---------- Auditoría ----------
export const AUDIT_SCHEMA = obj({
  summary: str,
  confidence: str,
  findings: { type: "array", items: obj({ claim: str, evidence: str }) },
  do_more: strs,
  stop: strs,
  profile: obj({ name_field: str, bio: str, notes: strs }),
  first_reels: { type: "array", items: obj({ title: str, formula: int, hook: str, why: str }) },
});

export function buildAudit({ brain, igProfile, igMedia }) {
  const hasData = igMedia?.length > 0;
  return ask({
    schema: AUDIT_SCHEMA,
    effort: "high",
    prompt: `Haz la auditoría de Instagram de esta marca.
${hasData ? `Tienes sus publicaciones con métricas ya calculadas:
- outlier = visualizaciones / mediana de la cuenta (si es reel). Ordena por outlier y por envíos/alcance, no por visualizaciones brutas.
- Compara las 5 mejores con las 5 peores y busca qué las separa: formato, duración, tema, tipo de gancho (usa los números de fórmula de la lista). Día y hora, lo último y solo si lo demás no explica nada.
- Si una pieza tiene alcance pero no seguidores, es un problema de perfil, no de gancho: dilo.
- Cada hallazgo es una afirmación con su evidencia. Con menos de 10 publicaciones, dilo en confidence y no inventes patrones.`
  : `No hay Instagram conectado: audita el posicionamiento a partir del cerebro de marca, dilo en summary y pon confidence "baja".`}
- profile: reescribe el campo nombre (con la palabra que buscaría su cliente) y la bio (quién eres, para quién, qué consiguen, una llamada a la acción). notes: otros arreglos del perfil.
- first_reels: 3-5 reels recomendados, cada uno con la fórmula de gancho (número) y el gancho hablado.

Fórmulas de gancho:
${FORMULAS_TEXT}

Cerebro de marca: ${JSON.stringify(brain)}
${igProfile ? `Perfil: ${JSON.stringify(igProfile)}` : ""}
${hasData ? `Publicaciones: ${JSON.stringify(igMedia)}` : ""}`,
  });
}

// ---------- Plan semanal ----------
export const PLAN_SCHEMA = obj({
  theme: str,
  advice: str,
  items: {
    type: "array",
    items: obj({
      day: { type: "integer", description: "0 = lunes ... 6 = domingo" },
      time: { type: "string", description: "Hora local HH:MM" },
      kind: { type: "string", enum: ["reel", "carousel", "story"] },
      type: { type: "string", enum: ["prueba", "enseña", "opinión", "historia", "oferta"] },
      pillar: str,
      formula: int,
      title: str,
      angle: str,
    }),
  },
});

export function buildWeeklyPlan({ brain, audit, count, recentTitles, thisWeek }) {
  return ask({
    schema: PLAN_SCHEMA,
    prompt: `Planifica la próxima semana: ${count} piezas.
- Al menos la mitad (y mínimo 3 si hay 5 o más) son reels: son lo único que llega a gente que no te sigue. Carruseles para profundizar con seguidores. Stories, como mucho 1-2 secuencias destacadas.
- Reparte tipos: prueba (algo que pasó, con número), enseña (algo que el espectador puede hacer hoy), opinión (una postura que podría costar seguidores), historia (una escena con un coste), oferta (lo que vende, dicho claro). Nunca dos del mismo tipo seguidos.
- Cada pieza es un ÁNGULO concreto, no un tema. "Instagram" no es un plan; "el cliente que canceló porque el presupuesto tardó 5 días" sí.
- Elige para cada reel la fórmula de gancho que encaje (número). Prioriza lo que la auditoría dice que funciona.
- Horas: cuando su audiencia está despierta y no trabajando (consumidor: primera hora de la tarde-noche; empresa: primera hora de la mañana), en su zona horaria.
- advice: un consejo honesto para la semana (p. ej., que el gancho importa más que la hora).
- No repitas: ${JSON.stringify(recentTitles)}

${thisWeek ? `Lo que ha pasado esta semana en el negocio (úsalo, es la mejor materia prima): ${thisWeek}` : "El cliente no ha contado novedades esta semana: usa ángulos de su oferta y de su audiencia, y deja huecos {{dato}} donde haga falta un número real."}

Fórmulas de gancho:
${FORMULAS_TEXT}

Cerebro de marca: ${JSON.stringify(brain)}
${audit ? `Auditoría: ${JSON.stringify(audit)}` : ""}`,
  });
}

// ---------- Borradores ----------
// Un mismo esquema para reel, carrusel y story; "beats" son bloques, diapositivas o fotogramas.
export const DRAFT_SCHEMA = obj({
  title: str,
  hooks: { type: "array", items: obj({ formula: int, spoken: str, on_screen: str }) },
  chosen_hook: { type: "integer", description: "Índice (desde 0) del gancho elegido en hooks" },
  why_this_hook: str,
  beats: {
    type: "array",
    items: obj({ label: str, visual: str, spoken: str, on_screen: str, sticker: str }),
  },
  caption: str,
  search_terms: strs,
  hashtags: strs,
  dm_keyword: str,
  alt_text: str,
  first_comment: str,
});

const FORMAT_RULES = {
  reel: `REEL de 15-45 s.
- hooks: 3 ganchos de fórmulas DISTINTAS. Cada uno con frase hablada (se dice en menos de 3 s, con algo concreto y algo en juego, sin saludo) y rótulo (6 palabras o menos). Elige el mejor en chosen_hook.
- beats: el primero es el gancho elegido (label "0:00 GANCHO"). Luego "LO QUE ESTÁ EN JUEGO" (por qué le importa al espectador, una frase), el CUERPO (una idea por bloque, cambio de plano en cada bloque, ningún bloque de más de ~4 s hablando) y el CIERRE (cumple lo prometido + una sola petición). La última frase repite una palabra del gancho para que el bucle encaje.
- label con tiempo aproximado ("0:02-0:06 ..."). visual: qué se ve, con movimiento en el primer plano. on_screen: rótulo de 6 palabras o menos, o vacío. sticker: vacío.
- Una sola idea por reel. Sin intro, sin logo, sin "en este vídeo".
- caption (trabajo A): el vídeo ya engancha, así que la primera línea (125 caracteres visibles) es la petición dicha claramente; el cuerpo da contexto en 2-4 párrafos cortos e incluye los search_terms como frases normales.`,
  carousel: `CARRUSEL de 6-10 diapositivas (1080x1350).
- hooks: 3 opciones de portada (spoken = frase de promesa bajo el título; on_screen = título de portada de 6 palabras o menos). Elige una.
- beats: 1 PORTADA (on_screen = título, spoken = promesa de una línea), 2 LO QUE ESTÁ EN JUEGO (sirve como segunda portada, no es introducción), 3..N UNA IDEA POR DIAPOSITIVA (on_screen = titular de 3-7 palabras, spoken = máximo 25 palabras), RESUMEN (la diapositiva que la gente guarda y envía, legible sin contexto), CTA (una sola acción). label = "1/8 PORTADA", "2/8", etc. visual = indicaciones de diseño. sticker vacío.
- caption (trabajo B): aquí la primera línea ES el gancho, concreta y cortada en un punto que pide seguir leyendo. alt_text de la portada obligatorio.`,
  story: `SECUENCIA DE STORIES de 3-7 fotogramas (para seguidores: profundidad, no alcance).
- hooks: 3 opciones de primer fotograma. Elige una.
- beats: 1 APERTURA (algo que pasa hoy, con cara o manos), 2-3 CONTENIDO (proceso, resultado o error), 4 PETICIÓN con UN sticker (encuesta, caja de preguntas, quiz, enlace o cuenta atrás), 5 CIERRE. Una idea por fotograma, hablando a una sola persona (tú). sticker: el sticker y su texto, o vacío.
- caption: qué hacer con las respuestas (responder a cada persona que vote o pregunte). hashtags vacío.`,
};

export function draftPost({ brain, item }) {
  const kind = item.kind ?? "reel";
  return ask({
    schema: DRAFT_SCHEMA,
    prompt: `Escribe el borrador completo de esta pieza.

${FORMAT_RULES[kind]}

Para todos:
- hashtags: 3-5 específicos que describan el tema, sin # y nunca genéricos (viral, fyp, parati, explore).
- search_terms: 2-3 frases que este cliente buscaría, del cerebro de marca, y que aparezcan dentro del caption.
- Sin enlaces en el caption: no son clicables. Si hay enlace, va en first_comment o por DM.
- dm_keyword: si la petición es "comenta PALABRA y te lo envío", una sola palabra en mayúsculas sin espacios ni emojis, dicha también en el vídeo. Si no, vacío.
- Una sola petición en toda la pieza.
- Emojis solo como puntuación, nunca de viñeta.

Fórmulas de gancho:
${FORMULAS_TEXT}

Pieza: ${JSON.stringify(item)}
Cerebro de marca: ${JSON.stringify(brain)}`,
  });
}

export function revisePost({ brain, draft, kind, feedback }) {
  return ask({
    schema: DRAFT_SCHEMA,
    prompt: `Rehaz este borrador aplicando exactamente los cambios que pide el cliente. Mantén lo que no menciona y respeta las reglas del formato.

${FORMAT_RULES[kind ?? "reel"]}

Cambios pedidos: ${feedback}
Borrador actual: ${JSON.stringify(draft)}
Cerebro de marca: ${JSON.stringify(brain)}`,
  });
}

// ---------- Comentarios ----------
export const TRIAGE_SCHEMA = obj({
  items: {
    type: "array",
    items: obj({
      comment_id: str,
      bucket: { type: "string", enum: ["PALABRA", "CLIENTE", "APORTA", "PREGUNTA", "APOYO", "RUIDO"] },
      reply: str,
      reel_idea: str,
    }),
  },
});

export function triageComments({ brain, comments, keywords }) {
  return ask({
    schema: TRIAGE_SCHEMA,
    prompt: `Clasifica estos comentarios de la cuenta y redacta respuestas.
Categorías:
- PALABRA: comentó una de estas palabras clave ${JSON.stringify(keywords)}. reply: una línea cálida y distinta cada vez diciendo que se lo envías por DM.
- CLIENTE: describe el problema que resuelve la marca. reply: respuesta útil completa en público y, al final, una frase ofreciendo ayuda (no venta).
- APORTA: aporta datos, discrepa o amplía. reply: la más trabajada; ante una crítica, concede primero lo cierto con sus palabras y luego mantén la postura.
- PREGUNTA: una duda que tendrá mucha gente. reply: responde de verdad (no "te escribo por DM"). reel_idea: si merece un reel respondiendo, el gancho con la fórmula #16.
- APOYO: "genial", emojis, etiquetas. reply: 3-8 palabras como mucho.
- RUIDO: spam, autopromoción, mala fe o haters. reply vacío: responder les da alcance.
Reglas: usa el nombre una vez al principio sin exclamación, ajusta la longitud a la del comentario, voz de la marca. reel_idea vacío salvo en PREGUNTA.

Comentarios: ${JSON.stringify(comments)}
Cerebro de marca: ${JSON.stringify(brain)}`,
  });
}

// ---------- DM por palabra clave ----------
export const DM_SCHEMA = obj({ dm_text: str, public_reply: str });

export function suggestDm({ brain, keyword, offer }) {
  return ask({
    schema: DM_SCHEMA,
    prompt: `Escribe el mensaje privado automático que recibe quien comenta "${keyword}" para recibir: ${offer}.
- dm_text: entrega lo prometido en el primer mensaje, sin condiciones ni preguntas previas. Estructura: "Aquí lo tienes: ..." (el enlace se añade aparte al final), una línea sobre cómo usarlo, y una pregunta que se pueda responder en cuatro palabras. Máximo 300 caracteres. No incluyas el enlace.
- public_reply: respuesta pública corta y natural al comentario (p. ej. "Te lo acabo de mandar por DM").
Voz de la marca: ${JSON.stringify({ tone: brain.tone, voice_rules: brain.voice_rules, language: brain.language })}`,
  });
}
