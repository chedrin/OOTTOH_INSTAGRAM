import crypto from "node:crypto";

// Instagram API con inicio de sesión de Instagram (cuentas profesionales: empresa o creador).
const GRAPH = process.env.INSTAGRAM_GRAPH_URL || "https://graph.instagram.com/v23.0";
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
  "instagram_business_manage_insights",
].join(",");

// En Render, RENDER_EXTERNAL_URL se define solo; PUBLIC_URL permite usar un dominio propio.
export const publicUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

const env = () => ({
  appId: process.env.INSTAGRAM_APP_ID,
  appSecret: process.env.INSTAGRAM_APP_SECRET,
  redirectUri: `${publicUrl()}/api/instagram/callback`,
});

export const isConfigured = () => Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && publicUrl());

export function authorizeUrl(state) {
  const { appId, redirectUri } = env();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

async function call(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.message || body.error_message || `HTTP ${res.status}`;
    throw new Error(`Instagram: ${msg}`);
  }
  return body;
}

// Intercambia el código por un token de larga duración (~60 días).
export async function exchangeCode(code) {
  const { appId, appSecret, redirectUri } = env();
  const short = await call("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const long = await call(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    })}`,
  );
  return { token: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000) };
}

export async function refreshToken(token) {
  const r = await call(
    `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`,
  );
  return { token: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
}

const get = (path, token, fields) =>
  call(`${GRAPH}/${path}?${new URLSearchParams({ ...(fields ? { fields } : {}), access_token: token })}`);

export const getProfile = (token) =>
  get("me", token, "user_id,username,name,biography,website,followers_count,follows_count,media_count");

export async function getRecentMedia(token, limit = 20) {
  const r = await call(
    `${GRAPH}/me/media?${new URLSearchParams({
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: String(limit),
      access_token: token,
    })}`,
  );
  return r.data ?? [];
}

// Métricas por publicación (requiere instagram_business_manage_insights). Si falla, devuelve {}.
export async function getInsights(mediaId, token, isReel) {
  const metrics = isReel
    ? "views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time"
    : "views,reach,saved,shares,total_interactions";
  try {
    const res = await call(`${GRAPH}/${mediaId}/insights?${new URLSearchParams({ metric: metrics, access_token: token })}`);
    return Object.fromEntries((res.data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? null]));
  } catch {
    return {};
  }
}

export async function getComments(mediaId, token) {
  const r = await call(
    `${GRAPH}/${mediaId}/comments?${new URLSearchParams({ fields: "id,text,username,timestamp,like_count,replies{id,username}", limit: "50", access_token: token })}`,
  );
  return r.data ?? [];
}

const post = (path, token, params) =>
  call(`${GRAPH}/${path}`, { method: "POST", body: new URLSearchParams({ ...params, access_token: token }) });

// Publica un reel a partir de una URL pública de vídeo (MP4/MOV, 9:16).
export async function publishReel({ igUserId, token, videoUrl, caption }) {
  const container = await post(`${igUserId}/media`, token, { media_type: "REELS", video_url: videoUrl, caption });
  for (let i = 0; i < 60; i++) {
    const { status_code } = await get(container.id, token, "status_code");
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram no pudo procesar el vídeo (${status_code}).`);
    if (i === 59) throw new Error("Instagram tardó demasiado en procesar el vídeo.");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const published = await post(`${igUserId}/media_publish`, token, { creation_id: container.id });
  const media = await get(published.id, token, "permalink");
  return { id: published.id, permalink: media.permalink };
}

export const replyToComment = (commentId, token, message) => post(`${commentId}/replies`, token, { message });

// Respuesta privada: envía un DM a quien comentó (válido hasta 7 días después del comentario).
export const sendPrivateReply = (igUserId, token, commentId, text) =>
  call(`${GRAPH}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });

export function verifySignature(rawBody, header) {
  if (!header || !process.env.INSTAGRAM_APP_SECRET) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.INSTAGRAM_APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
