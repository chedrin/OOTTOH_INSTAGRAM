const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
let me = null;

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (arr) => (arr?.length ? `<ul class="clean">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">—</p>`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const toLocalInput = (d) => {
  const x = new Date(d ?? Date.now());
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const STATUS = { draft: "Borrador", approved: "Aprobado", scheduled: "Programado", publishing: "Publicando", published: "Publicado", failed: "Error" };
const KIND = { reel: "Reel", carousel: "Carrusel", story: "Story" };

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3500);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") { me.authed = false; render(); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Ejecuta una acción mostrando un indicador en el botón y un aviso al terminar.
async function busy(btn, label, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${label}`;
  try {
    return await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// ---------- vistas ----------
function loginView() {
  $nav.innerHTML = "";
  $app.innerHTML = `
    <section class="hero"><h1>Tu estudio de reels</h1><p class="muted">Entra con la contraseña de tu instalación.</p></section>
    <form class="card stack" id="login" style="max-width:380px">
      <div><label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="primary">Entrar</button>
    </form>`;
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/login", { method: "POST", body: { password: document.getElementById("pw").value } });
      me.authed = true;
      render();
    } catch (err) { toast(err.message); }
  };
}

async function homeView() {
  const brands = await api("/brands");
  $app.innerHTML = `
    <section class="hero">
      <h1>Reels que suenan a tu marca</h1>
      <p class="muted">Añade tu web: la app aprende qué vendes y cómo hablas, te da una auditoría y te prepara la semana de reels. Tú apruebas, pides cambios en lenguaje normal y decides cuándo se publica.</p>
    </section>
    ${!me.aiConfigured ? `<div class="card"><b>Falta configurar la IA.</b> <span class="muted">Define ANTHROPIC_API_KEY en las variables de entorno.</span></div>` : ""}
    <form class="card stack" id="newBrand">
      <h2>Nueva marca</h2>
      <div class="grid">
        <div><label for="bn">Nombre</label><input id="bn" required placeholder="Mi negocio"></div>
        <div><label for="bw">Web</label><input id="bw" required placeholder="https://minegocio.com"></div>
      </div>
      <div class="row"><button class="primary" id="bcreate">Analizar web y crear</button><span class="muted small">Tarda 1-2 minutos: lee la web, crea el cerebro de marca y la auditoría.</span></div>
    </form>
    <h2>Tus marcas</h2>
    <div class="grid">
      ${brands.length ? brands.map((b) => `
        <a class="card" href="#/brand/${b.id}" style="text-decoration:none;color:inherit">
          <h3>${esc(b.name)}</h3>
          <p class="muted small">${esc(b.website)}</p>
          <div class="row">${(b.brain?.colors ?? []).slice(0, 5).map((c) => `<span class="swatch" style="background:${esc(c)}"></span>`).join("")}</div>
          <p class="small">${b.ig_connected ? `Instagram: @${esc(b.ig_username)}` : `<span class="muted">Instagram sin conectar</span>`}</p>
        </a>`).join("") : `<p class="muted">Aún no hay marcas.</p>`}
    </div>`;
  document.getElementById("newBrand").onsubmit = (e) => {
    e.preventDefault();
    busy(document.getElementById("bcreate"), "Analizando…", async () => {
      const b = await api("/brands", { method: "POST", body: { name: document.getElementById("bn").value, website: document.getElementById("bw").value } });
      location.hash = `#/brand/${b.id}`;
    });
  };
}

const TABS = [
  ["overview", "Cerebro y auditoría"],
  ["queue", "Cola de aprobación"],
  ["plan", "Plan semanal"],
  ["comments", "Comentarios"],
  ["dm", "Comentario → DM"],
  ["settings", "Instagram y ajustes"],
];

