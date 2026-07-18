// Tests for the pure(ish), highest-value functions pulled straight out of
// trakyodollas.html — see extract.js for why this loads the real shipped
// source instead of a hand-copied duplicate. Scope is deliberately narrow
// for this first pass: functions with no DOM dependency, covering the
// bugs found in this session's review (XSS escaping, the budget
// over/at-risk classification split, and the sync passphrase crypto).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFunctions } = require("../scripts/extract-testable-fns.js");

// ── esc() — HTML escaping used everywhere user/CSV-supplied text is
// rendered into innerHTML. The CSV import preview (finding #1, this
// session) was the one place this had been skipped. ──
test("esc: escapes all five HTML-significant characters", () => {
  const { esc } = loadFunctions(["esc"]);
  assert.equal(esc(`<script>alert('x')</script> & "quoted"`),
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;");
});
test("esc: a plain string with nothing to escape is returned unchanged", () => {
  const { esc } = loadFunctions(["esc"]);
  assert.equal(esc("Coffee Shop #42"), "Coffee Shop #42");
});
test("esc: coerces non-string input instead of throwing", () => {
  const { esc } = loadFunctions(["esc"]);
  assert.equal(esc(42), "42");
  assert.equal(esc(null), "null");
});

// ── isValidHexColor() — a custom category's color is user data (including
// via JSON backup restore, which doesn't validate per-item field contents)
// that used to flow raw into style="background:${c.color}" at several
// render sites. This is the validation `assignColors()`/`getCatColor()` now
// run before trusting a custom color, added during the July 6, 2026
// pre-launch adversarial review. ──
test("isValidHexColor: accepts standard 6-digit and shorthand 3-digit hex colors", () => {
  const { isValidHexColor } = loadFunctions(["isValidHexColor"]);
  assert.equal(isValidHexColor("#34D399"), true);
  assert.equal(isValidHexColor("#fff"), true);
});
test("isValidHexColor: rejects a value that breaks out of a style attribute", () => {
  const { isValidHexColor } = loadFunctions(["isValidHexColor"]);
  assert.equal(isValidHexColor('red;background:url(javascript:alert(1))'), false);
  assert.equal(isValidHexColor('#fff" onmouseover="alert(1)'), false);
});
test("isValidHexColor: rejects non-strings, empty string, and near-miss hex lengths", () => {
  const { isValidHexColor } = loadFunctions(["isValidHexColor"]);
  assert.equal(isValidHexColor(null), false);
  assert.equal(isValidHexColor(undefined), false);
  assert.equal(isValidHexColor(""), false);
  assert.equal(isValidHexColor("#12345"), false);
  assert.equal(isValidHexColor("blue"), false);
});

// ── classifyBudgetStatus() — shared by the Spending tab's "Budget health"
// pill and the Budget tab's needs-attention/on-track grouping (finding
// #3, this session). Before the fix, these were two separately-written
// implementations that could disagree; this is now the one place the
// over/at-risk rule is decided. ──
test("classifyBudgetStatus: over budget takes priority regardless of day-of-month", () => {
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  const result = classifyBudgetStatus(150, 100, true, 0.9, 80);
  assert.equal(result.over, true);
  assert.equal(result.atRisk, false);
  assert.equal(result.pct, 150);
});
test("classifyBudgetStatus: at-risk requires >= warnPct, current month, and early enough in the month", () => {
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  assert.equal(classifyBudgetStatus(85, 100, true, 0.5, 80).atRisk, true);
});
test("classifyBudgetStatus: not at-risk once past the day-of-month cutoff, even above warnPct", () => {
  // Being at 85% used with 90% of the month elapsed isn't a warning sign —
  // it's just pacing normally toward 100%. The 0.6 cutoff is what makes
  // that distinction.
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  const result = classifyBudgetStatus(85, 100, true, 0.9, 80);
  assert.equal(result.over, false);
  assert.equal(result.atRisk, false);
});
test("classifyBudgetStatus: not at-risk for a non-current (historical) month", () => {
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  const result = classifyBudgetStatus(85, 100, false, 0.5, 80);
  assert.equal(result.atRisk, false);
});
test("classifyBudgetStatus: comfortably under budget is on-track", () => {
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  const result = classifyBudgetStatus(50, 100, true, 0.5, 80);
  assert.equal(result.over, false);
  assert.equal(result.atRisk, false);
});
test("classifyBudgetStatus: a zero/unset budget returns pct 0 instead of Infinity or NaN", () => {
  // undoBudgetCat() can leave a category at budget=0 instead of deleting
  // it — call sites are expected to filter these out before classifying
  // (see the budgetCats filter in renderInsights), but the function
  // itself should still degrade safely if one slips through.
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  const result = classifyBudgetStatus(0, 0, true, 0.5, 80);
  assert.equal(result.pct, 0);
  assert.equal(result.over, false);
});

// ── splitCSVLine() / parseCSV() — the first thing that touches a
// user-uploaded bank CSV. ──
test("splitCSVLine: splits plain comma-separated fields", () => {
  const { splitCSVLine } = loadFunctions(["splitCSVLine"]);
  assert.deepEqual(splitCSVLine("a,b,c"), ["a", "b", "c"]);
});
test("splitCSVLine: a comma inside quotes doesn't split the field (quotes themselves are stripped)", () => {
  const { splitCSVLine } = loadFunctions(["splitCSVLine"]);
  assert.deepEqual(splitCSVLine('a,"b,c",d'), ["a", "b,c", "d"]);
});
test("splitCSVLine: a trailing empty field after the last comma is preserved", () => {
  const { splitCSVLine } = loadFunctions(["splitCSVLine"]);
  assert.deepEqual(splitCSVLine("a,b,"), ["a", "b", ""]);
});
test("splitCSVLine: a doubled quote inside a quoted field is a literal quote, not two field boundaries", () => {
  // Standard CSV escaping: "" inside a quoted field means one literal ".
  // The naive quote-toggle parser used to treat each " independently and
  // silently drop both characters instead of keeping one.
  const { splitCSVLine } = loadFunctions(["splitCSVLine"]);
  assert.deepEqual(splitCSVLine('"He said ""hi""",next'), ['He said "hi"', "next"]);
});
test("parseCSV: lowercases headers and maps each row to an object keyed by them", () => {
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  const rows = parseCSV("Date,Description,Amount\n01/15/2026,Coffee Shop,5.00\n01/16/2026,Groceries,42.10");
  assert.deepEqual(rows, [
    { date: "01/15/2026", description: "Coffee Shop", amount: "5.00" },
    { date: "01/16/2026", description: "Groceries", amount: "42.10" },
  ]);
});
test("parseCSV: a header-only file (no data rows) returns an empty array, not a crash", () => {
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  assert.deepEqual(parseCSV("Date,Description,Amount"), []);
});
test("parseCSV: blank lines are dropped", () => {
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  const rows = parseCSV("Date,Amount\n01/15/2026,5.00\n\n01/16/2026,42.10\n");
  assert.equal(rows.length, 2);
});
test("parseCSV: a newline embedded inside a quoted field doesn't fracture the row", () => {
  // A bank memo/description field can legitimately contain a newline when
  // quoted per RFC 4180. Splitting on '\n' before parsing quotes (the old
  // behavior) silently misaligned columns for the rest of the file instead
  // of surfacing an import error.
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  const rows = parseCSV('Date,Description,Amount\n01/15/2026,"Line one\nLine two",5.00\n01/16/2026,Groceries,42.10');
  assert.deepEqual(rows, [
    { date: "01/15/2026", description: "Line one\nLine two", amount: "5.00" },
    { date: "01/16/2026", description: "Groceries", amount: "42.10" },
  ]);
});

// ── csvSafeField() — quotes a CSV export cell and neutralizes a leading
// =/+/-/@ so a value copied from an imported transaction (bank memo,
// custom category name) can't be interpreted as a formula by Excel/Sheets
// when the exported file is reopened there. ──
test("csvSafeField: quotes a plain value and escapes embedded quotes", () => {
  const { csvSafeField } = loadFunctions(["csvSafeField"]);
  assert.equal(csvSafeField('Trader Joe\'s "Everything" Bagel'), '"Trader Joe\'s ""Everything"" Bagel"');
});
test("csvSafeField: prefixes a leading = with a single quote to defuse formula injection", () => {
  const { csvSafeField } = loadFunctions(["csvSafeField"]);
  assert.equal(csvSafeField("=HYPERLINK(\"http://evil\",\"click\")"), '"\'=HYPERLINK(""http://evil"",""click"")"');
});
test("csvSafeField: also defuses leading +, -, and @", () => {
  const { csvSafeField } = loadFunctions(["csvSafeField"]);
  assert.equal(csvSafeField("+1+1"), "\"'+1+1\"");
  assert.equal(csvSafeField("-1+1"), "\"'-1+1\"");
  assert.equal(csvSafeField("@SUM(1,2)"), "\"'@SUM(1,2)\"");
});
test("csvSafeField: null/undefined becomes an empty quoted field", () => {
  const { csvSafeField } = loadFunctions(["csvSafeField"]);
  assert.equal(csvSafeField(null), '""');
  assert.equal(csvSafeField(undefined), '""');
});

// ── parseImportDate() — a malformed or corrupted CSV row (out-of-range day/month,
// e.g. from a truncated or hand-edited export) used to be silently "fixed" by
// JS Date's rollover behavior (Date(2026,12,45) quietly becomes Feb 14 2027)
// instead of being rejected. normalizeTxRow() treats an empty return as "skip
// this row", so a round-trip validation guard was added to make that the
// outcome for genuinely invalid calendar dates rather than a wrong-but-plausible
// silent date shift. ──
test("parseImportDate: rejects an invalid calendar date (Feb 30) instead of rolling over to March", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  assert.equal(parseImportDate("02/30/2026", "mdy"), "");
});
test("parseImportDate: rejects out-of-range month/day (13/45) instead of rolling into next year", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  assert.equal(parseImportDate("13/45/2026", "mdy"), "");
});
test("parseImportDate: rejects an invalid ISO calendar date (2026-02-30)", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  assert.equal(parseImportDate("2026-02-30"), "");
});
test("parseImportDate: still parses valid mdy, dmy, iso, and locale-string dates", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  assert.equal(parseImportDate("05/01/2026", "mdy"), "2026-05-01");
  assert.equal(parseImportDate("25/12/2026", "dmy"), "2026-12-25");
  assert.equal(parseImportDate("2026-05-01"), "2026-05-01");
  assert.equal(parseImportDate("Jan 15, 2025"), "2025-01-15");
});
test("parseImportDate: rejects an incomplete date missing a year (03/10) instead of the native parser's silent year-2001 guess — 11th adversarial pass", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  // Matches neither the ISO nor MM/DD/YYYY regex (both require a 2-4 digit
  // year group), so it used to fall through to the unguarded native
  // new Date('03/10') fallback branch, which silently parses as 2001-03-10.
  assert.equal(parseImportDate("03/10", "mdy"), "");
});

// ── 84th adversarial pass: the 83rd pass added manual Add/Edit Transaction
// date validation by calling parseImportDate() with NO fmt argument, which
// silently always took the MM/DD (US) branch -- unlike a CSV import (one
// consistent format throughout a file, chosen once via a dropdown), a
// free-text field has no such signal, so an unambiguously day-first date
// like "25/12/2026" (day 25 can't be a month) was rejected outright as
// invalid, even though exactly one valid reading exists. Fixed by having
// parseImportDate() retry the swapped mo/dy reading whenever the given
// fmt's interpretation fails AND the swap is unambiguous (only one of the
// two components could possibly be a month). Genuinely ambiguous dates
// (both components <=12) are untouched -- there's no safe way to guess
// those, so they still follow whatever fmt was passed/defaulted. ──
test("parseImportDate: rescues an unambiguous date even when the given fmt's reading is invalid", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  // Day 25 can't be a month -- unambiguously Dec 25, regardless of fmt.
  assert.equal(parseImportDate("25/12/2026"), "2026-12-25", "no fmt (defaults mdy) should still rescue an unambiguous day-first date");
  assert.equal(parseImportDate("25/12/2026", "mdy"), "2026-12-25", "explicit mdy should still rescue it the same way");
  assert.equal(parseImportDate("12/25/2026", "dmy"), "2026-12-25", "the mirror case: day 25 makes 12/25 unambiguously Dec 25 even under dmy");
  // Genuinely ambiguous (both components <=12): no rescue possible, follows
  // the given/defaulted fmt exactly as before this fix.
  assert.equal(parseImportDate("05/03/2026"), "2026-05-03", "ambiguous date with no fmt still defaults to mdy (May 3), unchanged");
  assert.equal(parseImportDate("05/03/2026", "dmy"), "2026-03-05", "same ambiguous date under explicit dmy still reads as March 5, unchanged");
  // Both components >12: no valid reading either way, still correctly rejected.
  assert.equal(parseImportDate("13/45/2026"), "", "still rejects a date with no valid interpretation under either reading");
});

// ── detectGenericSignConvention() — the "generic" CSV format (fallback for any
// bank/credit union that doesn't match one of the 7 known column signatures) used
// to treat every positive amount as spend unconditionally, so a majority-negative
// checking export (typical sign convention: negative=expense, positive=deposit)
// silently imported every paycheck/deposit as an expense in "Other". This function
// picks which sign is "expense" from the file's own majority polarity so
// normalizeTxRow's generic branch can gate the minority sign behind Include Income,
// the same way every other format already does. ──
test("detectGenericSignConvention: majority-negative file (typical checking export) treats negative as expense", () => {
  const { detectGenericSignConvention } = loadFunctions(["detectGenericSignConvention"]);
  const rows = [{amount:"-4.50"},{amount:"-82.10"},{amount:"2500.00"},{amount:"-45.00"}];
  assert.equal(detectGenericSignConvention(rows), false);
});
test("detectGenericSignConvention: majority-positive file (unsigned credit-card export) treats positive as expense", () => {
  const { detectGenericSignConvention } = loadFunctions(["detectGenericSignConvention"]);
  const rows = [{amount:"4.50"},{amount:"82.10"},{amount:"-25.00"},{amount:"45.00"}];
  assert.equal(detectGenericSignConvention(rows), true);
});
test("detectGenericSignConvention: zero/unparseable amounts don't skew the majority", () => {
  const { detectGenericSignConvention } = loadFunctions(["detectGenericSignConvention"]);
  const rows = [{amount:"-10"},{amount:"0"},{amount:""},{amount:"-5"}];
  assert.equal(detectGenericSignConvention(rows), false);
});

// ── Sync passphrase encryption (finding #2, this session) — the key is
// now derived from a passphrase Supabase never sees, instead of the
// user's uid (which Supabase stores in the same row as the ciphertext).
// These exercise the real Web Crypto AES-256-GCM + PBKDF2 code path. ──
function makeCryptoContext() {
  const ctx = {
    crypto: globalThis.crypto,
    atob: (b64) => Buffer.from(b64, "base64").toString("binary"),
    btoa: (bin) => Buffer.from(bin, "binary").toString("base64"),
    TextEncoder, TextDecoder,
    _syncPassphrase: null,
    _cryptoKey: null, _cryptoKeyUid: null, _cryptoKeyPassphrase: null,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    _getOrCreateSalt: async () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64"),
  };
  ctx.getSyncPassphrase = () => ctx._syncPassphrase;
  ctx.setSyncPassphrase = (pw) => { ctx._syncPassphrase = pw; };
  return ctx;
}

test("_encrypt/_decrypt: round-trips arbitrary JSON through the same passphrase", async () => {
  const ctx = makeCryptoContext();
  const { _encrypt, _decrypt } = loadFunctions(["_deriveKey", "_encrypt", "_decrypt"], ctx);
  ctx.setSyncPassphrase("correct horse battery staple");
  const plain = { budgets: { Groceries: 700 }, note: "hello" };
  const envelope = await _encrypt(plain, "uid-1");
  const decrypted = await _decrypt(envelope, "uid-1");
  assert.deepEqual(decrypted, plain);
});
test("_decrypt: a wrong passphrase throws a recognizable error instead of returning garbage", async () => {
  const ctx = makeCryptoContext();
  const { _encrypt, _decrypt } = loadFunctions(["_deriveKey", "_encrypt", "_decrypt"], ctx);
  ctx.setSyncPassphrase("the-right-one");
  const envelope = await _encrypt({ a: 1 }, "uid-1");
  ctx.setSyncPassphrase("a-different-one");
  await assert.rejects(() => _decrypt(envelope, "uid-1"), /wrong-passphrase/);
});
test("_encrypt: throws a recognizable error when no passphrase has been set yet", async () => {
  const ctx = makeCryptoContext();
  const { _encrypt } = loadFunctions(["_deriveKey", "_encrypt", "_decrypt"], ctx);
  await assert.rejects(() => _encrypt({ a: 1 }, "uid-1"), /missing-passphrase/);
});

// ── _getOrCreateSalt() — user_keys.user_id is the table's primary key, so
// two concurrent first-time-setup calls for the same brand-new account (two
// tabs/devices, or a double-submitted passphrase form — see
// submitSyncPassphrase's now-added disabled-button guard) can both see "no
// row yet" and race to insert a salt. Before this fix (July 6, 2026, 6th
// adversarial pass) the loser's insert error was silently discarded, so it
// returned its own never-persisted salt and derived a key nobody else's
// session would ever reproduce — indistinguishable from real data loss on
// the next load. ──
function makeSaltMockSb({ selectResults, insertError, onInsert }) {
  let selectCall = 0;
  return {
    from() {
      return {
        select() {
          return { eq() { return Promise.resolve({ data: selectResults[Math.min(selectCall++, selectResults.length - 1)] }); } };
        },
        insert(row) { if (onInsert) onInsert(row); return Promise.resolve({ error: insertError || null }); },
      };
    },
  };
}
const saltCtx = () => ({ crypto: globalThis.crypto, btoa: (s) => Buffer.from(s, "binary").toString("base64") });

test("_getOrCreateSalt: an existing row is returned directly, no insert attempted", async () => {
  let insertCalled = false;
  const _sb = makeSaltMockSb({ selectResults: [[{ salt: "EXISTING" }]], onInsert: () => { insertCalled = true; } });
  const { _getOrCreateSalt } = loadFunctions(["_getOrCreateSalt"], { ...saltCtx(), _sb });
  const result = await _getOrCreateSalt("uid-existing");
  assert.equal(result, "EXISTING");
  assert.equal(insertCalled, false);
});
test("_getOrCreateSalt: no existing row, insert succeeds — returns the newly-created salt", async () => {
  const _sb = makeSaltMockSb({ selectResults: [[]] });
  const { _getOrCreateSalt } = loadFunctions(["_getOrCreateSalt"], { ...saltCtx(), _sb });
  const result = await _getOrCreateSalt("uid-normal");
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});
test("_getOrCreateSalt: lost the insert race — re-fetches and returns the winner's salt, not its own orphaned one", async () => {
  const _sb = makeSaltMockSb({ selectResults: [[], [{ salt: "WINNER_SALT" }]], insertError: { message: "duplicate key value violates unique constraint" } });
  const { _getOrCreateSalt } = loadFunctions(["_getOrCreateSalt"], { ...saltCtx(), _sb });
  const result = await _getOrCreateSalt("uid-race");
  assert.equal(result, "WINNER_SALT");
});

// ── isRealSpend() — single source of truth for "does this transaction count
// as spend," consolidated from ~15 independent reimplementations of
// `!t.excluded&&!t.isIncome` during the 10th adversarial pass (July 6,
// 2026). A category rule can retag t.cat but never t.isIncome, which is
// why isIncome (not cat) is the field this must check. ──
test("isRealSpend: a normal, non-excluded, non-income transaction counts as spend", () => {
  const { isRealSpend } = loadFunctions(["isRealSpend"]);
  assert.equal(isRealSpend({ excluded: false, isIncome: false }), true);
});
test("isRealSpend: a manually-excluded transaction never counts as spend", () => {
  const { isRealSpend } = loadFunctions(["isRealSpend"]);
  assert.equal(isRealSpend({ excluded: true, isIncome: false }), false);
});
test("isRealSpend: an income transaction never counts as spend, even if a category rule retagged its cat away from 'Income'", () => {
  const { isRealSpend } = loadFunctions(["isRealSpend"]);
  assert.equal(isRealSpend({ excluded: false, isIncome: true, cat: "Salary" }), false);
});
test("isRealSpend: excluded and income together still returns false, not a crash", () => {
  const { isRealSpend } = loadFunctions(["isRealSpend"]);
  assert.equal(isRealSpend({ excluded: true, isIncome: true }), false);
});

// ── saveToLocalStorage() / scheduleSave() persistence gates — the CRITICAL
// finding from the 9th adversarial pass (July 6, 2026): previewing a demo
// profile over real saved data could silently overwrite it, because these
// functions checked only window._isDemoPreview, never
// window._viewingDemoOverReal. Covering the gate itself here so a future
// change can't reintroduce that regression silently — this is exactly the
// kind of fix that must never quietly break again. ──
function makeLsSpy() {
  const store = {};
  return { setItem: (k, v) => { store[k] = v; }, _store: store };
}
function saveCtx(overrides) {
  return {
    window: { _isDemoPreview: false, _viewingDemoOverReal: false, ...overrides },
    LS_KEY: "trakyo_state_v2",
    LS_TXS_KEY: "trakyo_txs_v1",
    serializeState: () => '{"fake":"state"}',
    localStorage: makeLsSpy(),
    _txsDirty: false,
    state: { transactions: [] },
    showToast: () => {},
  };
}

test("saveToLocalStorage: demo-preview flag blocks the write entirely", () => {
  const ctx = saveCtx({ _isDemoPreview: true });
  const { saveToLocalStorage } = loadFunctions(["saveToLocalStorage"], ctx);
  saveToLocalStorage();
  assert.deepEqual(ctx.localStorage._store, {});
});
test("saveToLocalStorage: viewingDemoOverReal flag blocks the write entirely — the flag the CRITICAL bug was missing", () => {
  const ctx = saveCtx({ _viewingDemoOverReal: true });
  const { saveToLocalStorage } = loadFunctions(["saveToLocalStorage"], ctx);
  saveToLocalStorage();
  assert.deepEqual(ctx.localStorage._store, {});
});
test("saveToLocalStorage: with neither flag set, the write proceeds normally", () => {
  const ctx = saveCtx();
  const { saveToLocalStorage } = loadFunctions(["saveToLocalStorage"], ctx);
  saveToLocalStorage();
  assert.equal(ctx.localStorage._store["trakyo_state_v2"], '{"fake":"state"}');
});

test("scheduleSave: demo-preview flag prevents the debounced save from ever firing, even after the 800ms window", async () => {
  let saveCalled = false;
  const ctx = {
    window: { _isDemoPreview: true, _viewingDemoOverReal: false, _fbUser: null, _fb: null, _awaitingCloudMerge: false },
    _lsSaveTimer: null,
    _clearAllDataInProgress: false,
    saveToLocalStorage: () => { saveCalled = true; },
    syncToCloud: () => {},
  };
  const { scheduleSave } = loadFunctions(["scheduleSave"], ctx);
  scheduleSave();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(saveCalled, false);
});
test("scheduleSave: awaitingCloudMerge gates only the cloud sync, not the local save — the sign-in-race fix from the 9th pass", async () => {
  let saveCalled = false, syncCalled = false;
  const ctx = {
    window: { _isDemoPreview: false, _viewingDemoOverReal: false, _fbUser: { uid: "x" }, _fb: {}, _awaitingCloudMerge: true },
    _lsSaveTimer: null,
    _clearAllDataInProgress: false,
    saveToLocalStorage: () => { saveCalled = true; },
    syncToCloud: () => { syncCalled = true; },
  };
  const { scheduleSave } = loadFunctions(["scheduleSave"], ctx);
  scheduleSave();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(saveCalled, true);
  assert.equal(syncCalled, false);
});
test("scheduleSave: _clearAllDataInProgress blocks a new debounced save from arming — the 60th-pass fix for a race in confirmClearAllData()'s await", async () => {
  // confirmClearAllData() awaits window._fb.signOut() before wiping
  // localStorage; during that await the app is fully interactive again
  // (Escape closes the confirmation modal, since it isn't special-cased),
  // so any edit in that window used to arm a brand-new _lsSaveTimer that
  // outlived the function's own clearTimeout() at its top -- the reload's
  // resulting pagehide/_flushPendingSave() would then re-save the very
  // keys just deleted, resurrecting the "permanently deleted" data.
  let saveCalled = false;
  const ctx = {
    window: { _isDemoPreview: false, _viewingDemoOverReal: false, _fbUser: null, _fb: null, _awaitingCloudMerge: false },
    _lsSaveTimer: null,
    _clearAllDataInProgress: true,
    saveToLocalStorage: () => { saveCalled = true; },
    syncToCloud: () => {},
  };
  const { scheduleSave } = loadFunctions(["scheduleSave"], ctx);
  scheduleSave();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(saveCalled, false);
});

// ── mutateTransactions() — the wrapper added to collapse the three-step
// manual contract (set _txsDirty, call rebuildMonthly, call scheduleSave)
// that saveTx()/confirmSrcRemove()/applyVenmoOpt()/loadUserData() each
// independently forgot a piece of at some point this cycle. This tests the
// real end-to-end guarantee -- that a mutation actually reaches the mocked
// localStorage after the debounce -- not just that _txsDirty gets
// internally reassigned (not observable from outside: it's a primitive
// parameter in the generated-function scope loadFunctions() creates, not a
// mutable object). _txsDirty must be passed explicitly in ctx even though
// mutateTransactions immediately overwrites it -- omitting it would make
// the assignment an implicit global on the realm, which can leak across
// other test files in the same node --test process. ──
test("mutateTransactions: a mutation reaches localStorage after the debounce", async () => {
  const ctx = {
    window: { _isDemoPreview: false, _viewingDemoOverReal: false, _fbUser: null, _fb: null, _awaitingCloudMerge: false },
    LS_KEY: "trakyo_state_v2",
    LS_TXS_KEY: "trakyo_txs_v1",
    serializeState: () => '{"fake":"state"}',
    localStorage: makeLsSpy(),
    _txsDirty: false,
    _lsSaveTimer: null,
    _clearAllDataInProgress: false,
    state: { transactions: [{ id: 1, cat: "Other" }] },
    rebuildMonthly: () => {}, // spy/no-op -- rebuildMonthly's own correctness is covered elsewhere
    showToast: () => {},
  };
  const { mutateTransactions } = loadFunctions(["mutateTransactions", "scheduleSave", "saveToLocalStorage"], ctx);
  mutateTransactions(() => { ctx.state.transactions[0].cat = "Groceries"; });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(JSON.parse(ctx.localStorage._store["trakyo_txs_v1"])[0].cat, "Groceries");
});

// ── scheduleSave() + _flushPendingSave() (the pagehide handler, extracted to
// a named function for testability) — CRITICAL regression from the 12th
// adversarial pass: a fired setTimeout ID is still truthy, so without
// resetting _lsSaveTimer back to null once the debounced save actually
// fires, _flushPendingSave() (called on every pagehide, including the
// reload location.reload() triggers) kept re-saving forever after the
// *first* save of a session — turning "Clear all data" (which removes the
// localStorage keys then reloads) into a no-op for everything the reload's
// resulting pagehide event wrote straight back. ──
function flushCtx(overrides) {
  return {
    window: { _isDemoPreview: false, _viewingDemoOverReal: false, _fbUser: null, _fb: null, _awaitingCloudMerge: false, ...overrides },
    _lsSaveTimer: null,
    _clearAllDataInProgress: false,
    saveToLocalStorage: () => {},
    syncToCloud: () => {},
  };
}
test("_flushPendingSave: does NOT re-save once the debounced save has already fired — the 'Clear all data' regression", async () => {
  let saveCallCount = 0;
  const ctx = flushCtx();
  ctx.saveToLocalStorage = () => { saveCallCount++; };
  const { scheduleSave, _flushPendingSave } = loadFunctions(["scheduleSave", "_flushPendingSave"], ctx);
  scheduleSave();
  await new Promise((r) => setTimeout(r, 900)); // let the debounced save actually fire
  assert.equal(saveCallCount, 1);
  // Simulate a reload/pagehide happening after the save already completed
  // (e.g. confirmClearAllData()'s location.reload()) — must NOT re-save.
  _flushPendingSave();
  assert.equal(saveCallCount, 1);
});
test("_flushPendingSave: DOES flush a genuinely still-pending save — the original pagehide-flush intent, still must work", async () => {
  let saveCallCount = 0;
  const ctx = flushCtx();
  ctx.saveToLocalStorage = () => { saveCallCount++; };
  const { scheduleSave, _flushPendingSave } = loadFunctions(["scheduleSave", "_flushPendingSave"], ctx);
  scheduleSave(); // schedules but the 800ms debounce hasn't fired yet
  _flushPendingSave(); // simulate an immediate pagehide/reload
  assert.equal(saveCallCount, 1);
});

// ── The shared event-dispatch coerce() turns any data-arg that "looks
// numeric" into an actual Number before calling the handler — correct for
// id-based actions, but broke every name-based one whenever a user's
// category/vendor/source name happened to be a bare numeric string (e.g.
// "76", "2024"). 13th adversarial pass: deleteVendorAlias() threw outright
// (.replace is not a function on a Number) and toggleCatFilter() silently
// stored a Number in a Set that real category names (always strings) could
// never match, making the filtered view show zero data. Fixed by coercing
// back to String at the top of each affected function. ──
test("deleteVendorAlias: a numeric-looking vendor name (coerced to a Number by the dispatcher) doesn't throw and is actually removed", () => {
  const ctx = {
    state: { vendorAliases: { "76": "Gas Station" } },
    renderVendorAliasList: () => {},
    renderSpending: () => {},
    scheduleSave: () => {},
  };
  const { deleteVendorAlias } = loadFunctions(["deleteVendorAlias"], ctx);
  assert.doesNotThrow(() => deleteVendorAlias(76));
  assert.equal("76" in ctx.state.vendorAliases, false);
});
test("toggleCatFilter: a numeric-looking category name (coerced to a Number) is stored and matched as a string, so real transactions in that category are found", () => {
  const ctx = {
    state: { activeCats: new Set(), chartMode: "category" },
    showTxN: 50,
    renderSpendSummary: () => {},
    renderBucketGrid: () => {},
    renderActiveChart: () => {},
    renderTxList: () => {},
    setChartMode: () => {},
    document: { getElementById: () => null },
  };
  const { toggleCatFilter } = loadFunctions(["toggleCatFilter"], ctx);
  toggleCatFilter(2024); // dispatcher would pass the Number 2024, not the string "2024"
  assert.equal(ctx.state.activeCats.has("2024"), true);
  assert.equal(ctx.state.activeCats.has(2024), false);
});

// ── 14th adversarial pass: the "patch mutating functions to auto-save" list
// (right before this in trakyodollas.html) named 'deleteSnapshot' -- the
// function that only *opens* the delete-confirm modal -- instead of
// 'confirmDeleteSnapshot', the one actually bound to the modal's "Yes,
// delete" button that splices state.snapshots. A confirmed deletion never
// got scheduleSave()'d, so it could silently resurrect on the next reload.
// This test reads the real source (not an extracted function -- the patch
// is inline top-level code, not itself a named function) and asserts the
// list contains the real mutator and not the modal-opener. ──
test("auto-save patch list wraps confirmDeleteSnapshot (the real mutator), not deleteSnapshot (the modal-opener)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const m = source.match(/\/\/ Patch mutating functions to auto-save[\s\S]*?\[([^\]]+)\]\.forEach/);
  assert.ok(m, "could not find the auto-save patch list in trakyodollas.html");
  const patched = m[1];
  assert.match(patched, /'confirmDeleteSnapshot'/);
  assert.doesNotMatch(patched, /'deleteSnapshot'/);
});

