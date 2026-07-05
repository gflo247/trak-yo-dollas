// ONE-TIME cleanup — not part of the app, not run by deploy.sh or any
// build step. Paste into the browser devtools console on trakyodollas.com
// (or the dev deploy) while signed in.
//
// Why this exists: the sync passphrase fix (see _HANDOFF.md) changed how
// the encryption key is derived — from the account's uid to a passphrase
// you set. Any data already synced under the old scheme was encrypted
// with a key that no passphrase can ever reproduce, so it needs to be
// cleared rather than left to fail decryption forever.
//
// Safe by construction, not just by care: every query below is scoped to
// `eq('user_id', uid)` where `uid` comes from your own live session, and
// Supabase's row-level security policies mean the API would reject
// touching any other account's rows even if this were run against a
// different uid.
//
// Usage:
//   1. Sign in normally through the app's "Sign In" button first, so
//      `_sb`/`window._fbUser` reflect a real authenticated session.
//   2. Open devtools → Console, paste this entire file, press Enter.
//   3. Run previewSyncReset() — read-only, shows what would be deleted.
//   4. If the counts look right, run confirmSyncReset() to actually
//      delete. This cannot be undone. Local data on this device (in
//      localStorage) is completely unaffected either way.
//   5. Sign out and back in — you'll see the "Set a sync passphrase"
//      first-time flow, same as a brand-new sync user.

async function previewSyncReset() {
  const uid = window._fbUser && window._fbUser.uid;
  if (!uid) { console.error("Not signed in — sign in first, then re-run this."); return; }
  const [keys, prefs, snaps] = await Promise.all([
    _sb.from("user_keys").select("user_id").eq("user_id", uid),
    _sb.from("prefs").select("user_id").eq("user_id", uid),
    _sb.from("snapshots").select("month_key").eq("user_id", uid),
  ]);
  console.log("Signed in as uid:", uid);
  console.log("Will delete on confirmSyncReset():");
  console.log("  user_keys row:", keys.data ? keys.data.length : 0);
  console.log("  prefs row:", prefs.data ? prefs.data.length : 0);
  console.log("  snapshots rows:", snaps.data ? snaps.data.length : 0,
    snaps.data ? snaps.data.map((s) => s.month_key) : []);
}

async function confirmSyncReset() {
  const uid = window._fbUser && window._fbUser.uid;
  if (!uid) { console.error("Not signed in — sign in first, then re-run this."); return; }
  const [snapsRes, prefsRes, keysRes] = await Promise.all([
    _sb.from("snapshots").delete().eq("user_id", uid),
    _sb.from("prefs").delete().eq("user_id", uid),
    _sb.from("user_keys").delete().eq("user_id", uid),
  ]);
  [["snapshots", snapsRes], ["prefs", prefsRes], ["user_keys", keysRes]].forEach(([table, res]) => {
    if (res.error) console.error(`Failed to clear ${table}:`, res.error);
  });
  console.log("Done. Local data on this device is untouched.");
  console.log("Sign out and back in to set a new sync passphrase.");
}
