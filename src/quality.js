// Control de calidad local, sin IA: limpia huellas de texto generado y revisa
// gancho, duración y caption antes de que el borrador llegue a la cola.

const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁯﻿\u{E0000}-\u{E007F}]/gu;
const ODD_SPACES = /[   ]/g;

export function clean(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(INVISIBLE, "")
    .replace(ODD_SPACES, " ")
    .replace(/\s*—\s*/g, ", ") // raya larga -> coma
    .replace(/–/g, "-")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/,\s*([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ");
}

// Aplica clean() a todas las cadenas de un objeto (borrador completo).
export function cleanDeep(value) {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)]));
  return value;
}

// Frases que delatan texto de plantilla o de IA en español (se señalan, no se reescriben).
const SLOP = [
  "en el mundo actual", "en la era digital", "sin lugar a dudas", "cabe destacar", "es importante destacar",
  "sumérgete", "adéntrate", "desbloquea", "potencia tu", "lleva tu", "al siguiente nivel", "revoluciona",
  "descubre cómo", "no te lo pierdas", "el secreto mejor guardado", "un antes y un después", "game changer",
  "sígueme para más", "sigueme para mas", "etiqueta a alguien", "dale like", "doble tap", "en este vídeo",
  "en este video", "hola a todos", "hola chicos", "bienvenidos", "el algoritmo", "corre a", "no es solo",
  "transformar tu", "viaje", "sinergia", "robusto", "holístico", "fascinante", "apasionante",
];
const STRUCTURE = [
  [/\bno es solo\b.*\bes\b/i, "Estructura «no es solo X, es Y»"],
  [/^[^\n]{0,20}\?\s*$/m, "Pregunta retórica de una línea («¿El resultado?»)"],
  [/(^|\n)\s*[\u{1F300}-\u{1FAFF}☀-➿]\s/mu, "Lista con emojis como viñetas"],
  [/(\b[A-ZÁÉÍÓÚÑ]{3,}\b\s+){3,}/, "Tres o más palabras seguidas en mayúsculas"],
];

export function slopFlags(text) {
  const lower = String(text ?? "").toLowerCase();
  const hits = SLOP.filter((p) => lower.includes(p)).map((p) => `Frase de plantilla: «${p}»`);
  for (const [re, label] of STRUCTURE) if (re.test(text ?? "")) hits.push(label);
  return hits;
}

const NUMBER_WORDS = /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|mil|millón|millones|doble|triple|mitad)\b/i;
const STAKES = /\b(deja|dejar|nunca|nadie|error|errores|perd[ií]|perder|cost[óo]|cuesta|gratis|pagu[ée]|ahorr|mal|peor|mentira|verdad|secreto|antes|hasta|sin|solo|en vez|deber[ií]as|todav[ií]a|ya|contra|realmente|no)\b/i;
const OPENERS = /^(hola|hey|buenas|bienvenid|en este v[ií]deo|hoy (os|te) (voy|traigo)|soy )/i;
const YOU = /\b(t[uú]|te|ti|tu|tus|usted|vosotros|os)\b/i;