// ── 14th adversarial pass: parseCsvAccounts() (bulk account CSV import) had
// three independent bugs. (1) balance of exactly 0 (a paid-off card, a
// closed account) is falsy in JS, so `if(...&&balance)` silently dropped
// those rows same as a missing/unparseable balance. (2) a naive
// line.split(',') shifted every field left when a quoted name contained a
// comma, discarding the real balance. (3) it never set
// hasRealAccounts/hasRealData, unlike saveAccount() and every other
// account-mutating path, so the demo-data notice never dismissed and
// onboarding nudges gated on hasRealData stayed stuck showing demo state.
// Fixed by switching to the existing quote-aware splitCSVLine(), checking
// isNaN() instead of falsiness, and mirroring saveAccount()'s flag updates. ──
test("parseCsvAccounts: a zero balance is imported, not silently dropped", () => {
  const ctx = {
    state: { accounts: [], nextId: 1, hasRealAccounts: false, hasRealData: false },
    hideDemoBadge: () => {},
    _replaceDemoDataWithReal: () => {},
    document: { getElementById: () => null },
    ACCT_TYPE_ALIASES: {
      cash: "cash", "cash/savings": "cash", checking: "cash", savings: "cash",
      investment: "investment",
      home: "home", "real estate": "home",
      vehicle: "vehicle",
      mortgage: "mortgage",
      credit: "credit", "credit card": "credit",
      "other-asset": "other-asset", "other asset": "other-asset",
      "other-liability": "other-liability", "other liability": "other-liability", "other liab": "other-liability",
    },
  };
  const { parseCsvAccounts } = loadFunctions(["parseCsvAccounts", "splitCSVLine"], ctx);
  const { imported, skipped } = parseCsvAccounts("name,source,type,balance\nOld Card,Chase,Credit Card,0");
  assert.equal(imported, 1);
  assert.equal(skipped, 0);
  assert.equal(ctx.state.accounts[0].balance, 0);
});
test("parseCsvAccounts: a quoted name containing a comma doesn't shift the balance field left", () => {
  const ctx = {
    state: { accounts: [], nextId: 1, hasRealAccounts: false, hasRealData: false },
    hideDemoBadge: () => {},
    _replaceDemoDataWithReal: () => {},
    document: { getElementById: () => null },
    ACCT_TYPE_ALIASES: {
      cash: "cash", "cash/savings": "cash", checking: "cash", savings: "cash",
      investment: "investment",
      home: "home", "real estate": "home",
      vehicle: "vehicle",
      mortgage: "mortgage",
      credit: "credit", "credit card": "credit",
      "other-asset": "other-asset", "other asset": "other-asset",
      "other-liability": "other-liability", "other liability": "other-liability", "other liab": "other-liability",
    },
  };
  const { parseCsvAccounts } = loadFunctions(["parseCsvAccounts", "splitCSVLine"], ctx);
  const { imported } = parseCsvAccounts('name,source,type,balance\n"Smith, John Checking",Chase,Checking,1500');
  assert.equal(imported, 1);
  assert.equal(ctx.state.accounts[0].name, "Smith, John Checking");
  assert.equal(ctx.state.accounts[0].balance, 1500);
});
test("parseCsvAccounts: a successful import sets hasRealAccounts/hasRealData, matching saveAccount()", () => {
  const ctx = {
    state: { accounts: [], nextId: 1, hasRealAccounts: false, hasRealData: false },
    hideDemoBadge: () => {},
    _replaceDemoDataWithReal: () => {},
    document: { getElementById: () => null },
    ACCT_TYPE_ALIASES: {
      cash: "cash", "cash/savings": "cash", checking: "cash", savings: "cash",
      investment: "investment",
      home: "home", "real estate": "home",
      vehicle: "vehicle",
      mortgage: "mortgage",
      credit: "credit", "credit card": "credit",
      "other-asset": "other-asset", "other asset": "other-asset",
      "other-liability": "other-liability", "other liability": "other-liability", "other liab": "other-liability",
    },
  };
  const { parseCsvAccounts } = loadFunctions(["parseCsvAccounts", "splitCSVLine"], ctx);
  parseCsvAccounts("name,source,type,balance\nChecking,Chase,Checking,500");
  assert.equal(ctx.state.hasRealAccounts, true);
  assert.equal(ctx.state.hasRealData, true);
});

// ── 62nd adversarial pass: parseCsvAccounts() only checked that `type`
// was non-empty, storing whatever string was typed verbatim -- pasting a
// human-readable label the app's own UI shows for an account type (e.g.
// "Credit Card", copied straight from the Add Account form's dropdown)
// created an account isLiab() doesn't recognize (it only matches the
// exact lowercase-hyphenated code "credit"), silently adding its balance
// to totalAssets() instead of subtracting it via totalLiab() -- a 2x
// net-worth swing with a clean "✓ Imported" toast and no warning. Fixed
// by normalizing `type` through ACCT_TYPE_ALIASES (case-insensitive,
// covers both the internal codes and every label variant) and skipping
// rows whose type doesn't resolve to a real code at all. ──
function acctAliasCtx() {
  return {
    state: { accounts: [], nextId: 1, hasRealAccounts: false, hasRealData: false },
    hideDemoBadge: () => {},
    _replaceDemoDataWithReal: () => {},
    document: { getElementById: () => null },
    ACCT_TYPE_ALIASES: {
      cash: "cash", "cash/savings": "cash", checking: "cash", savings: "cash",
      investment: "investment",
      home: "home", "real estate": "home",
      vehicle: "vehicle",
      mortgage: "mortgage",
      credit: "credit", "credit card": "credit",
      "other-asset": "other-asset", "other asset": "other-asset",
      "other-liability": "other-liability", "other liability": "other-liability", "other liab": "other-liability",
    },
  };
}
test("parseCsvAccounts: a human-readable type label (\"Credit Card\", copied from the Add Account dropdown) normalizes to the internal code isLiab() recognizes", () => {
  const ctx = acctAliasCtx();
  const { parseCsvAccounts } = loadFunctions(["parseCsvAccounts", "splitCSVLine"], ctx);
  const { imported } = parseCsvAccounts("name,source,type,balance\nMy Card,Chase,Credit Card,5000");
  assert.equal(imported, 1);
  assert.equal(ctx.state.accounts[0].type, "credit");
});
test("parseCsvAccounts: an unrecognized type is skipped, not silently stored verbatim and mis-classified as an asset", () => {
  const ctx = acctAliasCtx();
  const { parseCsvAccounts } = loadFunctions(["parseCsvAccounts", "splitCSVLine"], ctx);
  const { imported, skipped } = parseCsvAccounts("name,source,type,balance\nMy Card,Chase,Gibberish Type,5000");
  assert.equal(imported, 0);
  assert.equal(skipped, 1);
  assert.equal(ctx.state.accounts.length, 0);
});

// ── 14th adversarial pass: openKBB()'s make/model can be coerced to a
// Number by the shared dispatcher when a vehicle's model starts with a
// number (BMW "3 Series", Porsche "911", Fiat "500") -- (model||'')
// .toLowerCase() then throws (a truthy Number has no .toLowerCase),
// silently killing the "Check value on Kelley Blue Book" link. ──
test("openKBB: a numeric-looking model (coerced to a Number by the dispatcher) doesn't throw", () => {
  const ctx = { window: { open: () => {} } };
  const { openKBB } = loadFunctions(["openKBB"], ctx);
  assert.doesNotThrow(() => openKBB(2020, "BMW", 3));
});

// ── 14th adversarial pass, CRITICAL: deploy.sh's `sed "s/__CACHE_VERSION__/
// $DEPLOY_TS/"` line has referenced $DEPLOY_TS since this whole review
// cycle's first commit (83daa34), but that same commit accidentally
// deleted the `DEPLOY_TS=$(date -u +%Y%m%d%H%M%S)` assignment while making
// the sed portable across BSD/GNU -- so every deploy since substituted an
// empty string, making sw.js's CACHE_NAME the literal constant "trakyo-"
// forever. Browsers detect service-worker updates via a byte diff of
// sw.js; with CACHE_NAME never changing, install/activate never re-fire
// for a returning user, so the cache-first fetch handler could keep
// serving the app-shell snapshot from a user's first visit indefinitely,
// across every deploy since -- almost certainly the real cause of the
// "stale service worker" false leads that cost real debugging time earlier
// in this review cycle. Verified live: curl-ing the deployed sw.js on both
// dev and prod showed `const CACHE_VERSION = '';` before this fix. ──
test("deploy.sh assigns DEPLOY_TS before using it in the CACHE_VERSION sed substitution", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "deploy.sh"), "utf8");
  const sedIdx = source.indexOf("__CACHE_VERSION__/$DEPLOY_TS");
  assert.notEqual(sedIdx, -1, "could not find the CACHE_VERSION sed line in deploy.sh");
  const assignIdx = source.search(/^DEPLOY_TS=/m);
  assert.notEqual(assignIdx, -1, "DEPLOY_TS is never assigned in deploy.sh");
  assert.ok(assignIdx < sedIdx, "DEPLOY_TS must be assigned before the sed line that substitutes it");
});

// ── 14th adversarial pass: triggerPwaInstall() only nulled _installPrompt
// inside the async userChoice.then() callback, so a fast double-click
// before that promise resolved called .prompt() a second time on the same
// already-used BeforeInstallPromptEvent -- which the spec disallows and
// throws. That exception also aborted any other action chained after this
// one in the same data-action dispatch (e.g. "triggerPwaInstall|
// closeSpendingOverflow"). Fixed by nulling _installPrompt synchronously
// before calling .prompt(), so a same-tick second call is a no-op. ──
test("triggerPwaInstall: a synchronous double-call only invokes .prompt() once", () => {
  let promptCalls = 0;
  const fakeEvent = {
    prompt: () => { promptCalls++; },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  };
  const ctx = { _installPrompt: fakeEvent, document: { getElementById: () => null } };
  const { triggerPwaInstall } = loadFunctions(["triggerPwaInstall"], ctx);
  triggerPwaInstall();
  triggerPwaInstall(); // same tick, before userChoice has resolved
  assert.equal(promptCalls, 1);
});

// ── 15th adversarial pass: openBudgetModal(cat) was the one budget-related
// handler in the "name-based data-action argument" family (see the 13th
// pass's coerce() note above) that never re-stringified its argument. A
// custom category literally named "2024" arrives as the Number 2024 from
// the dispatcher; the modal's <select> compares `c===cat` against real
// string category names, so the wrong (or no) <option> showed as selected
// even though the budget itself still saved correctly (object bracket-key
// access auto-stringifies). Fixed with the same String(cat) pattern used
// elsewhere. ──
test("openBudgetModal: a numeric-looking category name (coerced to a Number by the dispatcher) is compared as a string, so the matching <option> is marked selected", () => {
  let selHTML = "";
  const fakeSel = {
    set innerHTML(v) { selHTML = v; },
    get innerHTML() { return selHTML; },
    onchange: null,
  };
  const fakeModal = { classList: { remove: () => {} } };
  const fakeAmountInput = { focus: () => {} };
  const ctx = {
    getAllCats: () => ["Groceries", "2024"],
    state: { budgets: {} },
    MONTHLY: {},
    getCatMonthSpend: () => 0,
    esc: (s) => String(s),
    fmt: (n) => String(n),
    _refreshBudgetModalContext: () => {},
    document: {
      getElementById: (id) => {
        if (id === "budget-cat-select") return fakeSel;
        if (id === "budget-modal") return fakeModal;
        if (id === "budget-amount") return fakeAmountInput;
        return null;
      },
    },
  };
  const { openBudgetModal } = loadFunctions(["openBudgetModal"], ctx);
  openBudgetModal(2024); // dispatcher would pass the Number 2024, not the string "2024"
  assert.match(selHTML, /<option value="2024" selected>/);
});

// ── 15th adversarial pass: budgetWarnPct is clamped to [50,99] on every live
// edit via setBudgetWarnPct(), but both restore paths (localStorage load and
// JSON-backup import) only NaN-guarded it, never clamped the range. A
// corrupted or hand-edited backup with e.g. budgetWarnPct:-20 restored
// unmodified, making classifyBudgetStatus()'s atRisk check (pct>=warnPct)
// true for nearly any nonzero spend -- flooding the Budget tab with false
// "AT RISK" badges. Fixed by mirroring setBudgetWarnPct()'s own clamp at
// both restore sites. ──
test("all budgetWarnPct restore sites (localStorage load, JSON-backup import, cloud-sync restore) clamp to the same [50,99] range as setBudgetWarnPct()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const clampPattern = /Math\.min\(99,Math\.max\(50,n\)\)/g;
  const matches = source.match(clampPattern) || [];
  // setBudgetWarnPct() itself, plus 3 restore sites (localStorage load,
  // JSON-backup import, and loadUserData()'s cloud-sync restore -- added
  // in the 38th adversarial pass alongside budgetWarnPct/currency finally
  // being added to the cloud sync payload at all) -- 4 total.
  assert.equal(matches.length, 4, `expected 4 uses of the [50,99] clamp (setBudgetWarnPct + 3 restore sites), found ${matches.length}`);
});

// ── 80th adversarial pass: the 76th pass's own fix for the one-time "press ?
// for tips" toast, tc('#334155','#CBD5E1'), had tc(dark,light)'s arguments
// backwards -- dark theme (this app's default) kept the exact same ~1.41:1
// contrast the fix was supposed to eliminate, and light theme newly
// regressed to ~1.47:1 (previously ~10.33:1 pre-fix, since the whole toast
// was a single hardcoded color before). Neither theme was ever actually
// fixed; light theme was made worse. A plain string-match test wouldn't
// catch a *different* wrong color choice recurring here later, so this
// computes real WCAG contrast against both themes' actual --toast-bg. ──
function relLum(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA, hexB) {
  const [l1, l2] = [relLum(hexA.replace("#", "")), relLum(hexB.replace("#", ""))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
test("tips-toast color: tc('#CBD5E1','#334155') meets WCAG AA (4.5:1) against both themes' --toast-bg", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /Press <strong style="color:#fff">\?<\/strong> anytime for tips & shortcuts',tc\('#CBD5E1','#334155'\)/,
    "tips toast should call tc('#CBD5E1','#334155') -- dark theme first, matching tc(dark,light)'s signature"
  );
  const DARK_TOAST_BG = "#1E293B";
  const LIGHT_TOAST_BG = "#FFFEFB";
  assert.ok(contrastRatio("#CBD5E1", DARK_TOAST_BG) >= 4.5, "dark-theme color (#CBD5E1, this app's default theme) must meet AA against the dark toast bg");
  assert.ok(contrastRatio("#334155", LIGHT_TOAST_BG) >= 4.5, "light-theme color (#334155) must meet AA against the light toast bg");
});

// ── 65th adversarial pass: computePeriodSpendVsIncome() ("the app's own
// documented single source of truth for period-level spend vs income") sums
// each filtered month's own getEffectiveIncome() instead of multiplying the
// latest month's figure by the month count. For the "auto-detect from
// deposits" method, income varies per month, so the old formula let one
// outlier month (a bonus, or a lean month) at the end of a multi-month range
// stand in for the whole period's income. ──
function periodIncomeCtx(byMonth) {
  const transactions = Object.entries(byMonth).map(([date, amount], i) => ({
    id: `dep-${i}`,
    date: `${date}-15`,
    amount,
    card: "chase",
    desc: "PAYROLL DEPOSIT",
    excluded: true,
    is_offset: false,
    isIncome: false,
    cat: "",
    biz: false,
  }));
  return {
    ALL_MONTHS: Object.keys(byMonth).sort(),
    _bizFilter: "all",
    state: {
      transactions,
      activeSources: new Set(["chase"]),
      excludedCats: new Set(),
      income: { method: "auto", monthlyAmount: 0 },
      declaredIncome: 0,
      rangeFrom: Object.keys(byMonth).sort()[0],
      rangeTo: Object.keys(byMonth).sort().slice(-1)[0],
      sourceAlignDate: null,
    },
  };
}
test("computePeriodSpendVsIncome: sums each month's auto-detected income instead of multiplying the latest month's figure by month count", () => {
  const ctx = periodIncomeCtx({ "2026-05": 3000, "2026-06": 6000, "2026-07": 3000 });
  const { computePeriodSpendVsIncome, getFilteredMonths, getEffectiveIncome, detectDepositIncome, isRealSpend } =
    loadFunctions(
      ["computePeriodSpendVsIncome", "sumIncomeForMonths", "getFilteredMonths", "getEffectiveIncome", "detectDepositIncome", "isRealSpend"],
      ctx
    );
  const result = computePeriodSpendVsIncome();
  // Old buggy formula: getEffectiveIncome(last month = July, $3000) * 3 = $9000.
  assert.equal(result.totalIncome, 12000, "should sum $3000 + $6000 + $3000, not multiply July's $3000 by 3 months");
  assert.equal(result.income, 4000, "the period's average monthly income should be totalIncome / monthCount");
});
test("computePeriodSpendVsIncome: a single-month period is unaffected (income equals that month's detected deposits)", () => {
  const ctx = periodIncomeCtx({ "2026-07": 5000 });
  const { computePeriodSpendVsIncome, getFilteredMonths, getEffectiveIncome, detectDepositIncome, isRealSpend } =
    loadFunctions(
      ["computePeriodSpendVsIncome", "sumIncomeForMonths", "getFilteredMonths", "getEffectiveIncome", "detectDepositIncome", "isRealSpend"],
      ctx
    );
  const result = computePeriodSpendVsIncome();
  assert.equal(result.totalIncome, 5000);
  assert.equal(result.income, 5000);
});

// ── 66th adversarial pass: the 65th pass's per-month sum fix let
// getEffectiveIncome() call detectDepositIncome() -- an unmemoized full
// state.transactions scan -- once per filtered month instead of once total.
// computePeriodSpendVsIncome() runs on the app's main render path
// (renderInsights(), called from renderAll() on essentially every state
// change), so a multi-month "All time" view on the auto-detect income
// method turned one scan per render into dozens. Fixed by calling
// detectDepositIncome() at most once and reusing its byMonth map. ──
test("computePeriodSpendVsIncome: calls detectDepositIncome() at most once per invocation, not once per filtered month", () => {
  let calls = 0;
  const ctx = {
    detectDepositIncome: () => {
      calls++;
      return { byMonth: { "2026-05": 3000, "2026-06": 6000, "2026-07": 3000 }, avgMonthly: 4000 };
    },
    getEffectiveIncome: () => 0,
    isRealSpend: (t) => !t.excluded && !t.isIncome,
    getFilteredMonths: () => ["2026-05", "2026-06", "2026-07"],
    state: {
      transactions: [],
      activeSources: new Set(),
      excludedCats: new Set(),
      income: { method: "auto", monthlyAmount: 0 },
      declaredIncome: 0,
    },
    _bizFilter: "all",
  };
  const { computePeriodSpendVsIncome } = loadFunctions(["computePeriodSpendVsIncome", "sumIncomeForMonths"], ctx);
  const result = computePeriodSpendVsIncome();
  assert.equal(calls, 1, "detectDepositIncome() should be called once per computePeriodSpendVsIncome() invocation, not once per filtered month");
  assert.equal(result.totalIncome, 12000);
});

// ── 67th adversarial pass: renderYearInReview()/copyYirSummary() had each
// independently hand-rolled the same income*monthCount formula
// computePeriodSpendVsIncome() used before the 65th pass -- reproducing the
// exact bug that fix addressed, since it was never ported to the Year in
// Review feature's own separate month-window calculation. Both now call the
// shared sumIncomeForMonths() helper directly. ──
test("sumIncomeForMonths: sums each month's auto-detected income instead of multiplying the latest month's figure by month count", () => {
  let calls = 0;
  const ctx = {
    detectDepositIncome: () => {
      calls++;
      return { byMonth: { "2026-05": 3000, "2026-06": 6000, "2026-07": 3000 }, avgMonthly: 4000 };
    },
    getEffectiveIncome: () => 0,
    state: {
      income: { method: "auto", monthlyAmount: 0 },
      declaredIncome: 0,
    },
  };
  const { sumIncomeForMonths } = loadFunctions(["sumIncomeForMonths"], ctx);
  const result = sumIncomeForMonths(["2026-05", "2026-06", "2026-07"]);
  assert.equal(result, 12000, "should sum $3000 + $6000 + $3000, not multiply July's $3000 by 3 months");
  assert.equal(calls, 1, "detectDepositIncome() should be called once, not once per month");
});
test("sumIncomeForMonths: declared/manual income (constant per month) is unaffected by the per-month sum", () => {
  const ctx = {
    detectDepositIncome: () => {
      throw new Error("should not be called for declared income");
    },
    getEffectiveIncome: () => 2500,
    state: {
      income: { method: "manual", monthlyAmount: 2500 },
      declaredIncome: 3000,
    },
  };
  const { sumIncomeForMonths } = loadFunctions(["sumIncomeForMonths"], ctx);
  const result = sumIncomeForMonths(["2026-05", "2026-06", "2026-07"]);
  assert.equal(result, 7500, "3 months of the same $2500 getEffectiveIncome() figure");
});

// ── 78th adversarial pass: detectDepositIncome() never checked _bizFilter,
// unlike every other spend/income total in the file (computePeriodSpendVsIncome()'s
// own totalSpend, sumIncomeForMonths() callers via getEffectiveIncome(), etc. all
// gate on it). With income method "auto" and deposits tagged both biz and personal,
// filtering to "Business" compared business-only spend against combined
// business+personal income -- wildly overstating savings / masking a real
// business-side overspend.
//
// 79th adversarial pass: the 78th pass's unconditional guard reached 3 more
// call sites it never audited (openIncomeModal(), selectIncomeMethod(),
// showAutoPreview() -- the Income Setup modal's own "have you imported any
// deposits at all" preview), which don't want _bizFilter scoping and started
// showing a false "No deposit transactions found yet" message whenever an
// unrelated Business/Personal chip was active. Made the filter opt-in via a
// respectBizFilter param: getEffectiveIncome()/sumIncomeForMonths() (feeding
// computePeriodSpendVsIncome()) pass true; the 3 modal-preview call sites
// call it with no argument and get the original always-unfiltered total. ──
test("detectDepositIncome: respectBizFilter=true scopes to the active _bizFilter; omitted (default) ignores it", () => {
  const ctx = {
    state: {
      transactions: [
        { id: "d1", date: "2026-07-15", amount: 4000, card: "chase", desc: "PAYROLL", excluded: true, is_offset: false, biz: false },
        { id: "d2", date: "2026-07-20", amount: 2000, card: "chase", desc: "CLIENT INVOICE DEPOSIT", excluded: true, is_offset: false, biz: true },
      ],
      activeSources: new Set(["chase"]),
    },
  };
  const { detectDepositIncome } = loadFunctions(["detectDepositIncome"], { ...ctx, _bizFilter: "all" });
  assert.equal(detectDepositIncome(true).avgMonthly, 6000, "'all' filter should count both the personal and business deposit");

  const bizOnly = loadFunctions(["detectDepositIncome"], { ...ctx, _bizFilter: "biz" });
  assert.equal(bizOnly.detectDepositIncome(true).avgMonthly, 2000, "'biz' filter should count only the $2000 tagged-business deposit");
  assert.equal(bizOnly.detectDepositIncome().avgMonthly, 6000, "omitting the param should ignore _bizFilter entirely, same as before the 78th pass -- the Income Setup modal's preview needs this");

  const personalOnly = loadFunctions(["detectDepositIncome"], { ...ctx, _bizFilter: "personal" });
  assert.equal(personalOnly.detectDepositIncome(true).avgMonthly, 4000, "'personal' filter should count only the $4000 untagged deposit");
});

// ── 67th adversarial pass: openSyncPassphraseReset() (66th pass) opens the
// same sync-passphrase-modal, and shares Cancel/Escape routing, with
// promptSyncPassphrase()'s genuine unresolved-sign-in flow -- but
// cancelSyncPassphrase() unconditionally signed out either way. For an
// already-signed-in, already-synced session (openSyncPassphraseReset()'s
// case), backing out of "delete my synced data" via Back+Cancel or double-
// Escape silently signed the user out, right after being told nothing
// would happen if they cancelled. window._awaitingCloudMerge distinguishes
// the two cases: true only for a genuinely unresolved sign-in. ──
function cancelSyncPassphraseCtx(awaitingCloudMerge) {
  const signOutCalls = [];
  return {
    ctx: {
      window: { _awaitingCloudMerge: awaitingCloudMerge },
      closeModals: () => {},
      doSignOut: () => signOutCalls.push(true),
      _pendingSyncUid: "some-uid",
    },
    signOutCalls,
  };
}
test("cancelSyncPassphrase: signs out for a genuine unresolved sign-in (window._awaitingCloudMerge true)", () => {
  const { ctx, signOutCalls } = cancelSyncPassphraseCtx(true);
  const { cancelSyncPassphrase } = loadFunctions(["cancelSyncPassphrase"], ctx);
  cancelSyncPassphrase();
  assert.equal(signOutCalls.length, 1, "should sign out when a sign-in was genuinely left unresolved");
});
test("cancelSyncPassphrase: does NOT sign out when opened via openSyncPassphraseReset() on an already-synced session (window._awaitingCloudMerge false)", () => {
  const { ctx, signOutCalls } = cancelSyncPassphraseCtx(false);
  const { cancelSyncPassphrase } = loadFunctions(["cancelSyncPassphrase"], ctx);
  cancelSyncPassphrase();
  assert.equal(signOutCalls.length, 0, "should not silently sign out a device that was already fully signed in and synced");
});

// ── 70th adversarial pass: isPairedAccount() -- the vehicle/physical-asset
// <-> account pairing predicate extracted from saveVehicle(), deleteVehicle(),
// and renderAccountLists() after the identical "legacy fallback missing at
// one more call site" gap recurred across the 35th, 45th, 47th, 58th, and
// 69th adversarial passes. Prefers the modern acctId link; falls back to
// the pre-acctId legacy match (type + exact name) for records saved before
// the 35th pass introduced acctId. ──
test("isPairedAccount: matches by acctId when set, ignoring type/name entirely", () => {
  const { isPairedAccount } = loadFunctions(["isPairedAccount"]);
  const v = { acctId: 42, name: "irrelevant" };
  assert.equal(isPairedAccount({ id: 42, type: "cash", name: "different" }, v), true);
  assert.equal(isPairedAccount({ id: 43, type: "vehicle", name: "irrelevant" }, v), false);
});
test("isPairedAccount: legacy record (acctId null) falls back to type + exact name match", () => {
  const { isPairedAccount } = loadFunctions(["isPairedAccount"]);
  const v = { acctId: null, name: "2021 Honda CR-V" };
  assert.equal(isPairedAccount({ id: 1, type: "vehicle", name: "2021 Honda CR-V" }, v), true);
  assert.equal(isPairedAccount({ id: 2, type: "other-asset", name: "2021 Honda CR-V" }, v), true, "other-asset is a valid paired type too, not just vehicle");
  assert.equal(isPairedAccount({ id: 3, type: "cash", name: "2021 Honda CR-V" }, v), false, "name match alone isn't enough -- type must be vehicle or other-asset");
  assert.equal(isPairedAccount({ id: 4, type: "vehicle", name: "Different Name" }, v), false);
});
test("isPairedAccount: legacy record respects the exclude set, so ambiguous same-named siblings don't both claim the same account", () => {
  const { isPairedAccount } = loadFunctions(["isPairedAccount"]);
  const v = { acctId: null, name: "Boat" };
  const acct = { id: 5, type: "other-asset", name: "Boat" };
  assert.equal(isPairedAccount(acct, v), true);
  assert.equal(isPairedAccount(acct, v, new Set([5])), false, "an excluded account id should never match, even with an otherwise-correct type+name");
  assert.equal(isPairedAccount(acct, v, new Set([6])), true, "excluding an unrelated id shouldn't affect the match");
});

// ── 70th adversarial pass: deleteVehicle()'s legacy fallback removed EVERY
// account sharing the deleted vehicle's type+name, not just its own paired
// one -- surfaced while testing the isPairedAccount() extraction above, not
// introduced by it (the original inline logic had the identical gap). Two
// same-named legacy "Boat" assets, one already self-healed an acctId via an
// earlier edit, one not: deleting the unresolved one used to also delete
// the OTHER boat's already-correctly-paired account. ──
function deleteVehicleCtx(vehicles, accounts, editVehicleId) {
  return {
    editVehicleId,
    state: { vehicles, accounts },
    closeModals: () => {},
    renderAll: () => {},
    scheduleSave: () => {},
  };
}
test("deleteVehicle: removing one of two ambiguous same-named legacy assets doesn't touch the OTHER one's already-paired account", () => {
  const vehicles = [
    { id: 1, name: "Boat", acctId: 101 }, // already resolved via an earlier edit
    { id: 2, name: "Boat", acctId: null }, // still unresolved -- this one gets deleted
  ];
  const accounts = [
    { id: 101, type: "other-asset", name: "Boat", balance: 9999 },
    { id: 102, type: "other-asset", name: "Boat", balance: 2000 },
  ];
  const ctx = deleteVehicleCtx(vehicles, accounts, 2);
  const { deleteVehicle, isPairedAccount } = loadFunctions(["deleteVehicle", "isPairedAccount"], ctx);
  deleteVehicle();
  assert.deepEqual(
    ctx.state.vehicles.map((v) => v.id),
    [1],
    "only the deleted vehicle record should be removed"
  );
  assert.deepEqual(
    ctx.state.accounts.map((a) => a.id),
    [101],
    "account 102 (the deleted vehicle's own paired account) should be removed; account 101 (the OTHER, already-resolved vehicle's account) must survive"
  );
});
test("deleteVehicle: the common case (acctId already set) removes exactly that one paired account", () => {
  const vehicles = [{ id: 1, name: "2021 Honda CR-V", acctId: 50 }];
  const accounts = [{ id: 50, type: "vehicle", name: "2021 Honda CR-V", balance: 22000 }];
  const ctx = deleteVehicleCtx(vehicles, accounts, 1);
  const { deleteVehicle, isPairedAccount } = loadFunctions(["deleteVehicle", "isPairedAccount"], ctx);
  deleteVehicle();
  assert.deepEqual(ctx.state.vehicles, []);
  assert.deepEqual(ctx.state.accounts, []);
});

// ── 71st adversarial pass: renderAccountLists()'s legacy-vehicle exclusion
// loop, and _refreshBudgetModalContext()'s "% under/above avg" text, both
// found while giving the 70th pass's own diff a hard second look (the
// standing "fix regresses/is incomplete in the next pass" note) and a
// fresh-territory pass over the Budget modal. ──
function renderAccountListsCtx(vehicles, accounts) {
  let assetHTML = "";
  return {
    ctx: {
      state: { vehicles, accounts },
      isLiab: (t) => t === "credit" || t === "mortgage" || t === "other-liability",
      SC_M: {}, TC_M: {}, SA_M: {}, TL_M: {},
      esc: (s) => String(s),
      fmt: (n) => String(n),
      document: {
        getElementById: (id) => {
          if (id === "asset-list") return { set innerHTML(v) { assetHTML = v; }, get innerHTML() { return assetHTML; } };
          if (id === "liability-list") return { set innerHTML(v) {}, get innerHTML() { return ""; } };
          return null;
        },
      },
    },
    getAssetHTML: () => assetHTML,
  };
}
test("renderAccountLists: two ambiguous same-named legacy 'Other' assets both get excluded from Financial assets, not just the first match", () => {
  const vehicles = [
    { id: 1, name: "Boat", acctId: null },
    { id: 2, name: "Boat", acctId: null },
  ];
  const accounts = [
    { id: 101, type: "other-asset", name: "Boat", balance: 1000 },
    { id: 102, type: "other-asset", name: "Boat", balance: 2000 },
  ];
  const { ctx, getAssetHTML } = renderAccountListsCtx(vehicles, accounts);
  const { renderAccountLists, isPairedAccount } = loadFunctions(["renderAccountLists", "isPairedAccount"], ctx);
  renderAccountLists();
  assert.doesNotMatch(getAssetHTML(), /1000|2000/, "neither legacy Boat account should appear in Financial assets -- both are paired to Physical assets, not just the first-matched one");
});

