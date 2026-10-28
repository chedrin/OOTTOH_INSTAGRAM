import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { migrate, one, many, q } from "./db.js";
import * as ai from "./ai.js";
import * as ig from "./instagram.js";
import { readWebsite } from "./website.js";
import { review } from "./quality.js";
import { startScheduler, publishPost } from "./scheduler.js";

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const PASSWORD = process.env.APP_PASSWORD;
const APP_NAME = process.env.APP_NAME || "AIPEX DIGITAL";
if (!PASSWORD) console.warn("Aviso: APP_PASSWORD no está definida; la app no dejará iniciar sesión.");

// ---------- Sesión sencilla con cookie firmada ----------
const sign = (v) => `${v}.${crypto.createHmac("sha256", SECRET).update(v).digest("base64url")}`;
const unsign = (s) => {
  const i = s?.lastIndexOf(".") ?? -1;
  if (i < 0) return null;
  const v = s.slice(0, i);
  const a = Buffer.from(sign(v));
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
};
const cookie = (req, name) =>
  Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)))[name];
const secure = () => ig.publicUrl().startsWith("https");

function setSession(res) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  res.setHeader(
    "Set-Cookie",
    `aipex=${encodeURIComponent(sign(`ok:${exp}`))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${secure() ? "; Secure" : ""}`,
  );
}
function authed(req) {
  const v = unsign(cookie(req, "aipex"));
  return v?.startsWith("ok:") && Number(v.slice(3)) > Date.now();
}
const requireAuth = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "No autorizado" }));

// El webhook de Instagram necesita el cuerpo sin procesar para verificar la firma.
app.use("/webhooks/instagram", express.raw({ type: "*/*", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public")));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message || "Error inesperado" });
  });

// ---------- Auth ----------
// Límite sencillo contra intentos repetidos de contraseña: 10 por IP cada 15 minutos.
const attempts = new Map();
app.set("trust proxy", 1);
app.post("/api/login", (req, res) => {
  const now = Date.now();
  const a = attempts.get(req.ip)?.filter((t) => now - t < 15 * 60 * 1000) ?? [];
  if (a.length >= 10) return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
  attempts.set(req.ip, [...a, now]);
  const given = Buffer.from(String(req.body?.password ?? ""));
  const want = Buffer.from(PASSWORD ?? crypto.randomBytes(16).toString("hex"));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: "Contraseña incorrecta" });
  attempts.delete(req.ip);
  setSession(res);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "aipex=; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) =>
  res.json({
    authed: authed(req),
    appName: APP_NAME,
    instagramConfigured: ig.isConfigured(),
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  }),
);

app.use("/api", (req, res, next) => (req.path.startsWith("/instagram/callback") ? next() : requireAuth(req, res, next)));

// ---------- Marcas ----------
const publicBrand = ({ ig_token, ...b }) => ({ ...b, ig_connected: Boolean(ig_token) });
const getBrand = (id) => one("SELECT * FROM brands WHERE id = $1", [id]);

app.get("/api/brands", wrap(async (req, res) => {
  res.json((await many("SELECT * FROM brands ORDER BY created_at")).map(publicBrand));
}));

// Perfil y publicaciones recientes con métricas; outlier = visualizaciones / mediana de la cuenta.
async function igSnapshot(brand) {
  if (!brand.ig_token) return {};
  const profile = await ig.getProfile(brand.ig_token);
  const media = await ig.getRecentMedia(brand.ig_token, 30);
  const rows = await mapLimit(media, 5, async (m) => {
    const isReel = m.media_product_type === "REELS";
    const ins = await ig.getInsights(m.id, brand.ig_token, isReel);
    return {
      date: m.timestamp?.slice(0, 10),
      format: isReel ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carrusel" : "imagen",
      caption: (m.caption ?? "").slice(0, 300),
      likes: m.like_count,
      comments: m.comments_count,
      ...ins,
    };
  });
  const views = rows.map((r) => r.views).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)] || 1 : null;
  for (const r of rows) {
    if (median && typeof r.views === "number") r.outlier = Number((r.views / median).toFixed(2));
    if (r.reach) r.sends_per_reach = Number(((r.shares ?? 0) / r.reach).toFixed(4));
  }
  return { profile, media: rows, captions: media.map((m) => m.caption).filter(Boolean).slice(0, 15) };
}