// Puntuación 0-100 de un gancho hablado. Heurística local: detecta ganchos
// flojos (saludos, nada concreto, demasiado largos); no predice visualizaciones.
export function hookScore(line) {
  const text = String(line ?? "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const notes = [];
  let score = 0;

  const seconds = words.length / 2.7;
  if (seconds <= 3) score += 25;
  else if (seconds <= 4.5) { score += 12; notes.push("Tarda más de 3 s en decirse"); }
  else notes.push("Demasiado largo para los 2-3 primeros segundos");

  if (/\d/.test(text) || NUMBER_WORDS.test(text) || /[€$%]/.test(text)) score += 25;
  else notes.push("Sin nada concreto: añade una cifra, un nombre o un plazo");

  if (STAKES.test(text)) score += 20;
  else notes.push("No hay nada en juego: falta tensión o coste");

  if (OPENERS.test(text)) notes.push("Empieza con saludo o presentación: córtalo");
  else score += 15;

  if (YOU.test(text) || /^(yo|me|mi)\b/i.test(text) || /\b(me|mi|mis)\b/i.test(text)) score += 15;
  else notes.push("No se dirige a nadie: usa «tú» o cuenta algo tuyo");

  return { score, label: score >= 70 ? "FUERTE" : score >= 50 ? "OK" : "FLOJO", notes };
}

const WPS = 2.7; // palabras por segundo al hablar en español, aprox. 160 ppm

export function reelTiming(beats) {
  const notes = [];
  let total = 0;
  beats.forEach((b, i) => {
    const s = String(b.spoken ?? "").split(/\s+/).filter(Boolean).length / WPS;
    total += s;
    if (i === 0 && s > 3) notes.push(`El gancho dura ${s.toFixed(1)} s (máx. 3 s)`);
    if (i > 0 && s > 4.5) notes.push(`El bloque ${i + 1} dura ${s.toFixed(1)} s: divídelo o cambia de plano`);
    if (String(b.on_screen ?? "").split(/\s+/).filter(Boolean).length > 6) notes.push(`Rótulo del bloque ${i + 1} con más de 6 palabras`);
  });
  if (total < 7) notes.push("Menos de 7 s: demasiado corto");
  if (total > 60) notes.push(`Dura ~${Math.round(total)} s: apunta a 15-45 s`);
  return { seconds: Math.round(total), notes };
}

const ASKS = /\b(comenta|guarda|gu[aá]rdalo|s[ií]gueme|sigue a|escr[ií]beme|m[aá]ndame|env[ií]ame|link en (la )?bio|enlace en (la )?bio|comp[aá]rtelo|reserva|compra)\b/gi;
const DEAD_TAGS = new Set(["viral", "fyp", "foryou", "parati", "explorepage", "explore", "instagood", "reels", "reel"]);
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/gu;

export function captionLint(caption, hashtags = [], searchTerms = []) {
  const text = String(caption ?? "");
  const fails = [];
  const warns = [];
  const first = text.split("\n")[0];
  if (/^\s*(#|[\u{1F300}-\u{1FAFF}☀-➿])/u.test(text)) fails.push("Empieza con hashtag o emoji");
  if (OPENERS.test(first)) fails.push("La primera línea es un saludo");
  if (text.slice(0, 125).trim().length < 40) warns.push("La parte visible antes de «más» es muy corta");
  if (/https?:\/\/|www\./i.test(text)) fails.push("Hay un enlace: en Instagram no es clicable, llévalo a la bio o al DM");
  const asks = new Set((text.match(ASKS) ?? []).map((a) => a.toLowerCase()));
  if (asks.size === 0) warns.push("No hay llamada a la acción");
  if (asks.size > 1) warns.push(`Varias llamadas a la acción (${[...asks].join(", ")}): deja una`);
  if (hashtags.length > 5) fails.push(`${hashtags.length} hashtags: Instagram admite 5 como máximo`);
  const dead = hashtags.filter((h) => DEAD_TAGS.has(h.replace(/^#/, "").toLowerCase()));
  if (dead.length) warns.push(`Hashtags que no describen nada: ${dead.join(", ")}`);
  const emojis = (text.match(EMOJI) ?? []).length;
  if (text.length && emojis / (text.length / 100) > 4) warns.push("Demasiados emojis");
  if (text.length > 2200) fails.push("Supera 2.200 caracteres");
  const missing = searchTerms.filter((t) => !text.toLowerCase().includes(t.toLowerCase()));
  if (missing.length) warns.push(`Términos de búsqueda que no aparecen en el texto: ${missing.join(", ")}`);
  return { visible: text.slice(0, 125), fails, warns, status: fails.length ? "REVISAR" : "LISTO" };
}

// Calcula el informe de calidad de un borrador completo.
export function review(draft, kind) {
  const all = [draft.caption, ...(draft.beats ?? []).flatMap((b) => [b.spoken, b.on_screen, b.visual])].join("\n");
  const hooks = (draft.hooks ?? []).map((h) => ({ ...h, ...hookScore(h.spoken) }));
  return {
    hooks,
    hook: kind === "reel" ? hookScore(draft.beats?.[0]?.spoken ?? draft.hook) : null,
    timing: kind === "reel" ? reelTiming(draft.beats ?? []) : null,
    caption: captionLint(draft.caption, draft.hashtags, draft.search_terms),
    slop: slopFlags(all),
    placeholders: (all.match(/\{\{[^}]+\}\}/g) ?? []),
  };
}