test("_refreshBudgetModalContext: '% under/above avg' divides by avg, not the budget amount", () => {
  let contextHTML = "";
  const ctx = {
    window: {},
    document: {
      getElementById: (id) => {
        if (id === "budget-modal") return { style: { setProperty: () => {} } };
        if (id === "budget-amount") return { value: "" };
        if (id === "budget-modal-context") return { set innerHTML(v) { contextHTML = v; }, get innerHTML() { return contextHTML; } };
        return null;
      },
    },
    getCatColor: () => "#000",
    getCatStats: () => ({ Groceries: { avg: 200 } }),
    fmt: (n) => String(n),
    state: { budgets: { Groceries: 100 } },
  };
  const { _refreshBudgetModalContext } = loadFunctions(["_refreshBudgetModalContext"], ctx);
  _refreshBudgetModalContext("Groceries");
  // avg=200, budget=100 -- old buggy formula divided by cur (100): (200-100)/100*100 = 100%.
  // Correct formula divides by avg (200): (200-100)/200*100 = 50%.
  assert.match(contextHTML, /50% under avg/, "should read 50% under avg (divided by the $200 average), not 100% (divided by the $100 budget)");
  assert.doesNotMatch(contextHTML, /100% under avg/);
});

// ── 72nd adversarial pass: exportBudgetCSV()'s Status column used to judge
// "AT RISK" against pct>=warnPct with no isCurrentMonth gate at all -- a
// fully-completed PAST month (the only one with any spend, e.g. exporting
// early in a new month before this category has posted a transaction yet)
// landing in the warn-to-100% band got labeled "AT RISK" even though that
// risk window had already closed. Now delegates to classifyBudgetStatus(),
// the same function the live Budget tab uses, which already requires
// isCurrentMonth for atRisk (see the "not at-risk for a non-current
// (historical) month" test above). ──
test("exportBudgetCSV: a completed PAST month landing in the warn-to-100% band reads On track, not AT RISK", () => {
  const now = new Date();
  const todayYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pastYM = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}`;

  let capturedCsv = null;
  const ctx = {
    state: { budgets: { Groceries: 100 }, budgetWarnPct: 80 },
    MONTHLY: { [pastYM]: {} }, // no entry for todayYM -- this category has no spend yet this month
    getCatMonthSpend: (cat, m) => (m === pastYM ? 85 : 0), // 85% of $100 budget -- inside the warn-to-100% band
    csvSafeField: (s) => s,
    showToast: () => {},
    document: { createElement: () => ({ click: () => {} }) },
    Blob: function (parts) {
      capturedCsv = parts[0];
    },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
  };
  const { exportBudgetCSV } = loadFunctions(["exportBudgetCSV", "classifyBudgetStatus"], ctx);
  exportBudgetCSV();
  const groceriesRow = capturedCsv.split("\n").find((l) => l.startsWith("Groceries"));
  assert.ok(groceriesRow, "Groceries row should exist in the exported CSV");
  assert.match(groceriesRow, /On track$/, "a completed past month at 85% of budget should read On track -- the risk window already closed");
  assert.doesNotMatch(groceriesRow, /AT RISK/);
});

// ── 74th adversarial pass: confirmCatExclusion()/undoCatExclusion() are both
// invoked fresh from the dispatcher via a data-arg attribute (the "Hide"
// confirm popover and the new Undo-in-toast button, respectively), so a
// numeric-looking category name (e.g. "2024") arrives as a real Number, not
// a string -- restoreCat()/toggleCatExclusion() already guard against this
// exact coercion risk with their own String(cat) cast; these two didn't. ──
test("confirmCatExclusion: a numeric-looking category name (coerced to a Number by the dispatcher) is stored as a string, matching how every consumer checks state.excludedCats.has(t.cat)", () => {
  const ctx = {
    state: { excludedCats: new Set(), activeCats: new Set([2024]) },
    scheduleSave: () => {},
    renderSourceChips: () => {},
    renderSpendSummary: () => {},
    renderBucketGrid: () => {},
    renderTxList: () => {},
    renderActiveChart: () => {},
    esc: (s) => String(s),
    tc: (dark) => dark,
    showToast: () => {},
  };
  const { confirmCatExclusion } = loadFunctions(["confirmCatExclusion"], ctx);
  confirmCatExclusion(2024); // dispatcher would pass the Number 2024, not the string "2024"
  assert.deepEqual([...ctx.state.excludedCats], ["2024"], "should be stored as a string, not the Number 2024");
});
test("undoCatExclusion: a numeric-looking category name (coerced to a Number) correctly removes the string entry confirmCatExclusion() actually stored", () => {
  const ctx = {
    state: { excludedCats: new Set(["2024"]) },
    scheduleSave: () => {},
    renderSourceChips: () => {},
    renderSpendSummary: () => {},
    renderBucketGrid: () => {},
    renderTxList: () => {},
    renderActiveChart: () => {},
    esc: (s) => String(s),
    showToast: () => {},
  };
  const { undoCatExclusion } = loadFunctions(["undoCatExclusion"], ctx);
  undoCatExclusion(2024); // dispatcher-coerced Number, same as a real click on the new Undo button
  assert.equal(ctx.state.excludedCats.size, 0, "should remove the string entry, not silently fail to match a Number against it");
});

// ── 74th adversarial pass: removeBudget()'s Undo toast only ever passed 2
// arguments to showToast(msg,color,duration) -- (msg, 4000) -- so 4000
// landed in the `color` slot (an invalid CSS value, silently rejected,
// leaving the toast's color at whatever the previous toast left it) and
// `duration` fell through to showToast()'s 2800ms default instead of the
// clearly-intended 4000ms, the only recovery path for an accidental
// budget deletion. ──
test("removeBudget: showToast is called with an explicit color and the intended 4000ms duration, not with 4000 landing in the color slot", () => {
  let toastArgs = null;
  const ctx = {
    state: { budgets: { Groceries: 100 } },
    scheduleSave: () => {},
    renderBucketGrid: () => {},
    renderBudgetTab: () => {},
    esc: (s) => String(s),
    // tc(dark,light) -- the 75th pass replaced the hardcoded '#94A3B8'
    // (this file's dark-theme --text-secondary, ~2.5:1 contrast on the
    // light theme's toast background) with a real tc() call; mocked here
    // as identity-on-dark since this test only cares about argument
    // position, not theme switching itself.
    tc: (dark) => dark,
    showToast: (...args) => {
      toastArgs = args;
    },
  };
  const { removeBudget } = loadFunctions(["removeBudget"], ctx);
  removeBudget("Groceries");
  assert.equal(toastArgs[1], "#94A3B8", "color should be an explicit value, not the number 4000");
  assert.equal(toastArgs[2], 4000, "duration should be 4000ms in its own argument slot");
});

// ── 81st adversarial pass: renderNwChart()'s Y-axis domain padding,
// Math.min(...vals)*0.98 / Math.max(...vals)*1.02, pads outward correctly
// only when both bounds are positive. For a negative net worth series (a
// real, reachable state for anyone paying down debt -- getIsDark()'s own
// annualPct comment above this function calls this out explicitly),
// multiplying a negative min by 0.98 moves it TOWARD zero (inward) and
// multiplying a negative max by 1.02 moves it AWAY from zero in the wrong
// direction, clipping both series extremes off the chart. renderNwChart()
// itself is D3/DOM-heavy and not a good extraction-test candidate, so this
// re-derives the same range-based padding formula the real fix uses
// (verified via a source match below) and checks it against both a
// negative and a positive series directly. ──
test("renderNwChart Y-axis padding: pads outward correctly for a negative net worth series, not just positive", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const rawMin=Math\.min\(\.\.\.vals\), rawMax=Math\.max\(\.\.\.vals\), vPad=\(rawMax-rawMin\)\*0\.02;\s*const vMin=rawMin-vPad, vMax=rawMax\+vPad;/,
    "renderNwChart() should pad by a fraction of the value RANGE (rawMax-rawMin), not a fraction of each bound's own magnitude"
  );
  const pad = (vals) => {
    const rawMin = Math.min(...vals),
      rawMax = Math.max(...vals),
      vPad = (rawMax - rawMin) * 0.02;
    return { vMin: rawMin - vPad, vMax: rawMax + vPad };
  };
  const neg = pad([-8000, -7000, -6000, -5000, -4000, -2000]);
  assert.ok(neg.vMin <= -8000, `vMin (${neg.vMin}) must be at or below the real minimum (-8000), not above it`);
  assert.ok(neg.vMax >= -2000, `vMax (${neg.vMax}) must be at or above the real maximum (-2000), not below it`);

  const pos = pad([1000, 5000]);
  assert.ok(pos.vMin <= 1000 && pos.vMax >= 5000, "positive series should still pad outward on both ends");
});

// ── 82nd adversarial pass: fmtC()/fmtH() are declared as `const name=...`
// arrow functions, not `function name(...)`, so loadFunctions()'s
// brace-matching extractor (which only anchors on the `function` keyword)
// can't pull them out directly. Extracting the real one-line source
// definitions via regex and eval'ing them keeps this test exercising the
// actual shipped code rather than a hand-derived reimplementation, same
// intent as loadFunctions() elsewhere in this file. ──
function loadConstArrowFn(name) {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const re = new RegExp(`^const ${name}=.*;$`, "m");
  const m = source.match(re);
  if (!m) throw new Error(`loadConstArrowFn: could not find 'const ${name}=...' in source`);
  const esc = (s) => String(s);
  const state = { currency: "$" };
  // eslint-disable-next-line no-eval
  return new Function("esc", "state", `${m[0]}\nreturn ${name};`)(esc, state);
}

// fmtH() rounded the signed value directly and let toLocaleString()'s own
// leading '-' land AFTER the currency symbol ("$-500"), unlike fmtC() which
// explicitly repositions the sign before the symbol ("-$500"). fmtH() feeds
// Chart.js tooltips off raw unguarded monthly accumulators that can go
// negative when a refund exceeds that month's purchases. ──
test("fmtH: negative values put the minus sign before the currency symbol, not after (matches fmtC's convention)", () => {
  const fmtH = loadConstArrowFn("fmtH");
  assert.equal(fmtH(-500), "-$500", "should read -$500, not the malformed $-500");
  assert.equal(fmtH(500), "$500", "positive values are unaffected");
  assert.equal(fmtH(-1234), "-$1,200", "still rounds to the nearest 100 before formatting");
});

// fmtC()'s 'k' branch rounded a in [999500,999999] up to 1000, producing
// "$1000k" instead of switching to the 'M' branch a few hundred dollars
// early -- fmtC() formats live net worth/assets/liabilities/goal figures,
// so any user near the $1M mark could hit this ~$500-wide band. ──
test("fmtC: values in the [999500,999999] band show as $1M, not the malformed $1000k", () => {
  // fmtC() was converted from a const arrow fn to a function declaration in
  // the 105th adversarial pass (to make it real-extractable via the
  // standard loadFunctions() path, needed for its new raw=true parameter's
  // own test) -- loadConstArrowFn() is no longer needed for this one.
  const ctx = { state: { currency: "$" }, esc: (s) => String(s) };
  const { fmtC } = loadFunctions(["fmtC"], ctx);
  assert.equal(fmtC(999499), "$999k", "just below the band is unaffected");
  assert.equal(fmtC(999500), "$1M", "the exact point where the old 'k' rounding first hit 1000");
  assert.equal(fmtC(999999), "$1M");
  assert.equal(fmtC(1000000), "$1M", "existing >=1e6 case is unaffected");
  assert.equal(fmtC(-999600), "-$1M", "negative sign still repositions correctly in the newly-widened M branch");
});

// ── 83rd adversarial pass: saveEditTx()'s `t.amount=parseFloat(...)||t.amount`
// silently reverted an edit to $0 (or a blank field) back to the pre-edit
// value, with the modal still closing normally and no error shown -- a user
// correcting a transaction to a fully-waived $0 fee had their edit silently
// discarded. Both saveEditTx() and saveTx() also accepted the free-text
// #et-date/#t-date fields with zero format validation, unlike the CSV
// import path's parseImportDate(). saveTx()/saveEditTx() themselves read
// directly from document.getElementById(...) with no DOM mock available in
// this test suite (no jsdom dependency), so per this suite's established
// precedent for DOM-heavy functions, this checks the source pattern itself
// rather than driving the functions end-to-end -- a regression back to the
// old `||t.amount` fallback or a bare unvalidated `.value` read would fail
// this match. parseImportDate() itself already has full behavioral
// coverage above (Feb 30, 13/45, missing-year cases). ──
test("saveEditTx/saveTx: amount validation uses isNaN (0 is a legitimate amount), and date is validated via parseImportDate, not accepted as raw text", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(
    source,
    /t\.amount=parseFloat\([^)]*\)\|\|t\.amount/,
    "saveEditTx() should not fall back to the pre-edit amount on a falsy parse -- that treats a deliberate $0 edit as if it never happened"
  );
  assert.match(
    source,
    /const dateVal=parseImportDate\(document\.getElementById\('et-date'\)\.value\);\s*const amountVal=parseFloat\(document\.getElementById\('et-amount'\)\.value\);\s*if\(!dateVal\)/,
    "saveEditTx() should validate its date via parseImportDate() and its amount via a variable checked with isNaN, not a bare `.value` read"
  );
  assert.match(
    source,
    /function saveTx\(\)\{[\s\S]{0,900}?const dateVal=parseImportDate\(document\.getElementById\('t-date'\)\.value\)/,
    "saveTx() should validate its date via parseImportDate() the same way saveEditTx() does"
  );
  // 85th adversarial pass: the 84th pass's fix passed _importDateFmt into
  // both calls, but that module-level flag is only reset when the CSV
  // Import modal itself opens, not on the generic closeModals() a
  // cancelled import routes through -- leaking an unrelated modal
  // session's date-format setting into these two, with no visible
  // indicator in this modal of which format was silently borrowed.
  // Reverted to keep both calls self-contained.
  assert.doesNotMatch(source, /parseImportDate\(document\.getElementById\('et-date'\)\.value,_importDateFmt\)/, "saveEditTx() should not depend on the CSV-import modal's leaked _importDateFmt state");
  assert.doesNotMatch(source, /parseImportDate\(document\.getElementById\('t-date'\)\.value,_importDateFmt\)/, "saveTx() should not depend on the CSV-import modal's leaked _importDateFmt state");
});

// ── 84th adversarial pass: renderNwGoalWidget()'s progress-bar fraction,
// pct=Math.min(nw/goal,1), only clamped the upper bound. goal is always
// positive, but nw (net worth) can be negative while monthlyGrowth is still
// positive -- the snapshot-based growth calc only requires nw>oldest.nw,
// not nw>0, so anyone paying down debt over time (e.g. -50000 six months
// ago, -10000 today) reaches this code with a negative nw. That produced a
// negative pct, an invalid negative SVG rect width (silently fails to
// render per spec), and a nonsensical "-10% there" label -- for exactly
// the early-career, currently-negative-net-worth audience this widget's
// own milestone auto-select is built around. renderNwGoalWidget() itself
// is D3/DOM-heavy and not a good extraction-test candidate, so this checks
// the source pattern directly, matching this suite's established
// precedent for similar chart-math fixes (e.g. the 81st pass's
// renderNwChart padding test above). ──
test("renderNwGoalWidget: progress fraction is clamped to [0,1], not just <=1 -- negative net worth can't produce a negative SVG bar width", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const pct=Math\.max\(0,Math\.min\(nw\/goal,1\)\);/,
    "pct should be clamped on both ends (Math.max(0,...)), not just Math.min(...,1) -- a negative nw with a positive goal must floor at 0, not go negative"
  );
  const clamp = (nw, goal) => Math.max(0, Math.min(nw / goal, 1));
  assert.equal(clamp(-10000, 100000), 0, "negative net worth should floor the progress fraction at 0, not go negative");
  assert.equal(clamp(50000, 100000), 0.5, "positive, sub-goal net worth is unaffected");
  assert.equal(clamp(150000, 100000), 1, "still clamped at 1 for net worth exceeding the goal");
});

// ── 85th adversarial pass: two sibling instances of the same missing-floor
// shape found in ringHTML() (the Budget tab's YTD ring) and barTicksHTML()
// (the per-category fill bar) -- spendByCat's raw sum has no sign
// filtering (established by the 82nd pass's fmtH() fix), so a category
// net-refunded this month produces a negative `spent`/`ytd`. barTicksHTML's
// fillPct fed a CSS width%, and ringHTML's arcPct fed a conic-gradient
// stop -- both invalid when negative, silently breaking the visual fill
// (a "full" bar or a blank ring) instead of correctly showing empty. ──
test("barTicksHTML: fillPct floors at 0 for a net-refunded (negative spend) category, not a negative CSS width%", () => {
  const { barTicksHTML } = loadFunctions(["barTicksHTML"], { fmt: (n) => "$" + Math.abs(n).toLocaleString(), COMBO_TICK_PCT: 6 });
  assert.equal(barTicksHTML(100, 80, -50, true).fillPct, 0, "negative spend should floor fillPct at 0, not produce a negative CSS width%");
  assert.ok(barTicksHTML(100, 80, 50, true).fillPct > 0, "positive spend below the scale max is unaffected");
});
test("ringHTML: arcPct formula floors at 0 for a net-refunded (negative ytd) category, not a negative conic-gradient stop", () => {
  // ringHTML() takes a destructured `{ytd,ytdPace}` parameter, which the
  // extraction harness's brace-counter can't handle (it stops at the
  // destructured param's own closing brace, mistaking it for the function
  // body's end) -- a pre-existing loadFunctions() limitation unrelated to
  // this fix, not something to work around by changing shared test
  // infrastructure mid-pass. Checking the source pattern directly instead,
  // same approach as the renderNwGoalWidget test above.
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const arcPct=ratio==null\?0:Math\.max\(0,Math\.min\(ratio,1\)\)\*100;/,
    "ringHTML()'s arcPct should be clamped on both ends, not just Math.min(ratio,1)*100"
  );
  const arcPct = (ratio) => (ratio == null ? 0 : Math.max(0, Math.min(ratio, 1)) * 100);
  assert.equal(arcPct(-0.5), 0, "negative ytd/ytdPace ratio should floor arcPct at 0, not go negative");
  assert.equal(arcPct(0.5), 50, "a normal in-range ratio is unaffected");
});

// ── 85th adversarial pass: importBackup()'s 'Internal Transfer' backfill
// (mirroring runMigrations()'s one-time version-gated equivalent) had no
// gate at all -- it ran on EVERY restore, silently re-excluding 'Internal
// Transfer' even for a backup exported after a user deliberately
// un-excluded it via the ordinary category toggle. Fixed by gating on the
// backup's own exportedAt timestamp predating the cutoff date the default
// changed. importBackup() itself is a large, file-upload/confirm()-gated,
// heavily DOM-dependent function -- not a good extraction-test candidate,
// so this checks the source pattern and re-derives the exact gate logic
// against representative payload shapes.
//
// 86th adversarial pass: the comparison was strict `<CUTOFF`, but the fix
// that added 'Internal Transfer' to the default exclusion set landed
// DURING July 6, not before it -- date-only precision can't distinguish a
// same-day backup exported before that fix (still needs the backfill)
// from one exported after (already fine), so `<` silently skipped the
// backfill for every backup dated exactly on the cutoff, the opposite of
// this gate's own stated safe-default bias. Fixed to `<=CUTOFF`. ──
test("importBackup: 'Internal Transfer' backfill is gated on the backup's own exportedAt date, inclusive of the cutoff day itself", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!state\.excludedCats\.has\('Internal Transfer'\)&&\(!exportedAt\|\|exportedAt<=CUTOFF\)\)state\.excludedCats\.add\('Internal Transfer'\);/,
    "the backfill should be gated on the backup predating (or matching) the cutoff, not applied to every restore unconditionally, and not excluding the cutoff day itself"
  );
  const CUTOFF = "2026-07-06";
  const shouldBackfill = (exportedAtISO) => {
    const exportedAt = typeof exportedAtISO === "string" ? exportedAtISO.slice(0, 10) : null;
    return !exportedAt || exportedAt <= CUTOFF;
  };
  assert.equal(shouldBackfill("2026-06-01T00:00:00.000Z"), true, "a backup exported before the cutoff should still get the backfill");
  assert.equal(shouldBackfill("2026-07-06T23:59:59.000Z"), true, "a backup exported ON the cutoff date itself (date-only precision can't tell if it was before or after that day's fix) should still get the backfill -- the safe default");
  assert.equal(shouldBackfill("2026-07-14T00:00:00.000Z"), false, "a backup exported well after the cutoff should NOT be backfilled -- the user may have deliberately un-excluded this category");
  assert.equal(shouldBackfill(undefined), true, "a backup with no exportedAt field at all defaults to needing the backfill (the safe default)");
});

// ── 86th adversarial pass: renderYearInReview()'s "Top categories" bar had
// no clamp at all (not even a ceiling) -- byCat's sum has no sign
// filtering, so a category with net refunds exceeding purchases produces
// a negative amt, OR (more subtly) a positive-amt category can still get
// a negative pct if a DIFFERENT category in the same period nets negative
// enough to drag totalSpent itself negative (e.g. Travel=$500,
// Electronics=-$800 net-refunded -> totalSpent=-$300 -> Travel's
// pct=round(500/-300*100)=-167). A negative CSS width% is invalid, so the
// browser drops the declaration and the fill div falls back to
// width:auto, rendering full width for what should show near-empty --
// the same "opposite of reality" failure fixed twice already this cycle
// in ringHTML()/barTicksHTML() (85th pass). Fourth/fifth instance of the
// same missing-clamp shape (81st, 84th, 85th x2, now 86th). ──
test("renderYearInReview: Top categories bar pct is clamped to [0,100] and guarded against totalSpent<=0, not just Math.round with no bounds", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const pct=totalSpent>0\?Math\.max\(0,Math\.min\(100,Math\.round\(amt\/totalSpent\*100\)\)\):0;/,
    "pct should be clamped to [0,100] and guarded against totalSpent<=0, not a bare Math.round with no bounds"
  );
  const pctOf = (amt, totalSpent) => (totalSpent > 0 ? Math.max(0, Math.min(100, Math.round((amt / totalSpent) * 100))) : 0);
  assert.equal(pctOf(500, -300), 0, "a category with positive spend should floor at 0%, not go negative, when another category's refund drags totalSpent negative");
  assert.equal(pctOf(-800, 500), 0, "a category that's itself net-refunded should floor at 0%, not show a negative fill");
  assert.equal(pctOf(1000, 500), 100, "a category exceeding totalSpent (due to another category's refund) should cap at 100%, not overflow past it");
  assert.equal(pctOf(250, 1000), 25, "an ordinary in-range case is unaffected");
  assert.equal(pctOf(100, 0), 0, "totalSpent<=0 should fall back to 0% instead of computing amt/0");
});

// ── 87th adversarial pass: normalizeTxRow()'s date normalization,
// date=parseImportDate(date,_importDateFmt)||date, reverted to the
// ORIGINAL raw string whenever parseImportDate() failed to parse it --
// still truthy for any non-empty garbage cell ("N/A", a corrupted date),
// so the function's own `if(!date||...)return null;` guard two lines
// below never caught it, and the row proceeded with a garbage t.date
// instead of being rejected. normalizeTxRow() itself is a 280+ line
// function with heavy importFmt-branching and many format-specific
// dependencies -- not a good extraction-test candidate for a one-line
// fix, so this checks the source pattern directly and re-derives the
// exact before/after behavior using the real, already-tested
// parseImportDate() (see its own test block above) combined with the
// same guard logic normalizeTxRow() uses. ──
test("normalizeTxRow: an unparseable date is rejected outright, not silently replaced with the original garbage string", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(
    source,
    /if\(date\)date=parseImportDate\(date,_importDateFmt\)\|\|date;/,
    "normalizeTxRow() should not fall back to the original raw date string when parseImportDate() fails -- that defeats the !date rejection guard on the very next line"
  );
  assert.match(
    source,
    /if\(date\)date=parseImportDate\(date,_importDateFmt\);/,
    "normalizeTxRow() should let parseImportDate()'s empty-string failure result flow through to the !date guard"
  );
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  const normalizeDateOld = (raw) => (raw ? parseImportDate(raw, "mdy") || raw : raw);
  const normalizeDateNew = (raw) => (raw ? parseImportDate(raw, "mdy") : raw);
  assert.equal(normalizeDateOld("N/A"), "N/A", "demonstrates the old bug: a garbage date cell survived as a truthy, unrejectable garbage string");
  assert.equal(normalizeDateNew("N/A"), "", "the fixed logic correctly turns a garbage date cell into an empty string, which the !date guard then rejects");
});

// ── 87th adversarial pass: openAddModal() never reset #f-source/#f-type,
// only editAccount()'s edit path set them. Editing an account with a
// non-default Type (e.g. Mortgage), then opening "+ Add Account" fresh,
// left the Type dropdown showing the stale value -- saveAccount() reads
// #f-type's current value directly, and isLiab() treats 'mortgage' as a
// liability, so a stale selection silently subtracted a new account's
// balance from net worth instead of adding it. Same bug class as
// openVehicleModal()'s #v-other-cat reset (45th adversarial pass), never
// mirrored onto this modal. openAddModal() itself is DOM-only (no return
// value, just element mutation) -- checking the source pattern directly,
// matching this suite's precedent for DOM-mutation-only functions. ──
test("openAddModal: resets #f-source and #f-type to their default option, not leaving editAccount()'s stale selection behind", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function openAddModal\(\)\{[^}]*const fs=document\.getElementById\('f-source'\);if\(fs\)fs\.selectedIndex=0;const ft=document\.getElementById\('f-type'\);if\(ft\)ft\.selectedIndex=0;/,
    "openAddModal() should reset both #f-source and #f-type to their first <option> (selectedIndex=0), matching editAccount()'s own reset-on-open convention for the other fields"
  );
});

// ── 88th adversarial pass: openCatModal() reset _confirmingDeleteCatName
// but never its sibling flag _editingCatName (set by startRenameCat()),
// and closeModals() (routed to by the modal's own "Done" button) doesn't
// touch it either. Clicking rename on a category, then "Done" instead of
// confirming/cancelling, left it set -- reopening "Manage categories"
// made renderCatManagerList() see the stale flag and silently re-render
// that row straight into edit mode, unprompted. Same reset-on-open shape
// as openVehicleModal()'s #v-other-cat (45th pass), openAcctCsvModal()
// (77th pass), and openAddModal() (87th pass). ──
test("openCatModal: resets _editingCatName, not just _confirmingDeleteCatName, so a category can't reopen stuck in rename mode", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function openCatModal\(\)\{\s*_confirmingDeleteCatName=null;[\s\S]{0,1200}?_editingCatName=null;\s*renderCatManagerList\(\);/,
    "openCatModal() should reset _editingCatName alongside _confirmingDeleteCatName, before rendering the category list"
  );
});

// ── 88th adversarial pass: deleteVendorAlias()'s manual entity-decode
// (`from.replace(/&amp;/g,'&')...`) operated on a value the browser had
// already decoded once (data-arg="${esc(from)}" round-trips exactly
// through esc()+HTML-attribute-parsing). For the common case this second
// decode was a harmless no-op, but for a vendor description that itself
// literally contains an entity-like substring like "&amp;" as text (real
// CSV-export messiness some banks/portals produce), the extra decode
// corrupted the lookup key, so delete state.vendorAliases[...] silently
// matched nothing and the alias was never actually removed -- no error
// shown, the "✕" click just appeared to do nothing. Confirmed anomalous:
// no sibling delete function (deleteCustomCat, etc.) does a second decode
// pass on an already-decoded data-arg value. ──
test("deleteVendorAlias: deletes the exact key it's given, without a redundant second entity-decode that can corrupt the lookup", () => {
  const ctx = {
    state: { vendorAliases: { "AT&amp;T WIRELESS": "AT&T", Amazon: "Amazon.com" } },
    renderVendorAliasList: () => {},
    renderSpending: () => {},
    scheduleSave: () => {},
  };
  const { deleteVendorAlias } = loadFunctions(["deleteVendorAlias"], ctx);
  deleteVendorAlias("AT&amp;T WIRELESS");
  assert.ok(!("AT&amp;T WIRELESS" in ctx.state.vendorAliases), "a vendor key that literally contains entity-like text should still be deleted by its exact, real key");
  assert.ok("Amazon" in ctx.state.vendorAliases, "an unrelated alias should be untouched");
});

// ── 89th adversarial pass: detectSubscriptions()'s !t.is_offset guard
// (37th pass) only covered ONE source of negative t.amount (Venmo-cashout
// offsets). isRealSpend()/!t.is_offset both still let through a
// manually-typed negative-amount transaction (saveTx()/saveEditTx() only
// validate isNaN, never positivity), and the same underlying bug the 37th
// pass's own comment describes recurs: when a vendor's entries are all
// negative, `median` is negative, and Math.abs(a-median)/median is always
// <=0, so a wildly INCONSISTENT set of negative amounts still passes the
// <0.20 consistency check and gets listed as a "subscription" with a
// negative monthly cost. Fixed by filtering to amount>0 directly (a
// subscription is a recurring CHARGE by definition), closing the whole
// class rather than chasing each individual negative-amount source. ──
test("detectSubscriptions: a wildly inconsistent negative-amount vendor (e.g. manually-entered refunds) is not listed as a subscription", () => {
  const txs = [
    { id: 1, date: "2026-05-01", desc: "REFUND CO", cat: "Shopping", card: "chase", amount: -5, excluded: false, isIncome: false, is_offset: false, biz: false },
    { id: 2, date: "2026-06-01", desc: "REFUND CO", cat: "Shopping", card: "chase", amount: -50, excluded: false, isIncome: false, is_offset: false, biz: false },
    { id: 3, date: "2026-07-01", desc: "REFUND CO", cat: "Shopping", card: "chase", amount: -10, excluded: false, isIncome: false, is_offset: false, biz: false },
  ];
  const ctx = {
    MONTHLY: { "2026-05": {}, "2026-06": {}, "2026-07": {} },
    isRealSpend: (t) => !t.excluded && !t.isIncome,
    resolveVendor: (d) => d,
    state: { transactions: txs, excludedCats: new Set(), activeSources: new Set(["chase"]) },
    _bizFilter: "all",
  };
  const { detectSubscriptions } = loadFunctions(["detectSubscriptions"], ctx);
  const result = detectSubscriptions(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.deepEqual(result.subVendors, [], "a vendor with wildly varying (-5,-50,-10) negative amounts should not be listed as a 'consistent' subscription just because dividing by a negative median flips the sign of the variance check");
  assert.equal(result.subTotal, 0);
});
test("detectSubscriptions: still detects an ordinary, genuinely consistent positive-amount subscription", () => {
  const txs = [1, 2, 3].map((n) => ({
    id: n,
    date: `2026-0${4 + n}-01`,
    desc: "NETFLIX",
    cat: "Entertainment",
    card: "chase",
    amount: 15.99,
    excluded: false,
    isIncome: false,
    is_offset: false,
    biz: false,
  }));
  const ctx = {
    MONTHLY: { "2026-05": {}, "2026-06": {}, "2026-07": {} },
    isRealSpend: (t) => !t.excluded && !t.isIncome,
    resolveVendor: (d) => d,
    state: { transactions: txs, excludedCats: new Set(), activeSources: new Set(["chase"]) },
    _bizFilter: "all",
  };
  const { detectSubscriptions } = loadFunctions(["detectSubscriptions"], ctx);
  const result = detectSubscriptions(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.equal(result.subVendors.length, 1, "an ordinary consistent positive-amount recurring charge should still be detected");
  assert.equal(result.subTotal, 15.99);
});

// ── 89th adversarial pass: openTxImportModal() never reset
// #import-source-label/#import-replace, unlike importParsed/importFmt/
// _importDateFmt/etc. The app's own "Import another CSV" button
// (importSuccessAndReopen()) reopens this exact modal as the designed
// flow for importing several accounts back-to-back -- a source label
// typed for import #1, or "Replace existing transactions from this
// source" left checked from a legitimate re-import, silently carried
// over. confirmTxImport() reads both straight from the DOM, and with
// replace still checked, an unrelated second CSV silently DELETES every
// transaction under the stale source label before importing under the
// wrong one -- no warning shown. openTxImportModal() itself is DOM-only
// (no return value) -- checking the source pattern directly. ──
test("openTxImportModal: resets #import-source-label and #import-replace, not leaving a prior import session's destructive settings behind", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function openTxImportModal\(\)\{[\s\S]{0,2000}?const isl=document\.getElementById\('import-source-label'\);if\(isl\)isl\.value='Checking';\s*const irc=document\.getElementById\('import-replace'\);if\(irc\)irc\.checked=false;/,
    "openTxImportModal() should reset #import-source-label to its default value and #import-replace to unchecked"
  );
});

// ── 90th adversarial pass: loadDemoProfile() resets rangeFrom/rangeTo/
// nwGoal/declaredIncome/_bizFilter/excludedCats/etc. to the demo profile's
// own values, but never state.sourceAlignDate/sourceAlignSkipped.
// getFilteredMonths() applies sourceAlignDate unconditionally
// (months.filter(m=>m>=state.sourceAlignDate)) -- reachable via the
// ?demoPreview=1 marketing-preview URL, where loadFromLocalStorage() runs
// BEFORE this function and populates state.sourceAlignDate from a real
// user's own saved multi-source-alignment choice, which then silently
// truncated the demo data's own months while renderSourceChips() showed a
// stale "Aligned to [date]" banner unrelated to the demo dataset on
// screen. Same shape as the 75th pass's declaredIncome leak, just for
// this field. loadDemoProfile() itself is a large, heavily DOM/render-
// dependent function -- per this suite's established precedent (skip
// extraction-testing loadDemoProfile()/renderAccountLists()/similar,
// rely on source-pattern checks + live verification instead), this
// checks the source pattern directly. ──
test("loadDemoProfile: resets state.sourceAlignDate/sourceAlignSkipped, not leaving a real user's source-alignment choice bleeding into the demo preview", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function loadDemoProfile\(n, silent=false, skipRender=false\)\{[\s\S]{0,3700}?state\.sourceAlignDate=null;\s*state\.sourceAlignSkipped=false;/,
    "loadDemoProfile() should reset both state.sourceAlignDate and state.sourceAlignSkipped, matching its existing reset of rangeFrom/rangeTo/declaredIncome/etc."
  );
});

// ── 91st adversarial pass: confirmClearAllData() (an explicitly-promised
// "this cannot be undone" wipe) removed trakyo_state_v2/trakyo_txs_v1/
// trakyo_state_v1 (data) and trakyo_tab/trakyo_chart (UI-preference keys,
// included specifically so the post-wipe reload starts from a clean UI
// state) -- but not trakyo_show_excl, a preference key of the exact same
// kind. Unlike trakyo_theme/trakyo_tips_seen/trakyo_patterns (genuinely
// cosmetic, correctly left alone), trakyo_show_excl is a DATA-VISIBILITY
// toggle: the load-time IIFE reads it back unconditionally on every boot
// and it bypasses exclusion filters app-wide ((state.showExcluded||!t.
// excluded), 10+ call sites). A user who'd enabled "show excluded/
// transfers in totals," then cleared all data, got the stale preference
// silently reapplied on the very next import -- with zero toggle
// interaction in the new session and no visual cue anything survived the
// wipe. confirmClearAllData() itself is a large async function with a
// network-dependent signOut() race -- not a good extraction-test
// candidate, so this checks the source pattern directly. ──
test("confirmClearAllData: removes trakyo_show_excl, not leaving a stale data-visibility preference behind after an explicitly-promised irreversible wipe", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /localStorage\.removeItem\('trakyo_tab'\);\s*localStorage\.removeItem\('trakyo_chart'\);[\s\S]{0,1500}?localStorage\.removeItem\('trakyo_show_excl'\);/,
    "confirmClearAllData()'s removal list should include trakyo_show_excl alongside its sibling UI-preference keys trakyo_tab/trakyo_chart"
  );
});

// ── 93rd adversarial pass: renderActiveChart() called renderTreemap() bare
// (no argument) whenever chartMode==='split', so the Treemap's own
// drillCat -- which category the user has drilled into -- existed only as
// an ephemeral local parameter, never persisted to state. Every OTHER
// caller of renderActiveChart() besides the Treemap's own category-tile
// click handler (theme toggle, window resize, category-filter/exclusion
// actions, date-range changes, grain changes -- 10+ call sites, several
// extremely common and undeliberate) silently reset an in-progress drill
// to the top-level view with zero warning. Fixed by adding
// state.treemapDrillCat, set by the click handler and read as the default
// argument here, matching the existing persistence pattern already used
// for state.activeVendors/state.bucketMode. ──
test("renderActiveChart: passes the persisted state.treemapDrillCat into renderTreemap(), not a bare call that silently discards an in-progress drill", () => {
  let calledWith = "unset";
  const ctx = {
    state: { chartMode: "split", treemapDrillCat: "Groceries" },
    renderDailyCal: () => {},
    renderTreemap: (arg) => {
      calledWith = arg;
    },
    renderSankey: () => {},
    renderSpendChart: () => {},
  };
  const { renderActiveChart } = loadFunctions(["renderActiveChart"], ctx);
  renderActiveChart();
  assert.equal(calledWith, "Groceries", "renderActiveChart() should pass the persisted drill category through to renderTreemap(), not call it bare");
});
test("renderActiveChart: passes null (top-level view) when no drill is in progress", () => {
  let calledWith = "unset";
  const ctx = {
    state: { chartMode: "split", treemapDrillCat: null },
    renderDailyCal: () => {},
    renderTreemap: (arg) => {
      calledWith = arg;
    },
    renderSankey: () => {},
    renderSpendChart: () => {},
  };
  const { renderActiveChart } = loadFunctions(["renderActiveChart"], ctx);
  renderActiveChart();
  assert.equal(calledWith, null, "with no drill in progress, renderTreemap() should still receive the (falsy) state value, rendering the top-level view");
});

// ── 94th adversarial pass: setChartMode() was the 4th real call site of
// renderTreemap() -- missed by the 93rd pass's own call-site enumeration,
// which only covered 3. Leaving Split mode (mode!=='split' branch) reset
// activeVendors/bucketMode but never state.treemapDrillCat; re-entering
// Split mode (mode==='split' branch) called renderTreemap() bare (always
// showing the top-level view) without nulling state.treemapDrillCat to
// match. Net effect: switch away from a drilled-in Treemap view and back
// (or just re-click "Split" while already active, which skips the
// mode!=='split' reset entirely), and the view visually shows top-level
// categories while state.treemapDrillCat silently still holds the old
// drilled category -- resurfacing with no warning the next time
// renderActiveChart() fires (theme toggle, resize, any unrelated filter
// change), exactly the desync class the 93rd pass fixed everywhere else.
// setChartMode() itself is a large, heavily DOM-dependent function (many
// document.getElementById calls, no jsdom in this suite) -- checking the
// source pattern directly, matching this suite's precedent for similar
// functions. ──
test("setChartMode: resets state.treemapDrillCat both when leaving Split mode and when (re-)entering it, keeping it in sync with the always-top-level renderTreemap() call", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /_restoreCatsFromTreemapStash\(\);\s*\/\/ state\.treemapDrillCat \(93rd pass\)[\s\S]{0,200}?state\.treemapDrillCat=null;\s*\}/,
    "setChartMode()'s mode!=='split' branch (leaving Split mode) should reset state.treemapDrillCat alongside activeVendors/bucketMode"
  );
  assert.match(
    source,
    /state\.treemapDrillCat=null;\s*renderTreemap\(\);\s*return;/,
    "setChartMode()'s mode==='split' branch ((re-)entering Split mode) should null state.treemapDrillCat immediately before its always-top-level renderTreemap() call"
  );
});

// ── 96th adversarial pass: the 95th pass's own hand-written reset blocks in
// importBackup()/confirmTxImport() had already drifted out of sync with
// loadDemoProfile()'s (missing showExcluded/the #tx-search DOM clear in one
// case, missing showExcluded in the other), and loadUserData() (cloud-sync
// restore) was missing the reset entirely despite a comment elsewhere
// claiming it already had it. Consolidated into one shared helper,
// _resetSessionFiltersForDataReplace(), so every wholesale-dataset-replace
// path calls the exact same reset set instead of four independent copies. ──
test("_resetSessionFiltersForDataReplace: resets every session-scoped filter field, clears the search DOM, and un-persists showExcluded", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function _resetSessionFiltersForDataReplace\(\)\{\s*_bizFilter='all';\s*state\.activeCats=new Set\(\);\s*state\.dashFilter=null;\s*state\.searchQuery='';\s*const searchEl=document\.getElementById\('tx-search'\);\s*if\(searchEl\)searchEl\.value='';\s*document\.getElementById\('search-clear-btn'\)\?\.classList\.add\('hidden'\);\s*state\.showExcluded=false;[\s\S]{0,700}?if\(!\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\)\{\s*try\{localStorage\.removeItem\('trakyo_show_excl'\);\}catch\(e\)\{\}\s*\}\s*_clearVendorDayFiltersForDataReplace\(\);\s*\}/,
    "_resetSessionFiltersForDataReplace() should reset _bizFilter/activeCats/dashFilter/searchQuery (+ DOM), showExcluded (+ localStorage key), and call _clearVendorDayFiltersForDataReplace()"
  );
});
test("importBackup, confirmTxImport, and loadDemoProfile all call the shared _resetSessionFiltersForDataReplace() helper", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=arr\(payload\.transactions\)[\s\S]{0,1600}?_resetSessionFiltersForDataReplace\(\);\s*rebuildMonthly\(\);\s*rebuildCatSelects\(\);\s*scheduleSave\(\);\s*renderAll\(\);\s*showToast\('Backup restored\.'/,
    "importBackup() should call _resetSessionFiltersForDataReplace() before rebuildMonthly(), right before its final 'Backup restored.' toast"
  );
  assert.match(
    source,
    /function _replaceDemoDataWithReal\(\)\{\s*if\(state\.hasRealData\)return;[\s\S]{0,1700}?_resetSessionFiltersForDataReplace\(\);/,
    "_replaceDemoDataWithReal() (110th pass; confirmTxImport()'s first-real-import wipe is now one call to this shared helper instead of its own hand-rolled reset list) should call _resetSessionFiltersForDataReplace() as part of its reset"
  );
  assert.match(
    source,
    /state\.nextId=5000;[\s\S]{0,600}?_resetSessionFiltersForDataReplace\(\);\s*rebuildMonthly\(\);\s*rebuildCatSelects\(\);\s*if\(skipRender\)return;/,
    "loadDemoProfile() should call _resetSessionFiltersForDataReplace()"
  );
});

// ── 95th adversarial pass: deleteCustomCat()/confirmRenameCat() cascade to
// budgets/catRules/excludedCats/activeCats (26th/27th passes) but neither
// touched state.treemapDrillCat -- a Treemap drill into the exact category
// being deleted/renamed left renderTreemap() drilling into a name nothing
// matches anymore on the very next render. Delete clears the reference
// (the category is gone); rename updates it (the category still exists,
// just under a new name) -- matching how both functions already treat
// state.activeCats for the identical shape.
//
// 96th adversarial pass: a third holder of category names, missed by the
// 95th pass's own cascade -- _treemapPrevActiveCats, a snapshot Set stashed
// when drilling into a Treemap vendor tile, restored back onto
// state.activeCats later (deselecting the vendor, changing chart mode, or
// switching tabs). Same delete-clears/rename-updates treatment. ──
test("deleteCustomCat: clears state.treemapDrillCat and the _treemapPrevActiveCats stash when the deleted category is the one currently drilled into / stashed", () => {
  const ctx = {
    state: {
      customCategories: [{ name: "Groceries", color: null }],
      transactions: [{ id: 1, cat: "Groceries" }],
      budgets: {},
      catRules: [],
      excludedCats: new Set(),
      activeCats: new Set(),
      treemapDrillCat: "Groceries",
    },
    window: { _catColorMap: null },
    renderCatManagerList: () => {},
    rebuildCatSelects: () => {},
    rebuildMonthly: () => {},
    renderAll: () => {},
    scheduleSave: () => {},
    _confirmingDeleteCatName: "Groceries",
    _treemapPrevActiveCats: new Set(["Groceries", "Other"]),
  };
  const { deleteCustomCat } = loadFunctions(["deleteCustomCat"], ctx);
  deleteCustomCat("Groceries");
  assert.equal(ctx.state.treemapDrillCat, null, "deleting the category currently drilled into should clear treemapDrillCat, not leave it pointing at a category that no longer exists");
  assert.equal(ctx._treemapPrevActiveCats.has("Groceries"), false, "deleting a category stashed in _treemapPrevActiveCats should remove it from the stash too, not just from the live activeCats set");
  assert.equal(ctx._treemapPrevActiveCats.has("Other"), true, "the stash's unrelated entries should survive untouched");
});
test("confirmRenameCat: updates state.treemapDrillCat and the _treemapPrevActiveCats stash to the new name when the renamed category is the one currently drilled into / stashed", () => {
  const inputEl = { value: "Food", style: {} };
  const ctx = {
    state: {
      customCategories: [{ name: "Groceries", color: null }],
      transactions: [{ id: 1, cat: "Groceries" }],
      budgets: {},
      catRules: [],
      excludedCats: new Set(),
      activeCats: new Set(),
      treemapDrillCat: "Groceries",
    },
    window: { _catColorMap: null },
    document: { getElementById: (id) => (id === "rename-cat-input" ? inputEl : null) },
    isReservedCatName: () => false,
    getAllCats: () => ["Groceries", "Other"],
    renderCatManagerList: () => {},
    rebuildCatSelects: () => {},
    rebuildMonthly: () => {},
    renderAll: () => {},
    scheduleSave: () => {},
    _editingCatName: "Groceries",
    _treemapPrevActiveCats: new Set(["Groceries", "Other"]),
  };
  const { confirmRenameCat } = loadFunctions(["confirmRenameCat"], ctx);
  confirmRenameCat("Groceries");
  assert.equal(ctx.state.treemapDrillCat, "Food", "renaming the category currently drilled into should update treemapDrillCat to the new name, since the category still exists, just renamed");
  assert.equal(ctx._treemapPrevActiveCats.has("Groceries"), false, "the old name should no longer be present in the stash after rename");
  assert.equal(ctx._treemapPrevActiveCats.has("Food"), true, "the stash should hold the new name after rename, matching the live activeCats treatment");
  assert.equal(ctx._treemapPrevActiveCats.has("Other"), true, "the stash's unrelated entries should survive untouched");
});

// ── 96th adversarial pass: saveToLocalStorage() guards demo-preview sessions
// from persisting anything ("demo-preview sessions never persist"), but
// toggleExcluded()'s direct localStorage write bypassed that guard entirely
// -- toggling "Show in totals" while previewing a demo (over real saved
// data, or via the marketing ?demoPreview=1 link) leaked a demo-only
// preference into the visitor's next real session. ──
test("toggleExcluded: persists trakyo_show_excl to localStorage during a normal session", () => {
  let stored = null;
  const ctx = {
    state: { showExcluded: false },
    window: {},
    localStorage: { setItem: (k, v) => { stored = [k, v]; } },
    document: { getElementById: () => null },
    renderSourceChips: () => {}, renderSpendSummary: () => {}, renderBucketGrid: () => {}, renderTxList: () => {}, renderActiveChart: () => {},
    showTxN: 50,
  };
  const { toggleExcluded } = loadFunctions(["toggleExcluded"], ctx);
  toggleExcluded();
  assert.equal(ctx.state.showExcluded, true, "toggleExcluded() should flip state.showExcluded");
  assert.deepEqual(stored, ["trakyo_show_excl", "1"], "a normal session should persist the toggle to localStorage");
});
test("toggleExcluded: does NOT persist trakyo_show_excl to localStorage during a demo-preview session", () => {
  let stored = null;
  const ctx = {
    state: { showExcluded: false },
    window: { _viewingDemoOverReal: true },
    localStorage: { setItem: (k, v) => { stored = [k, v]; } },
    document: { getElementById: () => null },
    renderSourceChips: () => {}, renderSpendSummary: () => {}, renderBucketGrid: () => {}, renderTxList: () => {}, renderActiveChart: () => {},
    showTxN: 50,
  };
  const { toggleExcluded } = loadFunctions(["toggleExcluded"], ctx);
  toggleExcluded();
  assert.equal(ctx.state.showExcluded, true, "toggleExcluded() should still flip the in-memory flag so the current demo-preview session reflects the toggle");
  assert.equal(stored, null, "a demo-preview session (_viewingDemoOverReal) must not leak the toggle into localStorage for the next real session to pick up");
});

// ── 96th adversarial pass: renderNwGoalWidget()'s ETA calculation called
// Date.setMonth() on a Date still holding today's day-of-month -- on the
// 29th/30th/31st, adding N months overflows into the month after the
// intended one whenever that target month is shorter (e.g. Jan 31 + 1
// month lands on Mar 2/3, since Feb has no 31st), even though only the
// month/year are ever displayed. Fixed by clamping the day to 1 first. ──
test("renderNwGoalWidget: clamps the ETA date to day 1 before adding months, avoiding month-end overflow", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const eta=new Date\(\);\s*eta\.setDate\(1\);\s*eta\.setMonth\(eta\.getMonth\(\)\+monthsToGoal\);/,
    "the ETA date should be clamped to day 1 before setMonth() is called, so adding months can't overflow into the following month on the 29th-31st"
  );
});

// ── 96th adversarial pass: the dashboard net-worth pill's goal-percentage
// label had the same unclamped-fraction shape the 84th/85th/86th passes
// fixed for chart widths -- state.nwGoal is always positive, but nwNow can
// be negative (someone paying down debt), producing a negative percentage
// label ("-15% of the way to $100k") with nothing rendering-breaking about
// it, just visibly wrong. ──
test("dashboard net-worth pill: clamps the goal percentage to a minimum of 0", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const goalPct=Math\.max\(0,Math\.round\(nwNow\/state\.nwGoal\*100\)\);/,
    "goalPct should be floored at 0 so a negative net worth doesn't produce a negative percentage label"
  );
});

// ── 97th adversarial pass: _resetSessionFiltersForDataReplace() (introduced
// the previous pass) unconditionally removed trakyo_show_excl from
// localStorage -- including when called from loadDemoProfile() while
// genuinely previewing a demo over real saved data, silently deleting the
// real "Show in totals" preference the demo-preview banner promised would
// stay untouched. Same invariant toggleExcluded() enforces for the write
// side of this exact key, just missing here for the delete side. ──
test("_resetSessionFiltersForDataReplace: does NOT remove trakyo_show_excl from localStorage during a demo-preview session", () => {
  let removed = false;
  const ctx = {
    _bizFilter: "business",
    state: {
      activeCats: new Set(["Foo"]), dashFilter: "x", searchQuery: "starbucks", showExcluded: true,
      activeDate: null, activeVendors: new Set(), bucketMode: "category", treemapDrillCat: null,
    },
    window: { _viewingDemoOverReal: true },
    document: { getElementById: () => null },
    localStorage: { removeItem: () => { removed = true; } },
    _treemapPrevActiveCats: null,
  };
  const { _resetSessionFiltersForDataReplace } = loadFunctions(["_resetSessionFiltersForDataReplace", "_clearVendorDayFiltersForDataReplace"], ctx);
  _resetSessionFiltersForDataReplace();
  assert.equal(ctx.state.showExcluded, false, "the in-memory flag should still flip so the current demo-preview session reflects the reset");
  assert.equal(removed, false, "a demo-preview session (_viewingDemoOverReal) must not remove the real trakyo_show_excl key from localStorage");
});
test("_resetSessionFiltersForDataReplace: DOES remove trakyo_show_excl from localStorage during a normal session", () => {
  let removed = false;
  const ctx = {
    _bizFilter: "business",
    state: {
      activeCats: new Set(["Foo"]), dashFilter: "x", searchQuery: "starbucks", showExcluded: true,
      activeDate: null, activeVendors: new Set(), bucketMode: "category", treemapDrillCat: null,
    },
    window: {},
    document: { getElementById: () => null },
    localStorage: { removeItem: () => { removed = true; } },
    _treemapPrevActiveCats: null,
  };
  const { _resetSessionFiltersForDataReplace } = loadFunctions(["_resetSessionFiltersForDataReplace", "_clearVendorDayFiltersForDataReplace"], ctx);
  _resetSessionFiltersForDataReplace();
  assert.equal(removed, true, "a normal (non-demo-preview) wholesale-replace should still remove the stale localStorage key");
});
test("loadDemoProfile: sets window._viewingDemoOverReal before calling _resetSessionFiltersForDataReplace(), not after", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const hadRealData=state\.hasRealData;[\s\S]{0,700}?if\(!silent&&hadRealData\)window\._viewingDemoOverReal=true;[\s\S]{0,6000}?_resetSessionFiltersForDataReplace\(\);/,
    "window._viewingDemoOverReal must be set before _resetSessionFiltersForDataReplace() runs, not near the end of the function, since that helper's own localStorage guard depends on the flag already being current"
  );
});

// ── 97th adversarial pass: addVendorAlias()'s merge-loop guard called
// resolveVendor(to), which only ever returns the chain's *terminal* value --
// missing the case where `from` sits mid-chain rather than at the end
// (updating an existing alias's target can walk straight through it).
// Replaced with _vendorAliasChainReaches(), which checks every hop. ──
test("_vendorAliasChainReaches: detects `from` as an intermediate hop in the chain, not just the terminal value", () => {
  const ctx = { state: { vendorAliases: { AMZN: "Amazon", Amazon: "Shopping" } } };
  const { _vendorAliasChainReaches } = loadFunctions(["_vendorAliasChainReaches"], ctx);
  assert.equal(_vendorAliasChainReaches("AMZN", "Amazon"), true, "AMZN's chain (AMZN->Amazon->Shopping) passes through 'Amazon' as an intermediate hop, which the old resolveVendor(to)-only check missed");
  assert.equal(_vendorAliasChainReaches("Shopping", "Amazon"), false, "'Shopping' has no further alias and never reaches 'Amazon'");
});
test("addVendorAlias: refuses to re-point an alias in a way that would close a multi-hop merge loop", () => {
  let toastMsg = null;
  const ctx = {
    state: { vendorAliases: { AMZN: "Amazon", Amazon: "Shopping" } },
    document: {
      getElementById: (id) => {
        if (id === "alias-from") return { value: "Amazon" };
        if (id === "alias-to") return { value: "AMZN" };
        return null;
      },
    },
    isReservedCatName: () => false,
    esc: (s) => s,
    showToast: (msg) => { toastMsg = msg; },
    renderVendorAliasList: () => {}, renderSpending: () => {}, scheduleSave: () => {},
  };
  const { addVendorAlias } = loadFunctions(["addVendorAlias", "_vendorAliasChainReaches"], ctx);
  addVendorAlias();
  assert.match(toastMsg || "", /merge loop/i, "re-pointing Amazon->AMZN should be refused as a merge loop, not silently accepted");
  assert.deepEqual(ctx.state.vendorAliases, { AMZN: "Amazon", Amazon: "Shopping" }, "the alias map should be unchanged after a refused update -- not left as a closed 2-cycle that silently neutralizes both merges");
});

// ── 97th adversarial pass: renderVendorAliasList()'s per-alias transaction
// count matched against the raw t.desc, so a chained alias (merging an
// already-merged display name into a further alias) always showed "(0
// transactions)" despite correctly affecting every transaction upstream in
// the chain -- no raw transaction description ever literally equals a
// synthetic intermediate display name like "Amazon". ──
test("renderVendorAliasList: counts a chained alias's affected transactions via the full resolution chain, not a raw-desc match", () => {
  const elStub = { innerHTML: "" };
  const ctx = {
    state: {
      vendorAliases: { "AMAZON.COM": "Amazon", Amazon: "Shopping" },
      transactions: [{ desc: "AMAZON.COM" }, { desc: "WALMART" }],
    },
    document: { getElementById: (id) => (id === "vendor-alias-list" ? elStub : null) },
    esc: (s) => s,
  };
  const { renderVendorAliasList } = loadFunctions(["renderVendorAliasList", "_vendorAliasChainReaches"], ctx);
  renderVendorAliasList();
  assert.doesNotMatch(elStub.innerHTML, /\(0 transactions\)/, "neither alias row should show 0 -- both are on the one AMAZON.COM transaction's resolution chain");
  const oneTxCount = (elStub.innerHTML.match(/\(1 transaction\)/g) || []).length;
  assert.equal(oneTxCount, 2, "both the AMAZON.COM->Amazon hop and the chained Amazon->Shopping hop should correctly count the same 1 transaction");
});

// ── 97th adversarial pass: confirmClearAllData() only checked
// window._isDemoPreview, not window._viewingDemoOverReal, unlike every
// other demo-preview guard in the file (10+ sites all pair the two). A
// signed-in user with real saved data who clicks "try demo" in-app could
// reach Settings -> Clear all data and irreversibly wipe their real
// localStorage while the banner told them their data was untouched. ──
test("confirmClearAllData: blocks the wipe during an in-app demo-over-real preview, not just the ?demoPreview=1 URL mode", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /async function confirmClearAllData\(\)\{[\s\S]{0,900}?if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{/,
    "confirmClearAllData() should early-return for _viewingDemoOverReal the same way it already does for _isDemoPreview"
  );
});

// ── 97th adversarial pass: exportTransactionsCSV()'s csvSafeField() prepends
// a ' to any field starting with =/+/-/@ (formula-injection guard), but
// re-importing our own export ('trakyodollas' format) never stripped it back
// off -- a description/category that originally started with one of those
// characters came back permanently prefixed with a literal ' it never had. ──
test("_stripCsvFormulaGuard: reverses csvSafeField()'s leading ' only when it guards one of the injection-risk characters", () => {
  const ctx = {};
  const { _stripCsvFormulaGuard } = loadFunctions(["_stripCsvFormulaGuard"], ctx);
  assert.equal(_stripCsvFormulaGuard("'-1-800-FLOWERS"), "-1-800-FLOWERS", "a ' guarding a leading - should be stripped back off");
  assert.equal(_stripCsvFormulaGuard("'=SUM(A1)"), "=SUM(A1)", "a ' guarding a leading = should be stripped back off");
  assert.equal(_stripCsvFormulaGuard("'Twas a fine purchase"), "'Twas a fine purchase", "a ' NOT followed by a guarded character is a genuine leading apostrophe and must be left alone");
  assert.equal(_stripCsvFormulaGuard("Ordinary Store"), "Ordinary Store", "a value with no leading ' at all is untouched");
});
test("normalizeTxRow's 'trakyodollas' import branch strips the formula-injection guard from both description and category", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /desc=_stripCsvFormulaGuard\(\(row\['description'\]\|\|''\)\.trim\(\)\);/,
    "description should be passed through _stripCsvFormulaGuard() on our own round-trip import format"
  );
  assert.match(
    source,
    /cat=_stripCsvFormulaGuard\(\(row\['category'\]\|\|'Other'\)\.trim\(\)\)\|\|'Other';/,
    "category should be passed through _stripCsvFormulaGuard() on our own round-trip import format (trimmed as of the 109th adversarial pass, matching desc's own treatment)"
  );
});

// ── 97th adversarial pass: parseCSV() applied a redundant second
// .replace(/^"|"$/g,'') on top of splitCSVLine()'s own quote-consuming
// parse, silently destroying a field whose real content legitimately ends
// or starts with a literal quote character (e.g. an inch mark). ──
test("parseCSV: preserves a field's genuine trailing quote character instead of stripping it", () => {
  const ctx = {};
  const { parseCSV } = loadFunctions(["parseCSV", "splitCSVLine", "splitCSVRows"], ctx);
  const csv = 'Desc,Amount\n"BLINDS 72""",5.00';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].desc, 'BLINDS 72"', "a field CSV-encoded as a trailing literal quote (doubled inside the enclosing quotes) should round-trip with that quote intact, not silently lose it");
});

// ── 98th adversarial pass: loadUserData()'s call to
// _resetSessionFiltersForDataReplace() (added the 96th pass) fires on
// *every* successful cloud pull, including the silent, no-modal-shown
// re-pull promptSyncPassphrase() performs on every ordinary page reload for
// a returning signed-in user with a cached passphrase -- not just a genuine
// demo-to-real transition (which, per promptSyncPassphrase()'s own guard,
// this call path can never actually be reached during in the first place).
// Reverted to this function's pre-96th-pass behavior: only
// _clearVendorDayFiltersForDataReplace(), whose fields are all
// session-only view state never persisted by serializeState(), unlike
// _bizFilter/activeCats/dashFilter/searchQuery/showExcluded. ──
test("loadUserData: the transactions-replace branch calls only _clearVendorDayFiltersForDataReplace(), not the full session-filter reset", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if \(Array\.isArray\(prefs\.transactions\)\) \{[\s\S]{0,4200}?_clearVendorDayFiltersForDataReplace\(\);\s*rebuildMonthly\(\);/,
    "loadUserData()'s cloud-sync transactions-replace branch should call _clearVendorDayFiltersForDataReplace() (session-only fields, safe on every pull), not _resetSessionFiltersForDataReplace() (which reverts a signed-in user's own persisted showExcluded/_bizFilter on every routine reload)"
  );
});

// ── 98th adversarial pass: importBackup() and confirmTxImport() had no
// demo-preview guard at all, unlike confirmClearAllData() (97th pass) --
// saveToLocalStorage()/scheduleSave() are hard no-ops during a
// demo-preview session, so both actions could appear to succeed (a
// confirm() dialog, a full success toast/modal) while persisting nothing,
// silently reverting on the next reload. ──
test("importBackup: refuses to run during a demo-preview session instead of appearing to succeed and persisting nothing", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function importBackup\(file\)\{\s*if\(!file\)return;[\s\S]{0,600}?if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{\s*showToast\('Not available while previewing demo data/,
    "importBackup() should early-return with the standard demo-preview toast before ever reading the file"
  );
});
test("confirmTxImport: refuses to run during a demo-preview session instead of appearing to succeed and persisting nothing", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function confirmTxImport\(\)\{\s*if\(!importParsed\.length\)return;[\s\S]{0,900}?if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{\s*closeModals\(\);\s*showToast\('Not available while previewing demo data/,
    "confirmTxImport() should early-return with the standard demo-preview toast before touching state.transactions"
  );
});

// ── 98th adversarial pass: renderYearInReview()'s "Quietest month" reduce
// was seeded with the *unfiltered* byMonth[0], even though it only ever
// iterates the spent>0-filtered array -- if the window's chronologically
// first month has spent===0 (a deselected source zeroing it, or just a
// genuinely quiet first month), that $0 seed beats every real candidate in
// the b.spent<a.spent comparison every time, so "Quietest month" always
// showed that $0 month instead of the actual lowest nonzero-spend month. ──
test("Year in Review: quietestMonth is seeded from the filtered (spent>0) array, not the raw unfiltered byMonth[0]", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/const _positive\w*=byMonth\.filter\(m=>m\.spent>0\);\s*const quietestMonth=_positive\w*\.length\?_positive\w*\.reduce\(\(a,b\)=>b\.spent<a\.spent\?b:a\):null;/g) || [];
  assert.equal(matches.length, 2, "both renderYearInReview() and copyYirSummary() should seed quietestMonth's reduce from the filtered array (or null if nothing passed the filter), not raw byMonth[0]");
});

// ── 98th adversarial pass: renderYearInReview()'s net-worth-change card
// picked firstSnap as the earliest snapshot AT OR AFTER the window's start,
// and lastSnap as the latest snapshot AT OR BEFORE the window's end -- if no
// snapshot falls inside the window but snapshots exist on both sides,
// firstSnap can land chronologically AFTER lastSnap, inverting both the
// sign of nwChange and the "firstSnap -> lastSnap" display labels/range. ──
test("Year in Review: net-worth change requires firstSnap to be chronologically at or before lastSnap", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/firstSnap&&lastSnap&&firstSnap!==lastSnap&&firstSnap\.monthKey<=lastSnap\.monthKey\?lastSnap\.nw-firstSnap\.nw:null/g) || [];
  assert.equal(matches.length, 2, "both renderYearInReview() and copyYirSummary() should require firstSnap.monthKey<=lastSnap.monthKey before computing nwChange, falling back to null (hides the card) rather than showing an inverted result");
});

// ── 98th adversarial pass: _vendorAliasChainReaches() (added the 97th pass)
// checked `current` against `from` before attempting each hop, so its
// <10 loop bound only ever checked nodes at hop-distance 0-9 from `to` (10
// nodes) -- one short of resolveVendor()'s own walk, which advances up to
// 10 hops forward (11 reachable nodes, hop-distance 0-10). A 10-alias-deep
// chain with `from` as the very last node was reachable by resolveVendor()
// but invisible to this cycle check. ──
test("_vendorAliasChainReaches: detects `from` at the full 10-hop depth resolveVendor() itself can reach", () => {
  const vendorAliases = {};
  let prev = "V0";
  for (let i = 1; i <= 10; i++) {
    vendorAliases[prev] = `V${i}`;
    prev = `V${i}`;
  }
  // vendorAliases: V0->V1->V2->...->V9->V10 (a 10-hop chain)
  const ctx = { state: { vendorAliases } };
  const { _vendorAliasChainReaches } = loadFunctions(["_vendorAliasChainReaches"], ctx);
  assert.equal(_vendorAliasChainReaches("V0", "V10"), true, "V10 sits exactly 10 hops from V0 -- the same depth resolveVendor() can walk -- and must be detected, not silently missed by an off-by-one loop bound");
});

// ── 99th adversarial pass: with the 96th-98th passes' session-filter/
// demo-preview cluster finally verified clean end-to-end, this pass
// rebaselined and found 5 fresh bugs elsewhere in the file. ──

// loadUserData()'s Supabase query for snapshots has no ORDER BY (and can't
// sort server-side -- the row is encrypted), so an edited snapshot (its row
// physically relocates on UPDATE) could come back out of chronological
// order. Several consumers (renderInsights()'s NW pill, renderHistory()'s
// growth banner/deltas) index state.snapshots positionally instead of
// using the existing getSortedSnaps() helper.
test("loadUserData: sorts state.snapshots by monthKey after a cloud pull, since the query itself has no ORDER BY", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.snapshots = snaps\.filter\(_isValidSnapshot\)\.map\(s => \(\{[\s\S]{0,300}?\}\)\);[\s\S]{0,1400}?state\.snapshots\.sort\(_snapshotSortCompare\);/,
    "loadUserData() should sort state.snapshots by monthKey immediately after building it from the cloud payload"
  );
});

// confirmSrcRemove()'s `src` param is coerced to a Number by the
// event-delegation dispatcher for any numeric-looking source label (e.g.
// "4783", a card's last-4 digits) -- t.card is always a string, so the
// comparison silently matched nothing without a String() cast, matching
// the fix already applied to toggleSource()/etc. in the 13th pass.
test("confirmSrcRemove: coerces a numeric-looking source label back to a string before filtering transactions", () => {
  let toastMsg = null;
  const ctx = {
    state: {
      transactions: [{ card: "4783", desc: "A" }, { card: "4783", desc: "B" }, { card: "Chase", desc: "C" }],
      activeSources: new Set(["4783", "Chase"]),
    },
    mutateTransactions: (fn) => fn(),
    closeSrcRemovePop: () => {},
    renderSpending: () => {},
    showToast: (msg) => { toastMsg = msg; },
    esc: (s) => s,
  };
  const { confirmSrcRemove } = loadFunctions(["confirmSrcRemove"], ctx);
  confirmSrcRemove(4783); // simulates the dispatcher's coerce() turning "4783" into a Number
  assert.equal(ctx.state.transactions.length, 1, "both '4783'-carded transactions should be removed, not zero of them");
  assert.equal(ctx.state.activeSources.has("4783"), false, "the numeric-looking source should actually be removed from activeSources");
  assert.match(toastMsg || "", /Removed 2 transaction/, "the toast should report the real removed count, not 0");
});

// renderHistory()'s annualized-rate calc parsed first.date/last.date
// (locale display strings like "Apr 30, 2026", not ISO) with .split('-'),
// which has no hyphens to split on -- producing Invalid Date and a
// permanently-null/unreachable "%/yr annualized" figure. Fixed to use
// parseYM() against monthKey, matching renderInsights()'s NW pill.
test("renderHistory: computes the annualized-rate window from monthKey via parseYM(), not from the locale-formatted .date string", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(
    source,
    /const \[_fy2,_fm2,_fd2\]=first\.date\.split\('-'\)/,
    "renderHistory() should no longer try to ISO-parse first.date/last.date, which are locale display strings with no hyphens"
  );
  assert.match(
    source,
    /const firstDate=parseYM\(first\.monthKey\),lastDate=parseYM\(last\.monthKey\);/,
    "renderHistory() should derive firstDate/lastDate from monthKey via parseYM(), the same approach renderInsights()'s NW pill already uses correctly"
  );
});

// renderSankey() could throw (fmtMonthShort(undefined) inside periodStr)
// when totalIncome>0 (declared/manual income configured) but
// getFilteredMonths() returns an empty array (no transactions in range) --
// reachable by a new user setting up income before importing any CSV.
// saveDeclaredIncome()/clearDeclaredIncome() call this function bare
// (uncaught), so the crash also skipped their own renderInsights() refresh.
test("renderSankey: shows the income-setup nudge instead of crashing when there's income but no transactions in range", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!totalIncome\|\|!filteredMonths\.length\)\{\s*wrap\.innerHTML=`<div class="sankey-nudge"/,
    "renderSankey()'s early-return nudge should also fire when filteredMonths is empty, not just when totalIncome is falsy, since periodStr's fmtMonthShort(filteredMonths[0]) throws on an empty array"
  );
});

