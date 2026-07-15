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
  const fmtC = loadConstArrowFn("fmtC");
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
    /function saveTx\(\)\{const dateVal=parseImportDate\(document\.getElementById\('t-date'\)\.value\)/,
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
    /function loadDemoProfile\(n, silent=false, skipRender=false\)\{[\s\S]{0,2900}?state\.sourceAlignDate=null;\s*state\.sourceAlignSkipped=false;/,
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
test("importBackup, confirmTxImport, loadUserData, and loadDemoProfile all call the shared _resetSessionFiltersForDataReplace() helper", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=arr\(payload\.transactions\)\.map\(t=>[\s\S]{0,1400}?_resetSessionFiltersForDataReplace\(\);\s*rebuildMonthly\(\);\s*rebuildCatSelects\(\);\s*scheduleSave\(\);\s*renderAll\(\);\s*showToast\('Backup restored\.'/,
    "importBackup() should call _resetSessionFiltersForDataReplace() before rebuildMonthly(), right before its final 'Backup restored.' toast"
  );
  assert.match(
    source,
    /if\(!state\.hasRealData\)\{\s*state\.transactions=\[\];\s*state\.activeSources=new Set\(\);\s*state\.budgets=\{\};[\s\S]{0,1000}?_resetSessionFiltersForDataReplace\(\);\s*\}/,
    "confirmTxImport()'s !state.hasRealData branch should call _resetSessionFiltersForDataReplace() alongside its existing transactions/activeSources/budgets wipe"
  );
  assert.match(
    source,
    /if \(Array\.isArray\(prefs\.transactions\)\) \{\s*state\.transactions = prefs\.transactions\.map\(t=>[\s\S]{0,700}?_resetSessionFiltersForDataReplace\(\);\s*rebuildMonthly\(\);/,
    "loadUserData()'s cloud-sync transactions-replace branch should call _resetSessionFiltersForDataReplace()"
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
    /const hadRealData=state\.hasRealData;[\s\S]{0,700}?if\(!silent&&hadRealData\)window\._viewingDemoOverReal=true;[\s\S]{0,4500}?_resetSessionFiltersForDataReplace\(\);/,
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
    /cat=_stripCsvFormulaGuard\(row\['category'\]\|\|'Other'\);/,
    "category should be passed through _stripCsvFormulaGuard() on our own round-trip import format"
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