async function brandView(id, tab = "overview", query) {
  const brand = await api(`/brands/${id}`);
  if (query.get("ig") === "ok") toast("Instagram conectado");
  $app.innerHTML = `
    <div class="row spread"><h1>${esc(brand.name)}</h1><span class="muted small">${brand.ig_connected ? `@${esc(brand.ig_username)}` : "Instagram sin conectar"}</span></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/brand/${id}/${k}" class="${k === tab ? "active" : ""}">${l}</a>`).join("")}</div>
    <div id="tab"></div>`;
  const el = document.getElementById("tab");
  await ({ overview, queue, plan, comments, dm, settings }[tab] ?? overview)(brand, el);
}

// ----- Cerebro y auditoría -----
async function overview(brand, el) {
  const b = brand.brain ?? {};
  const a = brand.audit ?? {};
  el.innerHTML = `
    <div class="card">
      <div class="row spread"><h2>Cerebro de marca</h2><div class="row"><button id="rebrain">Volver a leer web${brand.ig_connected ? " e Instagram" : ""}</button><button id="editBrain">Editar</button></div></div>
      <p>${esc(b.business)}</p>
      <div class="grid">
        <div><h3>Oferta</h3>${list(b.offer)}</div>
        <div><h3>Audiencia</h3><p>${esc(b.audience)}</p><h3>Tono</h3><p>${esc(b.tone)}</p></div>
        <div><h3>Reglas de voz</h3>${list(b.voice_rules)}</div>
        <div><h3>Pilares</h3>${list(b.pillars)}<h3>Lo que busca tu cliente</h3>${list(b.search_terms)}</div>
        <div><h3>Se puede afirmar</h3>${list(b.claims_allowed)}</div>
        <div><h3>Evitar</h3>${list(b.claims_avoid)}</div>
      </div>
      <div class="row"><b>Colores:</b>${(b.colors ?? []).map((c) => `<span class="swatch" title="${esc(c)}" style="background:${esc(c)}"></span>`).join("")}<b style="margin-left:12px">Llamada a la acción:</b> ${esc(b.main_cta)}</div>
      <form id="brainForm" class="stack" hidden>
        <label for="brainJson">Edita los campos (formato JSON)</label>
        <textarea id="brainJson" style="min-height:320px;font-family:monospace">${esc(JSON.stringify(b, null, 2))}</textarea>
        <button class="primary">Guardar</button>
      </form>
    </div>
    <div class="card">
      <div class="row spread"><h2>Auditoría</h2><button id="reaudit">Rehacer auditoría</button></div>
      <p>${esc(a.summary)}</p>
      ${a.confidence ? `<p class="muted small">Confianza: ${esc(a.confidence)}</p>` : ""}
      ${(a.findings ?? []).map((f, i) => `<p><b>${i + 1}. ${esc(f.claim)}</b><br><span class="muted small">${esc(f.evidence)}</span></p>`).join("")}
      <div class="grid">
        <div><h3>Haz más</h3>${list(a.do_more)}</div>
        <div><h3>Deja de hacer</h3>${list(a.stop)}</div>
      </div>
      ${a.profile ? `<h3>Tu perfil</h3><p><b>Nombre:</b> ${esc(a.profile.name_field)}</p><p style="white-space:pre-wrap"><b>Bio:</b> ${esc(a.profile.bio)}</p>${list(a.profile.notes)}` : ""}
      <h3>Primeros reels recomendados</h3>
      <div class="grid">${(a.first_reels ?? []).map((r) => `
        <div class="card" style="margin:0"><b>${esc(r.title)}</b><p><i>"${esc(r.hook)}"</i></p><p class="muted small">Fórmula #${esc(r.formula)} · ${esc(r.why)}</p>
        <button data-idea="${esc(`${r.title}. Gancho propuesto (fórmula #${r.formula}): ${r.hook}`)}">Crear borrador</button></div>`).join("")}</div>
    </div>`;
  el.querySelector("#editBrain").onclick = () => (el.querySelector("#brainForm").hidden = false);
  el.querySelector("#brainForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const brain = JSON.parse(el.querySelector("#brainJson").value);
      await api(`/brands/${brand.id}`, { method: "PATCH", body: { brain } });
      toast("Cerebro de marca guardado");
      render();
    } catch (err) { toast(err instanceof SyntaxError ? "El JSON no es válido" : err.message); }
  };
  el.querySelector("#rebrain").onclick = (e) => busy(e.target, "Leyendo…", async () => {
    await api(`/brands/${brand.id}/rebrain`, { method: "POST" });
    toast("Cerebro de marca actualizado");
    render();
  });
  el.querySelector("#reaudit").onclick = (e) => busy(e.target, "Auditando…", async () => {
    await api(`/brands/${brand.id}/audit`, { method: "POST" });
    toast("Auditoría actualizada");
    render();
  });
  el.querySelectorAll("[data-idea]").forEach((btn) => (btn.onclick = () => busy(btn, "Escribiendo…", async () => {
    await api(`/brands/${brand.id}/posts`, { method: "POST", body: { idea: btn.dataset.idea } });
    location.hash = `#/brand/${brand.id}/queue`;
  })));
}