// window._isDemoPreview was only ever set inside the DOMContentLoaded
// handler, but the later <script> block's _sb.auth.onAuthStateChange()
// callback resolves asynchronously via a promise chain, not gated on any
// DOM event -- theoretically able to read the flag as undefined before
// DOMContentLoaded runs. Computed at parse time instead, closing the race
// regardless of the exact microtask/macrotask ordering.
test("window._isDemoPreview is computed at parse time, before the DOMContentLoaded handler", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /window\._isDemoPreview=new URLSearchParams\(window\.location\.search\)\.get\('demoPreview'\)==='1';\s*\n\s*\/\/ Wire up after DOM ready\s*\ndocument\.addEventListener\('DOMContentLoaded'/,
    "window._isDemoPreview should be assigned at top-level script scope, immediately before the DOMContentLoaded listener registration -- not inside the handler itself"
  );
});

// ── 100th adversarial pass: fresh-territory findings, all outside the
// just-rebaselined session-filter/demo-preview cluster. ──

// renderDailyCal()'s endDate defaulted to midnight local time (the numeric
// Date constructor's default), while every transaction parses at noon --
// a transaction on the range's actual last calendar day (noon) failed
// d<=endDate (midnight) and was silently excluded from the calendar's
// totals/cells. Month-end bills (rent, mortgage) are a routine trigger.
test("renderDailyCal: endDate is anchored to noon, matching how transaction dates are parsed, so the last day of the range isn't silently excluded", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const endDate=new Date\(maxMonth\.slice\(0,4\),parseInt\(maxMonth\.slice\(5,7\)\),0,12\); \/\/ last day of max month/,
    "endDate's Date constructor should pass 12 as the hours argument, matching new Date(t.date+'T12:00:00')'s noon anchor for every transaction"
  );
});

