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
      ["computePeriodSpendVsIncome", "getFilteredMonths", "getEffectiveIncome", "detectDepositIncome", "isRealSpend"],
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
      ["computePeriodSpendVsIncome", "getFilteredMonths", "getEffectiveIncome", "detectDepositIncome", "isRealSpend"],
      ctx
    );
  const result = computePeriodSpendVsIncome();
  assert.equal(result.totalIncome, 5000);
  assert.equal(result.income, 5000);
});