// ----- Cola de aprobación -----
function qualityBlock(q, kind) {
  if (!q) return "";
  const items = [
    ...(q.hook ? q.hook.notes.map((n) => `Gancho: ${n}`) : []),
    ...(q.timing?.notes ?? []),
    ...q.caption.fails.map((n) => `Caption: ${n}`),
    ...q.caption.warns.map((n) => `Caption: ${n}`),
    ...q.slop,
    ...q.placeholders.map((ph) => `Falta un dato real: ${ph}`),
  ];
  const head = [
    q.hook ? `Gancho ${q.hook.score}/100 ${q.hook.label}` : null,
    q.timing ? `~${q.timing.seconds} s` : null,
    `Caption ${q.caption.status}`,
  ].filter(Boolean).join(" · ");
  return `<div class="quality ${items.length ? "warn" : "ok"}"><b>Control de calidad:</b> ${esc(head)}${items.length ? list(items) : " <span class='small'>sin avisos</span>"}</div>`;
}

const BEAT_HEAD = {
  reel: ["Tiempo", "Se ve", "Se dice", "Rótulo"],
  carousel: ["Diapositiva", "Diseño", "Texto", "Titular"],
  story: ["Fotograma", "Se ve", "Se dice", "Texto / sticker"],
};

function postCard(p, brand) {
  const d = p.draft;
  const head = BEAT_HEAD[p.kind] ?? BEAT_HEAD.reel;
  const hooks = p.quality?.hooks ?? d.hooks ?? [];
  return `
  <div class="card" data-post="${p.id}">
    <div class="row spread">
      <div class="row"><span class="pill ${p.status}">${STATUS[p.status] ?? p.status}</span><span class="pill">${KIND[p.kind] ?? p.kind}</span>
        <span class="muted small">${p.scheduled_at ? `Programado: ${fmtDate(p.scheduled_at)}` : p.suggested_at ? `Sugerido: ${fmtDate(p.suggested_at)}` : ""}</span></div>
      ${p.ig_permalink ? `<a href="${esc(p.ig_permalink)}" target="_blank" rel="noopener">Ver en Instagram</a>` : ""}
    </div>
    <h3 style="margin-top:10px">${esc(d.title)}</h3>
    ${d.beats?.[0] ? `<p class="hookline">"${esc(d.beats[0].spoken)}"</p>` : ""}
    ${qualityBlock(p.quality, p.kind)}
    <details><summary>${p.kind === "carousel" ? "Diapositivas" : p.kind === "story" ? "Fotogramas" : "Guion plano a plano"}</summary>
      <table class="shots"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
        ${(d.beats ?? []).map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.visual)}</td><td>${esc(s.spoken)}</td><td>${esc(s.on_screen)}${s.sticker ? `<br><b>${esc(s.sticker)}</b>` : ""}</td></tr>`).join("")}</table>
    </details>
    ${hooks.length ? `<details><summary>Ganchos alternativos</summary><table class="shots"><tr><th>Fórmula</th><th>Hablado</th><th>En pantalla</th><th>Nota</th></tr>
      ${hooks.map((h, i) => `<tr${i === d.chosen_hook ? ' class="chosen"' : ""}><td>#${esc(h.formula)}</td><td>${esc(h.spoken)}</td><td>${esc(h.on_screen)}</td><td>${h.score != null ? `${h.score} ${esc(h.label)}` : ""}</td></tr>`).join("")}</table>
      ${d.why_this_hook ? `<p class="muted small">${esc(d.why_this_hook)}</p>` : ""}</details>` : ""}
    <p style="white-space:pre-wrap;margin-top:10px">${esc(d.caption)}</p>
    <p class="muted small">${(d.hashtags ?? []).map((h) => `#${esc(h.replace(/^#/, ""))}`).join(" ")}${d.dm_keyword ? ` · Palabra para DM: <b>${esc(d.dm_keyword)}</b>` : ""}</p>
    ${d.first_comment ? `<p class="muted small">Primer comentario: ${esc(d.first_comment)}</p>` : ""}
    ${d.alt_text ? `<p class="muted small">Texto alternativo: ${esc(d.alt_text)}</p>` : ""}
    ${p.error ? `<p style="color:var(--bad)">${esc(p.error)}</p>` : ""}
    ${p.status === "published" ? "" : `
    <div class="stack" style="margin-top:12px">
      <div class="row"><input class="fb" placeholder="Pide cambios: «hazlo más corto y con humor», «usa el gancho 2», «menciona el envío gratis»…" style="flex:1;min-width:220px"><button class="revise">Rehacer</button></div>
      ${p.kind === "reel" ? `<div class="row"><input class="vurl" placeholder="URL pública del vídeo final (MP4, 9:16)" value="${esc(p.video_url ?? "")}" style="flex:1;min-width:220px"><button class="saveVideo">Guardar vídeo</button></div>` : ""}
      <div class="row">
        ${p.status === "draft" ? `<button class="primary approve">Aprobar</button>` : ""}
        ${["approved", "failed"].includes(p.status) && p.kind === "reel" ? `
          <input type="datetime-local" class="when" value="${toLocalInput(p.suggested_at)}" style="width:auto">
          <button class="primary schedule">Programar</button>
          <button class="publish">Publicar ahora</button>` : ""}
        ${p.status === "approved" && p.kind !== "reel" ? `<span class="muted small">Aprobado. ${p.kind === "carousel" ? "Diseña las diapositivas y publícalo desde Instagram." : "Publica la secuencia desde Instagram."}</span>` : ""}
        ${p.status === "scheduled" ? `<button class="unschedule">Quitar de la agenda</button>` : ""}
        <button class="copy">Copiar texto</button>
        <button class="danger del">Eliminar</button>
      </div>
      ${p.status === "scheduled" && !brand.autopost ? `<p class="muted small">La publicación automática está desactivada para esta marca: actívala en «Instagram y ajustes».</p>` : ""}
    </div>`}
    ${p.history?.length ? `<p class="muted small">Cambios pedidos: ${p.history.map((h) => `«${esc(h.feedback)}»`).join(" · ")}</p>` : ""}
  </div>`;
}

function draftAsText(p) {
  const d = p.draft;
  const beats = (d.beats ?? []).map((b) => `${b.label}\n  Se ve: ${b.visual}\n  Se dice: ${b.spoken}${b.on_screen ? `\n  Texto: ${b.on_screen}` : ""}${b.sticker ? `\n  Sticker: ${b.sticker}` : ""}`).join("\n\n");
  const tags = (d.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return `${d.title}\n\n${beats}\n\n---\nCAPTION\n${d.caption}${tags ? `\n\n${tags}` : ""}`;
}

async function queue(brand, el) {
  const posts = await api(`/brands/${brand.id}/posts`);
  const order = ["draft", "failed", "approved", "scheduled", "publishing", "published"];
  posts.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  el.innerHTML = `
    <form class="card row" id="newPost">
      <input id="idea" placeholder="¿Tienes una idea? Descríbela y te escribo el borrador" style="flex:1;min-width:220px" required>
      <select id="kind" style="width:auto"><option value="reel">Reel</option><option value="carousel">Carrusel</option><option value="story">Story</option></select>
      <button class="primary" id="ideaBtn">Crear borrador</button>
    </form>
    ${posts.length ? posts.map((p) => postCard(p, brand)).join("") : `<p class="muted">No hay piezas. Genera un plan semanal o crea un borrador.</p>`}`;

  el.querySelector("#newPost").onsubmit = (e) => {
    e.preventDefault();
    busy(el.querySelector("#ideaBtn"), "Escribiendo…", async () => {
      await api(`/brands/${brand.id}/posts`, { method: "POST", body: { idea: el.querySelector("#idea").value, kind: el.querySelector("#kind").value } });
      render();
    });
  };
  el.querySelectorAll("[data-post]").forEach((card) => {
    const id = card.dataset.post;
    const on = (sel, label, fn) => card.querySelector(sel) && (card.querySelector(sel).onclick = (e) => busy(e.target, label, async () => { await fn(); render(); }));
    on(".revise", "Rehaciendo…", async () => {
      const feedback = card.querySelector(".fb").value.trim();
      if (!feedback) throw new Error("Escribe qué quieres cambiar");
      await api(`/posts/${id}/revise`, { method: "POST", body: { feedback } });
      toast("Borrador rehecho");
    });
    on(".saveVideo", "Guardando…", () => api(`/posts/${id}`, { method: "PATCH", body: { video_url: card.querySelector(".vurl").value.trim() } }));
    on(".approve", "Aprobando…", () => api(`/posts/${id}/approve`, { method: "POST" }));
    on(".schedule", "Programando…", () => api(`/posts/${id}/schedule`, { method: "POST", body: { at: new Date(card.querySelector(".when").value).toISOString() } }));
    on(".unschedule", "…", () => api(`/posts/${id}/unschedule`, { method: "POST" }));
    on(".publish", "Publicando…", async () => {
      if (!confirm("¿Publicar este reel en Instagram ahora?")) return;
      const p = await api(`/posts/${id}/publish`, { method: "POST" });
      toast(p.status === "published" ? "Publicado en Instagram" : `No se pudo publicar: ${p.error}`);
    });
    on(".del", "…", async () => { if (confirm("¿Eliminar esta pieza?")) await api(`/posts/${id}`, { method: "DELETE" }); });
    const copy = card.querySelector(".copy");
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(draftAsText(posts.find((x) => String(x.id) === id))); toast("Copiado"); } catch { toast("No se pudo copiar"); }
    };
  });
}

// ----- Plan semanal -----
async function plan(brand, el) {
  const plans = await api(`/brands/${brand.id}/plans`);
  const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const TYPE = { "prueba": "Prueba", "enseña": "Enseña", "opinión": "Opinión", "historia": "Historia", "oferta": "Oferta" };
  el.innerHTML = `
    <div class="card stack">
      <h2>Planificar la próxima semana</h2>
      <div><label for="week">¿Qué ha pasado esta semana en tu negocio?</label>
        <textarea id="week" placeholder="Un cliente, una cifra, un error, algo que has lanzado, una pregunta que te han hecho… Es la mejor materia prima para los reels. Si lo dejas vacío, se planifica con tu oferta."></textarea></div>
      <div class="row">
        <div><label for="count">Piezas</label><input id="count" type="number" min="1" max="16" value="5" style="width:100px"></div>
        <button class="primary" id="gen" style="align-self:flex-end">Generar plan y borradores</button>
        <span class="muted small" style="align-self:flex-end">Tarda 1-3 minutos. Los borradores aparecerán en la cola de aprobación.</span>
      </div>
    </div>
    ${plans.map((p) => `
      <div class="card">
        <h3>Semana del ${new Date(p.week_start).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}: ${esc(p.plan.theme)}</h3>
        ${p.plan.advice ? `<p class="muted">${esc(p.plan.advice)}</p>` : ""}
        <table class="shots"><tr><th>Día</th><th>Hora</th><th>Formato</th><th>Tipo</th><th>Gancho</th><th>Pieza</th></tr>
        ${p.plan.items.map((i) => `<tr><td>${days[i.day] ?? ""}</td><td>${esc(i.time)}</td><td>${KIND[i.kind] ?? esc(i.kind)}</td><td>${TYPE[i.type] ?? esc(i.type ?? "")}</td><td>${i.formula ? `#${esc(i.formula)}` : ""}</td><td><b>${esc(i.title)}</b><br><span class="muted small">${esc(i.angle)}</span></td></tr>`).join("")}
        </table>
      </div>`).join("") || `<p class="muted">Aún no hay planes.</p>`}`;
  el.querySelector("#gen").onclick = (e) => busy(e.target, "Planificando y escribiendo…", async () => {
    const r = await api(`/brands/${brand.id}/plan`, { method: "POST", body: { count: Number(el.querySelector("#count").value), thisWeek: el.querySelector("#week").value } });
    toast(`${r.created} borradores creados${r.failed ? `, ${r.failed} fallaron` : ""}`);
    location.hash = `#/brand/${brand.id}/queue`;
  });
}