// renderDailyCal() threw (maxMonth.slice() on undefined) when
// getFilteredMonths() returns [] -- reachable uncaught via
// setChartMode('daily') for a user with no transactions in range, the
// same crash shape renderSankey() had before the 99th pass's fix.
test("renderDailyCal: shows a 'No data' state instead of crashing when there are no transaction months in range", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function renderDailyCal\(\)\{[\s\S]{0,2500}?const filteredMonths=getFilteredMonths\(\);[\s\S]{0,700}?if\(!filteredMonths\.length\)\{\s*wrap\.innerHTML=`<div style="padding:2rem;color:var\(--text-muted\);font-size:12px;text-align:center">No data for this period<\/div>`;\s*return;\s*\}/,
    "renderDailyCal() should guard against an empty filteredMonths array before deriving minMonth/maxMonth"
  );
});

// importBackup() only shape-checks state.snapshots/state.vehicles as
// arrays -- a crafted backup file's .date/.purchaseYear/.miles fields flow
// unescaped into innerHTML in renderHistory()/renderVehicles(), the one
// unescaped seam in a file that treats crafted-backup-file XSS as in-scope
// (matches the pass-15 Budget-row and pass-34 community-rules-CSV fixes).
test("renderHistory and renderVehicles escape snapshot/vehicle fields that could carry an HTML payload from a crafted backup file", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /\$\{esc\(first\.date\)\} – \$\{esc\(last\.date\)\}/, "renderHistory()'s growth banner should esc() first.date/last.date");
  assert.match(source, /<div class="account-name" style="font-size:12px">\$\{esc\(s\.date\)\}<\/div>/, "renderHistory()'s per-row date should be esc()'d");
  assert.match(source, /purchased \$\{esc\(String\(v\.purchaseYear\)\)\}/, "renderVehicles() should esc(String(...)) purchaseYear");
  assert.match(source, /\$\{\(Number\(v\.miles\)\|\|0\)\.toLocaleString\(\)\} mi/, "renderVehicles() should Number()-coerce miles before .toLocaleString(), since a string passes through that method unchanged");
});


// renderNwBreakdown()'s liability group-header total hardcoded a leading
// '-' regardless of the group's actual net sign -- fmt() always
// Math.abs()'s its argument, so a liability group whose accounts net to a
// credit (raw<0) has net=-raw>0 (a real asset-like contribution) but
// still displayed with a '-' as if it were still net debt.
test("renderNwBreakdown: the group-header total's sign is driven by net<0, not hardcoded per group type", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\$\{net<0\?'-':''\}\$\{fmt\(net\)\}<\/span>/,
    "the group-header total should show '-' exactly when net<0, matching the per-item isNeg pattern used just above it, not a hardcoded sign tied to g.isLiab"
  );
  assert.doesNotMatch(
    source,
    /\$\{g\.isLiab\?`-\$\{fmt\(raw\)\}`:fmt\(net\)\}/,
    "the old hardcoded-per-branch sign logic should be gone"
  );
});

// ── 101st adversarial pass: fresh-territory findings, plus a regression
// re-verification catch in the 100th pass's own future-date fix. ──

