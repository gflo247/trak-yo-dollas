-- trak-yo-dollas D1 schema
-- Apply: wrangler d1 execute trak-yo-dollas-db --file=db/schema.sql
-- (also run against the dev db:
--   wrangler d1 execute trak-yo-dollas-db-dev --file=db/schema.sql)

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- UUID, generated on first sign-in
  email      TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

-- One-time magic-link tokens; expire in 15 minutes and can only be used once.
CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Session tokens returned after a successful magic-link verify; expire in 30 days.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Per-user PBKDF2 salt for client-side AES-256-GCM key derivation.
-- The passphrase itself never leaves the client.
CREATE TABLE IF NOT EXISTS user_keys (
  user_id TEXT PRIMARY KEY,
  salt    TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Encrypted preferences blob (the user's full app state).
-- One row per user; updated_at enables optimistic-concurrency writes.
CREATE TABLE IF NOT EXISTS prefs (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,   -- JSON: { iv: base64, ct: base64 }
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Rate-limiting counters for auth endpoints (one row per key per window).
-- key is 'email:<address>' or 'ip:<address>'. The window resets automatically
-- when window_end is in the past; no background cleanup job is needed.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  window_end TEXT NOT NULL
);

-- Encrypted monthly net-worth snapshots; one row per (user, month).
CREATE TABLE IF NOT EXISTS snapshots (
  user_id    TEXT NOT NULL,
  month_key  TEXT NOT NULL,
  data       TEXT NOT NULL,   -- JSON: { iv: base64, ct: base64 }
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