app.post("/api/brands", wrap(async (req, res) => {
  const { name, website } = req.body ?? {};
  if (!name || !website) return res.status(400).json({ error: "Indica nombre y web" });
  const site = await readWebsite(website);
  const brain = await ai.buildBrain({ name, website: site.url, siteText: `Colores detectados: ${site.colors.join(", ")}\n\n${site.text}` });
  const audit = await ai.buildAudit({ brain });
  const brand = await one("INSERT INTO brands (name, website, brain, audit) VALUES ($1,$2,$3,$4) RETURNING *", [name, site.url, brain, audit]);
  res.json(publicBrand(brand));
}));

app.get("/api/brands/:id", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marca no encontrada" });
  res.json(publicBrand(brand));
}));

app.patch("/api/brands/:id", wrap(async (req, res) => {
  const { name, brain, autopost, dm_enabled } = req.body ?? {};
  const brand = await one(
    `UPDATE brands SET name = COALESCE($2, name), brain = COALESCE($3, brain),
       autopost = COALESCE($4, autopost), dm_enabled = COALESCE($5, dm_enabled)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, brain ?? null, autopost ?? null, dm_enabled ?? null],
  );
  res.json(publicBrand(brand));
}));

app.delete("/api/brands/:id", wrap(async (req, res) => {
  await q("DELETE FROM brands WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/brands/:id/rebrain", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const site = await readWebsite(brand.website);
  const snap = await igSnapshot(brand);
  const brain = await ai.buildBrain({
    name: brand.name, website: site.url, siteText: `Colores detectados: ${site.colors.join(", ")}\n\n${site.text}`,
    igProfile: snap.profile, igCaptions: snap.captions,
  });
  res.json(publicBrand(await one("UPDATE brands SET brain = $2 WHERE id = $1 RETURNING *", [brand.id, brain])));
}));

app.post("/api/brands/:id/audit", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const snap = await igSnapshot(brand);
  const audit = await ai.buildAudit({ brain: brand.brain, igProfile: snap.profile, igMedia: snap.media });
  res.json(publicBrand(await one("UPDATE brands SET audit = $2 WHERE id = $1 RETURNING *", [brand.id, audit])));
}));

// ---------- Plan semanal ----------
function nextMonday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i).catch((e) => ({ error: e.message }));
    }
  }));
  return out;
}

app.post("/api/brands/:id/plan", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const count = Math.min(Math.max(Number(req.body?.count) || 5, 1), 16);
  const recent = await many("SELECT draft->>'title' AS t FROM posts WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 40", [brand.id]);
  const thisWeek = String(req.body?.thisWeek ?? "").slice(0, 4000);
  const plan = await ai.buildWeeklyPlan({ brain: brand.brain, audit: brand.audit, count, recentTitles: recent.map((r) => r.t), thisWeek });
  const monday = nextMonday();
  const saved = await one("INSERT INTO plans (brand_id, week_start, plan) VALUES ($1,$2,$3) RETURNING *", [brand.id, monday, plan]);

  const drafts = await mapLimit(plan.items, 4, (item) => ai.draftPost({ brain: brand.brain, item }));
  let created = 0;
  for (const [i, item] of plan.items.entries()) {
    if (drafts[i]?.error) continue;
    const [h, m] = (item.time || "18:00").split(":").map(Number);
    const when = new Date(monday);
    when.setUTCDate(when.getUTCDate() + (item.day ?? i));
    when.setUTCHours(h || 18, m || 0);
    await q("INSERT INTO posts (brand_id, plan_id, kind, draft, quality, suggested_at) VALUES ($1,$2,$3,$4,$5,$6)", [
      brand.id, saved.id, item.kind, drafts[i], review(drafts[i], item.kind), when,
    ]);
    created++;
  }
  res.json({ plan: saved, created, failed: plan.items.length - created });
}));

app.get("/api/brands/:id/plans", wrap(async (req, res) => {
  res.json(await many("SELECT * FROM plans WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 10", [req.params.id]));
}));

// ---------- Piezas (cola de aprobación) ----------
app.get("/api/brands/:id/posts", wrap(async (req, res) => {
  res.json(await many("SELECT * FROM posts WHERE brand_id = $1 ORDER BY COALESCE(scheduled_at, suggested_at, created_at)", [req.params.id]));
}));

app.post("/api/brands/:id/posts", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const { idea, kind = "reel" } = req.body ?? {};
  if (!idea) return res.status(400).json({ error: "Describe la idea" });
  if (!["reel", "carousel", "story"].includes(kind)) return res.status(400).json({ error: "Formato no válido" });
  const draft = await ai.draftPost({ brain: brand.brain, item: { kind, title: idea, angle: idea } });
  res.json(await one("INSERT INTO posts (brand_id, kind, draft, quality) VALUES ($1,$2,$3,$4) RETURNING *", [brand.id, kind, draft, review(draft, kind)]));
}));

const getPost = (id) => one("SELECT * FROM posts WHERE id = $1", [id]);

app.patch("/api/posts/:id", wrap(async (req, res) => {
  const { draft, video_url } = req.body ?? {};
  const post = await getPost(req.params.id);
  if (video_url && !/^https:\/\/\S+$/i.test(video_url)) return res.status(400).json({ error: "La URL del vídeo debe ser pública y empezar por https://" });
  res.json(await one(
    "UPDATE posts SET draft = COALESCE($2, draft), quality = COALESCE($3, quality), video_url = COALESCE($4, video_url), updated_at = now() WHERE id = $1 RETURNING *",
    [post.id, draft ?? null, draft ? review(draft, post.kind) : null, video_url ?? null],
  ));
}));

app.post("/api/posts/:id/revise", wrap(async (req, res) => {
  const post = await getPost(req.params.id);
  const brand = await getBrand(post.brand_id);
  const feedback = String(req.body?.feedback ?? "").trim();
  if (!feedback) return res.status(400).json({ error: "Escribe qué quieres cambiar" });
  const draft = await ai.revisePost({ brain: brand.brain, draft: post.draft, kind: post.kind, feedback });
  const history = [...post.history, { at: new Date(), feedback, previous: post.draft }];
  res.json(await one(
    "UPDATE posts SET draft = $2, quality = $3, history = $4, status = 'draft', updated_at = now() WHERE id = $1 RETURNING *",
    [post.id, draft, review(draft, post.kind), JSON.stringify(history)],
  ));
}));

app.post("/api/posts/:id/approve", wrap(async (req, res) => {
  res.json(await one("UPDATE posts SET status = 'approved', updated_at = now() WHERE id = $1 RETURNING *", [req.params.id]));
}));

app.post("/api/posts/:id/schedule", wrap(async (req, res) => {
  const post = await getPost(req.params.id);
  if (!["approved", "scheduled", "failed"].includes(post.status)) return res.status(400).json({ error: "Aprueba la pieza antes de programarla" });
  if (!post.video_url) return res.status(400).json({ error: "Añade la URL pública del vídeo antes de programar" });
  const when = req.body?.at ? new Date(req.body.at) : post.suggested_at ?? new Date();
  res.json(await one("UPDATE posts SET status = 'scheduled', scheduled_at = $2, error = NULL, updated_at = now() WHERE id = $1 RETURNING *", [post.id, when]));
}));

app.post("/api/posts/:id/unschedule", wrap(async (req, res) => {
  res.json(await one("UPDATE posts SET status = 'approved', scheduled_at = NULL, updated_at = now() WHERE id = $1 AND status = 'scheduled' RETURNING *", [req.params.id]));
}));

app.post("/api/posts/:id/publish", wrap(async (req, res) => {
  const post = await getPost(req.params.id);
  if (!["approved", "scheduled", "failed"].includes(post.status)) return res.status(400).json({ error: "Aprueba la pieza antes de publicarla" });
  res.json(await publishPost(post));
}));

app.delete("/api/posts/:id", wrap(async (req, res) => {
  await q("DELETE FROM posts WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Comentario → DM ----------
app.get("/api/brands/:id/dm-rules", wrap(async (req, res) => {
  const rules = await many("SELECT * FROM dm_rules WHERE brand_id = $1 ORDER BY id", [req.params.id]);
  const log = await many("SELECT * FROM dm_log WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 50", [req.params.id]);
  res.json({ rules, log });
}));
app.post("/api/brands/:id/dm-rules", wrap(async (req, res) => {
  const { keyword, public_reply, dm_text, link } = req.body ?? {};
  if (!keyword || !dm_text) return res.status(400).json({ error: "Palabra clave y mensaje son obligatorios" });
  res.json(await one(
    "INSERT INTO dm_rules (brand_id, keyword, public_reply, dm_text, link) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [req.params.id, keyword.trim().toUpperCase(), public_reply || null, dm_text, link || null],
  ));
}));
app.patch("/api/dm-rules/:id", wrap(async (req, res) => {
  res.json(await one("UPDATE dm_rules SET active = $2 WHERE id = $1 RETURNING *", [req.params.id, Boolean(req.body?.active)]));
}));
app.delete("/api/dm-rules/:id", wrap(async (req, res) => {
  await q("DELETE FROM dm_rules WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));

app.post("/api/brands/:id/dm-suggest", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const { keyword, offer } = req.body ?? {};
  if (!keyword || !offer) return res.status(400).json({ error: "Indica la palabra clave y qué recibe la persona" });
  res.json(await ai.suggestDm({ brain: brand.brain, keyword, offer }));
}));

// ---------- Comentarios ----------
app.post("/api/brands/:id/comments/triage", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  if (!brand.ig_token) return res.status(400).json({ error: "Conecta Instagram primero" });
  const media = (await ig.getRecentMedia(brand.ig_token, 6)).filter((m) => m.comments_count > 0);
  const comments = [];
  for (const m of media) {
    for (const c of await ig.getComments(m.id, brand.ig_token)) {
      if (c.username === brand.ig_username) continue;
      const answered = (c.replies?.data ?? []).some((r) => r.username === brand.ig_username);
      if (!answered) comments.push({ comment_id: c.id, username: c.username, text: c.text, likes: c.like_count, post: (m.caption ?? "").slice(0, 80), permalink: m.permalink });
    }
  }
  if (!comments.length) return res.json({ items: [] });
  const keywords = (await many("SELECT keyword FROM dm_rules WHERE brand_id = $1 AND active", [brand.id])).map((r) => r.keyword);
  const batch = comments.slice(0, 80);
  const { items } = await ai.triageComments({ brain: brand.brain, comments: batch.map(({ permalink, ...c }) => c), keywords });
  const byId = Object.fromEntries(batch.map((c) => [c.comment_id, c]));
  res.json({ items: items.filter((i) => byId[i.comment_id]).map((i) => ({ ...byId[i.comment_id], ...i })) });
}));

app.post("/api/brands/:id/comments/:cid/reply", wrap(async (req, res) => {
  const brand = await getBrand(req.params.id);
  const message = String(req.body?.message ?? "").trim();
  if (!brand.ig_token || !message) return res.status(400).json({ error: "Falta el texto o la conexión con Instagram" });
  await ig.replyToComment(req.params.cid, brand.ig_token, message);
  res.json({ ok: true });
}));

// ---------- Conexión con Instagram ----------
app.get("/api/brands/:id/instagram/connect", (req, res) => {
  if (!ig.isConfigured()) return res.status(400).json({ error: "Faltan INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET o PUBLIC_URL" });
  res.json({ url: ig.authorizeUrl(sign(`brand:${req.params.id}`)) });
});

app.get("/api/instagram/callback", wrap(async (req, res) => {
  const state = unsign(String(req.query.state ?? ""));
  if (!state?.startsWith("brand:") || !authed(req)) return res.status(400).send("Enlace de conexión no válido. Vuelve a intentarlo desde la app.");
  if (req.query.error) return res.redirect(`/#/brand/${state.slice(6)}?ig=cancelado`);
  const { token, expiresAt } = await ig.exchangeCode(String(req.query.code));
  const profile = await ig.getProfile(token);
  const brandId = state.slice(6);
  await q("UPDATE brands SET ig_token = $2, ig_token_expires = $3, ig_user_id = $4, ig_username = $5 WHERE id = $1", [
    brandId, token, expiresAt, String(profile.user_id), profile.username,
  ]);
  res.redirect(`/#/brand/${brandId}?ig=ok`);
}));

app.post("/api/brands/:id/instagram/disconnect", wrap(async (req, res) => {
  const brand = await one(
    "UPDATE brands SET ig_token = NULL, ig_token_expires = NULL, ig_user_id = NULL, ig_username = NULL, autopost = false, dm_enabled = false WHERE id = $1 RETURNING *",
    [req.params.id],
  );
  res.json(publicBrand(brand));
}));

// ---------- Webhook de Instagram (comentarios) ----------
app.get("/webhooks/instagram", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhooks/instagram", (req, res) => {
  if (!ig.verifySignature(req.body, req.get("x-hub-signature-256"))) return res.sendStatus(401);
  res.sendStatus(200);
  handleWebhook(JSON.parse(req.body.toString("utf8"))).catch((e) => console.error("webhook", e));
});

