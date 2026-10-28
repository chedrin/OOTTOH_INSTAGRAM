// Lee la portada y algunas páginas internas de una web y devuelve su texto visible.
const MAX_PAGES = 6;
const MAX_CHARS = 60000;

function toText(html) {
  return html
    .replace(/<(script|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function colorsFrom(html) {
  const found = html.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const counts = {};
  for (const c of found) counts[c.toLowerCase()] = (counts[c.toLowerCase()] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "CarreteBot/1.0 (+analisis de marca)" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  return res.text();
}

export async function readWebsite(website) {
  const start = new URL(website.startsWith("http") ? website : `https://${website}`);
  const home = await fetchHtml(start.href);
  if (!home) throw new Error("No se pudo leer la web. Comprueba la URL.");

  const links = [...home.matchAll(/href="([^"#]+)"/g)]
    .map((m) => {
      try { return new URL(m[1], start); } catch { return null; }
    })
    .filter((u) => u && u.host === start.host && !/\.(pdf|jpg|png|svg|webp|zip)$/i.test(u.pathname))
    .map((u) => u.origin + u.pathname);
  const pages = [...new Set(links)].filter((u) => u !== start.origin + start.pathname).slice(0, MAX_PAGES - 1);

  const parts = [`# ${start.href}\n${toText(home)}`];
  const extra = await Promise.all(pages.map((u) => fetchHtml(u).catch(() => null)));
  extra.forEach((html, i) => html && parts.push(`# ${pages[i]}\n${toText(html)}`));

  let text = parts.join("\n\n");
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS) + "\n[Contenido recortado por longitud]";
  return { url: start.href, text, colors: colorsFrom(home), pagesRead: 1 + extra.filter(Boolean).length };
}