// ----- Comentarios -----
const BUCKET = {
  PALABRA: "Pidió la palabra clave", CLIENTE: "Posible cliente", APORTA: "Aporta o discrepa",
  PREGUNTA: "Pregunta", APOYO: "Apoyo", RUIDO: "Ruido (mejor no responder)",
};
async function comments(brand, el) {
  el.innerHTML = `
    <div class="card stack">
      <h2>Comentarios sin responder</h2>
      <p class="muted">Lee los comentarios de tus últimas publicaciones, los ordena por valor y te propone respuestas con tu voz. Nada se publica hasta que pulses «Responder».</p>
      <div><button class="primary" id="load" ${brand.ig_connected ? "" : "disabled"}>Revisar comentarios</button>${brand.ig_connected ? "" : ` <span class="muted small">Conecta Instagram primero.</span>`}</div>
    </div>
    <div id="list"></div>`;
  el.querySelector("#load").onclick = (e) => busy(e.target, "Leyendo y clasificando…", async () => {
    const { items } = await api(`/brands/${brand.id}/comments/triage`, { method: "POST" });
    const order = Object.keys(BUCKET);
    items.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
    const $list = el.querySelector("#list");
    if (!items.length) { $list.innerHTML = `<p class="muted">No hay comentarios pendientes.</p>`; return; }
    $list.innerHTML = items.map((c, i) => `
      <div class="card stack" data-i="${i}">
        <div class="row spread"><span class="pill">${BUCKET[c.bucket] ?? c.bucket}</span>${c.permalink ? `<a class="small" href="${esc(c.permalink)}" target="_blank" rel="noopener">Ver publicación</a>` : ""}</div>
        <p><b>@${esc(c.username)}</b>: ${esc(c.text)}</p>
        ${c.reel_idea ? `<p class="small"><b>Esto merece un reel:</b> ${esc(c.reel_idea)} <button class="mkreel">Crear borrador</button></p>` : ""}
        ${c.bucket === "RUIDO" ? "" : `<div class="row"><input class="rep" value="${esc(c.reply)}" style="flex:1;min-width:220px"><button class="primary send">Responder</button></div>`}
      </div>`).join("");
    $list.querySelectorAll("[data-i]").forEach((card) => {
      const c = items[Number(card.dataset.i)];
      const send = card.querySelector(".send");
      if (send) send.onclick = () => busy(send, "Enviando…", async () => {
        await api(`/brands/${brand.id}/comments/${c.comment_id}/reply`, { method: "POST", body: { message: card.querySelector(".rep").value } });
        card.remove();
        toast("Respondido");
      });
      const mk = card.querySelector(".mkreel");
      if (mk) mk.onclick = () => busy(mk, "Escribiendo…", async () => {
        await api(`/brands/${brand.id}/posts`, { method: "POST", body: { idea: `Responder a la pregunta de @${c.username}: "${c.text}". ${c.reel_idea}` } });
        toast("Borrador creado en la cola");
      });
    });
  });
}