// saveHistoricalSnapshot()'s 100th-pass future-date guard compared `d`
// (the selected date pinned to noon) against `new Date()` (the exact
// current moment) -- before noon local, today-at-noon > now, so entering
// TODAY's own date (openHistoricalSnapshotModal()'s own prefilled
// default) was rejected as "in the future." Fixed with a pure
// YYYY-MM-DD string comparison, avoiding all time-of-day ambiguity.
test("saveHistoricalSnapshot: allows today's own date at any time of day, only rejects a date after today", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const todayIso=\(\(\)=>\{const t=new Date\(\);return`\$\{t\.getFullYear\(\)\}-\$\{String\(t\.getMonth\(\)\+1\)\.padStart\(2,'0'\)\}-\$\{String\(t\.getDate\(\)\)\.padStart\(2,'0'\)\}`;\}\)\(\);\s*if\(date>todayIso\)\{showToast\('That date is in the future/,
    "the future-date check should compare the raw YYYY-MM-DD date string against today's own YYYY-MM-DD string, not a noon-pinned Date object against the exact current moment"
  );
  assert.doesNotMatch(
    source,
    /if\(d>new Date\(\)\)\{showToast\('That date is in the future/,
    "the old Date-object comparison (which rejected today's own date before noon) should be gone"
  );
});

// renderNwGoalWidget()'s milestone auto-select (`MILESTONES.find(m=>m>nw)`)
// returns undefined once nw exceeds the top $5M milestone, leaving `goal`
// undefined -- `needed=goal-nw` is then NaN, cascading to "$NaN to go",
// an "Invalid Date" ETA, and a NaN-width progress bar. Fixed with an
// explicit no-goal-available branch pointing at openCustomNwGoal().
test("renderNwGoalWidget: shows a custom-goal prompt instead of NaN/Invalid Date when net worth exceeds every built-in milestone", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!projEl\)return;[\s\S]{0,1100}?if\(!goal\)\{\s*projEl\.innerHTML=`[\s\S]{0,600}?data-action="openCustomNwGoal"[\s\S]{0,400}?return;\s*\}/,
    "renderNwGoalWidget() should guard on !goal, before the 'Goal reached' check, and point the user at openCustomNwGoal() rather than the milestone-only setNwGoalNextMilestone() (which also silently no-ops past the top milestone)"
  );
});

// The 100th pass's own crafted-backup-XSS sweep of renderVehicles() missed
// 3 more sites of the identical gap: v.id (both editVehicle data-arg
// attributes) and v.year (the KBB link's data-arg) interpolate raw into an
// HTML attribute; v.model also risked a TypeError crash, not just
// injection, via (v.model||'').split(' ') -- a crafted backup storing
// v.model as a truthy non-string bypasses the ||'' fallback.
test("renderVehicles: escapes v.id and v.year in data-arg attributes, and coerces v.model to a string before .split()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const idMatches = source.match(/data-action="editVehicle" data-arg="\$\{esc\(String\(v\.id\)\)\}"/g) || [];
  assert.equal(idMatches.length, 2, "both editVehicle buttons (the 'other' asset branch and the regular vehicle branch) should esc(String(v.id))");
  assert.match(
    source,
    /data-action="openKBB" data-arg="\$\{esc\(String\(v\.year\)\)\}"/,
    "the KBB link's data-arg should esc(String(v.year))"
  );
  assert.match(
    source,
    /data-arg3="\$\{esc\(String\(v\.model\|\|''\)\.split\(' '\)\[0\]\)\}"/,
    "v.model should be String()-coerced before .split(' '), so a non-string payload (e.g. a number) can't throw instead of just being escaped"
  );
});

// loadFromLocalStorage()/importBackup() both assigned state.snapshots
// directly from a saved payload with no sort -- the local cache and a
// hand-edited/corrupted backup file aren't guaranteed to already be
// chronologically ordered, and every positional consumer of
// state.snapshots trusts that they are (same invariant loadUserData()'s
// 99th-pass fix restores for the cloud-pull path).
test("loadFromLocalStorage and importBackup both sort state.snapshots by monthKey after assigning it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.snapshots=Array\.isArray\(saved\.snapshots\)\?saved\.snapshots\.filter\(_isValidSnapshot\):state\.snapshots;[\s\S]{0,700}?state\.snapshots\.sort\(_snapshotSortCompare\);/,
    "loadFromLocalStorage() should sort state.snapshots immediately after assigning it from the local cache"
  );
  assert.match(
    source,
    /state\.snapshots=arr\(saved\.snapshots\)\.filter\(_isValidSnapshot\);[\s\S]{0,400}?state\.snapshots\.sort\(_snapshotSortCompare\);/,
    "importBackup() should sort state.snapshots immediately after assigning it from the backup payload"
  );
});

// ── 102nd adversarial pass: all 5 places that sort state.snapshots by
// monthKey (getSortedSnaps(), saveHistoricalSnapshot(), loadUserData(),
// loadFromLocalStorage(), importBackup()) used a bare
// `(a,b)=>a.monthKey.localeCompare(b.monthKey)` comparator with no guard
// against a null/undefined entry or a non-string monthKey. Worst case
// (importBackup()): a crafted backup with a malformed snapshots entry
// threw mid-assignment, after state.accounts/vehicles/snapshots were
// already replaced but before the rest of the restore completed --
// exactly the corrupted-hybrid-state failure mode the surrounding
// type-guard block's own comment already names as the thing it exists to
// prevent. Consolidated into one shared, crash-safe comparator. ──
test("_snapshotSortCompare: treats a missing or non-string monthKey as an empty string instead of throwing", () => {
  const ctx = {};
  const { _snapshotSortCompare } = loadFunctions(["_snapshotSortCompare"], ctx);
  const arr = [
    { monthKey: "2026-03" },
    { monthKey: 202601 }, // non-string -- a crafted/corrupted entry
    null, // malformed entry entirely
    { monthKey: "2026-02" },
    {}, // missing monthKey
  ];
  assert.doesNotThrow(() => arr.sort(_snapshotSortCompare), "sorting an array with malformed entries should not throw");
  // The three malformed/missing-monthKey entries all sort as '' (first),
  // followed by the two valid entries in chronological order.
  const validOrder = arr.filter(s => s && typeof s.monthKey === "string").map(s => s.monthKey);
  assert.deepEqual(validOrder, ["2026-02", "2026-03"], "the genuinely-valid entries should still end up correctly ordered relative to each other");
});
test("every state.snapshots sort call site uses the shared _snapshotSortCompare, not a bare inline comparator", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const sortCalls = source.match(/state\.snapshots\.sort\([^)]*\)/g) || [];
  assert.ok(sortCalls.length >= 4, "expected at least 4 direct state.snapshots.sort(...) call sites");
  for (const call of sortCalls) {
    assert.match(call, /_snapshotSortCompare/, `${call} should use the shared safe comparator, not an inline one`);
  }
  assert.match(
    source,
    /function getSortedSnaps\(\)\{\s*return state\.snapshots\.slice\(\)\.sort\(_snapshotSortCompare\);\s*\}/,
    "getSortedSnaps() should also use the shared comparator"
  );
});

// ── 102nd adversarial pass: renderNwGoalWidget()'s "Goal reached!" banner
// always pointed its button at setNwGoalNextMilestone() -- but that
// function's own MILESTONES.find(m=>m>nw) returns undefined once nw is at
// or past the top $5M milestone (whether the reached goal was that top
// milestone or a higher custom one), silently no-op'ing on click. The
// 101st pass's own fix comment named this exact dead end but only routed
// around it for the separate !goal case, not this one. ──
test("renderNwGoalWidget: the 'Goal reached' banner routes to openCustomNwGoal() instead of the dead-end setNwGoalNextMilestone() once no next milestone exists", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(nw>=goal\)\{[\s\S]{0,700}?const hasNextMilestone=MILESTONES\.some\(m=>m>nw\);[\s\S]{0,700}?data-action="\$\{hasNextMilestone\?'setNwGoalNextMilestone':'openCustomNwGoal'\}"/,
    "the goal-reached banner's button should check for a next milestone and fall back to openCustomNwGoal() when none exists"
  );
});

// ── 103rd adversarial pass: the crafted-backup-restore threat model this
// cycle already treats as in-scope (XSS fixes in passes 100/101, the
// sort-crash fix in pass 102) turned out to apply to plain crashes too --
// importBackup() could throw mid-restore on a malformed transactions or
// customCategories entry, landing state in a corrupted hybrid with no
// rollback (the exact failure mode the surrounding type-guard block's own
// comment names as what it exists to prevent). A 6th state.snapshots
// sort/filter site (renderMetrics()) also survived pass 102's
// consolidation -- missed because it spreads into a new array first
// rather than matching the literal `state.snapshots.sort(...)` pattern
// that consolidation was scoped to. Rather than patch each of the ~13
// places that iterate state.snapshots/transactions/customCategories
// individually, filtered out malformed entries at the 3 points these
// arrays are ever populated from external/untrusted data. ──
test("_isValidSnapshot: rejects null/non-object entries and entries with a non-string monthKey", () => {
  const ctx = {};
  const { _isValidSnapshot } = loadFunctions(["_isValidSnapshot"], ctx);
  assert.equal(_isValidSnapshot({ monthKey: "2026-03" }), true);
  assert.equal(_isValidSnapshot(null), false);
  assert.equal(_isValidSnapshot(undefined), false);
  assert.equal(_isValidSnapshot({}), false, "missing monthKey should be rejected");
  assert.equal(_isValidSnapshot({ monthKey: 202603 }), false, "a non-string monthKey should be rejected");
});
test("importBackup: filters malformed transactions/customCategories/snapshots entries instead of crashing mid-restore", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=arr\(payload\.transactions\)\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "importBackup() should filter out non-object transaction entries and coerce a malformed date to a safe default before mapping"
  );
  assert.match(
    source,
    /state\.customCategories=_arrOfObj\(saved\.customCategories\);/,
    "importBackup() should filter out non-object customCategories entries"
  );
  assert.match(
    source,
    /state\.snapshots=arr\(saved\.snapshots\)\.filter\(_isValidSnapshot\);/,
    "importBackup() should filter state.snapshots through _isValidSnapshot"
  );
});
test("loadFromLocalStorage: filters malformed transactions/customCategories/snapshots entries from the local cache", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "loadFromLocalStorage() should filter out non-object transaction entries and coerce a malformed date"
  );
  assert.match(
    source,
    /state\.customCategories=Array\.isArray\(saved\.customCategories\)\?_arrOfObj\(saved\.customCategories\):state\.customCategories;/,
    "loadFromLocalStorage() should filter out non-object customCategories entries"
  );
  assert.match(
    source,
    /state\.snapshots=Array\.isArray\(saved\.snapshots\)\?saved\.snapshots\.filter\(_isValidSnapshot\):state\.snapshots;/,
    "loadFromLocalStorage() should filter state.snapshots through _isValidSnapshot"
  );
});
test("loadUserData: filters malformed snapshot rows before mapping, not after", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.snapshots = snaps\.filter\(_isValidSnapshot\)\.map\(s => \(\{/,
    "loadUserData() should filter snaps through _isValidSnapshot before the .map() that dereferences each entry's fields"
  );
});
test("renderMetrics: allSnaps is null-safe and uses the shared snapshot sort comparator", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const allSnaps=\[\.\.\.state\.snapshots\]\.filter\(s=>s&&typeof s\.monthKey==='string'\)\.sort\(_snapshotSortCompare\);/,
    "renderMetrics()'s allSnaps should null-check each entry before touching .monthKey, and use the shared comparator -- this was a 6th snapshot sort/filter site missed by the 102nd pass's consolidation because it spreads into a new array rather than matching the literal state.snapshots.sort(...) pattern"
  );
});

// ── 104th adversarial pass: a dedicated, single-purpose audit of every
// OTHER field importBackup()/loadFromLocalStorage()/loadUserData() restore
// from external/untrusted data, following up on 4 consecutive passes
// (100-103) each finding a crash-on-malformed-entry gap in the previous
// pass's own fix. Rather than let this keep surfacing one field per pass,
// audited every remaining field in one sweep: state.accounts,
// state.vehicles, state.catRules, state.vendorAliases, state.hiddenPills,
// state.activeSources, state.sourceAlignDate, and two residual gaps in
// state.transactions/state.customCategories pass 103's own fix didn't
// reach (loadUserData(), the cloud-sync path, plus a txSource
// array-check in loadFromLocalStorage()). Two new shared helpers,
// _arrOfObj() (array of well-formed objects) and _strValueObj() (object
// with string-only values), consolidate the array/object-shape guards
// the same way _isValidSnapshot() already did for snapshots. ──

test("_arrOfObj: coerces to an array and drops null/primitive entries", () => {
  const ctx = {};
  const { _arrOfObj } = loadFunctions(["_arrOfObj"], ctx);
  assert.deepEqual(_arrOfObj([{ a: 1 }, null, "x", 5, { b: 2 }]), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(_arrOfObj(null), []);
  assert.deepEqual(_arrOfObj({}), []);
  assert.deepEqual(_arrOfObj(undefined), []);
});
test("_strValueObj: keeps only string-valued keys, coerces non-object input to {}", () => {
  const ctx = {};
  const { _strValueObj } = loadFunctions(["_strValueObj"], ctx);
  assert.deepEqual(_strValueObj({ a: "Amazon", b: 5, c: null, d: "Shopping" }), { a: "Amazon", d: "Shopping" });
  assert.deepEqual(_strValueObj(null), {});
  assert.deepEqual(_strValueObj([1, 2]), {}, "an array should not be treated as a valid vendorAliases object");
  assert.deepEqual(_strValueObj("x"), {});
});
test("_normalizeAccountTypes: filters null/non-object entries before dereferencing .type on each one", () => {
  const ctx = { ACCT_TYPE_ALIASES: { checking: "cash" } };
  const { _normalizeAccountTypes } = loadFunctions(["_normalizeAccountTypes"], ctx);
  const result = _normalizeAccountTypes([{ type: "checking" }, null, "garbage", { type: "cash" }]);
  assert.deepEqual(result, [{ type: "cash", balance: 0 }, { type: "cash", balance: 0 }], "null/non-object entries should be dropped, not crash the forEach, and a real entry's type should still get normalized via ACCT_TYPE_ALIASES");
});

// ── 130th adversarial pass ──────────────────────────────────────────────
// LOW/MEDIUM: unlike every other numeric ingestion path (transaction
// amount, manual-entry balance, CSV account import), account balance
// restored through _normalizeAccountTypes() (all 3 callers: cloud sync,
// local storage, backup restore) was taken verbatim from whatever a
// hand-edited or corrupted payload contained -- a comma-formatted string,
// a plain numeric string, or Infinity/NaN. totalAssets()/totalLiab() do
// `s+a.balance` in a reduce, so a string balance produces string
// concatenation instead of a sum, poisoning netWorth() into NaN, and the
// corrupted value then persists straight back to localStorage/cloud sync
// on the next save. Found in the 130th adversarial pass. ──
test("_normalizeAccountTypes: coerces balance to a finite number, stripping commas and falling back to 0 for non-finite input", () => {
  const ctx = { ACCT_TYPE_ALIASES: {} };
  const { _normalizeAccountTypes } = loadFunctions(["_normalizeAccountTypes"], ctx);
  const result = _normalizeAccountTypes([
    { type: "checking", balance: 1000 },
    { type: "checking", balance: "1,234.56" },
    { type: "checking", balance: "500" },
    { type: "checking", balance: "Infinity" },
    { type: "checking", balance: "garbage" },
    { type: "checking" },
    { type: "credit", balance: -2500 },
  ]);
  assert.deepEqual(
    result.map(a => a.balance),
    [1000, 1234.56, 500, 0, 0, 0, -2500],
    "a plain number should be untouched, a comma-formatted string should be parsed correctly (not truncated at the comma), a plain numeric string should parse, Infinity/garbage/missing should fall back to 0, and a negative liability balance should be preserved"
  );
});
test("loadFromLocalStorage: accounts/vehicles/catRules/vendorAliases/hiddenPills/activeSources/sourceAlignDate/nextId are all Array.isArray/type-guarded, and accounts routes through _normalizeAccountTypes", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /state\.accounts=Array\.isArray\(saved\.accounts\)\?_normalizeAccountTypes\(saved\.accounts\):state\.accounts;/, "accounts should be Array.isArray-guarded and routed through _normalizeAccountTypes(), which loadFromLocalStorage() never called before");
  assert.match(source, /state\.vehicles=Array\.isArray\(saved\.vehicles\)\?_arrOfObj\(saved\.vehicles\):state\.vehicles;/, "vehicles should be Array.isArray-guarded and entry-filtered");
  assert.match(source, /state\.catRules=_arrOfObj\(saved\.catRules\)\.filter\(r=>typeof r\.keyword==='string'\);/, "catRules should be entry-filtered plus a string-keyword check");
  assert.match(source, /state\.vendorAliases=_strValueObj\(saved\.vendorAliases\);/, "vendorAliases should be filtered to string-only values");
  assert.match(source, /state\.hiddenPills=new Set\(Array\.isArray\(saved\.hiddenPills\)\?saved\.hiddenPills:\[\]\);/, "hiddenPills should be Array.isArray-guarded before new Set()");
  assert.match(source, /if\(Array\.isArray\(saved\.activeSources\)&&saved\.activeSources\.length>0\)\{/, "activeSources should be Array.isArray-guarded, not just checked for a truthy .length");
  assert.match(source, /state\.sourceAlignDate=typeof saved\.sourceAlignDate==='string'\?saved\.sourceAlignDate:null;/, "sourceAlignDate should be type-checked, not just ??null");
  assert.match(source, /state\.nextId=Number\(saved\.nextId\)\|\|state\.nextId;/, "nextId should be Number()-coerced");
  assert.match(source, /const txSource=txRaw\?JSON\.parse\(txRaw\):saved\.transactions;[\s\S]{0,900}?state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)/, "the transactions txSource should be Array.isArray-checked before .filter()");
});
test("importBackup: vehicles/catRules/vendorAliases all route through the new shared helpers", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /state\.vehicles=_arrOfObj\(saved\.vehicles\);/, "vehicles should route through _arrOfObj()");
  assert.match(source, /state\.catRules=_arrOfObj\(saved\.catRules\)\.filter\(r=>typeof r\.keyword==='string'\);/, "catRules should be entry-filtered plus a string-keyword check");
  assert.match(source, /state\.vendorAliases=_strValueObj\(saved\.vendorAliases\);/, "vendorAliases should route through _strValueObj()");
  assert.match(source, /state\.customCategories=_arrOfObj\(saved\.customCategories\);/, "customCategories should route through _arrOfObj() (simplified from the 103rd pass's manual inline filter)");
});
test("loadUserData: customCategories/vehicles/catRules/vendorAliases/hiddenPills/transactions/nextId all get the same guards as the other two ingestion paths -- the cloud-sync path was the least-guarded of the three", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /if \(prefs\.customCategories\) state\.customCategories = _arrOfObj\(prefs\.customCategories\);/, "customCategories should route through _arrOfObj() -- this was pass 103's own gap on the cloud-sync path");
  assert.match(source, /if \(Array\.isArray\(prefs\.vehicles\)\) state\.vehicles = _arrOfObj\(prefs\.vehicles\);/, "vehicles should route through _arrOfObj()");
  assert.match(source, /if \(prefs\.catRules\) state\.catRules = _arrOfObj\(prefs\.catRules\)\.filter\(r=>typeof r\.keyword==='string'\);/, "catRules should be entry-filtered plus a string-keyword check");
  assert.match(source, /if \(prefs\.vendorAliases\) state\.vendorAliases = _strValueObj\(prefs\.vendorAliases\);/, "vendorAliases should route through _strValueObj()");
  assert.match(source, /if \(Array\.isArray\(prefs\.hiddenPills\)\) state\.hiddenPills = new Set\(prefs\.hiddenPills\);/, "hiddenPills should be Array.isArray-guarded, not just truthy-checked");
  assert.match(
    source,
    /state\.transactions = prefs\.transactions\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "transactions should get the same entry-filter and date-coercion pass 103 already applied to importBackup()/loadFromLocalStorage()"
  );
  assert.match(source, /if \(prefs\.nextId\) state\.nextId = Number\(prefs\.nextId\)\|\|state\.nextId;/, "nextId should be Number()-coerced");
});

// ── 105th adversarial pass: fresh findings after re-verifying pass 104's
// systematic audit held up (it did, in full) -- a genuine 10th gap the
// audit's own field-level scoping didn't cover (transaction desc/cat/card
// subfields, not the entry/date-level guards already fixed), plus two
// unrelated fresh-territory findings. ──

test("transaction ingestion: desc/cat/card are string-coerced (with cat defaulting to 'Other') at all 3 ingestion points, not just date/amount", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const pattern = /date:typeof t\.date==='string'\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset/g;
  const matches = source.match(pattern) || [];
  assert.equal(matches.length, 3, "all 3 ingestion points (loadUserData, loadFromLocalStorage, importBackup) should coerce desc/cat/card the same way -- a truthy non-string desc previously threw in resolveVendor()/displayVendor(), reachable from the Treemap, Spending tab, and the Dashboard's own 'largest charge' card");
});
test("resolveVendor and displayVendor only guard against falsy input, not a truthy non-string, confirming the transaction-ingestion fix is necessary", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /const resolveVendor=desc=>\{\s*if\(!desc\)return desc;/, "resolveVendor()'s guard is falsy-only");
  assert.match(source, /const displayVendor=name=>\{\s*if\(!name\)return name;/, "displayVendor()'s guard is falsy-only");
});

test("loadUserData and loadFromLocalStorage object-shape-guard state.budgets/state.income, matching importBackup()'s existing obj()-based guard", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /if \(prefs\.budgets && typeof prefs\.budgets === 'object' && !Array\.isArray\(prefs\.budgets\)\) state\.budgets = prefs\.budgets;/, "loadUserData() should object-shape-guard budgets");
  assert.match(source, /if \(prefs\.income && typeof prefs\.income === 'object' && !Array\.isArray\(prefs\.income\)\) state\.income = prefs\.income;/, "loadUserData() should object-shape-guard income");
  assert.match(source, /if\(saved\.budgets&&typeof saved\.budgets==='object'&&!Array\.isArray\(saved\.budgets\)&&Object\.keys\(saved\.budgets\)\.length>0\)state\.budgets=saved\.budgets;/, "loadFromLocalStorage() should object-shape-guard budgets (Object.keys().length>0 alone is true for a non-empty string too)");
  assert.match(source, /state\.income=\(saved\.income&&typeof saved\.income==='object'&&!Array\.isArray\(saved\.income\)\)\?saved\.income:\{method:null,monthlyAmount:0\};/, "loadFromLocalStorage() should object-shape-guard income");
});

test("fmtC: raw=true skips esc(), for D3 .text() SVG contexts that would otherwise double-escape a custom currency symbol", () => {
  const ctx = { state: { currency: "A&B" }, esc: (s) => String(s).replace(/&/g, "&amp;") };
  const { fmtC } = loadFunctions(["fmtC"], ctx);
  assert.equal(fmtC(1000), "A&amp;B1k", "default (raw=false) should still esc() the currency symbol, matching every existing innerHTML-based caller");
  assert.equal(fmtC(1000, true), "A&B1k", "raw=true should skip esc(), so a D3 .text() node doesn't render a literal '&amp;' instead of '&'");
});
test("fmtC(...,true) is used at every D3 .text() call site that renders a currency figure", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /\.text\(d=>fmtC\(d,true\)\);/, "the NW chart's axis-tick labels should use raw fmtC");
  assert.match(source, /\.text\(goalInRange\?`Goal \$\{fmtC\(state\.nwGoal,true\)\}`:`Goal \$\{fmtC\(state\.nwGoal,true\)\} ↑`\);/, "the NW goal chart label should use raw fmtC");
  assert.match(source, /\.text\(fmtC\(d\.data\.value,true\)\+\(drillCat\?'':' · '\+pct\+'%'\)\);/, "the Treemap tile's large-label variant should use raw fmtC");
  assert.match(source, /\.text\(fmtC\(d\.data\.value,true\)\);/, "the Treemap tile's small-label variant should use raw fmtC");
  assert.match(source, /return`\$\{d\.name\} \$\{fmtC\(d\.value,true\)\} · \$\{pct\}%`;/, "the Sankey node label should use raw fmtC");
});

test("Sankey link tooltip: the third (real-category) branch has a space after </strong>, matching its two sibling branches", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /:`<strong>\$\{esc\(d\.target\.name\)\}<\/strong> \$\{fmtC\(d\.value\)\} · \$\{Math\.round\(d\.value\/totalIncome\*100\)\}% of income`;/,
    "the real-category tooltip branch should have a space between </strong> and the currency figure, matching the __other__/__filtered_out__ branches above it"
  );
});

// ── 106th adversarial pass ──────────────────────────────────────────────

// Finding 1 (HIGH): openEditTxModal() always calls buildRcList(t,t.cat,t.cat)
// on every open (origCat===newCat is always true then), so buildRcList()'s
// early-return branch (no similar txs, or origCat===newCat) runs on
// essentially every ordinary modal open. That branch hid #recategorize-
// section but never cleared #rc-list's innerHTML, and closeModals() never
// touched it either -- any checkboxes left checked from an earlier,
// unrelated "similar transactions" list (shown while editing a DIFFERENT
// transaction's category, then cancelled instead of saved) stayed checked
// in the hidden DOM. saveEditTx()'s '#rc-list input:checked' query has no
// visibility or origin check, so saving ANY later, unrelated transaction
// edit silently recategorized those stale sibling transactions to the new
// edit's category. buildRcList()/closeModals() are DOM-heavy (not real-
// extraction candidates per this suite's established precedent for
// document.getElementById-driven functions), so this checks the source
// pattern directly. ──
test("buildRcList: the early-return branch clears #rc-list's innerHTML, not just hides #recategorize-section", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function buildRcList\(tx,origCat,newCat\)\{[\s\S]{0,3000}?\n\}/);
  assert.ok(fnMatch, "buildRcList() should exist");
  assert.match(
    fnMatch[0],
    /if\(!similar\.length\|\|origCat===newCat\)\{\s*sec\.classList\.add\('hidden'\);[\s\S]{0,1200}?document\.getElementById\('rc-list'\)\.innerHTML='';\s*return;\s*\}/,
    "buildRcList()'s early-return branch should clear #rc-list's innerHTML before returning, so stale checked checkboxes from an earlier call can't survive into a later, unrelated saveEditTx()"
  );
});

// Finding 2 (MEDIUM): the chase and debitcredit import branches fell back to
// the RAW bank category string (row['category']) when their own guess
// returned 'Other', unlike mint/ynab/monarch which route through
// mapImportedCategory() as their primary strategy (guaranteeing the result
// is always one of getAllCats()'s registered categories). An unrecognized
// raw string isn't in that list, so rebuildCatSelects()'s
// `if(cur)el.value=cur` silently fails to select it in the edit-tx modal's
// <select> the next time the transaction is opened for editing, leaving the
// category field blank with no error. normalizeTxRow() is a 280+ line DOM/
// state-heavy function with established source-pattern-only test precedent
// in this suite (see the 87th pass's date-validation test above). ──
test("normalizeTxRow: chase/debitcredit branches route their raw-category fallback through mapImportedCategory(), not the unvalidated bank string", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const chaseMatch = source.match(/\}\s*else if\(importFmt==='chase'\)\{[\s\S]{0,1400}?\n\n  \} else if\(importFmt==='debitcredit'\)/);
  assert.ok(chaseMatch, "the chase import branch should exist");
  assert.match(
    chaseMatch[0],
    /if\(cat==='Other'\)cat=mapImportedCategory\(row\['category'\]\)\|\|'Other';/,
    "chase's 'Other' fallback should route through mapImportedCategory(), landing on a registered category or the safe 'Other' default -- not an arbitrary unregistered bank string"
  );
  const debitcreditMatch = source.match(/\}\s*else if\(importFmt==='debitcredit'\)\{[\s\S]{0,1300}?\n\n  \} else if\(importFmt==='bofa'\)/);
  assert.ok(debitcreditMatch, "the debitcredit import branch should exist");
  assert.match(
    debitcreditMatch[0],
    /if\(cat==='Other'\)cat=mapImportedCategory\(row\['category'\]\)\|\|'Other';/,
    "debitcredit's 'Other' fallback should route through mapImportedCategory(), same as the chase branch"
  );
});

// Finding 3 (MEDIUM): openOtherVendorsModal()'s "Avg: $X/mo" divided by
// Object.keys(MONTHLY).length -- the entire dataset's all-time month count,
// ignoring the active time-window filter -- while every topVendors tile's
// own average (renderVendorBuckets(), the sibling surface one click away)
// already divides by allPeriods (grainedPeriods.length, which DOES respect
// the active filter). Both functions are D3/DOM-heavy; source-pattern only,
// matching this suite's established precedent. ──
test("openOtherVendorsModal: the per-vendor average divides by the active time window's period count, not the all-time month count", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /window\._otherVendorsAvgDenom=allPeriods;/,
    "the vendor-bucket render should stash the same allPeriods used for topVendors tiles' own averages"
  );
  assert.match(
    source,
    /Avg: \$\{fmt\(Math\.round\(d\.total\/\(window\._otherVendorsAvgDenom\|\|1\)\)\)\}\$\{window\._otherVendorsAvgGrainLabel\|\|'\/mo'\}/,
    "openOtherVendorsModal() should divide by window._otherVendorsAvgDenom, not Object.keys(MONTHLY).length (unit label updated by the 107th pass to be grain-aware too, see below)"
  );
  assert.doesNotMatch(
    source,
    /d\.total\/\(Object\.keys\(MONTHLY\)\.length\|\|1\)/,
    "the old all-time-month-count denominator should be fully gone"
  );
});

// Finding 4 (LOW): the Treemap tooltip was missing a space after </strong>
// (rendering e.g. "Groceries$1,234" with no separator) and, in the non-drill
// branch specifically, a second missing space before its leading '·' --
// mirroring the exact two gaps the 105th pass fixed in the Sankey tooltip.
test("Treemap tooltip: has a space after </strong>, and the non-drill branch's leading '·' has a space before it too", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /tip\.innerHTML=`<strong>\$\{esc\(tmDisplayName\(d\.data\.name\)\)\}<\/strong> \$\{fmtC\(d\.data\.value\)\}\$\{drillCat\?` · \$\{pct\}% of \$\{esc\(drillCat\)\}`:` · \$\{pct\}% of spend`\}`;/,
    "the Treemap tooltip should have a space after </strong> and a leading space before '·' in both the drillCat and non-drillCat branches"
  );
});

// Finding 5 (LOW): fmtC()'s raw=true param (105th pass) only reached D3
// .text() SVG sinks. fmt()/fmtD()/fmtH() had no raw param at all, and all
// three are also used at .textContent assignments and Chart.js canvas
// tooltip/tick callbacks -- neither sink interprets HTML entities, so
// esc()'ing a custom '&' currency symbol there rendered a literal "&amp;"
// on screen instead of "&". Extended the same raw=true pattern to all
// three formatters and applied it at every non-innerHTML call site found
// by an exhaustive grep of .textContent=/fillText/Chart.js tooltip and
// tick callbacks. ──
test("fmt/fmtD/fmtH: raw=true skips esc(), matching fmtC's existing convention", () => {
  // loadConstArrowFn() above hardcodes state.currency='$' and a passthrough
  // esc(), which can't demonstrate the '&'-double-escaping bug this raw
  // param exists to fix -- a local variant with an injectable esc()/state
  // is needed here instead, same single-line `const NAME=...;` extraction
  // approach.
  const loadWithCtx = (name, state, esc) => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
    const re = new RegExp(`^const ${name}=.*;$`, "m");
    const m = source.match(re);
    if (!m) throw new Error(`loadWithCtx: could not find 'const ${name}=...' in source`);
    return new Function("esc", "state", `${m[0]}\nreturn ${name};`)(esc, state);
  };
  const state = { currency: "A&B" };
  const esc = (s) => String(s).replace(/&/g, "&amp;");
  const fmtFn = loadWithCtx("fmt", state, esc);
  assert.equal(fmtFn(1000), "A&amp;B1,000", "fmt() default should still esc()");
  assert.equal(fmtFn(1000, true), "A&B1,000", "fmt(...,true) should skip esc()");
  const fmtDFn = loadWithCtx("fmtD", state, esc);
  assert.equal(fmtDFn(1000), "A&amp;B1,000.00", "fmtD() default should still esc()");
  assert.equal(fmtDFn(1000, true), "A&B1,000.00", "fmtD(...,true) should skip esc()");
  const fmtHFn = loadWithCtx("fmtH", state, esc);
  assert.equal(fmtHFn(1000), "A&amp;B1,000", "fmtH() default should still esc()");
  assert.equal(fmtHFn(1000, true), "A&B1,000", "fmtH(...,true) should skip esc()");
});
test("fmt/fmtD/fmtH raw param is applied at every non-D3, non-innerHTML sink: .textContent assignments and Chart.js canvas callbacks", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  // Chart.js tooltip callbacks (canvas-rendered, no entity decoding)
  assert.doesNotMatch(source, /fmtH\(ctx\.raw\)(?!,true\))/, "every fmtH(ctx.raw) Chart.js tooltip callback should pass raw=true");
  assert.match(source, /\.map\(x=>`\$\{x\.v\}: \$\{fmtC\(x\.val,true\)\}`\)/, "the vendor chart's _otherBreakdown tooltip lines should use raw fmtC");
  assert.match(source, /\.map\(x=>`\$\{x\.c\}: \$\{fmtH\(x\.v,true\)\}`\)/, "the category chart's _otherBreakdown tooltip lines should use raw fmtH");
  assert.match(source, /callback:v=>fmtC\(v,true\),font:\{size:9\}/, "the vendor/category stacked chart's y-axis tick callback should use raw fmtC");
  // .textContent assignments
  assert.match(source, /hint\.textContent=current\?`Current goal: \$\{fmtC\(current,true\)\}`/, "openCustomNwGoal()'s hint should use raw fmtC");
  assert.match(source, /try something higher than \$\{fmtC\(netWorth\(\),true\)\}/, "confirmCustomGoal()'s already-met hint should use raw fmtC");
  assert.match(source, /tip\.textContent=`\$\{fmtMonthShort\(d\.m\)\} · \$\{fmtC\(d\.v,true\)\}/, "the NW chart hover tooltip should use raw fmtC");
  assert.match(source, /spend-total-val'\)\.textContent=fmtC\(displayTotal,true\)/, "the Spending tab's total should use raw fmtC");
  assert.match(source, /incSumEl\.textContent=incomeTotal>0\?`\+ \$\{fmtC\(incomeTotal,true\)\} income · \$\{fmt\(incomeTotal\/incMonths,true\)\}\/mo avg`/, "the income-summary line should use raw fmtC and raw fmt");
  assert.match(source, /bfn\.textContent=`\$\{drillCat\} · \$\{fmtC\(catTotal,true\)\}/, "the Treemap drill-down footnote should use raw fmtC");
  assert.match(source, /income-manual-hint'\)\.textContent=`Current: \$\{fmt\(state\.income\.monthlyAmount,true\)\}\/mo take-home`/, "the manual-income hint (detected) should use raw fmt");
  assert.match(source, /income-manual-hint'\)\.textContent=`Saved: \$\{fmt\(val,true\)\}\/mo take-home`/, "the manual-income hint (saved) should use raw fmt");
  assert.match(source, /desc\.textContent=`This will permanently delete the snapshot for \$\{s\.date\} — net worth \$\{fmtC\(s\.nw,true\)\}\.`/, "the delete-snapshot confirm text should use raw fmtC");
  assert.match(source, /totalEl\.textContent=fmtD\(total,true\)/, "the Venmo cashout total should use raw fmtD");
});

// Finding 6 (LOW): the event-delegation dispatcher's coerce() turns a
// data-arg string of "0" into the JS Number 0 -- falsy. openBudgetModal(cat)
// checked `if(!cat)` (to pick a default category when none was specified)
// BEFORE `cat=String(cat)`, so a category literally named "0" hit the
// "no cat specified" branch and silently opened the wrong category's budget
// modal. toggleCatExclusion()/confirmSrcRemove() both coerce to a string
// first, before any conditional, for the same reason (99th adversarial
// pass). openBudgetModal() itself is DOM-heavy; source-pattern only. ──
test("openBudgetModal: coerces cat to a string before checking falsiness, so a category literally named \"0\" isn't mistaken for \"no cat specified\"", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function openBudgetModal\(cat\)\{[\s\S]{0,1600}?\n\}/);
  assert.ok(fnMatch, "openBudgetModal() should exist");
  const coerceIdx = fnMatch[0].search(/if\(cat!==undefined\)cat=String\(cat\);/);
  const falsyCheckIdx = fnMatch[0].search(/if\(!cat\)\{/);
  assert.ok(coerceIdx >= 0, "openBudgetModal() should coerce cat to a string, guarded on undefined so the 'no cat' default path still works when nothing was passed");
  assert.ok(falsyCheckIdx >= 0, "openBudgetModal() should still have its 'no cat specified' default-picking branch");
  assert.ok(coerceIdx < falsyCheckIdx, "the String(cat) coercion must run BEFORE the !cat falsy check -- otherwise coerce()'s Number(\"0\")===0 is indistinguishable from 'no cat specified'");
});

// ── 107th adversarial pass ──────────────────────────────────────────────

// Finding 1 (MEDIUM): the 106th pass fixed chase/debitcredit's raw-bank-
// category fallback to route through mapImportedCategory(), but missed the
// generic branch -- the fallback format for every unsupported bank, so the
// single most common path for a new user's own CSV. It was worse than the
// two fixed branches: it also fell back to row['type'], which in many bank
// exports holds raw jargon ("Debit"/"POS"/"Withdrawal"), not a category at
// all. normalizeTxRow() is DOM/state-heavy with established source-
// pattern-only precedent in this suite. ──
test("normalizeTxRow: the generic import branch also routes its raw-category fallback through mapImportedCategory(), matching chase/debitcredit", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!isIncome&&cat==='Other'\)cat=mapImportedCategory\(row\['category'\]\|\|row\['cat'\]\|\|row\['type'\]\)\|\|'Other';/,
    "the generic branch's 'Other' fallback should route the same 3 candidate columns through mapImportedCategory(), not assign whichever one is truthy directly"
  );
  assert.doesNotMatch(
    source,
    /cat=row\['category'\]\|\|row\['cat'\]\|\|row\['type'\]\|\|'Other';/,
    "the old unvalidated fallback should be fully gone"
  );
});

// Finding 2 (MEDIUM): the 106th pass's window._otherVendorsAvgDenom fix
// used allPeriods (a count of GRAINED periods -- quarters/years at that
// chart grain, not always months) but openOtherVendorsModal() hardcoded
// the '/mo' unit label regardless, while the sibling topVendors tiles use
// the grain-aware grainLabel ('/qtr'/'/yr'/'/mo'). At Quarterly/Yearly
// grain the modal showed a per-quarter/per-year figure mislabeled as
// monthly (3x/12x too high to read as "/mo"). Both render functions are
// D3/DOM-heavy; source-pattern only. ──
test("openOtherVendorsModal: the per-vendor average's unit label matches the grain the denominator was computed at (not hardcoded '/mo')", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /window\._otherVendorsAvgGrainLabel=grainLabel;/,
    "the vendor-bucket render should stash the same grain-aware label used for topVendors tiles"
  );
  assert.match(
    source,
    /Avg: \$\{fmt\(Math\.round\(d\.total\/\(window\._otherVendorsAvgDenom\|\|1\)\)\)\}\$\{window\._otherVendorsAvgGrainLabel\|\|'\/mo'\}<\/div>/,
    "openOtherVendorsModal() should use window._otherVendorsAvgGrainLabel, not a hardcoded '/mo'"
  );
});

// Finding 3 (LOW): the Sankey income-node label was the one D3 .text() call
// site the 105th/106th passes' raw-fmtC sweep missed -- it's an SVG text
// node like the category-node labels 30 lines above it (which DO use
// raw=true), so an esc()'d custom '&' currency symbol rendered as a
// literal "&amp;" here specifically. ──
test("Sankey income-node label uses raw fmtC, matching the category-node labels above it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.text\(isOverspend\s*\?`⚠ Spending exceeds income · \$\{fmtC\(totalIncome,true\)\} · \$\{monthCount\}mo\$\{editMark\}`\s*:`Income · \$\{fmtC\(totalIncome,true\)\} · \$\{monthCount\}mo\$\{editMark\}`\);/,
    "the Sankey income-node label's D3 .text() call should use raw fmtC in both branches"
  );
});

// Finding 4 (LOW): renderSpendChart()'s state.activeCats.size>0 branch (the
// category-drilldown mode) was the only one of this function's 5 Chart.js
// branches with no tooltip.callbacks.label customization at all -- hovering
// showed Chart.js's bare default tooltip (raw unformatted number, no
// currency symbol, no %-of-month/MoM/peak context), unlike every sibling
// branch. renderSpendChart() is D3/Chart.js-heavy; source-pattern only. ──
test("renderSpendChart: the category-filtered (activeCats) branch has its own tooltip label callback, not Chart.js's bare default", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const branchMatch = source.match(/if\(state\.activeCats\.size>0\)\{\n      const catsToShow[\s\S]{0,2700}?\n    \}/);
  assert.ok(branchMatch, "the activeCats>0 branch should exist");
  assert.match(
    branchMatch[0],
    /filteredOpts\.plugins\.tooltip=\{callbacks:\{label:function\(ctx\)\{/,
    "the activeCats branch should build its own tooltip.callbacks.label, not pass commonOpts through unmodified"
  );
  assert.match(
    branchMatch[0],
    /return`\$\{ctx\.dataset\.label\}: \$\{fmtH\(ctx\.raw,true\)\} · \$\{pct\}% of month\$\{momStr\}\$\{peakStr\}`;/,
    "the new callback should format currency (raw fmtH), show % of month, MoM delta, and the peak marker, matching the sibling top5+Other branch's convention"
  );
  assert.match(
    branchMatch[0],
    /spendChart=new Chart\(ctx,\{type:'bar',data:\{labels,datasets\},options:filteredOpts\}\);/,
    "the branch should pass its own filteredOpts (not the bare commonOpts) into the Chart constructor"
  );
});

// Finding 5 (LOW, cosmetic): buildRcList()'s populate branch always rebuilds
// every row checked, but never synced #rc-select-all's own checked state to
// match -- unchecking "Select all" (which unchecks every row), then
// changing the category dropdown again to a different value, rebuilt the
// list all-checked while "Select all" stayed visually unchecked. Cosmetic
// only (saveEditTx() reads the row checkboxes directly), but a real
// mismatch. buildRcList() is DOM-heavy; source-pattern only. ──
test("buildRcList: the populate branch syncs #rc-select-all's checked state to match the freshly-rebuilt (all-checked) row list", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function buildRcList\(tx,origCat,newCat\)\{[\s\S]{0,3000}?\n\}/);
  assert.ok(fnMatch, "buildRcList() should exist");
  assert.match(
    fnMatch[0],
    /document\.getElementById\('rc-list'\)\.innerHTML=similar\.map\([\s\S]{0,500}?\.join\(''\);\s*[\s\S]{0,700}?const selectAll=document\.getElementById\('rc-select-all'\);\s*if\(selectAll\)selectAll\.checked=true;\s*updateRcCount\(\);/,
    "buildRcList()'s populate branch should set #rc-select-all's checked=true right alongside rebuilding #rc-list, before updateRcCount()"
  );
});

// ── 108th adversarial pass ──────────────────────────────────────────────

// Finding 1 (MEDIUM): the 107th pass's new activeCats tooltip callback
// compared ctx.dataIndex against the shared, function-scoped peakIdx --
// documented as "peak period across ALL chart modes," i.e. computed from
// TOTAL spend across every category/source, correct for the sibling
// top5+Other branch (which plots every category) but wrong here, since
// this branch only plots the user-selected subset. The tooltip flagged
// "🔺 Peak month" on whichever period had the highest OVERALL spend, not
// the highest spend among the categories actually shown -- a factually
// wrong claim, and this branch never registers peakPlugin either, so
// there's no visual bar highlight to (mis)match it against. renderSpendChart()
// is D3/Chart.js-heavy; source-pattern only, matching this suite's
// established precedent. ──
test("renderSpendChart: the activeCats branch's 'Peak month' tooltip flag uses a branch-local peak (only the selected categories), not the shared all-category peakIdx", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const branchMatch = source.match(/if\(state\.activeCats\.size>0\)\{\n      const catsToShow[\s\S]{0,2700}?\n    \}/);
  assert.ok(branchMatch, "the activeCats>0 branch should exist");
  assert.match(
    branchMatch[0],
    /const peakIdxFiltered=periodTotalsFiltered\.indexOf\(Math\.max\(\.\.\.periodTotalsFiltered\)\);/,
    "the branch should compute its own peak index from periodTotalsFiltered (the selected categories' own totals), not reuse the shared all-category peakIdx"
  );
  assert.match(
    branchMatch[0],
    /const peakStr=ctx\.dataIndex===peakIdxFiltered\?' 🔺 Peak month':'';/,
    "the tooltip's peakStr should compare against peakIdxFiltered"
  );
  assert.doesNotMatch(
    branchMatch[0],
    /ctx\.dataIndex===peakIdx\?/,
    "the branch should no longer compare against the shared all-category peakIdx"
  );
});

// Finding 2 (MEDIUM): normalizeTxRow()'s trakyodollas re-import branch
// deliberately trusts row['category'] verbatim (unlike every other format,
// which routes through mapImportedCategory()/guessCatFromDesc()) so a
// custom category round-trips through export/re-import intact -- this is
// correct by design, not a gap to route through mapImportedCategory() like
// the 106th/107th passes' fixes (that WOULD destroy legitimate custom
// categories). But if the custom category was never actually registered on
// the importing profile (deleted after export, or imported on a different
// device), it isn't in getAllCats(), so rebuildCatSelects() can't select it
// in the edit-tx modal, and saveEditTx() reads the unmatched <select> back
// as '' -- silently blanking the category on the next edit of ANY field.
// Fixed by auto-registering unknown imported categories as real custom
// categories in confirmTxImport(), mirroring the 32nd pass's identical fix
// for the demo profile's own categories. confirmTxImport() is DOM-heavy;
// source-pattern only. ──
test("confirmTxImport: auto-registers any imported transaction's category that isn't already in getAllCats() as a new custom category", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/newTxs=importParsed\.map[\s\S]{0,2200}?\n  \}\);/);
  assert.ok(fnMatch, "confirmTxImport()'s mutateTransactions block should exist");
  assert.match(
    fnMatch[0],
    /const knownCats=new Set\(getAllCats\(\)\.map\(c=>c\.toLowerCase\(\)\)\);\s*newTxs\.forEach\(t=>\{\s*if\(t\.cat&&!knownCats\.has\(t\.cat\.toLowerCase\(\)\)\)\{\s*state\.customCategories\.push\(\{name:t\.cat,color:null\}\);\s*knownCats\.add\(t\.cat\.toLowerCase\(\)\);\s*\}\s*\}\);/,
    "confirmTxImport() should push {name,color:null} (addCustomCat()'s own shape) for every newly-imported category not already in getAllCats(), deduping case-insensitively (109th pass) via a local Set so a repeated new category isn't pushed twice"
  );
});

// Finding 3 (MEDIUM-LOW): loadDemoProfile() deep-copies state.accounts
// (p.accounts.map(a=>({...a}))) but only shallow-copied the ARRAY shell for
// vehicles/snapshots/transactions/catRules/customCategories -- the objects
// INSIDE those arrays stayed the exact same references as the module-level
// DEMO_PROFILE_1/DEMO_PROFILE_2 constants. Every in-place mutator this app
// has (saveEditTx()'s t.cat=/t.desc=, editVehicle()'s Object.assign(v,...),
// rule edits, category renames) wrote straight through into the "pristine"
// demo constants, so a user's edits during one demo session survived into
// the next profile switch or re-entry -- contradicting this function's own
// repeatedly-fixed promise (passes 75/90/96/97) that demo sessions leave
// nothing behind. loadDemoProfile() is DOM/state-heavy; source-pattern
// only. ──
test("loadDemoProfile: vehicles/snapshots/transactions/catRules/customCategories all get per-object copies, matching state.accounts' existing pattern", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /state\.vehicles=\(p\.vehicles\|\|\[\]\)\.map\(v=>\(\{\.\.\.v\}\)\);/, "vehicles should be per-object copied");
  assert.match(source, /state\.snapshots=p\.snapshots\.map\(s=>\(\{\.\.\.s\}\)\);/, "snapshots should be per-object copied");
  assert.match(source, /state\.transactions=p\.transactions\.map\(t=>\(\{\.\.\.t\}\)\);/, "transactions should be per-object copied");
  assert.match(source, /state\.catRules=\(p\.catRules\|\|\[\]\)\.map\(r=>\(\{\.\.\.r\}\)\);/, "catRules should be per-object copied");
  assert.match(source, /state\.customCategories=\(p\.customCategories\|\|\[\]\)\.map\(c=>\(\{\.\.\.c\}\)\);/, "customCategories should be per-object copied");
  assert.doesNotMatch(source, /state\.vehicles=\[\.\.\.\(p\.vehicles\|\|\[\]\)\];/, "the old array-shell-only copy should be gone for vehicles");
  assert.doesNotMatch(source, /state\.snapshots=\[\.\.\.p\.snapshots\];/, "the old array-shell-only copy should be gone for snapshots");
  assert.doesNotMatch(source, /state\.transactions=\[\.\.\.p\.transactions\];/, "the old array-shell-only copy should be gone for transactions");
});

// Finding 4 (LOW): copyYirSummary()'s clipboard sink (navigator.clipboard.
// writeText()) is a plain-text sink like .textContent/D3 .text()/canvas --
// never decodes HTML entities -- but all 8 of its fmt() calls used the
// default esc()'d form, so a custom '&'-containing currency symbol copied
// as a literal "&amp;". The only clipboard call site in the file; missed
// by all 3 prior raw-fmt sweeps (105-107) since those only enumerated DOM
// sinks. ──
test("copyYirSummary: every fmt() call feeding the clipboard uses raw=true, not the default esc()'d form", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function copyYirSummary\(\)\{[\s\S]{0,4700}?\n\}/);
  assert.ok(fnMatch, "copyYirSummary() should exist");
  const fmtCalls = fnMatch[0].match(/fmt\((?:[^()]|\([^()]*\))*\)/g) || [];
  const nonRawCalls = fmtCalls.filter(c => !c.endsWith(",true)") && !c.startsWith("fmtMonthShort"));
  assert.equal(nonRawCalls.length, 0, `every fmt(...) call in copyYirSummary() should pass raw=true; found non-raw calls: ${JSON.stringify(nonRawCalls)}`);
  assert.match(fnMatch[0], /navigator\.clipboard\.writeText\(lines\)/, "should still write to the clipboard");
});

// Finding 5 (LOW, dead code): renderSpendChart()'s top5+Other branch used
// to assign customOpts.plugins.tooltip.callbacks.label TWICE -- a simple
// pct-only version first, then immediately overwritten 10 lines later by a
// superset version (same pct/Other handling plus MoM delta and peak
// marker). The first assignment could never execute; harmless today but a
// trap for a future fix landing in the shadowed block. Removed, folding
// into a single assignment. ──
test("renderSpendChart: the top5+Other branch's tooltip label callback is assigned exactly once, not shadowed by a second assignment", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const assignmentCount = (source.match(/customOpts\.plugins\.tooltip[.=]/g) || []).length;
  assert.equal(assignmentCount, 1, "customOpts.plugins.tooltip should be referenced exactly once (a single assignment), not assigned then immediately reassigned");
  assert.match(
    source,
    /customOpts\.plugins\.tooltip=\{callbacks:\{label:function\(ctx\)\{/,
    "the single surviving assignment should be the full-featured callback (pct/Other/MoM/peak)"
  );
});

// ── 109th adversarial pass ──────────────────────────────────────────────

// Finding 1 (MEDIUM): the 108th pass's own comment justified reusing the
// shared, all-category peakIdx in renderSpendChart()'s top5+Other branch
// by claiming that branch "plots every category, so the overall peak IS
// the displayed peak" -- true only when no vendor filter is active. With
// one (state.bucketMode==='vendor' && state.activeVendors.size>0),
// catMonthMap is filtered to the selected vendors, so this branch plots a
// SUBSET, but peakIdx still indexed the unfiltered MONTHLY totals -- both
// the tooltip's "Peak month" text and peakPlugin's canvas highlight
// pointed at the wrong period. Fixed by reassigning the shared peakIdx
// (declared let for this reason) from monthTotalsForChart -- already
// vendor-filter-aware -- right before this branch's own Chart()
// construction, which correctly propagates to both sinks via the shared
// closure since only one branch executes per render call.
// renderSpendChart() is D3/Chart.js-heavy; source-pattern only, matching
// this suite's established precedent. ──
test("renderSpendChart: peakIdx is declared let and reassigned from the vendor-filtered monthTotalsForChart when a vendor filter is active", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /let peakIdx=periodSums\.indexOf\(Math\.max\(\.\.\.periodSums\)\);/,
    "peakIdx should be declared with let (not const), so it can be reassigned by the category branch"
  );
  assert.match(
    source,
    /if\(vendorFilter\)peakIdx=monthTotalsForChart\.indexOf\(Math\.max\(\.\.\.monthTotalsForChart\)\);/,
    "the category branch should reassign peakIdx from monthTotalsForChart (the vendor-filtered plotted totals) when a vendor filter is active"
  );
});

// Finding 2 (MEDIUM): confirmTxImport()'s "first real import on a demo
// session" branch (state.hasRealData was false, meaning every field is
// still the scripted DEMO_PROFILE_1/2 value) wiped transactions/
// activeSources/budgets but left income/catRules/vendorAliases/nwGoal/
// customCategories untouched -- state.hasRealData=true plus scheduleSave()
// afterward then permanently persisted all 5 as if the user had entered
// them themselves (a fabricated manual income, demo cat-rules silently
// recategorizing the user's own first real transactions, demo vendor
// aliases renaming real vendors). Fixed by resetting all 5 to the same
// fresh-state defaults the initial state object literal uses.
// confirmTxImport() is DOM-heavy; source-pattern only. ──
// Superseded by the 110th pass's _replaceDemoDataWithReal() consolidation
// (confirmTxImport()'s own hand-rolled reset list, including this fix, was
// replaced by one call to that shared helper -- see the dedicated
// _replaceDemoDataWithReal() test below for full field coverage). Kept as
// a historical marker that confirmTxImport() itself no longer hand-rolls
// this reset.
test("confirmTxImport: the demo-session-wipe branch delegates to the shared _replaceDemoDataWithReal() helper, not its own hand-rolled reset list", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function confirmTxImport\(\)\{[\s\S]{0,2500}?_replaceDemoDataWithReal\(\);/);
  assert.ok(fnMatch, "confirmTxImport() should call _replaceDemoDataWithReal()");
  assert.doesNotMatch(
    source.match(/function confirmTxImport\(\)\{[\s\S]{0,4900}?\n  closeModals\(\);/)[0],
    /state\.income=\{method:null,monthlyAmount:0\};/,
    "confirmTxImport() itself should no longer hand-roll the income reset -- it's now inside the shared helper"
  );
});

// Finding 3 (LOW): the trakyodollas re-import branch's category assignment
// wasn't .trim()'d, unlike desc two lines above it -- a hand-edited or
// foreign-profile CSV's " Groceries" (leading/trailing whitespace)
// registered, via confirmTxImport()'s auto-register (108th pass), as a
// visually-duplicate category that addCustomCat()'s own case-insensitive
// collision guard would then refuse to ever merge back onto the real one.
// Also, confirmTxImport()'s own knownCats dedup Set used exact-match
// comparison instead of matching addCustomCat()'s established case-
// insensitive convention, so a category differing only in case
// ("groceries" vs "Groceries") could register as a second duplicate too. ──
test("normalizeTxRow: the trakyodollas branch trims its category (matching desc), and confirmTxImport()'s category auto-register is case-insensitive (matching addCustomCat())", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /cat=_stripCsvFormulaGuard\(\(row\['category'\]\|\|'Other'\)\.trim\(\)\)\|\|'Other';/,
    "the trakyodollas branch's category should be trimmed before the formula guard, with an 'Other' fallback if trimming leaves it empty"
  );
  assert.match(
    source,
    /const knownCats=new Set\(getAllCats\(\)\.map\(c=>c\.toLowerCase\(\)\)\);/,
    "confirmTxImport()'s knownCats Set should be built from lowercased category names"
  );
  assert.match(
    source,
    /if\(t\.cat&&!knownCats\.has\(t\.cat\.toLowerCase\(\)\)\)\{/,
    "the auto-register check should compare against the lowercased imported category"
  );
});

// Finding 4 (LOW): the service-worker registration's hadController flag
// was captured once at page load and never updated -- on a genuine first-
// ever visit it starts false (correctly skipping the reload for that first
// install), but if that same tab stayed open across the NEXT deploy, the
// resulting controllerchange event still read the stale, page-load-time
// false and skipped the reload again -- the exact "tab silently running
// old in-memory JS indefinitely" failure this mechanism exists to
// prevent, one deploy cycle later than intended. ──
test("Service worker registration: hadController is updated on every controllerchange event, not just read once at page load", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /let hadController=!!navigator\.serviceWorker\.controller;/,
    "hadController should be declared with let (not const), so it can be updated"
  );
  assert.match(
    source,
    /if\(_swRefreshing\|\|!hadController\)\{hadController=true;return;\}/,
    "the controllerchange handler should set hadController=true before returning on the skip path, so a LATER controllerchange (a real subsequent deploy) is no longer treated as the first-ever install"
  );
});

// Dead code (Part 3): loadDemoProfile()'s state.accounts filter
// (`state.accounts=state.accounts.filter(a=>p.accounts.some(pa=>pa.id===a.id))`)
// ran immediately after state.accounts had just been wholly reassigned
// FROM p.accounts.map(...) on the line above -- every element trivially
// passed the filter (state.accounts WAS p.accounts's ids at that point),
// making it a guaranteed no-op. The "strip accounts that crept in from
// localStorage migration" comment described something that couldn't
// happen given the reassignment immediately above it. Removed. ──
test("loadDemoProfile: the dead no-op accounts filter (immediately after a full state.accounts reassignment) is removed", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(
    source,
    /state\.accounts = state\.accounts\.filter\(a=>p\.accounts\.some\(pa=>pa\.id===a\.id\)\);/,
    "the dead no-op filter should be gone"
  );
  assert.match(
    source,
    /state\.accounts = p\.accounts\.map\(a=>\(\{\.\.\.a\}\)\);/,
    "the actual deep-copy assignment should still be present"
  );
});

// ── 110th adversarial pass ──────────────────────────────────────────────

// Findings 1 & 2 (HIGH): the Accounts/Net Worth demo notices promised "add
// your real balances to replace these," but nothing ever did --
// saveAccount()/saveSnapshot()/parseCsvAccounts() each added ONE real
// entry alongside the demo's ~12 fake accounts/6 fake snapshots, which
// stayed permanently mixed into net worth and persisted history with no
// way to tell them apart once the demo notice hid itself. Separately,
// saveTx() never set state.hasRealData at all, so a manual-entry-only
// user's real transactions were misclassified as demo data and silently
// DELETED the moment they later used confirmTxImport() (whose own
// !state.hasRealData branch treats "not yet real" as license to wipe).
// Fixed with one shared helper, _replaceDemoDataWithReal() -- wipes every
// field loadDemoProfile() seeds back to the same fresh-state defaults,
// consolidating what was 3 missing call sites plus confirmTxImport()'s own
// hand-rolled (and twice-incomplete: 98th, then 109th pass) version of the
// same reset. A no-op once state.hasRealData is already true. ──
test("_replaceDemoDataWithReal: resets every field loadDemoProfile() seeds to the same fresh-state defaults, and no-ops once hasRealData is true", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function _replaceDemoDataWithReal\(\)\{[\s\S]{0,2300}?\n\}/);
  assert.ok(fnMatch, "_replaceDemoDataWithReal() should exist");
  assert.match(fnMatch[0], /if\(state\.hasRealData\)return;/, "should no-op once real data already exists, never wiping real data");
  for (const line of [
    "state.accounts=[];", "state.vehicles=[];", "state.snapshots=[];", "state.transactions=[];",
    "state.activeSources=new Set();", "state.budgets={};", "state.rangeFrom=null;", "state.rangeTo=null;",
    "state.sourceAlignDate=null;", "state.sourceAlignSkipped=false;", "state.nwGoal=null;",
    "state.income={method:null,monthlyAmount:0};", "state.declaredIncome=0;", "state.includeIncome=false;",
    "state.excludedCats=new Set(TRANSFER_LIKE_CATS);", "state.catRules=[];", "state.customCategories=[];",
    "state.hiddenPills=new Set();", "state.vendorAliases={};",
  ]) {
    assert.ok(fnMatch[0].includes(line), `_replaceDemoDataWithReal() should include: ${line}`);
  }
  assert.match(fnMatch[0], /_resetSessionFiltersForDataReplace\(\);/, "should also reset session-scoped filters, matching every other wholesale-replace path");
});
test("saveAccount: calls _replaceDemoDataWithReal() before adding the account, and falls back to adding as new if editAcctId no longer resolves after the wipe", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveAccount\(\)\{[\s\S]{0,3700}?closeModals\(\);renderAll\(\);\}/);
  assert.ok(fnMatch, "saveAccount() should exist");
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const pushIdx = fnMatch[0].search(/state\.accounts\.push\(/);
  assert.ok(wipeIdx >= 0, "saveAccount() should call _replaceDemoDataWithReal()");
  assert.ok(wipeIdx < pushIdx, "the wipe must run BEFORE the account is added, or the new account would be wiped along with the demo data");
  assert.match(
    fnMatch[0],
    /if\(editAcctId\)\{const a=state\.accounts\.find\(x=>x\.id===editAcctId\);if\(a\)\{[^}]*\}else state\.accounts\.push\(/,
    "if editAcctId no longer resolves after the wipe (it pointed at a demo account that just got cleared), saveAccount() should fall back to adding as new rather than silently dropping the save"
  );
});
test("saveSnapshot: calls _replaceDemoDataWithReal() before the duplicate-month check and before computing netWorth()/totalAssets()/totalLiab()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveSnapshot\(\)\{[\s\S]{0,3800}?\n\}/);
  assert.ok(fnMatch, "saveSnapshot() should exist");
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const dupCheckIdx = fnMatch[0].search(/state\.snapshots\.find\(s=>s\.monthKey===ym\)/);
  const netWorthIdx = fnMatch[0].search(/nw:netWorth\(\)/);
  assert.ok(wipeIdx >= 0, "saveSnapshot() should call _replaceDemoDataWithReal()");
  assert.ok(wipeIdx < dupCheckIdx, "the wipe must run before the duplicate-month check, so a demo-scripted monthKey can't false-positive against the real current month");
  assert.ok(wipeIdx < netWorthIdx, "the wipe must run before netWorth()/totalAssets()/totalLiab() are computed, so the snapshot reflects real (possibly zero) account data, not fake demo balances");
});
test("parseCsvAccounts: only calls _replaceDemoDataWithReal() once at least one row parses successfully, not unconditionally", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function parseCsvAccounts\(text\)\{[\s\S]{0,2400}?\n\}/);
  assert.ok(fnMatch, "parseCsvAccounts() should exist");
  const ifImportedIdx = fnMatch[0].search(/if\(imported>0\)\{/);
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  assert.ok(ifImportedIdx >= 0 && wipeIdx >= 0, "both the imported>0 guard and the wipe call should exist");
  assert.ok(
    ifImportedIdx < wipeIdx,
    "the wipe must be gated inside if(imported>0), not run unconditionally -- otherwise a CSV where every row is invalid would wipe the demo's accounts and leave the user with neither the demo nor any real data"
  );
});
test("saveTx: sets state.hasRealData and calls _replaceDemoDataWithReal(), unlike before when it never set hasRealData at all", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveTx\(\)\{[\s\S]{0,3600}?\n\}/);
  assert.ok(fnMatch, "saveTx() should exist");
  assert.match(fnMatch[0], /_replaceDemoDataWithReal\(\);/, "saveTx() should call the shared wipe helper");
  assert.match(fnMatch[0], /state\.hasRealData=true;/, "saveTx() should now set state.hasRealData -- previously it never did, so a manual-entry-only user's transactions stayed misclassified as demo data and were silently deleted by confirmTxImport()'s own !state.hasRealData wipe on their first later CSV import");
});

// Finding 4 (LOW): applyCurrency()/applyCustomCurrency() only called
// renderSpending(), but a currency symbol appears on every tab (Dashboard
// metrics/NW breakdown, Accounts, Vehicles, History, Budget) -- every
// other tab kept showing the old symbol until an unrelated renderAll() or
// a reload. ──
test("applyCurrency and applyCustomCurrency both call renderAll(), not just renderSpending()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const acMatch = source.match(/function applyCurrency\(sym,btn\)\{[\s\S]{0,900}?\n\}/);
  assert.ok(acMatch, "applyCurrency() should exist");
  assert.match(acMatch[0], /renderAll\(\);/, "applyCurrency() should call renderAll()");
  const accMatch = source.match(/function applyCustomCurrency\(val\)\{[\s\S]{0,500}?\n\}/);
  assert.ok(accMatch, "applyCustomCurrency() should exist");
  assert.match(accMatch[0], /renderAll\(\);/, "applyCustomCurrency() should call renderAll()");
});

// Finding 5 (LOW): the shared peakIdx (renderSpendChart()'s "Peak month"
// tooltip/canvas highlight, used by all 3 chart branches) was computed
// from MONTHLY (rebuildMonthly()'s own comment: "used by chart when
// showExcluded=false") and getAggregatedData() (also MONTHLY-based) --
// neither respects state.showExcluded ("Show in totals"), while every
// branch's own plotted data (built from getBaseTxs(), which DOES respect
// it) does. With the toggle on and excluded spend large enough to shift
// which period is highest, the peak marker pointed at the wrong bar --
// the showExcluded sibling of the vendor-filter mismatch the 109th pass
// fixed in this same spot. Fixed by computing monthSumsFn/periodSums
// directly off getBaseTxs() once, rather than adding a third branch-local
// patch. ──
test("renderSpendChart: the shared peakIdx is computed from getBaseTxs() (respects state.showExcluded), not from MONTHLY/getAggregatedData() (which never did)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const _peakBaseTxs=getBaseTxs\(\)\.filter\(t=>!t\.isIncome&&\(state\.activeCats\.size===0\|\|state\.activeCats\.has\(t\.cat\)\)\);\s*const monthSumsFn=m=>_peakBaseTxs\.reduce\(\(s,t\)=>t\.date\.slice\(0,7\)===m\?s\+t\.amount:s,0\);/,
    "monthSumsFn should be built from getBaseTxs() (filtered per the 111th pass's fixes), not from MONTHLY"
  );
  assert.match(
    source,
    /const periodSums=useAgg\?getAggregatedPeriods\(\)\.map\(p=>p\.months\.reduce\(\(s,m\)=>s\+monthSumsFn\(m\),0\)\):allMonthSums;/,
    "the Quarterly/Yearly-grain branch (useAgg) should also route through monthSumsFn (getAggregatedPeriods() for grouping only, no MONTHLY-based totals), not the old MONTHLY-based getAggregatedData()"
  );
});

// ── 111th adversarial pass ──────────────────────────────────────────────
// (re-verification of the 110th pass's new _replaceDemoDataWithReal()
// infrastructure found 4 gaps in it, plus 3 more findings from fresh-
// territory review and a dead-code sweep)

// Finding 1 (HIGH): saveSnapshot() called _replaceDemoDataWithReal()
// (wiping state.accounts) BEFORE computing netWorth()/totalAssets()/
// totalLiab() -- since a demo session guarantees hasRealData===false and
// no real accounts can exist yet, this always produced a fabricated
// $0/$0/$0 snapshot the instant a user clicked any of the app's 3 "Save
// snapshot" CTAs while still viewing demo data, toasted as a normal
// success ("✓ Snapshot saved · net worth $0.00"), and permanently
// persisted as the anchor of the user's real net-worth history. Fixed by
// requiring state.hasRealAccounts BEFORE the wipe runs at all -- by
// construction, every account-adding path already sets hasRealAccounts
// and hasRealData together, so this guard also means the wipe below it is
// always already a no-op by the time it's reached. ──
test("saveSnapshot: requires state.hasRealAccounts before wiping demo data or computing netWorth()/totalAssets()/totalLiab()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveSnapshot\(\)\{[\s\S]{0,3800}?\n\}/);
  assert.ok(fnMatch, "saveSnapshot() should exist");
  const guardIdx = fnMatch[0].search(/if\(!state\.hasRealAccounts\)\{/);
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const nwIdx = fnMatch[0].search(/nw:netWorth\(\)/);
  assert.ok(guardIdx >= 0, "saveSnapshot() should check state.hasRealAccounts");
  assert.ok(wipeIdx >= 0 && nwIdx >= 0, "the wipe call and netWorth() computation should both exist");
  assert.ok(guardIdx < wipeIdx, "the hasRealAccounts guard must run BEFORE the wipe");
  assert.ok(wipeIdx < nwIdx, "the wipe must still run before netWorth() is computed (for defense-in-depth), but only after the guard above has already ensured real accounts exist");
});
test("saveSnapshot: the now-unreachable demo-preview branch after the new top-of-function guard was removed", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveSnapshot\(\)\{[\s\S]{0,3800}?\n\}/);
  assert.ok(fnMatch, "saveSnapshot() should exist");
  assert.doesNotMatch(
    fnMatch[0],
    /if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{\s*showToast\(`✓ Snapshot saved/,
    "the old mid-function demo-preview toast branch should be gone -- the new top-of-function guard already returns before this point during any demo preview"
  );
});

// Finding 2 (MEDIUM): the 110th pass's new shared peak computation
// (_peakBaseTxs/monthSumsFn) summed getBaseTxs() with no !t.isIncome
// filter, while every one of this function's OWN getBaseTxs() consumers
// (source/vendor/trend/category modes) add that filter on top of
// getBaseTxs() -- a regression from the pre-110 MONTHLY-based sums, which
// rebuildMonthly() itself always excluded income from. With income
// tracking on and month-to-month income variation, the peak sum could
// include a paycheck that none of the actually-plotted bars do. ──
test("renderSpendChart: the shared peak computation excludes income transactions, matching every one of its own getBaseTxs() consumers", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const _peakBaseTxs=getBaseTxs\(\)\.filter\(t=>!t\.isIncome&&\(state\.activeCats\.size===0\|\|state\.activeCats\.has\(t\.cat\)\)\);/,
    "_peakBaseTxs should filter out income transactions (and respect an active category filter, finding 6 below)"
  );
});

