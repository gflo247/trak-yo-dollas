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
    saveToLocalStorage: () => { saveCalled = true; },
    syncToCloud: () => { syncCalled = true; },
  };
  const { scheduleSave } = loadFunctions(["scheduleSave"], ctx);
  scheduleSave();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(saveCalled, true);
  assert.equal(syncCalled, false);
});