// ----- Comentario → DM -----
async function dm(brand, el) {
  const { rules, log } = await api(`/brands/${brand.id}/dm-rules`);
  el.innerHTML = `
    <div class="card">
      <h2>Comentario → DM</h2>
      <p class="muted">Cuando alguien comente una palabra clave en tus publicaciones, le envías un mensaje privado con tu enlace y, si quieres, una respuesta pública.
      ${brand.dm_enabled ? "<b>Activo.</b>" : "<b>Desactivado:</b> actívalo en «Instagram y ajustes»."}</p>
      <form id="rule" class="stack">
        <div class="grid">
          <div><label for="kw">Palabra clave</label><input id="kw" placeholder="GUIA" required></div>
          <div><label for="lk">Enlace (opcional)</label><input id="lk" placeholder="https://…"></div>
        </div>
        <div><label for="dmt">Mensaje privado</label><textarea id="dmt" required placeholder="¡Hola! Aquí tienes la guía que pediste:"></textarea></div>
        <div><label for="pr">Respuesta pública (opcional)</label><input id="pr" placeholder="¡Te lo acabo de enviar por DM!"></div>
        <div class="row"><input id="offer" placeholder="¿Qué recibe? p. ej. «la guía de precios en PDF»" style="flex:1;min-width:220px"><button type="button" id="suggest">Redactar con IA</button></div>
        <p class="muted small">Entrega lo prometido en el primer mensaje, sin pedir nada antes. Solo responde a quien comenta: nunca envía mensajes a quien no ha interactuado.</p>
        <button class="primary">Añadir regla</button>
      </form>
    </div>
    ${rules.map((r) => `
      <div class="card row spread" data-rule="${r.id}">
        <div><b>${esc(r.keyword)}</b> → ${esc(r.dm_text)} ${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a>` : ""}
          ${r.public_reply ? `<div class="muted small">Respuesta pública: ${esc(r.public_reply)}</div>` : ""}</div>
        <div class="row"><button class="toggle">${r.active ? "Pausar" : "Activar"}</button><button class="danger del">Eliminar</button></div>
      </div>`).join("")}
    <div class="card"><h3>Últimos envíos</h3>
      ${log.length ? `<table class="shots"><tr><th>Fecha</th><th>Usuario</th><th>Palabra</th><th>Resultado</th></tr>
        ${log.map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td>@${esc(l.username)}</td><td>${esc(l.keyword)}</td><td>${l.ok ? "Enviado" : `<span style="color:var(--bad)">${esc(l.error ?? "Pendiente")}</span>`}</td></tr>`).join("")}</table>`
        : `<p class="muted">Todavía no hay envíos.</p>`}
    </div>`;
  el.querySelector("#suggest").onclick = (e) => busy(e.target, "Redactando…", async () => {
    const r = await api(`/brands/${brand.id}/dm-suggest`, { method: "POST", body: { keyword: el.querySelector("#kw").value, offer: el.querySelector("#offer").value } });
    el.querySelector("#dmt").value = r.dm_text;
    el.querySelector("#pr").value = r.public_reply;
  });
  el.querySelector("#rule").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/brands/${brand.id}/dm-rules`, { method: "POST", body: {
        keyword: el.querySelector("#kw").value, link: el.querySelector("#lk").value,
        dm_text: el.querySelector("#dmt").value, public_reply: el.querySelector("#pr").value,
      } });
      render();
    } catch (err) { toast(err.message); }
  };
  el.querySelectorAll("[data-rule]").forEach((row) => {
    const r = rules.find((x) => String(x.id) === row.dataset.rule);
    row.querySelector(".toggle").onclick = async () => { await api(`/dm-rules/${r.id}`, { method: "PATCH", body: { active: !r.active } }); render(); };
    row.querySelector(".del").onclick = async () => { if (confirm("¿Eliminar regla?")) { await api(`/dm-rules/${r.id}`, { method: "DELETE" }); render(); } };
  });
}

// ----- Instagram y ajustes -----
async function settings(brand, el) {
  el.innerHTML = `
    <div class="card stack">
      <h2>Instagram</h2>
      ${!me.instagramConfigured ? `<p><b>La conexión con Instagram no está configurada.</b> <span class="muted">Define INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET y PUBLIC_URL (ver README).</span></p>` : ""}
      ${brand.ig_connected
        ? `<p>Conectado como <b>@${esc(brand.ig_username)}</b>. El acceso se renueva solo.</p><div><button class="danger" id="disc">Desconectar</button></div>`
        : `<p class="muted">Conecta una cuenta profesional (empresa o creador). Inicias sesión en Instagram; la app nunca ve tu contraseña.</p><div><button class="primary" id="conn" ${me.instagramConfigured ? "" : "disabled"}>Conectar Instagram</button></div>`}
    </div>
    <div class="card stack">
      <h2>Automatización</h2>
      <label class="row" style="font-weight:400"><input type="checkbox" id="auto" style="width:auto" ${brand.autopost ? "checked" : ""} ${brand.ig_connected ? "" : "disabled"}> Publicar automáticamente los reels programados (solo los que hayas aprobado)</label>
      <label class="row" style="font-weight:400"><input type="checkbox" id="dmOn" style="width:auto" ${brand.dm_enabled ? "checked" : ""} ${brand.ig_connected ? "" : "disabled"}> Responder comentarios con palabra clave por DM</label>
    </div>
    <div class="card stack">
      <h2>Marca</h2>
      <div><label for="nm">Nombre</label><input id="nm" value="${esc(brand.name)}"></div>
      <div class="row"><button id="saveName">Guardar</button><button class="danger" id="delBrand">Eliminar marca</button></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  $("#conn") && ($("#conn").onclick = async () => { try { location.href = (await api(`/brands/${brand.id}/instagram/connect`)).url; } catch (e) { toast(e.message); } });
  $("#disc") && ($("#disc").onclick = async () => { if (confirm("¿Desconectar Instagram?")) { await api(`/brands/${brand.id}/instagram/disconnect`, { method: "POST" }); render(); } });
  $("#auto").onchange = async (e) => { await api(`/brands/${brand.id}`, { method: "PATCH", body: { autopost: e.target.checked } }); toast("Guardado"); };
  $("#dmOn").onchange = async (e) => { await api(`/brands/${brand.id}`, { method: "PATCH", body: { dm_enabled: e.target.checked } }); toast("Guardado"); };
  $("#saveName").onclick = async () => { await api(`/brands/${brand.id}`, { method: "PATCH", body: { name: $("#nm").value } }); render(); };
  $("#delBrand").onclick = async () => {
    if (confirm(`¿Eliminar ${brand.name} y todo su contenido?`)) { await api(`/brands/${brand.id}`, { method: "DELETE" }); location.hash = "#/"; }
  };
}

// ---------- router ----------
async function render() {
  if (!me) {
    me = await (await fetch("/api/me")).json();
    document.querySelector(".logo .name").textContent = me.appName;
    document.title = `${me.appName} · Estudio de reels`;
  }
  if (!me.authed) return loginView();
  $nav.innerHTML = `<a href="#/" class="${location.hash.length < 3 ? "active" : ""}">Marcas</a><a href="#" id="logout">Salir</a>`;
  document.getElementById("logout").onclick = async (e) => { e.preventDefault(); await api("/logout", { method: "POST" }); me.authed = false; render(); };
  const [route, qs] = location.hash.slice(1).split("?");
  const parts = route.split("/").filter(Boolean);
  try {
    if (parts[0] === "brand") await brandView(parts[1], parts[2], new URLSearchParams(qs));
    else await homeView();
  } catch (e) {
    $app.innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", render);
render();