// Finding 3 (MEDIUM): saveTx()'s #t-cat <select> is populated from
// demo-scripted customCategories while the demo is still loaded -- picking
// one (e.g. profile 1's 'Rent', or profile 2's 'Income') and saving meant
// the captured cat value no longer existed in getAllCats() the instant
// _replaceDemoDataWithReal() wiped state.customCategories a few lines
// later, silently blanking the category on the transaction's next edit
// (the same unmatched-<select> mechanism the 32nd/108th passes already
// fixed elsewhere). confirmTxImport() already auto-registers unknown
// imported categories (108th pass); saveTx(), the 5th "first real save"
// entry point the 110th pass added, never got the equivalent. ──
test("saveTx: auto-registers the selected category as a real custom category if it isn't already registered (matching confirmTxImport()'s equivalent fix)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveTx\(\)\{[\s\S]{0,3600}?\n\}/);
  assert.ok(fnMatch, "saveTx() should exist");
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const registerIdx = fnMatch[0].search(/if\(cat&&!getAllCats\(\)\.some\(c=>c\.toLowerCase\(\)===cat\.toLowerCase\(\)\)\)\{/);
  const mutateIdx = fnMatch[0].search(/mutateTransactions\(\(\)=>\{state\.transactions\.unshift/);
  assert.ok(wipeIdx >= 0, "saveTx() should call the wipe helper");
  assert.ok(registerIdx >= 0, "saveTx() should auto-register the category if it's not already registered");
  assert.ok(mutateIdx >= 0, "saveTx() should still add the transaction");
  assert.ok(wipeIdx < registerIdx, "the auto-register check must run AFTER the wipe (which cleared customCategories), so it can correctly detect the category is now missing");
  assert.ok(registerIdx < mutateIdx, "the category should be registered before the transaction referencing it is added");
});

// Finding 4 (MEDIUM): _replaceDemoDataWithReal() never rebuilt MONTHLY/
// ALL_MONTHS or the category <select>s, unlike loadDemoProfile() -- the
// wholesale-replace function this one otherwise mirrors -- which always
// calls rebuildMonthly()/rebuildCatSelects() right after its own reset.
// saveAccount()/saveSnapshot()/parseCsvAccounts() don't separately
// trigger an equivalent rebuild the way mutateTransactions() does for
// saveTx()/confirmTxImport(), so those 3 call sites rendered against
// caches describing data that no longer existed. ──
test("_replaceDemoDataWithReal: calls rebuildMonthly() and rebuildCatSelects(), matching loadDemoProfile()'s own wholesale-replace pattern", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function _replaceDemoDataWithReal\(\)\{[\s\S]{0,2200}?\n\}/);
  assert.ok(fnMatch, "_replaceDemoDataWithReal() should exist");
  assert.match(fnMatch[0], /rebuildMonthly\(\);/, "should call rebuildMonthly()");
  assert.match(fnMatch[0], /rebuildCatSelects\(\);/, "should call rebuildCatSelects()");
  const resetIdx = fnMatch[0].search(/_resetSessionFiltersForDataReplace\(\);/);
  const rebuildIdx = fnMatch[0].search(/rebuildMonthly\(\);/);
  assert.ok(resetIdx >= 0 && rebuildIdx >= 0 && resetIdx < rebuildIdx, "the rebuilds should come after the session-filter reset, matching loadDemoProfile()'s own ordering");
});

// Finding 5 (MEDIUM): confirmTxImport()/importBackup() already refuse to
// run during a demo-preview-over-real session (98th pass), but the other
// entry points that can trigger _replaceDemoDataWithReal() -- saveAccount,
// saveSnapshot, saveTx, and the two callers of parseCsvAccounts
// (handleCsv, importCsvText) -- had no such guard. Since
// saveToLocalStorage()/cloud sync are hard no-ops during a demo preview,
// each of these ran the full wipe-and-save UI (demo data visibly
// disappears, a normal success toast fires) that silently reverted on
// the next reload with no warning it was never actually saved. ──
test("saveAccount, saveSnapshot, saveTx, handleCsv, and importCsvText all refuse to run during a demo-preview-over-real session", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const guardPattern = /if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{\s*closeModals\(\);\s*showToast\('Not available while previewing demo data — your real data is untouched here',tc\('#94A3B8','#4B5563'\),9000\);\s*return;\s*\}/;
  const fns = [
    ["saveAccount", /function saveAccount\(\)\{[\s\S]{0,900}/],
    ["saveSnapshot", /function saveSnapshot\(\)\{[\s\S]{0,900}/],
    ["saveTx", /function saveTx\(\)\{[\s\S]{0,900}/],
    ["handleCsv", /function handleCsv\(input\)\{[\s\S]{0,900}/],
    ["importCsvText", /function importCsvText\(\)\{[\s\S]{0,900}/],
  ];
  for (const [name, fnRe] of fns) {
    const fnMatch = source.match(fnRe);
    assert.ok(fnMatch, `${name}() should exist`);
    assert.match(fnMatch[0], guardPattern, `${name}() should have the demo-preview guard`);
  }
});

// Finding 6 (LOW, pre-existing): Source and Trend chart modes both plot
// data filtered by state.activeCats when a category chip is active (see
// their own getBaseTxs().filter(...) calls), but the shared peak
// computation had no equivalent filter -- predates the 110th pass (the
// old MONTHLY-based sums had the same gap), not a regression, but the
// 110th pass's own comment claimed this computation now matches "the same
// base data … all plot below," which wasn't quite true until this fix. ──
test("renderSpendChart: the shared peak computation respects state.activeCats, matching Source/Trend mode's own plotted-data filter", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const _peakBaseTxs=getBaseTxs\(\)\.filter\(t=>!t\.isIncome&&\(state\.activeCats\.size===0\|\|state\.activeCats\.has\(t\.cat\)\)\);/,
    "_peakBaseTxs should filter by activeCats the same way Source/Trend mode's own plotted data does"
  );
});

// Finding 7 (LOW, dead code): the SOURCES global was write-only -- pushed
// to inside confirmTxImport()'s own guard, but never read anywhere else
// in the file. Removed along with the dead guard. ──
test("confirmTxImport: the dead write-only SOURCES global and its guard are removed", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(source, /\bconst SOURCES=/, "the dead SOURCES const should be removed");
  assert.doesNotMatch(source, /SOURCES\.push\(source\)/, "the dead write-only guard should be removed");
});

// ── 112th adversarial pass ──────────────────────────────────────────────
// Pass 112 was scoped to exhaustively re-verify the demo-to-real
// transition area (passes 108-111) rather than review fresh territory --
// its verdict was that this area needed a dedicated systematic-audit
// pass, since it found 2 MORE missed "first real save" entry points
// (saveVehicle(), saveHistoricalSnapshot()) with the identical bug shape
// as saveAccount()/saveSnapshot()/saveTx() (110th/111th passes): they add
// real, user-entered balance-sheet data during a demo session without
// wiping demo data, without setting hasRealData/hasRealAccounts/
// hasRealSnapshot, and without the demo-preview-over-real guard. ──

// Finding 1 (HIGH): saveVehicle() pushes a vehicle AND its paired
// balance-carrying account -- the same class of net-worth data
// saveAccount() already guards -- but was missed as a 6th "first real
// save" entry point. A real vehicle added during a demo session was
// silently DELETED the moment any other covered first-real-save action
// ran its own wipe. Fixed with the same guard/wipe/fallback pattern as
// saveAccount(). saveVehicle() is DOM-heavy; source-pattern only,
// matching this suite's established precedent. ──
test("saveVehicle: has the demo-preview guard, calls _replaceDemoDataWithReal() after validation, and falls back editVehicleId to null if it no longer resolves post-wipe", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveVehicle\(\)\{[\s\S]{0,7900}?closeModals\(\);renderAll\(\);\n\}/);
  assert.ok(fnMatch, "saveVehicle() should exist");
  const guardIdx = fnMatch[0].search(/if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{/);
  const valueGuardIdx = fnMatch[0].search(/if\(value<0\|\|!Number\.isFinite\(value\)\|\|!Number\.isFinite\(purchase\)\)return;/);
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const fallbackIdx = fnMatch[0].search(/if\(editVehicleId&&!state\.vehicles\.find\(x=>x\.id===editVehicleId\)\)editVehicleId=null;/);
  const editCheckIdx = fnMatch[0].search(/if\(editVehicleId\)\{/);
  assert.ok(guardIdx >= 0, "saveVehicle() should have the demo-preview guard");
  assert.ok(guardIdx < valueGuardIdx, "the demo-preview guard should be the first check in the function");
  assert.ok(wipeIdx >= 0, "saveVehicle() should call _replaceDemoDataWithReal()");
  assert.ok(valueGuardIdx < wipeIdx, "value/name validation must run before the wipe, so a rejected save doesn't leave demo data wiped with nothing saved");
  assert.ok(fallbackIdx >= 0 && fallbackIdx < editCheckIdx, "editVehicleId should be nulled out before the edit/add branch if it no longer resolves post-wipe, falling back to add-as-new");
});

// Finding 2 (HIGH) & Finding 3 (MEDIUM): saveHistoricalSnapshot() pushes
// real, user-typed net-worth history -- the same class of data
// saveSnapshot() already guards -- but was missed as a 7th "first real
// save" entry point, AND never set hasRealSnapshot at all (only
// saveSnapshot()'s "current month" flow did), leaving the "Demo
// snapshots" notice visible over fully real history for anyone whose
// first snapshot came from this "+ Add historical" flow instead. ──
test("saveHistoricalSnapshot: has the demo-preview guard, wipes demo data before the duplicate-month checks, and sets hasRealData/hasRealSnapshot", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveHistoricalSnapshot\(\)\{[\s\S]{0,7500}?_editingSnapshotMonthKey=null;\n  closeModals\(\);renderHistory\(\);renderNwChart\(\);scheduleSave\(\);/);
  assert.ok(fnMatch, "saveHistoricalSnapshot() should exist");
  const guardIdx = fnMatch[0].search(/if\(window\._isDemoPreview\|\|window\._viewingDemoOverReal\)\{/);
  const dateGuardIdx = fnMatch[0].search(/if\(!date\|\|!Number\.isFinite\(nw\)\)/);
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const dupCheckIdx = fnMatch[0].search(/if\(!_editingSnapshotMonthKey&&state\.snapshots\.some/);
  const hasRealSnapIdx = fnMatch[0].search(/state\.hasRealSnapshot=true;/);
  assert.ok(guardIdx >= 0 && guardIdx < dateGuardIdx, "the demo-preview guard should be the first check");
  assert.ok(wipeIdx >= 0, "should call _replaceDemoDataWithReal()");
  assert.ok(dateGuardIdx < wipeIdx, "date/net-worth validation must run before the wipe");
  assert.ok(wipeIdx < dupCheckIdx, "the wipe must run BEFORE the duplicate-month check, so a demo-scripted monthKey can't false-positive against the real month being backfilled");
  assert.ok(hasRealSnapIdx >= 0, "should set state.hasRealSnapshot=true, matching saveSnapshot()'s own flag -- previously only that function set it");
});

// Finding 5 (LOW): the sign-out handler re-showed the "this is demo data"
// nudge whenever window._demoPicked was true, with no check for whether
// the user had since transitioned to real data -- _demoPicked is a
// one-time "did they ever open the demo picker this session" flag, never
// reset by the demo-to-real transition. ──
test("Sign-out handler: only re-shows the demo nudge if the user hasn't transitioned to real data (state.hasRealData is false)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if \(window\._demoPicked && !state\.hasRealData\) \{/,
    "the sign-out handler should check !state.hasRealData before re-showing the demo nudge"
  );
});

// ── 113th adversarial pass (dedicated systematic audit) ───────────────────
// Pass 112's explicit verdict was that the demo-to-real transition area
// needed a dedicated audit rather than continued reactive per-site
// patching (5 consecutive passes, 108-112, had each found real gaps). The
// 113th pass exhaustively enumerated every writer to the 4 wiped arrays
// and every _replaceDemoDataWithReal()-reset field, and found: the
// incremental-add side (7 "first real save" entry points) was fully
// closed -- no 8th uncovered site exists -- but the LOAD direction had
// the same bug shape in a more severe form. ──

// CRITICAL finding: loadUserData() (the cloud-sync restore path) never
// set hasRealData/hasRealAccounts/hasRealSnapshot at all --
// check-cloudsync-coverage.py's own docstring incorrectly claimed these
// were "re-derived flags," but nothing anywhere actually derived them. A
// signed-in user restoring real data on a fresh device/browser stayed
// permanently "demo-armed": every covered first-real-save entry point's
// own _replaceDemoDataWithReal() guard treated their entire real,
// cloud-synced dataset as safe to wipe on their very next ordinary
// action, and since that action re-syncs to the cloud, the destruction
// propagated to every other device too. loadUserData() is async/
// Supabase-heavy; source-pattern only, matching this suite's established
// precedent. ──
test("loadUserData: derives hasRealAccounts/hasRealSnapshot/hasRealData from what was actually restored", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/\/\/ Ensure activeSources is populated after cloud restore[\s\S]{0,2500}?renderAll\(\);/);
  assert.ok(fnMatch, "the post-restore block in loadUserData() should exist");
  assert.match(fnMatch[0], /if\(state\.accounts\.length>0\)state\.hasRealAccounts=true;/, "should set hasRealAccounts when real accounts were restored");
  assert.match(fnMatch[0], /if\(state\.snapshots\.length>0\)state\.hasRealSnapshot=true;/, "should set hasRealSnapshot when real snapshots were restored");
  assert.match(
    fnMatch[0],
    /if\(state\.hasRealAccounts\|\|state\.hasRealSnapshot\|\|state\.vehicles\.length>0\|\|state\.transactions\.length>0\)state\.hasRealData=true;/,
    "should set hasRealData if any real data (accounts, snapshots, vehicles, or transactions) was restored (vehicles.length added defensively, 114th pass)"
  );
  assert.doesNotMatch(
    fnMatch[0],
    /const chip=document\.getElementById\('demo-chip'\);if\(chip\)chip\.style\.display='none';/,
    "the old direct-DOM-hiding block should be removed -- renderAll()'s own hideDemoBadge() call now correctly covers this once the flags are set"
  );
});

// MEDIUM finding: deleteAcct()/deleteVehicle() never reset hasRealAccounts
// when the account list emptied, unlike confirmDeleteSnapshot()'s existing
// !state.snapshots.length pattern for hasRealSnapshot -- a stale-flag
// ghost state that re-armed the exact fabricated-$0-snapshot bug the
// 111th pass fixed (saveSnapshot()'s guard checks the flag, not the
// account list itself). ──
test("deleteAcct and deleteVehicle: reset hasRealAccounts=false when state.accounts becomes empty, matching confirmDeleteSnapshot()'s existing pattern", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const daMatch = source.match(/function deleteAcct\(\)\{[\s\S]{0,1000}?\n\}/);
  assert.ok(daMatch, "deleteAcct() should exist");
  assert.match(daMatch[0], /if\(!state\.accounts\.length\)state\.hasRealAccounts=false;/, "deleteAcct() should reset hasRealAccounts when the last account is deleted");
  const dvMatch = source.match(/function deleteVehicle\(\)\{[\s\S]{0,1500}?\n\}/);
  assert.ok(dvMatch, "deleteVehicle() should exist");
  assert.match(dvMatch[0], /if\(!state\.accounts\.length\)state\.hasRealAccounts=false;/, "deleteVehicle() should reset hasRealAccounts when its paired-account removal leaves state.accounts empty");
});

