import { one, many, q } from "./db.js";
import * as ig from "./instagram.js";

const captionOf = (draft) =>
  [draft.caption, (draft.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ")].filter(Boolean).join("\n\n");

export async function publishPost(post) {
  const brand = await one("SELECT * FROM brands WHERE id = $1", [post.brand_id]);
  if (!brand?.ig_token) throw new Error("Conecta Instagram antes de publicar");
  if (post.kind !== "reel") throw new Error("Por ahora solo se publican reels automáticamente; los carruseles y stories se publican a mano");
  if (!post.video_url) throw new Error("Falta la URL pública del vídeo");

  // Marca la pieza como "publicando" solo si nadie más lo ha hecho, para no publicar dos veces.
  const claimed = await one(
    "UPDATE posts SET status = 'publishing', updated_at = now() WHERE id = $1 AND status IN ('approved','scheduled','failed') RETURNING id",
    [post.id],
  );
  if (!claimed) throw new Error("La pieza ya se está publicando");
  try {
    const media = await ig.publishReel({ igUserId: brand.ig_user_id, token: brand.ig_token, videoUrl: post.video_url, caption: captionOf(post.draft) });
    return await one(
      "UPDATE posts SET status = 'published', published_at = now(), ig_media_id = $2, ig_permalink = $3, error = NULL, updated_at = now() WHERE id = $1 RETURNING *",
      [post.id, media.id, media.permalink],
    );
  } catch (e) {
    return await one("UPDATE posts SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 RETURNING *", [post.id, e.message]);
  }
}

async function tick() {
  const due = await many(
    `SELECT p.* FROM posts p JOIN brands b ON b.id = p.brand_id
     WHERE p.status = 'scheduled' AND p.scheduled_at <= now() AND b.autopost AND b.ig_token IS NOT NULL
     ORDER BY p.scheduled_at LIMIT 5`,
  );
  for (const post of due) await publishPost(post).catch((e) => console.error("publicar", post.id, e.message));

  // Renueva tokens de Instagram que caducan en menos de 7 días.
  const expiring = await many("SELECT id, ig_token FROM brands WHERE ig_token IS NOT NULL AND ig_token_expires < now() + interval '7 days'");
  for (const b of expiring) {
    try {
      const { token, expiresAt } = await ig.refreshToken(b.ig_token);
      await q("UPDATE brands SET ig_token = $2, ig_token_expires = $3 WHERE id = $1", [b.id, token, expiresAt]);
    } catch (e) {
      console.error("renovar token", b.id, e.message);
    }
  }
}

export function startScheduler() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (e) { console.error("scheduler", e); } finally { running = false; }
  }, 60_000);
}
