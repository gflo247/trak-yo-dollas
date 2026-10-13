// trak-yo-dollas Cloudflare Worker
// Handles auth (magic-link email via Resend) and encrypted sync (D1).
// Every request not matching /auth/* or /api/* falls through to static assets.

'use strict';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_DURATION_MS   = 15 * 60 * 1000;            // 15 minutes

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Validates the Bearer token from the Authorization header against the
// sessions table. Returns { userId, token } or null.
async function getSession(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, new Date().toISOString()).first();
  return row ? { userId: row.user_id, token } : null;
}

// ── POST /auth/request-link  { email } ───────────────────────────────────────
async function handleRequestLink(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonRes({ error: 'bad-request' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonRes({ error: 'invalid-email' }, 400);
  }

  // Find or create user record
  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)'
    ).bind(id, email, new Date().toISOString()).run();
    user = { id };
  }

  // Issue a single-use token valid for 15 minutes
  const token     = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_DURATION_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO auth_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)'
  ).bind(token, user.id, expiresAt).run();

  const origin = new URL(request.url).origin;
  const link   = `${origin}/auth/verify?token=${token}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'trak-yo-dolla$ <noreply@trakyodollas.com>',
      to:      email,
      subject: 'Sign in to trak-yo-dolla$',
      html: `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#111720;color:#D1DCE8;padding:2rem;max-width:480px;margin:0 auto">
<div style="background:#1E293B;border-radius:12px;padding:2rem">
  <p style="font-size:1.1rem;font-weight:700;color:#F1F5F9;margin:0 0 1rem">trak-yo-dolla<span style="color:#FBBF24">$</span></p>
  <p style="margin:0 0 1.5rem;color:#94A3B8;line-height:1.6">Click the button below to sign in. This link expires in 15 minutes and works only once.</p>
  <a href="${link}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:0.95rem">Sign in to trak-yo-dolla$</a>
  <p style="margin:1.5rem 0 0;font-size:0.8rem;color:#8595A8">If you didn't request this, you can safely ignore this email.</p>
</div>
</body></html>`,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text().catch(() => '');
    console.error('Resend error:', emailRes.status, err);
    return jsonRes({ error: 'email-failed' }, 500);
  }
  return jsonRes({ ok: true });
}

// ── GET /auth/verify?token=... ────────────────────────────────────────────────
async function handleVerify(request, env) {
  const url    = new URL(request.url);
  const token  = url.searchParams.get('token');
  const origin = url.origin;

  if (!token) {
    return Response.redirect(`${origin}/trakyodollas#error=invalid-link`, 302);
  }

  const row = await env.DB.prepare(
    'SELECT user_id, expires_at, used FROM auth_tokens WHERE token = ?'
  ).bind(token).first();

  if (!row) {
    return Response.redirect(`${origin}/trakyodollas#error=invalid-link`, 302);
  }
  if (row.used) {
    return Response.redirect(`${origin}/trakyodollas#error=link-used`, 302);
  }
  if (new Date(row.expires_at) < new Date()) {
    return Response.redirect(`${origin}/trakyodollas#error=link-expired`, 302);
  }

  // Consume token (mark used so it can't be replayed)
  await env.DB.prepare('UPDATE auth_tokens SET used = 1 WHERE token = ?').bind(token).run();

  // Create a 30-day session
  const sessionToken  = generateToken();
  const sessionExpiry = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionToken, row.user_id, sessionExpiry).run();

  return Response.redirect(`${origin}/trakyodollas#session=${sessionToken}`, 302);
}

// ── POST /auth/signout ────────────────────────────────────────────────────────
async function handleSignout(request, env) {
  const session = await getSession(request, env);
  if (session) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run();
  }
  return jsonRes({ ok: true });
}

// ── GET /api/session ──────────────────────────────────────────────────────────
async function handleGetSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ valid: false }, 401);
  const user = await env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return jsonRes({ valid: false }, 401);
  return jsonRes({ valid: true, user: { id: user.id, email: user.email } });
}

// ── GET /api/salt ─────────────────────────────────────────────────────────────
// Returns (or creates) the user's PBKDF2 salt. The passphrase itself never
// leaves the client; the salt only needs to be unique per account, not secret.
async function handleGetSalt(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  const row = await env.DB.prepare(
    'SELECT salt FROM user_keys WHERE user_id = ?'
  ).bind(session.userId).first();
  if (row) return jsonRes({ salt: row.salt });

  // Create a fresh salt. Two concurrent first-time calls may race on the
  // INSERT; the loser catches the conflict, re-fetches, and returns whichever
  // salt actually won — same fix as the original Supabase implementation.
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = btoa(String.fromCharCode(...saltBytes));
  try {
    await env.DB.prepare(
      'INSERT INTO user_keys (user_id, salt) VALUES (?, ?)'
    ).bind(session.userId, salt).run();
    return jsonRes({ salt });
  } catch {
    const existing = await env.DB.prepare(
      'SELECT salt FROM user_keys WHERE user_id = ?'
    ).bind(session.userId).first();
    if (existing) return jsonRes({ salt: existing.salt });
    return jsonRes({ error: 'salt-error' }, 500);
  }
}