// LOW finding (confirmed, with a correction): post-transition demo
// notices could describe rows that no longer exist -- a transactions-only
// first save (saveTx()/confirmTxImport()) correctly empties
// state.accounts/state.snapshots too (the wipe clears every field, not
// just the one the triggering action populated), but hasRealAccounts/
// hasRealSnapshot stayed false, so their notices kept showing "add your
// real balances to replace these" over a genuinely empty (not demo)
// list. Fixed by also hiding each notice once state.hasRealData is true,
// since no demo rows survive in ANY field past that point. Also removed
// 2 dead-code references to a #demo-notice-history element that doesn't
// exist anywhere in the DOM. ──
test("renderAll: per-tab demo notices also hide once state.hasRealData is true, not just their own more-specific flag", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderAll\(\)\{[\s\S]{0,2400}?\n\}/);
  assert.ok(fnMatch, "renderAll() should exist");
  assert.match(fnMatch[0], /if\(da\)da\.style\.display=\(state\.hasRealAccounts\|\|state\.hasRealData\)\?'none':'';/, "the accounts notice should hide once hasRealData is true too");
  assert.match(fnMatch[0], /if\(sdn\)sdn\.style\.display=\(state\.hasRealSnapshot\|\|state\.hasRealData\)\?'none':'';/, "the snapshot notice should hide once hasRealData is true too");
  assert.match(
    fnMatch[0],
    /if\(dn\)dn\.style\.display=\(\(state\.hasRealAccounts&&state\.hasRealSnapshot\)\|\|state\.hasRealData\)\?'none':'';/,
    "the dashboard notice should hide once hasRealData is true too"
  );
});
test("The dead #demo-notice-history DOM references are removed (the element doesn't exist anywhere in the DOM)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(source, /demo-notice-history/, "no reference to the nonexistent #demo-notice-history element should remain");
});

// Structural fix: a new permanent scanner, check-demo-transition-coverage.py,
// flags any function that pushes onto state.accounts/vehicles/snapshots/
// transactions without referencing _replaceDemoDataWithReal() -- so a
// future 8th "first real save" entry point can't be written without the
// treatment and silently reopen this whole bug class again. ──
test("check-demo-transition-coverage.py exists and reports 0 candidates against the current, fully-covered set of entry points", () => {
  const { execFileSync } = require("child_process");
  const path = require("path");
  const scriptPath = path.join(__dirname, "..", "scripts", "check-demo-transition-coverage.py");
  const fs = require("fs");
  assert.ok(fs.existsSync(scriptPath), "scripts/check-demo-transition-coverage.py should exist");
  const output = execFileSync("python3", [scriptPath], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  assert.match(output, /^0 candidate site\(s\)/m, "the scanner should report 0 candidates now that all known entry points call _replaceDemoDataWithReal()");
});

// ── 114th adversarial pass (first pass run with model: opus) ──────────────

// Finding 1 (MEDIUM): resetSourceAlign() -- bound to the "show all" link
// next to the "✓ Aligned to X" indicator -- only cleared sourceAlignDate
// and rangeFrom, never rangeTo. Every sibling range-changing handler
// (setQuickRange, onRangeFromChange) resets rangeTo when it moves
// rangeFrom; this one didn't, so a user who'd narrowed the "to" month
// after aligning sources, then clicked "show all", kept every month after
// that stale bound silently hidden -- directly contradicting the link's
// own label. ──
test("resetSourceAlign: also clears state.rangeTo, not just sourceAlignDate/rangeFrom", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function resetSourceAlign\(\)\{state\.sourceAlignDate=null;state\.rangeFrom=null;state\.rangeTo=null;scheduleSave\(\);renderSpending\(\);\}/,
    "resetSourceAlign() should reset state.rangeTo=null alongside sourceAlignDate/rangeFrom, so 'show all' actually shows all months"
  );
});

// Finding 2 (LOW): checkSourceAlignment() created a fresh #source-align-modal
// element with a fixed id and no check for an existing one, so calling it
// twice without a dismissal in between stacked duplicate overlays sharing
// the same id -- applySourceAlign()/skipSourceAlign() only ever remove the
// first one found. checkSourceAlignment() is DOM-heavy; source-pattern
// only, matching this suite's established precedent. ──
test("checkSourceAlignment: removes any existing #source-align-modal before creating a new one", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function checkSourceAlignment\(\)\{[\s\S]{0,5000}?document\.body\.appendChild\(modal\);/);
  assert.ok(fnMatch, "checkSourceAlignment() should exist");
  const removeIdx = fnMatch[0].search(/const existing=document\.getElementById\('source-align-modal'\);[\s\S]{0,800}?if\(existing\)existing\.remove\(\);/);
  const createIdx = fnMatch[0].search(/const modal=document\.createElement\('div'\);/);
  assert.ok(removeIdx >= 0, "should remove any existing #source-align-modal");
  assert.ok(removeIdx < createIdx, "the removal should happen before the new element is created");
});

// Finding 3 (LOW): detectSubscriptions()'s latest-month figure used
// entries.find(e=>e.m===latestM) -- only the FIRST matching entry -- so a
// vendor charged more than once in the latest month (a mid-cycle price
// change's proration alongside the regular charge, or two distinct
// subscriptions resolving to the same vendor key) undercounted both its
// own displayed amount and the aggregate subTotal pill. ──
test("detectSubscriptions: sums ALL of a vendor's entries in the latest month, not just the first match", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function detectSubscriptions\(allMonths,latestFullM\)\{[\s\S]{0,4700}?return\{subVendors,subTotal\};/);
  assert.ok(fnMatch, "detectSubscriptions() should exist");
  assert.match(
    fnMatch[0],
    /const curEntries=entries\.filter\(e=>e\.m===latestM\);\s*if\(curEntries\.length\)\{\s*const curAmt=curEntries\.reduce\(\(s,e\)=>s\+e\.amt,0\);/,
    "should filter+sum all of the vendor's latest-month entries, not .find() the first one"
  );
  assert.doesNotMatch(fnMatch[0], /entries\.find\(e=>e\.m===latestM\)/, "the old .find()-based single-entry lookup should be gone");
});

// Finding 4 (LOW): the Dashboard's "on pace for..." spend projection
// extrapolated linearly from however much had been spent so far this
// month (currentSpendSoFar/dayOfMonth*daysInCurrentM) with no minimum
// day-of-month guard -- on day 1-2, a single normal-sized charge
// extrapolates to several times a typical month's total, false-alarming
// "would be your highest" off essentially no signal. ──
test("renderInsights: the spend-pace projection requires at least 3 days elapsed before showing (falls back to the stable last-month comparison otherwise)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(currentSpendSoFar>0&&dayOfMonth>=3&&dayOfMonth<daysInCurrentM\)\{/,
    "the pace-projection branch should require dayOfMonth>=3 before showing a projection"
  );
});

// Finding 5 (LOW, defensive): loadUserData()'s hasRealData derivation
// (113th pass) didn't account for state.vehicles.length -- not reachable
// today (saveVehicle() always pushes a paired state.accounts entry, so
// hasRealAccounts already covers every UI-created vehicle), but a hand-
// crafted/legacy cloud row breaking that pairing invariant would
// otherwise leave a user with real vehicles but zero accounts stuck
// demo-armed. ──
test("loadUserData: hasRealData derivation also includes state.vehicles.length as a defensive fallback", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(state\.hasRealAccounts\|\|state\.hasRealSnapshot\|\|state\.vehicles\.length>0\|\|state\.transactions\.length>0\)state\.hasRealData=true;/,
    "hasRealData should also be set true if real vehicles were restored, even without a paired account"
  );
});

// Part 3 dead-code findings: showAllPills()/togglePill() both repeated
// classList.remove('hidden') on #pill-customizer-modal right after
// openPillCustomizer() already does the same thing internally; togglePill()
// additionally had an unused querySelectorAll() left over from an earlier
// inline-update approach the full re-render replaced. checkSourceAlignment()
// had monthDiff and longMonths computed via the identical formula twice.
// The legacy College-Fund migration in loadFromLocalStorage() pushed a
// hardcoded id:12, which could collide with an existing legacy account
// already holding that id (state.nextId isn't restored from saved.nextId
// until later in the same function, so it can't be trusted safe at this
// point either) -- replaced with a locally-computed collision-safe id. ──
test("showAllPills and togglePill: no longer repeat classList.remove('hidden') after openPillCustomizer() already does it, and the unused labels query is removed", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const saMatch = source.match(/function showAllPills\(\)\{[\s\S]{0,400}?\n\}/);
  assert.ok(saMatch, "showAllPills() should exist");
  assert.doesNotMatch(saMatch[0], /document\.getElementById\('pill-customizer-modal'\)\.classList\.remove\('hidden'\);/, "showAllPills() should not repeat the redundant classList.remove('hidden')");
  const tpMatch = source.match(/function togglePill\(key,visible\)\{[\s\S]{0,600}?\n\}/);
  assert.ok(tpMatch, "togglePill() should exist");
  assert.doesNotMatch(tpMatch[0], /document\.getElementById\('pill-customizer-modal'\)\.classList\.remove\('hidden'\);/, "togglePill() should not repeat the redundant classList.remove('hidden')");
  assert.doesNotMatch(tpMatch[0], /querySelectorAll\('#pill-toggle-list label span'\)/, "the unused labels query should be removed");
});
test("checkSourceAlignment: longMonths reuses monthDiff instead of recomputing the identical formula", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /const longMonths=monthDiff;/, "longMonths should reuse monthDiff, not recompute the same date-diff formula a second time");
});
test("loadFromLocalStorage: the legacy College-Fund migration uses a locally-computed collision-safe id, not a hardcoded literal", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const safeId=Math\.max\(0,\.\.\.state\.accounts\.map\(a=>a\.id\|\|0\)\)\+1;\s*state\.accounts\.push\(\{id:safeId,name:'College Fund\(s\)'/,
    "the migration should compute a safe id from the current max id in state.accounts, not push a hardcoded id:12"
  );
});

// ── 115th adversarial pass ──────────────────────────────────────────────
// Part 1 (re-verification of the 114th pass's 8 fixes) came back clean --
// no gaps found, all held up. The 2 new findings below are both LOW,
// from fresh-territory review of the theme toggle and a dead-code sweep
// of detectSubscriptions() (110-114 passes had already hardened the
// highest-traffic surfaces heavily; both findings here are cosmetic/
// edge-case, not data-safety issues). ──

// Finding 1 (LOW): <meta name="theme-color"> was static (always the dark
// theme's #111720) -- neither the boot-time theme-restore script nor
// toggleTheme() ever updated it, so the mobile browser chrome/iOS Safari
// address bar/an installed PWA's status bar stayed dark blue even when
// a returning user's saved preference (or a live toggle) was light. ──
test("theme-color meta tag updates on both initial load and toggleTheme(), matching the active theme's --bg-page color", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const bootMatch = source.match(/\/\/ Restore theme before CSS renders to prevent flash[\s\S]{0,1100}?\}\)\(\);/);
  assert.ok(bootMatch, "the boot-time theme-restore IIFE should exist");
  assert.match(
    bootMatch[0],
    /const tc=document\.querySelector\('meta\[name="theme-color"\]'\);\s*if\(tc\)tc\.setAttribute\('content',t==='light'\?'#F8FAFC':'#111720'\);/,
    "the boot-time restore should also set theme-color to match the restored theme"
  );
  const toggleMatch = source.match(/function toggleTheme\(\)\{[\s\S]{0,1200}/);
  assert.ok(toggleMatch, "toggleTheme() should exist");
  assert.match(
    toggleMatch[0],
    /const tc=document\.querySelector\('meta\[name="theme-color"\]'\);\s*if\(tc\)tc\.setAttribute\('content',isLight\?'#111720':'#F8FAFC'\);/,
    "toggleTheme() should also update theme-color when live-toggling"
  );
});

// Dead-code finding (Part 3): detectSubscriptions() pushed a `median`
// field into subVendors that nothing (neither the pill nor the modal)
// ever read -- the local variable is still needed for the consistency
// check earlier in the same function, just wasn't a field any consumer
// used once summed into the object. ──
test("detectSubscriptions: no longer pushes an unused median field into subVendors", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /subVendors\.push\(\{vendor,amt:curAmt,cat:curEntries\[0\]\.cat,months:uniqueMonths\.size\}\);/,
    "subVendors.push() should no longer include the unused median field"
  );
  assert.match(source, /const median=amts\[Math\.floor\(amts\.length\/2\)\];/, "the local median variable itself should still exist -- it's still needed for the consistency check");
});

// ── 116th adversarial pass ──────────────────────────────────────────────
// Part 1 (re-verification of all 10 fixes from the 114th and 115th passes)
// came back completely clean -- no gaps found, first fully clean pass in
// this window, breaking a ~12-pass streak. The one item below is dead
// code, not a bug: the body-script "apply saved theme" IIFE re-set
// data-theme via a fresh localStorage read even though the head IIFE
// (which runs first, before CSS renders) already set it correctly,
// including its own localStorage-throws fallback. ──
test("body-script theme IIFE no longer redundantly re-sets data-theme (the head IIFE already did)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const match = source.match(/\/\/ Apply saved theme and preferences on load\n\(function\(\)\{[\s\S]{0,500}/);
  assert.ok(match, "the body-script theme-apply IIFE should exist");
  assert.doesNotMatch(
    match[0],
    /document\.documentElement\.setAttribute\('data-theme',saved\);/,
    "should no longer redundantly re-set data-theme -- the head IIFE already did"
  );
  assert.match(
    match[0],
    /if\(btn\)btn\.textContent=saved==='light'\?'☀️':'🌙';/,
    "should still set the toggle button's label from the saved theme"
  );
});

// ── 117th adversarial pass ──────────────────────────────────────────────
// HIGH: saveHistoricalSnapshot() unconditionally nulled
// _editingSnapshotMonthKey right after calling _replaceDemoDataWithReal(),
// which is a no-op whenever state.hasRealData is already true -- the
// ordinary case for any real user editing an existing snapshot. Every
// edit-detection check below (the "already have a snapshot" guard, the
// moved-to-a-different-month guard, movedFromMonthKey) reads that flag,
// so the unconditional clear silently broke snapshot editing entirely:
// an in-place value edit was rejected as "already have a snapshot for
// that month," and an edit that also moved the month created a stale
// duplicate instead of moving the entry (both locally and in Supabase).
// Found in the 117th adversarial pass, a regression escaped from the
// 112th pass's own demo-transition fix. ──
test("saveHistoricalSnapshot: only clears _editingSnapshotMonthKey when the demo-data wipe actually ran, not unconditionally", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveHistoricalSnapshot\(\)\{[\s\S]{0,5000}?if\(_wasDemoData\)_editingSnapshotMonthKey=null;/);
  assert.ok(fnMatch, "saveHistoricalSnapshot() should exist and reach the fixed clear site");
  assert.match(
    fnMatch[0],
    /const _wasDemoData=!state\.hasRealData;\s*_replaceDemoDataWithReal\(\);\s*if\(_wasDemoData\)_editingSnapshotMonthKey=null;/,
    "should capture whether real data existed before the wipe, and only clear the editing flag when the wipe actually ran"
  );
  assert.doesNotMatch(
    fnMatch[0],
    /_replaceDemoDataWithReal\(\);\s*_editingSnapshotMonthKey=null;/,
    "should no longer unconditionally clear _editingSnapshotMonthKey right after the wipe call"
  );
});

// ── 119th adversarial pass ──────────────────────────────────────────────
// LOW: the 87th pass added a Number.isFinite guard to CSV import
// specifically because parseFloat('Infinity')/parseFloat('1e400') both
// return a truthy Infinity, not NaN -- so a bare !amount/isNaN/>0 check
// lets it straight through. That guard was never propagated to the
// app's ~8 manual-entry numeric fields (transactions, accounts,
// vehicles, budgets, historical snapshots, income). An accepted
// Infinity poisons every live aggregate that reads it for the rest of
// the session, then silently collapses to 0 on the next save+reload
// (JSON.stringify(Infinity)==="null", and every loader's `||0`
// coercion turns null back into 0) -- so not a crash, but a real
// silent-data-corruption path. Found in the 119th adversarial pass. ──
test("saveTx: rejects a non-finite (Infinity/1e400) amount, not just a falsy one", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveTx\(\)\{[\s\S]{0,1600}/);
  assert.ok(fnMatch, "saveTx() should exist");
  assert.match(
    fnMatch[0],
    /if\(!desc\|\|!amount\|\|!Number\.isFinite\(amount\)\)\{/,
    "should reject a non-finite amount alongside the existing falsy check"
  );
});

test("saveEditTx: rejects a non-finite amount, not just NaN", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!Number\.isFinite\(amountVal\)\)\{showToast\('⚠ Invalid amount — edit not saved'/,
    "should use !Number.isFinite instead of isNaN, so Infinity is also rejected"
  );
});

test("saveAccount: a non-finite balance falls back to 0 instead of poisoning net worth", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /_balanceRaw=parseFloat\(document\.getElementById\('f-balance'\)\.value\),\s*balance=Number\.isFinite\(_balanceRaw\)\?_balanceRaw:0,/,
    "balance should be derived via a Number.isFinite check, not a bare `||0` fallback that Infinity survives"
  );
});

test("saveVehicle: rejects non-finite value/purchase, not just a negative value", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(value<0\|\|!Number\.isFinite\(value\)\|\|!Number\.isFinite\(purchase\)\)return;/,
    "should reject non-finite value or purchase alongside the existing negative-value guard"
  );
});

test("saveBudget: a non-finite budget amount is treated as absent, not saved", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(val>0&&Number\.isFinite\(val\)\)state\.budgets\[cat\]=Math\.round\(val\);/,
    "should require Number.isFinite alongside val>0 before saving the budget"
  );
});

test("saveHistoricalSnapshot: net worth/assets/liabilities are all Number.isFinite-guarded", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const assetsRaw=parseFloat\(document\.getElementById\('hist-snap-assets'\)\.value\);\s*const assets=Number\.isFinite\(assetsRaw\)\?assetsRaw:nw;/,
    "assets should fall back to nw only via a Number.isFinite check, not a bare `||nw` that Infinity survives"
  );
  assert.match(
    source,
    /const liabRaw=parseFloat\(document\.getElementById\('hist-snap-liab'\)\.value\);\s*const liab=Number\.isFinite\(liabRaw\)\?liabRaw:0;/,
    "liab should fall back to 0 only via a Number.isFinite check"
  );
  assert.match(
    source,
    /if\(!date\|\|!Number\.isFinite\(nw\)\)\{showToast\('Please enter a date and net worth'/,
    "nw should be rejected via !Number.isFinite, not just isNaN"
  );
});

test("saveDeclaredIncome: rejects a non-finite value, not just NaN", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(Number\.isFinite\(val\)&&val>0\)\{/,
    "should use Number.isFinite instead of !isNaN, so Infinity is also rejected"
  );
});

test("saveManualIncome: rejects a non-finite value alongside the existing falsy/negative checks", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!val\|\|val<=0\|\|!Number\.isFinite\(val\)\)\{showToast\('Please enter a valid monthly income'/,
    "should reject a non-finite value alongside the existing checks"
  );
});

// ── 120th adversarial pass ──────────────────────────────────────────────
// LOW: extending the 119th pass's Number.isFinite sweep -- its search was
// scoped to manual-entry save functions and trusted an over-broad reading
// of the 87th pass's fix ("CSV import" actually meant transaction CSV
// import only). Two more reachable sites of the identical Infinity/1e400
// class survived: the account CSV import path (never touched by either
// the 87th or 119th pass), and the custom net-worth-goal input (whose
// type="number" field accepts scientific notation like '1e400'). Found
// in the 120th adversarial pass. ──
test("parseCsvAccounts: rejects a non-finite (Infinity/1e400) balance, not just NaN", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!name\.trim\(\)\|\|!normType\|\|!Number\.isFinite\(balance\)\)\{skipped\+\+;return;\}/,
    "should reject a non-finite balance alongside the existing name/type checks"
  );
});

test("confirmCustomGoal: rejects a non-finite (Infinity/1e400) goal amount, not just NaN", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!Number\.isFinite\(parsed\)\|\|parsed<=0\)\{/,
    "should reject a non-finite parsed value alongside the existing parsed<=0 check"
  );
});

// ── 121st adversarial pass ──────────────────────────────────────────────
// MEDIUM: exportTransactionsCSV() writes a per-row Source column (t.card),
// and the trakyodollas re-import branch's whole design is "trust every
// field directly instead of re-guessing" -- but it never read row['source']
// back, so every re-imported row silently collapsed onto the single
// file-level source label instead (the #import-source-label input,
// default "Checking"), losing per-source attribution wholesale on a plain
// export/reimport round-trip. Fixed by reading row['source'] (through the
// same _stripCsvFormulaGuard() treatment desc/cat already get) and
// falling back to the file-level label only when the column is absent or
// blank. Found in the 121st adversarial pass. ──
test("normalizeTxRow's 'trakyodollas' import branch reads the per-row Source column back, instead of collapsing every row onto the file-level source label", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /card=_stripCsvFormulaGuard\(\(row\['source'\]\|\|''\)\.trim\(\)\)\|\|undefined;/,
    "the trakyodollas branch should read row['source'] through the same formula-guard treatment as desc/cat"
  );
  assert.match(
    source,
    /return \{date,desc:desc\.slice\(0,50\),cat,card:card\|\|source,amount:Math\.round\(amount\*100\)\/100,excluded,is_offset:isOffset,isIncome:isIncome\|\|false,biz:biz\|\|false\};/,
    "the return statement should prefer the per-row card over the file-level source label when one was parsed"
  );
});

// ── 122nd adversarial pass ──────────────────────────────────────────────
// LOW: rule matching (applyRulesToExisting()/normalizeTxRow()) is
// first-match-wins over descUpper.includes(rule.keyword), and
// addCatRule() unshifts new rules to the front -- so a new keyword that's
// a SUBSTRING of an existing rule's keyword matches every description
// that existing rule would have, and (sitting in front) always wins the
// tie. The existing rule becomes permanently unreachable with no warning
// and nothing deleted -- the same "the label invites an edit that hides
// the conflict" shape the 60th pass fixed for the exact-match case, just
// one level broader (a substring conflict, not just an exact one). Found
// in the 122nd adversarial pass. ──
test("_checkSrpKeywordConflict: also warns when the new keyword would shadow (not just exactly duplicate) an existing rule", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function _checkSrpKeywordConflict\(keyword\)\{[\s\S]{0,1600}?\n\}/);
  assert.ok(fnMatch, "_checkSrpKeywordConflict() should exist");
  assert.match(
    fnMatch[0],
    /const shadowed=state\.catRules\.find\(r=>r\.keyword\.toUpperCase\(\)\.includes\(kw\)\);/,
    "should also check for an existing rule whose keyword contains the new (shorter) keyword as a substring"
  );
  const exactIdx = fnMatch[0].search(/const conflict=state\.catRules\.find\(r=>r\.keyword\.toUpperCase\(\)===kw\);/);
  const shadowIdx = fnMatch[0].search(/const shadowed=state\.catRules\.find/);
  assert.ok(exactIdx >= 0 && exactIdx < shadowIdx, "the exact-match check should still run first (its own more specific, more actionable warning)");
});

// ── 123rd adversarial pass ──────────────────────────────────────────────
// MEDIUM: #toast is the app's single universal feedback channel (save
// confirmations, import results, validation errors, cloud-sync-failure
// warnings) but had no aria-live/role markup at all, so a screen-reader
// user got zero announcement of any toast -- including error toasts that
// are the only signal a save/import was rejected. Found in the 123rd
// adversarial pass. ──
test("#toast carries role=\"status\" and aria-live=\"polite\" so its messages are announced to screen readers", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div id="toast" role="status" aria-live="polite" aria-atomic="true" style=/,
    "the #toast element should carry role=status, aria-live=polite, and aria-atomic=true"
  );
});

// LOW: checkSourceAlignment() builds its modal at runtime via
// createElement() rather than static markup, so it never got the
// role="dialog"/aria-modal/aria-labelledby/tabindex every static .modal
// in the file carries -- the existing focus-trap logic already traps Tab
// inside it, but assistive tech didn't recognize it as a dialog. Found in
// the 123rd adversarial pass. ──
test("checkSourceAlignment's dynamically-built modal carries the same dialog semantics as every static modal", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="source-align-title" tabindex="-1" style="max-width:420px">/,
    "the modal-box should carry role=dialog, aria-modal=true, aria-labelledby, and tabindex=-1"
  );
  assert.match(
    source,
    /<div id="source-align-title" class="modal-title" style="font-size:17px;margin-bottom:\.75rem">Your sources cover different time periods<\/div>/,
    "the title element should carry the id the aria-labelledby resolves to"
  );
});

// ── 124th adversarial pass ──────────────────────────────────────────────
// MEDIUM: #source-align-modal is the one modal built at runtime rather
// than existing in static markup, so it was never in the DOM when
// _a11yModalObserver's one-time querySelectorAll('.modal-overlay') set up
// its watch list -- it never got focus moved in on open or returned on
// close, and since it's dismissed via .remove() rather than toggling the
// .hidden class, no class-attribute mutation ever exists for the observer
// to detect even if it WERE registered. The 123rd pass's aria-modal="true"
// addition asserted dialog semantics this modal couldn't actually back
// up. Found in the 124th adversarial pass (re-verifying the 123rd pass's
// own fix). ──
test("checkSourceAlignment's modal is wired into the shared a11y focus-management system (registered with the observer, opens/closes via the same handlers as static modals)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /_a11yModalObserver\.observe\(modal,\{attributes:true,attributeFilter:\['class'\]\}\);\s*if\(_a11yOpenModalEl!==modal\)_a11yHandleOpen\(modal\);/,
    "checkSourceAlignment() should register the modal with the observer and directly call _a11yHandleOpen(), since no class-attribute mutation occurs for the observer to detect on its own"
  );
  const closers = ["applySourceAlign", "skipSourceAlign", "skipSourceAlignPermanent"];
  closers.forEach(fnName => {
    const fnMatch = source.match(new RegExp(`function ${fnName}\\([^)]*\\)\\{[\\s\\S]{0,400}`));
    assert.ok(fnMatch, `${fnName}() should exist`);
    assert.match(
      fnMatch[0],
      /if\(modal\)\{if\(_a11yOpenModalEl===modal\)_a11yHandleClose\(\);modal\.remove\(\);\}/,
      `${fnName}() should call _a11yHandleClose() before removing the modal, so focus returns to the trigger`
    );
  });
});

// LOW: Chrome (and some other browsers) silently increments/decrements a
// focused <input type="number">'s value when the mouse wheel scrolls over
// it. #budget-warn-input sits inline in the scrollable Budget tab (not a
// modal), so a user scrolling the page with that field still focused from
// a prior edit gets their near-limit warning threshold silently altered
// with zero intent. Found in the 124th adversarial pass. ──
test("a focused <input type=number> is blurred on wheel scroll, preventing the browser's native scroll-to-change behavior", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /document\.addEventListener\('wheel',function\(e\)\{\s*if\(e\.target\.tagName==='INPUT'&&e\.target\.type==='number'&&document\.activeElement===e\.target\)e\.target\.blur\(\);\s*\},\{passive:true\}\);/,
    "should blur a focused number input on wheel, with {passive:true} so page scrolling itself is unaffected"
  );
});

// ── 125th adversarial pass ──────────────────────────────────────────────
// LOW: re-verifying the 124th pass's own a11y-wiring fix, checkSourceAlignment()
// calling itself again while a source-align modal is ALREADY the tracked-
// open modal (e.g. resumeSourceAlign() firing while a prior instance is
// still up, the exact double-call case the 114th pass's own "remove any
// existing instance" comment documents as reachable) removed the existing
// modal WITHOUT calling _a11yHandleClose() first -- so by the time the new
// modal's _a11yHandleOpen() ran, document.activeElement had already
// collapsed to <body> (removing a focused tabindex="-1" element does
// that), silently discarding the real pre-modal focus target and
// returning focus to <body> instead of the trigger on the new modal's
// eventual close. Found in the 125th adversarial pass. ──
test("checkSourceAlignment: re-opening while a prior instance is already tracked-open preserves the ORIGINAL pre-modal return-focus target", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function checkSourceAlignment\(\)\{[\s\S]{0,5000}?document\.body\.appendChild\(modal\);/);
  assert.ok(fnMatch, "checkSourceAlignment() should exist");
  assert.match(
    fnMatch[0],
    /const _priorReturnFocusEl=\(_a11yOpenModalEl===existing\)\?_a11yReturnFocusEl:null;\s*if\(existing\)existing\.remove\(\);/,
    "should capture the prior modal's own already-correct return-focus target before removing it"
  );
  const afterMatch = source.match(/document\.body\.appendChild\(modal\);[\s\S]{0,1300}?\n\}/);
  assert.ok(afterMatch, "should find the code after appendChild through the function's closing brace");
  assert.match(
    afterMatch[0],
    /if\(_a11yOpenModalEl!==modal\)_a11yHandleOpen\(modal\);\s*if\(_priorReturnFocusEl\)_a11yReturnFocusEl=_priorReturnFocusEl;/,
    "should restore the preserved return-focus target after _a11yHandleOpen() runs, overriding its own (now-wrong) document.activeElement capture"
  );
});

// MEDIUM: a deploy-triggered service-worker controllerchange forced an
// immediate location.reload() on any already-open tab with no guard --
// location.reload()'s own pagehide handler only flushes committed state,
// not typed-but-not-yet-saved DOM input (a half-entered transaction, a
// passphrase mid-entry), which was silently destroyed by a reload the
// user never asked for. Found in the 125th adversarial pass. ──
test("service-worker controllerchange defers location.reload() while a modal is open, instead of forcing it immediately", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const reloadWhenIdle=\(\)=>\{\s*if\(document\.querySelector\('\.modal-overlay:not\(\.hidden\)'\)\)setTimeout\(reloadWhenIdle,1000\);\s*else location\.reload\(\);\s*\};\s*reloadWhenIdle\(\);/,
    "should poll for an open modal and defer the reload until none is open, rather than reloading unconditionally"
  );
});

// ── 127th adversarial pass ──────────────────────────────────────────────
// MEDIUM: renderYearInReview()/copyYirSummary()'s "Total spent" hero,
// month-by-month figures (biggest/quietest/average), and savings rate all
// derived from `txs`, which only excluded state.excludedCats-independent
// isRealSpend() (!excluded && !isIncome) -- NOT YIR_EXCLUDE_CATS
// (Transfers/Investment Contributions/Internal Transfer/CC Payment/
// Checks), which only ever gated the category/vendor breakdown below via
// a separate `txsFiltered`. A 401k/brokerage contribution or a transfer
// into savings inflated "Total spent" and pushed the savings rate DOWN --
// the app penalized saving as if it were spending -- and the category
// breakdown never summed to the hero total as a direct symptom. Fixed by
// applying YIR_EXCLUDE_CATS to `txs` itself, so every downstream figure
// (not just the breakdown) is consistent. Found in the 127th adversarial
// pass. ──
test("Year in Review: Total spent/month figures/savings rate exclude transfer-like categories, not just the category breakdown", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/state\.transactions\.filter\(t=>months\.includes\(t\.date\.slice\(0,7\)\)&&isRealSpend\(t\)&&!YIR_EXCLUDE_CATS\.has\(t\.cat\)&&state\.activeSources\.has\(t\.card\)&&\(_bizFilter!=='biz'\|\|t\.biz\)&&\(_bizFilter!=='personal'\|\|!t\.biz\)\);/g) || [];
  assert.equal(matches.length, 2, "both renderYearInReview() and copyYirSummary() should apply YIR_EXCLUDE_CATS directly to the txs filter, not only to the separate txsFiltered used for the category/vendor breakdown");
});

// ── 128th adversarial pass ──────────────────────────────────────────────
// LOW (cosmetic): copyYirSummary()'s footer note still read "...excluded
// from categories/vendors" after the 127th pass's fix, which extended the
// same exclusion to the total/savings rate/month rankings above it too --
// understating what the copied summary actually reflects. Found in the
// 128th adversarial pass, a fresh-territory re-verification of the 127th
// pass's fix. ──
test("copyYirSummary: footer note reflects that transfer-like categories are excluded throughout, not just from categories/vendors", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /'\(Transfers, CC payments & investments excluded throughout\)',/,
    "the footer note should say 'excluded throughout', not the stale 'excluded from categories/vendors'"
  );
});