async function handleWebhook(payload) {
  for (const entry of payload.entry ?? []) {
    const brand = await one("SELECT * FROM brands WHERE ig_user_id = $1", [String(entry.id)]);
    if (!brand?.dm_enabled || !brand.ig_token) continue;
    const rules = await many("SELECT * FROM dm_rules WHERE brand_id = $1 AND active", [brand.id]);
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const c = change.value;
      if (!c?.id || String(c.from?.id) === brand.ig_user_id) continue;
      const words = String(c.text ?? "").toUpperCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const rule = rules.find((r) => words.includes(r.keyword));
      if (!rule) continue;
      const claimed = await one(
        "INSERT INTO dm_log (brand_id, comment_id, username, keyword, ok) VALUES ($1,$2,$3,$4,false) ON CONFLICT (comment_id) DO NOTHING RETURNING id",
        [brand.id, c.id, c.from?.username ?? null, rule.keyword],
      );
      if (!claimed) continue;
      try {
        const text = rule.link ? `${rule.dm_text}\n${rule.link}` : rule.dm_text;
        await ig.sendPrivateReply(brand.ig_user_id, brand.ig_token, c.id, text);
        if (rule.public_reply) await ig.replyToComment(c.id, brand.ig_token, rule.public_reply);
        await q("UPDATE dm_log SET ok = true WHERE id = $1", [claimed.id]);
      } catch (e) {
        await q("UPDATE dm_log SET error = $2 WHERE id = $1", [claimed.id, e.message]);
      }
    }
  }
}

app.get("/healthz", (req, res) => res.send("ok"));

await migrate();
startScheduler();
app.listen(PORT, () => console.log(`${APP_NAME} escuchando en el puerto ${PORT}`));
