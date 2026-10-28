import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL (cadena de conexión de PostgreSQL).");
  process.exit(1);
}

// La URL interna de Render (host sin dominio, p. ej. dpg-xxxx-a) no usa SSL; las externas sí.
const host = new URL(connectionString).hostname;
const useSsl = process.env.PGSSL ? process.env.PGSSL === "on" : host.includes(".") && !/^(localhost|127\.0\.0\.1)$/.test(host);
export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      website TEXT,
      brain JSONB,
      audit JSONB,
      ig_user_id TEXT,
      ig_username TEXT,
      ig_token TEXT,
      ig_token_expires TIMESTAMPTZ,
      autopost BOOLEAN NOT NULL DEFAULT false,
      dm_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      plan JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      plan_id INT REFERENCES plans(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'reel',
      status TEXT NOT NULL DEFAULT 'draft',
      draft JSONB NOT NULL,
      history JSONB NOT NULL DEFAULT '[]',
      video_url TEXT,
      suggested_at TIMESTAMPTZ,
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      ig_media_id TEXT,
      ig_permalink TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dm_rules (
      id SERIAL PRIMARY KEY,
      brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      public_reply TEXT,
      dm_text TEXT NOT NULL,
      link TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS dm_log (
      id SERIAL PRIMARY KEY,
      brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      comment_id TEXT NOT NULL UNIQUE,
      username TEXT,
      keyword TEXT,
      ok BOOLEAN NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS quality JSONB;
    CREATE INDEX IF NOT EXISTS posts_due_idx ON posts (status, scheduled_at);
  `);
}