// ── GET /api/salt-exists ──────────────────────────────────────────────────────
// Checks whether the user has a salt row without creating one. Used by the
// client to decide whether to show "create passphrase" (new) vs "enter
// passphrase" (returning) UI.
async function handleSaltExists(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);
  const row = await env.DB.prepare(
    'SELECT user_id FROM user_keys WHERE user_id = ?'
  ).bind(session.userId).first();
  return jsonRes({ exists: !!row });
}

// ── GET /api/prefs ────────────────────────────────────────────────────────────
async function handleGetPrefs(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  const row = await env.DB.prepare(
    'SELECT data, updated_at FROM prefs WHERE user_id = ?'
  ).bind(session.userId).first();
  if (!row) return jsonRes({ data: null, updatedAt: null });
  return jsonRes({ data: JSON.parse(row.data), updatedAt: row.updated_at });
}

// ── POST /api/prefs  { data, expectedUpdatedAt, newUpdatedAt } ────────────────
// Implements the same optimistic-concurrency semantics as the Supabase version:
// if expectedUpdatedAt is set and the row has moved, returns { wrote: false }
// (conflict) rather than throwing — the caller shows the sync-conflict banner.
async function handleSavePrefs(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ error: 'bad-request' }, 400); }
  const { data, expectedUpdatedAt, newUpdatedAt } = body;
  if (!data || !newUpdatedAt) return jsonRes({ error: 'bad-request' }, 400);

  const existing = await env.DB.prepare(
    'SELECT updated_at FROM prefs WHERE user_id = ?'
  ).bind(session.userId).first();

  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO prefs (user_id, data, updated_at) VALUES (?, ?, ?)'
    ).bind(session.userId, JSON.stringify(data), newUpdatedAt).run();
    return jsonRes({ wrote: true });
  }

  // Optimistic concurrency: only overwrite if the baseline still matches
  if (expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) {
    return jsonRes({ wrote: false });
  }

  await env.DB.prepare(
    'UPDATE prefs SET data = ?, updated_at = ? WHERE user_id = ?'
  ).bind(JSON.stringify(data), newUpdatedAt, session.userId).run();
  return jsonRes({ wrote: true });
}

// ── GET /api/snapshots ────────────────────────────────────────────────────────
async function handleGetSnapshots(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT month_key, data FROM snapshots WHERE user_id = ?'
  ).bind(session.userId).all();

  return jsonRes({
    snapshots: (results || []).map(r => ({
      monthKey: r.month_key,
      data:     JSON.parse(r.data),
    })),
  });
}

// ── POST /api/snapshots  { monthKey, data } ───────────────────────────────────
async function handleSaveSnapshot(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ error: 'bad-request' }, 400); }
  const { monthKey, data } = body;
  if (!monthKey || !data) return jsonRes({ error: 'bad-request' }, 400);

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO snapshots (user_id, month_key, data, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, month_key)
     DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(session.userId, monthKey, JSON.stringify(data), updatedAt).run();

  return jsonRes({ ok: true });
}

// ── DELETE /api/snapshots/:monthKey ──────────────────────────────────────────
async function handleDeleteSnapshot(request, env, monthKey) {
  const session = await getSession(request, env);
  if (!session) return jsonRes({ error: 'unauthorized' }, 401);

  await env.DB.prepare(
    'DELETE FROM snapshots WHERE user_id = ? AND month_key = ?'
  ).bind(session.userId, monthKey).run();

  return jsonRes({ ok: true });
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname === '/auth/request-link' && method === 'POST') return handleRequestLink(request, env);
      if (pathname === '/auth/verify'        && method === 'GET')  return handleVerify(request, env);
      if (pathname === '/auth/signout'        && method === 'POST') return handleSignout(request, env);

      if (pathname === '/api/session'      && method === 'GET')  return handleGetSession(request, env);
      if (pathname === '/api/salt'         && method === 'GET')  return handleGetSalt(request, env);
      if (pathname === '/api/salt-exists'  && method === 'GET')  return handleSaltExists(request, env);
      if (pathname === '/api/prefs'        && method === 'GET')  return handleGetPrefs(request, env);
      if (pathname === '/api/prefs'        && method === 'POST') return handleSavePrefs(request, env);
      if (pathname === '/api/snapshots'    && method === 'GET')  return handleGetSnapshots(request, env);
      if (pathname === '/api/snapshots'    && method === 'POST') return handleSaveSnapshot(request, env);

      const snapMatch = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
      if (snapMatch && method === 'DELETE') {
        return handleDeleteSnapshot(request, env, decodeURIComponent(snapMatch[1]));
      }
    } catch (e) {
      console.error('Worker error:', pathname, e.message);
      return jsonRes({ error: 'internal-error' }, 500);
    }

    // Not an API route — serve static assets
    return env.ASSETS.fetch(request);
  },
};
