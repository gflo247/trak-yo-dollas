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
test("isValidHexColor: accepts standard/shorthand hex, rejects style-attribute breakout attempts and non-hex input", () => {
  const { isValidHexColor } = loadFunctions(["isValidHexColor"]);
  assert.equal(isValidHexColor("#34D399"), true, "standard 6-digit hex");
  assert.equal(isValidHexColor("#fff"), true, "shorthand 3-digit hex");
  assert.equal(isValidHexColor('red;background:url(javascript:alert(1))'), false, "rejects a value that breaks out of a style attribute");
  assert.equal(isValidHexColor('#fff" onmouseover="alert(1)'), false, "rejects a value that breaks out of a style attribute");
  assert.equal(isValidHexColor(null), false);
  assert.equal(isValidHexColor(undefined), false);
  assert.equal(isValidHexColor(""), false);
  assert.equal(isValidHexColor("#12345"), false, "near-miss hex length");
  assert.equal(isValidHexColor("blue"), false, "non-hex color name");
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

// ── 141st adversarial pass ──────────────────────────────────────────────
// LOW: spendByCat accumulates raw floats across every transaction in a
// category with no re-rounding to cents (spendByCat[t.cat]=(spendByCat
// [t.cat]||0)+t.amount), so a month whose spend totals exactly the
// budget can land a hair above it purely from float noise (the classic
// 0.1+0.2 shape). The old bare spend>budget comparison flipped `over`
// true with no real overspend, showing a red "OVER" badge and a
// nonsensical "$0 over budget" label (fmt() rounds to whole dollars,
// so the sub-cent difference renders as $0). Found in the 141st
// adversarial pass. ──
test("classifyBudgetStatus: a sub-cent float-accumulation overshoot doesn't flip a category to OVER, but a genuine overspend (well beyond the epsilon) still does", () => {
  const { classifyBudgetStatus } = loadFunctions(["classifyBudgetStatus"]);
  // The classic 0.1+0.2 float-noise shape: spend lands a hair above
  // budget purely from accumulated floating-point error, not a real
  // overspend.
  const noisySpend = 0.1 + 0.2 + 299.7; // === 300.00000000000006, not exactly 300
  assert.equal(classifyBudgetStatus(noisySpend, 300, true, 0.9, 80).over, false, "a sub-cent float overshoot should not be classified as over budget");
  assert.equal(classifyBudgetStatus(300.5, 300, true, 0.9, 80).over, true, "a real 50-cent overspend should still be classified as over budget");
});

// ── 142nd adversarial pass ──────────────────────────────────────────────
// LOW: the 141st pass added the float-noise epsilon only INSIDE
// classifyBudgetStatus() -- 5 sibling sites (the compact budget badge,
// buildCondensedDots(), buildPctDots(), the hero 12-month history dots,
// and the inline per-cat condensed dots) all read the identical
// unrounded getCatMonthSpend()/spendByCat-style float sums via their own
// bare > comparisons, so a category exactly at budget could now show
// green in classifyBudgetStatus()'s own callers but red in every one of
// these -- the exact cross-UI inconsistency classifyBudgetStatus() was
// extracted to eliminate (see its own header comment and the 44th
// pass's near-identical fix for the warnPct boundary). Found in the
// 142nd adversarial pass, re-verifying the 141st pass's own fix. ──
test("the 4 sibling dot/pct-color render sites (compact badge, buildCondensedDots/buildPctDots, hero history dots, inline per-cat dots) all use the same float-noise epsilon as classifyBudgetStatus()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const badgeMatches = source.match(/curAmt>budget\+0\.005\?'#F87171':curAmt\/budget>0\.8\?'#FBBF24':'#34D399'/g) || [];
  assert.equal(badgeMatches.length, 2, "both the compact badge's dot and % text color should use the same epsilon-tolerant comparison");
  const condensedMatches = source.match(/ms>limit\+0\.005\?'#F87171':mp>=warnPct\?'#FBBF24':'#34D399'/g) || [];
  assert.equal(condensedMatches.length, 2, "both buildCondensedDots() and buildPctDots() should use the same epsilon-tolerant comparison");
  assert.match(
    source,
    /mSpent>totalBudget\+0\.005\?'#F87171':mPct>=warnPct\?'#FBBF24':'#34D399'/,
    "the hero history dots should use the same epsilon-tolerant comparison"
  );
  assert.match(
    source,
    /ms>budget\+0\.005\?'#F87171':mp>=warnPct\?'#FBBF24':'#34D399'/,
    "the inline per-cat condensed dots should use the same epsilon-tolerant comparison"
  );
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
test("splitCSVLine: plain fields, quoted commas, trailing empty fields, and doubled-quote escaping", () => {
  const { splitCSVLine } = loadFunctions(["splitCSVLine"]);
  assert.deepEqual(splitCSVLine("a,b,c"), ["a", "b", "c"], "splits plain comma-separated fields");
  assert.deepEqual(splitCSVLine('a,"b,c",d'), ["a", "b,c", "d"], "a comma inside quotes doesn't split the field (quotes themselves are stripped)");
  assert.deepEqual(splitCSVLine("a,b,"), ["a", "b", ""], "a trailing empty field after the last comma is preserved");
  // Standard CSV escaping: "" inside a quoted field means one literal ".
  // The naive quote-toggle parser used to treat each " independently and
  // silently drop both characters instead of keeping one.
  assert.deepEqual(splitCSVLine('"He said ""hi""",next'), ['He said "hi"', "next"], "a doubled quote inside a quoted field is a literal quote, not two field boundaries");
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
test("parseCSV/splitCSVLine: an explicit delimiter argument overrides the comma default, needed for UK midata exports which use semicolons", () => {
  const { parseCSV, splitCSVLine } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  assert.deepEqual(splitCSVLine("a;b;c", ";"), ["a", "b", "c"]);
  const rows = parseCSV("Date;Merchant/Description;Debit/Credit\n31/03/2018;TESCO STORES;-42.17", ";");
  assert.deepEqual(rows, [{ date: "31/03/2018", "merchant/description": "TESCO STORES", "debit/credit": "-42.17" }]);
  // Every other format is comma-only and must be unaffected by this addition.
  assert.deepEqual(parseCSV("Date,Amount\n01/15/2026,5.00"), [{ date: "01/15/2026", amount: "5.00" }]);
});
test("parseCSV: an explicit headerLineIdx skips preamble rows and treats that row as the header, matching a real Bank of America export quirk", () => {
  // 125th adversarial pass: some bank exports prepend summary/preamble
  // rows before the real column header (e.g. "Description,,Summary Amt."
  // and "Beginning balance as of ...") -- parseTxFile()'s auto-detect scan
  // finds the real header's row index and passes it through here so the
  // preamble rows are skipped entirely, not misread as data under the
  // wrong field names.
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  const text = [
    "Description,,Summary Amt.",
    "Beginning balance as of 01/01/2026,,,",
    "Date,Description,Amount,Running Bal.",
    "01/02/2026,Coffee Shop,-5.00,995.00",
    "01/03/2026,Groceries,-42.10,952.90",
  ].join("\n");
  const rows = parseCSV(text, ",", 2);
  assert.deepEqual(rows, [
    { date: "01/02/2026", description: "Coffee Shop", amount: "-5.00", "running bal.": "995.00" },
    { date: "01/03/2026", description: "Groceries", amount: "-42.10", "running bal.": "952.90" },
  ]);
});
test("parseCSV: headerLineIdx defaults to 0, preserving every existing caller's behavior", () => {
  const { parseCSV } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows"]);
  const rows = parseCSV("Date,Amount\n01/15/2026,5.00");
  assert.deepEqual(rows, [{ date: "01/15/2026", amount: "5.00" }]);
});

// ── detectFormatFromLine() — the 125th adversarial pass's fix for the
// header-detection gap above. parseTxFile() used to check only the file's
// literal first line for a known bank signature; it now scans the first
// several logical rows via this same per-line check, so a real header
// buried under preamble rows still gets recognized. ──
test("detectFormatFromLine: recognizes a known signature and returns its format", () => {
  const { detectFormatFromLine } = loadFunctions(["detectFormatFromLine"]);
  assert.equal(detectFormatFromLine("date,description,amount,running bal."), "bofa");
  assert.equal(detectFormatFromLine("date,merchant/description,debit/credit"), "midata");
});
test("detectFormatFromLine: returns null for a line matching no known signature, instead of guessing", () => {
  const { detectFormatFromLine } = loadFunctions(["detectFormatFromLine"]);
  assert.equal(detectFormatFromLine("description,,summary amt."), null);
  assert.equal(detectFormatFromLine("beginning balance as of 01/01/2026,,,"), null);
});
test("parseCSV: a midata file with a comma preamble row above its real semicolon header parses correctly once the right header row and delimiter are both used", () => {
  // Found live-testing the header-scan fix: sniffing the delimiter from
  // text.split('\n')[0] (a comma-only preamble line, no real header) instead
  // of the actual detected header row silently produced one giant
  // unsplit field per row instead of a real parse.
  const { parseCSV, detectFormatFromLine, splitCSVRows } = loadFunctions(["parseCSV","splitCSVLine","splitCSVRows","detectFormatFromLine"]);
  const text = [
    "Statement Summary,,",
    "Date;Merchant/Description;Debit/Credit",
    "31/03/2026;TESCO STORES;-42.17",
  ].join("\n");
  const scanLines = splitCSVRows(text.trim()).map(l=>l.trim()).filter(Boolean);
  const headerLineIdx = scanLines.findIndex(l => detectFormatFromLine(l.toLowerCase()) === "midata");
  assert.equal(headerLineIdx, 1, "the real header should be found on row 1, past the preamble row");
  const csvDelim = scanLines[headerLineIdx].includes(";") ? ";" : ",";
  const rows = parseCSV(text, csvDelim, headerLineIdx);
  assert.deepEqual(rows, [{ date: "31/03/2026", "merchant/description": "TESCO STORES", "debit/credit": "-42.17" }]);
});

// ── csvSafeField() — quotes a CSV export cell and neutralizes a leading
// =/+/-/@ so a value copied from an imported transaction (bank memo,
// custom category name) can't be interpreted as a formula by Excel/Sheets
// when the exported file is reopened there. ──
test("csvSafeField: quotes and escapes embedded quotes, defuses formula-injection prefixes (=/+/-/@), and handles null/undefined", () => {
  const { csvSafeField } = loadFunctions(["csvSafeField"]);
  assert.equal(csvSafeField('Trader Joe\'s "Everything" Bagel'), '"Trader Joe\'s ""Everything"" Bagel"', "quotes a plain value and escapes embedded quotes");
  assert.equal(csvSafeField("=HYPERLINK(\"http://evil\",\"click\")"), '"\'=HYPERLINK(""http://evil"",""click"")"', "prefixes a leading = with a single quote to defuse formula injection");
  assert.equal(csvSafeField("+1+1"), "\"'+1+1\"", "also defuses a leading +");
  assert.equal(csvSafeField("-1+1"), "\"'-1+1\"", "also defuses a leading -");
  assert.equal(csvSafeField("@SUM(1,2)"), "\"'@SUM(1,2)\"", "also defuses a leading @");
  assert.equal(csvSafeField(null), '""', "null becomes an empty quoted field");
  assert.equal(csvSafeField(undefined), '""', "undefined becomes an empty quoted field");
});

// ── parseImportDate() — a malformed or corrupted CSV row (out-of-range day/month,
// e.g. from a truncated or hand-edited export) used to be silently "fixed" by
// JS Date's rollover behavior (Date(2026,12,45) quietly becomes Feb 14 2027)
// instead of being rejected. normalizeTxRow() treats an empty return as "skip
// this row", so a round-trip validation guard was added to make that the
// outcome for genuinely invalid calendar dates rather than a wrong-but-plausible
// silent date shift. ──
test("parseImportDate: rejects invalid/out-of-range/incomplete calendar dates instead of silently rolling over or guessing a year, while still parsing every valid format", () => {
  const { parseImportDate } = loadFunctions(["parseImportDate"]);
  assert.equal(parseImportDate("02/30/2026", "mdy"), "", "an invalid calendar date (Feb 30) should be rejected, not rolled over to March");
  assert.equal(parseImportDate("13/45/2026", "mdy"), "", "out-of-range month/day (13/45) should be rejected, not rolled into next year");
  assert.equal(parseImportDate("2026-02-30"), "", "an invalid ISO calendar date should be rejected the same way");
  assert.equal(parseImportDate("05/01/2026", "mdy"), "2026-05-01", "valid mdy still parses");
  assert.equal(parseImportDate("25/12/2026", "dmy"), "2026-12-25", "valid dmy still parses");
  assert.equal(parseImportDate("2026-05-01"), "2026-05-01", "valid iso still parses");
  assert.equal(parseImportDate("Jan 15, 2025"), "2025-01-15", "valid locale-string dates still parse");
  // Matches neither the ISO nor MM/DD/YYYY regex (both require a 2-4 digit
  // year group), so it used to fall through to the unguarded native
  // new Date('03/10') fallback branch, which silently parses as 2001-03-10.
  // 11th adversarial pass.
  assert.equal(parseImportDate("03/10", "mdy"), "", "an incomplete date missing a year should be rejected, not silently guess year 2001 via the native parser fallback");
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
test("isRealSpend: normal/excluded/income/excluded+income cases", () => {
  const { isRealSpend } = loadFunctions(["isRealSpend"]);
  assert.equal(isRealSpend({ excluded: false, isIncome: false }), true, "a normal, non-excluded, non-income transaction counts as spend");
  assert.equal(isRealSpend({ excluded: true, isIncome: false }), false, "a manually-excluded transaction never counts as spend");
  assert.equal(isRealSpend({ excluded: false, isIncome: true, cat: "Salary" }), false, "an income transaction never counts as spend, even if a category rule retagged its cat away from 'Income'");
  assert.equal(isRealSpend({ excluded: true, isIncome: true }), false, "excluded and income together still returns false, not a crash");
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

// ── 14th adversarial pass: openKBB()'s (now openValuationLink()'s)
// make/model can be coerced to a Number by the shared dispatcher when a
// vehicle's model starts with a number (BMW "3 Series", Porsche "911",
// Fiat "500") -- (model||'').toLowerCase() then throws (a truthy Number
// has no .toLowerCase), silently killing the "Check value" link. Renamed
// and made region-aware (US/Canada/Australia/UK) August 2026; the
// underlying numeric-model coercion risk is unchanged for the US branch,
// still the default region. ──
test("openValuationLink: a numeric-looking model (coerced to a Number by the dispatcher) doesn't throw, for both the default US region and a region with no deep-link params", () => {
  const ctx = {
    window: { open: () => {} },
    // VALUATION_M is a top-level const, not a `function` declaration, so
    // loadFunctions()'s brace-matching extractor can't pull it from the
    // real source -- seeded via context instead, matching this harness's
    // existing convention for closed-over variables (see `state`
    // elsewhere in this file). Only shaped enough to exercise the
    // numeric-coercion path being tested here; VALUATION_M's actual
    // real-world contents are covered separately by the source-pattern
    // test below.
    VALUATION_M: { US: { url: (y, mk, mo) => `${mk}/${mo}/${y}` }, CA: { url: () => "https://example.test/ca" } },
  };
  const { openValuationLink } = loadFunctions(["openValuationLink", "valuationInfo"], ctx);
  assert.doesNotThrow(() => openValuationLink(2020, "BMW", 3));
  assert.doesNotThrow(() => openValuationLink(2020, "BMW", 3, { dataset: { region: "CA" } }));
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
    excluded: false,
    is_offset: false,
    isIncome: true,
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
test("sumIncomeForMonths: sums each month's auto-detected income instead of multiplying the latest month's figure by month count; declared/manual income is unaffected by the per-month sum", () => {
  let calls = 0;
  const autoCtx = {
    detectDepositIncome: () => {
      calls++;
      return { byMonth: { "2026-05": 3000, "2026-06": 6000, "2026-07": 3000 }, avgMonthly: 4000 };
    },
    getEffectiveIncome: () => 0,
    state: { income: { method: "auto", monthlyAmount: 0 }, declaredIncome: 0 },
  };
  const autoResult = loadFunctions(["sumIncomeForMonths"], autoCtx).sumIncomeForMonths(["2026-05", "2026-06", "2026-07"]);
  assert.equal(autoResult, 12000, "should sum $3000 + $6000 + $3000, not multiply July's $3000 by 3 months");
  assert.equal(calls, 1, "detectDepositIncome() should be called once, not once per month");

  const manualCtx = {
    detectDepositIncome: () => { throw new Error("should not be called for declared income"); },
    getEffectiveIncome: () => 2500,
    state: { income: { method: "manual", monthlyAmount: 2500 }, declaredIncome: 3000 },
  };
  const manualResult = loadFunctions(["sumIncomeForMonths"], manualCtx).sumIncomeForMonths(["2026-05", "2026-06", "2026-07"]);
  assert.equal(manualResult, 7500, "3 months of the same $2500 getEffectiveIncome() figure");
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
        { id: "d1", date: "2026-07-15", amount: 4000, card: "chase", desc: "PAYROLL", excluded: false, isIncome: true, is_offset: false, biz: false },
        { id: "d2", date: "2026-07-20", amount: 2000, card: "chase", desc: "CLIENT INVOICE DEPOSIT", excluded: false, isIncome: true, is_offset: false, biz: true },
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

// detectDepositIncome() (backing income.method==='auto') used to filter on
// t.excluded, but every one of the 8 import formats' isIncome=true branches
// in normalizeTxRow() leaves excluded at its default false -- excluded is a
// separate flag also set for CC Payment/Internal Transfer rows that have
// nothing to do with income. The old filter could never match a real
// imported income transaction, so "auto-detect income from deposits"
// silently always reported zero. Found wiring a demo profile's real Direct
// Deposit transactions up to this method, August 2026.
test("detectDepositIncome: matches a real transaction's shape (isIncome:true, excluded:false), not the old excluded:true assumption", () => {
  const ctx = {
    state: {
      transactions: [
        { id: "d1", date: "2026-07-15", amount: 4250, card: "chase", desc: "DIRECT DEPOSIT - EMPLOYER", excluded: false, isIncome: true, is_offset: false, biz: false },
        // A CC payment: excluded:true (so it's not double-counted as spend)
        // but isIncome:false -- must NOT be picked up as income.
        { id: "d2", date: "2026-07-20", amount: 500, card: "chase", desc: "CHASE CREDIT CARD PAYMENT", excluded: true, isIncome: false, is_offset: false, biz: false },
      ],
      activeSources: new Set(["chase"]),
    },
    _bizFilter: "all",
  };
  const { detectDepositIncome } = loadFunctions(["detectDepositIncome"], ctx);
  const result = detectDepositIncome();
  assert.equal(result.avgMonthly, 4250, "should count the isIncome:true deposit and ignore the excluded:true-but-not-income CC payment");
});

// Found live-testing the demo-to-real transition (August 2026):
// selectIncomeMethod('auto') commits state.income.method='auto' and
// scheduleSave()s immediately on click, exactly like every sibling
// income-modal action (saveManualIncome(), setNwGoal(), saveBudget(),
// toggleIncludeIncome(), etc.) -- but unlike all of them, it had no toast
// at all, and no _isLiveDemoSession()-aware "(resets once you add real
// data)" messaging from the July 28 pass. Live-verified the concrete harm:
// on Demo Profile 1 (zero income transactions of its own), clicking this
// card silently dropped the Spending tab's Savings Rate card from a
// healthy percentage to a blank "Set up" state with no warning either way.
test("selectIncomeMethod('auto'): shows a toast, distinguishing whether any deposits were actually detected, both demo-aware like every sibling income action", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function selectIncomeMethod\(method\)\{[\s\S]{0,1700}?\n  \}\n  if\(method==='manual'\)/);
  assert.ok(fnMatch, "selectIncomeMethod()'s auto branch should exist");
  assert.match(
    fnMatch[0],
    /if\(detected\.avgMonthly>0\)\{\s*showToast\(`💰 Auto-detect enabled — tracking ~\$\{fmt\(detected\.avgMonthly,true\)\}\/mo`\+\(_isLiveDemoSession\(\)\?' \(resets once you add real data\)':''\),'#34D399'\);/,
    "selecting auto with real detected deposits should show a demo-aware success toast, matching saveManualIncome()'s own pattern"
  );
  assert.match(
    fnMatch[0],
    /\}else\{\s*showToast\('Auto-detect enabled, but no deposit transactions found yet[\s\S]{0,120}\+\(_isLiveDemoSession\(\)\?' \(resets once you add real data\)':''\),'#FCD34D',5000\);/,
    "selecting auto with zero detected deposits should show a distinct, honest amber warning instead of a generic success toast that isn't true yet"
  );
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
test("isPairedAccount: acctId match, legacy type+name fallback, and the exclude set", () => {
  const { isPairedAccount } = loadFunctions(["isPairedAccount"]);

  const v1 = { acctId: 42, name: "irrelevant" };
  assert.equal(isPairedAccount({ id: 42, type: "cash", name: "different" }, v1), true, "matches by acctId when set, ignoring type/name entirely");
  assert.equal(isPairedAccount({ id: 43, type: "vehicle", name: "irrelevant" }, v1), false);

  const v2 = { acctId: null, name: "2021 Honda CR-V" };
  assert.equal(isPairedAccount({ id: 1, type: "vehicle", name: "2021 Honda CR-V" }, v2), true, "legacy record (acctId null) falls back to type + exact name match");
  assert.equal(isPairedAccount({ id: 2, type: "other-asset", name: "2021 Honda CR-V" }, v2), true, "other-asset is a valid paired type too, not just vehicle");
  assert.equal(isPairedAccount({ id: 3, type: "cash", name: "2021 Honda CR-V" }, v2), false, "name match alone isn't enough -- type must be vehicle or other-asset");
  assert.equal(isPairedAccount({ id: 4, type: "vehicle", name: "Different Name" }, v2), false);

  const v3 = { acctId: null, name: "Boat" };
  const acct3 = { id: 5, type: "other-asset", name: "Boat" };
  assert.equal(isPairedAccount(acct3, v3), true);
  assert.equal(isPairedAccount(acct3, v3, new Set([5])), false, "a legacy record respects the exclude set -- an excluded account id should never match, even with an otherwise-correct type+name (so ambiguous same-named siblings don't both claim the same account)");
  assert.equal(isPairedAccount(acct3, v3, new Set([6])), true, "excluding an unrelated id shouldn't affect the match");
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
  let liabHTML = "";
  return {
    getLiabHTML: () => liabHTML,
    ctx: {
      state: { vehicles, accounts },
      isLiab: (t) => t === "credit" || t === "mortgage" || t === "other-liability",
      // SC_M needs at least an 'Other' entry -- row()'s SC_M[a.source]||
      // SC_M.Other fallback mirrors the real source's own always-present
      // last entry (see SC_M's real definition), and throws on .bg/.fg if
      // that fallback itself is missing.
      SC_M: { Other: { bg: "#334155", fg: "#94A3B8" } }, TC_M: {}, SA_M: {}, TL_M: {},
      // ASSET_GROUPS is a top-level const, not a `function` declaration,
      // so loadFunctions()'s brace-matching extractor can't pull it from
      // the real source -- seeded via context instead, matching this
      // harness's existing convention (see VALUATION_M elsewhere in this
      // file). Mirrors the real definition's match() logic exactly, since
      // that's what determines which accounts this test's Boat entries
      // land under.
      ASSET_GROUPS: [
        { label: "Investments", color: "#34D399", hdr: "#065F4618", match: (a) => a.type === "investment" },
        { label: "Real estate", color: "#A78BFA", hdr: "#4C1D9518", match: (a) => a.type === "home" },
        { label: "Cash", color: "#60A5FA", hdr: "#1E40AF18", match: (a) => a.type === "cash" },
        { label: "Other assets", color: "#FBBF24", hdr: "#78350F18", match: (a) => !["investment", "home", "cash"].includes(a.type) },
      ],
      esc: (s) => String(s),
      fmt: (n) => String(n),
      document: {
        getElementById: (id) => {
          if (id === "asset-list") return { set innerHTML(v) { assetHTML = v; }, get innerHTML() { return assetHTML; } };
          if (id === "liability-list") return { set innerHTML(v) { liabHTML = v; }, get innerHTML() { return liabHTML; } };
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
test("confirmCatExclusion/undoCatExclusion: a numeric-looking category name (coerced to a Number by the dispatcher) is stored as a string and can then be correctly undone", () => {
  const confirmCtx = {
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
  loadFunctions(["confirmCatExclusion"], confirmCtx).confirmCatExclusion(2024); // dispatcher would pass the Number 2024, not the string "2024"
  assert.deepEqual([...confirmCtx.state.excludedCats], ["2024"], "confirmCatExclusion should store it as a string, not the Number 2024, matching how every consumer checks state.excludedCats.has(t.cat)");

  const undoCtx = {
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
  loadFunctions(["undoCatExclusion"], undoCtx).undoCatExclusion(2024); // dispatcher-coerced Number, same as a real click on the new Undo button
  assert.equal(undoCtx.state.excludedCats.size, 0, "undoCatExclusion should remove the string entry confirmCatExclusion() actually stored, not silently fail to match a Number against it");
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
test("barTicksHTML/ringHTML: fillPct/arcPct both floor at 0 for a net-refunded (negative spend/ytd) category, instead of a negative CSS width%/conic-gradient stop", () => {
  const { barTicksHTML } = loadFunctions(["barTicksHTML"], { fmt: (n) => "$" + Math.abs(n).toLocaleString(), COMBO_TICK_PCT: 6 });
  assert.equal(barTicksHTML(100, 80, -50, true).fillPct, 0, "negative spend should floor fillPct at 0, not produce a negative CSS width%");
  assert.ok(barTicksHTML(100, 80, 50, true).fillPct > 0, "positive spend below the scale max is unaffected");

  // ringHTML() takes a destructured `{ytd,ytdPace}` parameter, which the
  // extraction harness's brace-counter can't handle (it stops at the
  // destructured param's own closing brace, mistaking it for the function
  // body's end) -- a pre-existing loadFunctions() limitation unrelated to
  // this fix. Checking the source pattern directly instead, then
  // re-deriving the same formula to exercise the actual floor behavior.
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
test("openAddModal: resets #f-type to its first option and #f-source to 'Other' (not the alphabetically-first bank), not leaving editAccount()'s stale selection behind", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function openAddModal\(\)\{[^}]*const ft=document\.getElementById\('f-type'\);if\(ft\)ft\.selectedIndex=0;updateSourceOptionsForType\(\);const fs=document\.getElementById\('f-source'\);if\(fs\)fs\.value='Other';/,
    "openAddModal() should reset #f-type to selectedIndex=0 and #f-source to 'Other' -- a neutral default, not the alphabetically-first bank a user might silently leave selected"
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
    /function openCatModal\(\)\{[\s\S]{0,200}?_confirmingDeleteCatName=null;[\s\S]{0,1200}?_editingCatName=null;\s*renderCatManagerList\(\);/,
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
    SUBSCRIPTION_EXCLUDED_CATS: new Set(["Gas", "Home"]),
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
    SUBSCRIPTION_EXCLUDED_CATS: new Set(["Gas", "Home"]),
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
    /state\.transactions=arr\(payload\.transactions\)[\s\S]{0,2100}?_resetSessionFiltersForDataReplace\(\);\s*rebuildMonthly\(\);\s*rebuildCatSelects\(\);\s*scheduleSave\(\);\s*renderAll\(\);\s*showToast\('Backup restored\.'/,
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
test("toggleExcluded: persists to localStorage during a normal session, but not during a demo-preview session", () => {
  const mkCtx = (windowOverrides) => {
    let stored = null;
    const ctx = {
      state: { showExcluded: false },
      window: windowOverrides,
      localStorage: { setItem: (k, v) => { stored = [k, v]; } },
      document: { getElementById: () => null },
      renderSourceChips: () => {}, renderSpendSummary: () => {}, renderBucketGrid: () => {}, renderTxList: () => {}, renderActiveChart: () => {},
      showTxN: 50,
    };
    return { ctx, getStored: () => stored };
  };

  const normal = mkCtx({});
  loadFunctions(["toggleExcluded"], normal.ctx).toggleExcluded();
  assert.equal(normal.ctx.state.showExcluded, true, "toggleExcluded() should flip state.showExcluded");
  assert.deepEqual(normal.getStored(), ["trakyo_show_excl", "1"], "a normal session should persist the toggle to localStorage");

  const demoPreview = mkCtx({ _viewingDemoOverReal: true });
  loadFunctions(["toggleExcluded"], demoPreview.ctx).toggleExcluded();
  assert.equal(demoPreview.ctx.state.showExcluded, true, "toggleExcluded() should still flip the in-memory flag so the current demo-preview session reflects the toggle");
  assert.equal(demoPreview.getStored(), null, "a demo-preview session (_viewingDemoOverReal) must not leak the toggle into localStorage for the next real session to pick up");
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

// ── Importing a transaction CSV only tags rows with a source label
// (state.activeSources/t.card) -- it never creates a state.accounts entry,
// which is what the Accounts tab and netWorth()/History snapshots actually
// read. A real user imported 3 CSVs, found the Accounts tab empty, and
// nothing in the import-success flow explained why. Nudge on the one
// success modal that knows for certain no account matches this import's
// source label. confirmTxImport() is DOM-heavy; source-pattern only.
// Found via a real user report on launch day, August 2026. ──
test("import-success-modal has a #import-success-no-account nudge box, hidden by default like the existing uncategorized-count nudge", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const modalMatch = source.match(
    /<div class="modal-overlay hidden" id="import-success-modal">[\s\S]{0,1900}?<!-- Community rules modal -->/
  );
  assert.ok(modalMatch, "import-success-modal should exist");
  assert.match(
    modalMatch[0],
    /<div id="import-success-no-account" class="hidden"[^>]*><\/div>/,
    "import-success-modal should contain a hidden-by-default #import-success-no-account box, matching #import-success-uncategorized's own hidden-by-default pattern"
  );
});
test("confirmTxImport: shows the no-matching-account nudge only when no account's name matches this import's source label (case-insensitively)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function confirmTxImport\(\)\{[\s\S]{0,11600}?\n}\n/);
  assert.ok(fnMatch, "confirmTxImport() should exist");
  assert.match(
    fnMatch[0],
    /const noAcctEl=document\.getElementById\('import-success-no-account'\);\s*if\(noAcctEl\)\{\s*const hasMatchingAccount=state\.accounts\.some\(a=>a\.name\.trim\(\)\.toLowerCase\(\)===source\.trim\(\)\.toLowerCase\(\)\);\s*if\(!hasMatchingAccount\)\{noAcctEl\.textContent=/,
    "confirmTxImport() should check state.accounts for a case-insensitive name match against this import's source label before deciding whether to show the nudge"
  );
  assert.match(
    fnMatch[0],
    /else\{noAcctEl\.classList\.add\('hidden'\);\}/,
    "confirmTxImport() should explicitly hide the nudge when a matching account does exist, not just show it when one doesn't -- otherwise it would stay stuck visible from a prior import in the same session"
  );
});

// ── One-time glow on the Spending tab's Import CSV button, requested by
// Nicholas as a lighter alternative to a repeating pulse: fires once per
// browser tab session, only while state.hasRealData is still false, and
// never again once real data exists. Deliberately keyed off sessionStorage
// rather than a new state.* field, so there's nothing for
// check-demo-transition-coverage.py or check-cloudsync-coverage.py to
// track and nothing to reset on the demo-to-real transition. renderSpending()
// is DOM-heavy; source-pattern only. Added August 4, 2026. ──
test("renderSpending: the Import CSV button gets a one-time glow, gated on !state.hasRealData and a sessionStorage flag rather than a persisted state field", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderSpending\(\)\{[\s\S]{0,2400}?\n}\n/);
  assert.ok(fnMatch, "renderSpending() should exist");
  assert.match(
    fnMatch[0],
    /if\(!state\.hasRealData\)\{\s*try\{\s*if\(!sessionStorage\.getItem\('trakyo_import_cta_seen'\)\)\{\s*sessionStorage\.setItem\('trakyo_import_cta_seen','1'\);/,
    "renderSpending() should gate the glow on !state.hasRealData and a sessionStorage flag, set immediately so a second render call in the same session can't re-trigger it"
  );
  assert.match(
    fnMatch[0],
    /const importBtn=document\.getElementById\('toolbar-import-btn'\);\s*if\(importBtn\)\{\s*requestAnimationFrame\(\(\)=>importBtn\.classList\.add\('import-cta-glow'\)\);\s*setTimeout\(\(\)=>importBtn\.classList\.remove\('import-cta-glow'\),2200\);/,
    "renderSpending() should add .import-cta-glow to #toolbar-import-btn via requestAnimationFrame (forcing a fresh animation start) and remove it again after the animation finishes, matching the codebase's existing chip-nudge/sign-in-confirm cleanup pattern"
  );
  assert.doesNotMatch(
    source,
    /state\.\w+\s*=\s*[^;]*trakyo_import_cta_seen/,
    "the glow-seen flag should live only in sessionStorage, never get mirrored into a state.* field"
  );
});
test("the .import-cta-glow animation respects prefers-reduced-motion, matching the codebase's existing motion-sensitivity awareness elsewhere", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /@keyframes import-cta-glow\{[\s\S]{0,220}?\}\s*\.import-cta-glow\{animation:import-cta-glow[^}]*\}\s*@media \(prefers-reduced-motion:reduce\)\{\.import-cta-glow\{animation:none\}\}/,
    "the .import-cta-glow keyframe should have a paired @media(prefers-reduced-motion:reduce) override disabling the animation entirely"
  );
});

// ── 98th adversarial pass, two independent findings in the same
// renderYearInReview()/copyYirSummary() pair:
// (1) "Quietest month" was seeded with the *unfiltered* byMonth[0], even
// though it only ever iterates the spent>0-filtered array -- if the
// window's chronologically first month has spent===0 (a deselected
// source zeroing it, or just a genuinely quiet first month), that $0 seed
// beats every real candidate in the b.spent<a.spent comparison every
// time, so "Quietest month" always showed that $0 month instead of the
// actual lowest nonzero-spend month.
// (2) The net-worth-change card picked firstSnap as the earliest snapshot
// AT OR AFTER the window's start, and lastSnap as the latest snapshot AT
// OR BEFORE the window's end -- if no snapshot falls inside the window
// but snapshots exist on both sides, firstSnap can land chronologically
// AFTER lastSnap, inverting both the sign of nwChange and the
// "firstSnap -> lastSnap" display labels/range. ──
test("Year in Review: quietestMonth is seeded from the filtered (spent>0) array, not the raw unfiltered byMonth[0]; net-worth change requires firstSnap to be chronologically at or before lastSnap", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const quietestMatches = source.match(/const _positive\w*=byMonth\.filter\(m=>m\.spent>0\);\s*const quietestMonth=_positive\w*\.length\?_positive\w*\.reduce\(\(a,b\)=>b\.spent<a\.spent\?b:a\):null;/g) || [];
  assert.equal(quietestMatches.length, 2, "both renderYearInReview() and copyYirSummary() should seed quietestMonth's reduce from the filtered array (or null if nothing passed the filter), not raw byMonth[0]");
  const nwChangeMatches = source.match(/firstSnap&&lastSnap&&firstSnap!==lastSnap&&firstSnap\.monthKey<=lastSnap\.monthKey\?lastSnap\.nw-firstSnap\.nw:null/g) || [];
  assert.equal(nwChangeMatches.length, 2, "both renderYearInReview() and copyYirSummary() should require firstSnap.monthKey<=lastSnap.monthKey before computing nwChange, falling back to null (hides the card) rather than showing an inverted result");
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

test("renderDailyCal: endDate is anchored to noon (matching how transaction dates are parsed, so the last day of the range isn't silently excluded), and shows a 'No data' state instead of crashing when there are no transaction months in range", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  // endDate defaulted to midnight local time (the numeric Date
  // constructor's default), while every transaction parses at noon -- a
  // transaction on the range's actual last calendar day (noon) failed
  // d<=endDate (midnight) and was silently excluded from the calendar's
  // totals/cells. Month-end bills (rent, mortgage) are a routine trigger.
  assert.match(
    source,
    /const endDate=new Date\(maxMonth\.slice\(0,4\),parseInt\(maxMonth\.slice\(5,7\)\),0,12\); \/\/ last day of max month/,
    "endDate's Date constructor should pass 12 as the hours argument, matching new Date(t.date+'T12:00:00')'s noon anchor for every transaction"
  );

  // Threw (maxMonth.slice() on undefined) when getFilteredMonths()
  // returns [] -- reachable uncaught via setChartMode('daily') for a
  // user with no transactions in range, the same crash shape
  // renderSankey() had before the 99th pass's fix.
  assert.match(
    source,
    /function renderDailyCal\(\)\{[\s\S]{0,2500}?const filteredMonths=getFilteredMonths\(\);[\s\S]{0,700}?if\(!filteredMonths\.length\)\{\s*wrap\.innerHTML=`<div style="padding:2rem;color:var\(--text-muted\);font-size:12px;text-align:center">No data for this period<\/div>`;\s*return;\s*\}/,
    "renderDailyCal() should guard against an empty filteredMonths array before deriving minMonth/maxMonth"
  );
});

// importBackup() only shape-checks state.snapshots/state.vehicles as
// arrays -- a crafted backup file's .date/.miles fields flow unescaped
// into innerHTML in renderHistory()/renderVehicles(), the one unescaped
// seam in a file that treats crafted-backup-file XSS as in-scope (matches
// the pass-15 Budget-row and pass-34 community-rules-CSV fixes).
// .purchaseYear's own assertion here was removed alongside purchase
// price/year themselves (cut entirely, August 2026) -- there's no field
// left to esc(String(...)) coerce.
test("renderHistory and renderVehicles escape snapshot/vehicle fields that could carry an HTML payload from a crafted backup file", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /\$\{esc\(first\.date\)\} – \$\{esc\(last\.date\)\}/, "renderHistory()'s growth banner should esc() first.date/last.date");
  assert.match(source, /<div class="account-name" style="font-size:12px">\$\{esc\(s\.date\)\}<\/div>/, "renderHistory()'s per-row date should be esc()'d");
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
    /data-action="openValuationLink" data-arg="\$\{esc\(String\(v\.year\)\)\}"/,
    "the valuation link's data-arg should esc(String(v.year))"
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
    /state\.snapshots=Array\.isArray\(saved\.snapshots\)\?saved\.snapshots\.filter\(_isValidSnapshot\)\.map\(s=>\(\{\.\.\.s,nw:Number\(s\.nw\)\|\|0,assets:Number\(s\.assets\)\|\|0,liab:Number\(s\.liab\)\|\|0\}\)\):state\.snapshots;[\s\S]{0,700}?state\.snapshots\.sort\(_snapshotSortCompare\);/,
    "loadFromLocalStorage() should sort state.snapshots immediately after assigning it from the local cache"
  );
  assert.match(
    source,
    /state\.snapshots=arr\(saved\.snapshots\)\.filter\(_isValidSnapshot\)\.map\(s=>\(\{\.\.\.s,nw:Number\(s\.nw\)\|\|0,assets:Number\(s\.assets\)\|\|0,liab:Number\(s\.liab\)\|\|0\}\)\);[\s\S]{0,400}?state\.snapshots\.sort\(_snapshotSortCompare\);/,
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

// ── 154th adversarial pass ──────────────────────────────────────────────
// LOW: fmtMonthShort() only sanitizes the month segment (via a MON3[]
// lookup) -- the same "field skips the escaping convention" shape fixed
// for transaction date in the 153rd adversarial pass. Its input,
// snapshot.monthKey, was only type-guarded by _isValidSnapshot() (a
// string, not a YYYY-MM shape), and its unescaped output is interpolated
// directly into innerHTML at multiple sinks (the Year-in-Review growth
// banner, the Insights nwSub line, the net-worth pill subtitle/tooltip) --
// so a hand-edited backup/cloud snapshot with e.g.
// monthKey:"20<img src=x>-07" would pass the old type-only guard and
// inject raw HTML on render. Every real snapshot already derives monthKey
// as YYYY-MM (saveSnapshot()/saveHistoricalSnapshot() both zero-pad it),
// so tightening the shared ingestion filter to /^\d{4}-\d{2}$/ rejects
// nothing legitimate while closing the gap at all 3 restore paths at
// once (they all already filter through this one shared predicate).
// Found in the 154th adversarial pass. ──
test("_isValidSnapshot: rejects a monthKey that isn't YYYY-MM shaped, not just non-string ones", () => {
  const ctx = {};
  const { _isValidSnapshot } = loadFunctions(["_isValidSnapshot"], ctx);
  assert.equal(_isValidSnapshot({ monthKey: "2026-03" }), true);
  assert.equal(_isValidSnapshot({ monthKey: "20<img src=x>-07" }), false, "a monthKey with embedded HTML should be rejected, since fmtMonthShort() renders it unescaped");
  assert.equal(_isValidSnapshot({ monthKey: "2026-3" }), false, "a non-zero-padded month should be rejected (no legitimate snapshot ever produces one)");
  assert.equal(_isValidSnapshot({ monthKey: "2026/03" }), false, "a wrong-separator monthKey should be rejected");
});
test("importBackup: filters malformed transactions/customCategories/snapshots entries instead of crashing mid-restore", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=arr\(payload\.transactions\)\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(t\.date\)\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "importBackup() should filter out non-object transaction entries and coerce a malformed date to a safe default before mapping"
  );
  assert.match(
    source,
    /state\.customCategories=_arrOfObj\(saved\.customCategories\);/,
    "importBackup() should filter out non-object customCategories entries"
  );
  assert.match(
    source,
    /state\.snapshots=arr\(saved\.snapshots\)\.filter\(_isValidSnapshot\)\.map\(s=>\(\{\.\.\.s,nw:Number\(s\.nw\)\|\|0,assets:Number\(s\.assets\)\|\|0,liab:Number\(s\.liab\)\|\|0\}\)\);/,
    "importBackup() should filter state.snapshots through _isValidSnapshot and coerce nw/assets/liab"
  );
});
test("loadFromLocalStorage: filters malformed transactions/customCategories/snapshots entries from the local cache", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(t\.date\)\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "loadFromLocalStorage() should filter out non-object transaction entries and coerce a malformed date"
  );
  assert.match(
    source,
    /state\.customCategories=Array\.isArray\(saved\.customCategories\)\?_arrOfObj\(saved\.customCategories\):state\.customCategories;/,
    "loadFromLocalStorage() should filter out non-object customCategories entries"
  );
  assert.match(
    source,
    /state\.snapshots=Array\.isArray\(saved\.snapshots\)\?saved\.snapshots\.filter\(_isValidSnapshot\)\.map\(s=>\(\{\.\.\.s,nw:Number\(s\.nw\)\|\|0,assets:Number\(s\.assets\)\|\|0,liab:Number\(s\.liab\)\|\|0\}\)\):state\.snapshots;/,
    "loadFromLocalStorage() should filter state.snapshots through _isValidSnapshot and coerce nw/assets/liab"
  );
});
// July 28, 2026: snapshot nw/assets/liab and vehicle value/purchase were
// both restored with no numeric coercion, unlike their already-fixed
// siblings (account balance/nextId, vehicle miles/purchaseYear) -- a hand-
// edited or corrupted comma-formatted string like "1,234.56" would break
// Math.abs()-based formatting and comparisons downstream instead of
// crashing outright. Both confirmed display-only/low-reachability, not a
// net-worth-arithmetic gap. loadFromLocalStorage()'s and importBackup()'s
// own coercion is covered by their own dedicated tests above -- only
// loadUserData()'s cloud-sync path is novel here.
test("loadUserData: filters malformed snapshot rows before mapping, not after, and coerces nw/assets/liab to numbers", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /state\.snapshots = snaps\.filter\(_isValidSnapshot\)\.map\(s => \(\{/,
    "loadUserData() should filter snaps through _isValidSnapshot before the .map() that dereferences each entry's fields"
  );
  assert.match(
    source,
    /nw: Number\(s\.nw\)\|\|0, assets: Number\(s\.assets\)\|\|0, liab: Number\(s\.liab\)\|\|0/,
    "loadUserData()'s cloud-sync path should coerce nw/assets/liab"
  );
});
// Purchase price/year (and the v.purchase-driven "% value retained"/
// depreciation math this test used to also cover) were cut entirely,
// August 2026 -- nobody's tracking their car's depreciation closely
// enough to justify two extra modal fields, and Est. Value alone already
// drives net worth with nothing else depending on them. v.value's own
// coercion is unchanged and still worth guarding against a crafted
// backup's non-numeric payload.
test("renderVehicles coerces v.value to a number once, reused across every display site", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderVehicles\(\)\{[\s\S]{0,5000}?\n\}/);
  assert.ok(fnMatch, "renderVehicles() should exist");
  const fn = fnMatch[0];
  assert.match(
    fn,
    /const vValue=Number\(v\.value\)\|\|0;/,
    "renderVehicles() should coerce v.value into a local const near the top of the map callback"
  );
  assert.doesNotMatch(fn, /v\.purchase/, "renderVehicles() should no longer reference the removed v.purchase/v.purchaseYear fields at all");
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

test("_arrOfObj/_strValueObj: the two shared crafted-backup ingestion helpers coerce/filter their input as documented", () => {
  const { _arrOfObj, _strValueObj } = loadFunctions(["_arrOfObj", "_strValueObj"], {});

  assert.deepEqual(_arrOfObj([{ a: 1 }, null, "x", 5, { b: 2 }]), [{ a: 1 }, { b: 2 }], "_arrOfObj coerces to an array and drops null/primitive entries");
  assert.deepEqual(_arrOfObj(null), []);
  assert.deepEqual(_arrOfObj({}), []);
  assert.deepEqual(_arrOfObj(undefined), []);

  assert.deepEqual(_strValueObj({ a: "Amazon", b: 5, c: null, d: "Shopping" }), { a: "Amazon", d: "Shopping" }, "_strValueObj keeps only string-valued keys, coerces non-object input to {}");
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

// ── 131st adversarial pass ──────────────────────────────────────────────
// LOW: restored nextId (a hand-edited/corrupted backup, or a legacy/
// malformed cloud row) was never reconciled against the ids actually
// present in state.accounts/state.vehicles, which share the same id
// namespace. A duplicate id (e.g. from copy-pasting an account block
// while hand-editing a backup -- the same editing scenario the 130th
// pass's balance fix targets) or a stale/too-low saved.nextId causes
// editAccount()'s .find() to silently edit the wrong record,
// deleteAcct()'s .filter() to delete BOTH colliding accounts at once,
// isPairedAccount() to misattribute a vehicle's value, and the very next
// in-app "Add account" to mint a new id that collides with an existing
// one. Found in the 131st adversarial pass. ──
test("_reconcileNextId: bumps past the max existing id, leaves an already-safe nextId untouched, and treats a non-finite/missing id as 0 not NaN", () => {
  const s1 = { accounts: [{ id: 5000 }, { id: 5003 }], vehicles: [{ id: 5010 }], transactions: [], nextId: 3 };
  loadFunctions(["_reconcileNextId"], { state: s1 })._reconcileNextId();
  assert.equal(s1.nextId, 5011, "nextId should be bumped to 1 past the max id found across accounts and vehicles, since the restored nextId (3) was stale/too-low");

  const s2 = { accounts: [{ id: 5000 }], vehicles: [{ id: 5001 }], transactions: [], nextId: 6000 };
  loadFunctions(["_reconcileNextId"], { state: s2 })._reconcileNextId();
  assert.equal(s2.nextId, 6000, "nextId should stay unchanged when the restored value already exceeds every existing id");

  const s3 = { accounts: [{ id: "garbage" }, {}], vehicles: [], transactions: [], nextId: 1 };
  loadFunctions(["_reconcileNextId"], { state: s3 })._reconcileNextId();
  assert.equal(s3.nextId, 1, "with no valid ids present (non-finite/missing), nextId should stay at its own already-safe value, not become NaN and poison the Math.max computation");
});

// ── 134th adversarial pass ──────────────────────────────────────────────
// MEDIUM: _reconcileNextId() ignored the transaction id namespace even
// though transactions mint from the identical state.nextId++ counter as
// accounts/vehicles (saveTx()/CSV import both do id:state.nextId++) --
// and are by far the most numerous, id-looked-up record type
// (openEditTxModal()'s .find()/deleteTx()'s .filter() have the exact same
// wrong-record-edit/double-delete failure modes the 131st pass fixed for
// accounts). Worse, all 3 restore paths called _reconcileNextId() BEFORE
// state.transactions was even populated, so even the transactions being
// restored in the very same load were never folded into the max. Found
// in the 134th adversarial pass. ──
test("_reconcileNextId: bumps nextId past the max id present in transactions too, not just accounts/vehicles", () => {
  const state = { accounts: [{ id: 5000 }], vehicles: [{ id: 5001 }], transactions: [{ id: 5002 }, { id: 5008 }, { id: 5004 }], nextId: 2 };
  const { _reconcileNextId } = loadFunctions(["_reconcileNextId"], { state });
  _reconcileNextId();
  assert.equal(state.nextId, 5009, "nextId should be bumped past the max transaction id (5008), which exceeds every account/vehicle id -- confirms transactions are actually folded into the max computation, not silently ignored");
});

// ── 135th adversarial pass ──────────────────────────────────────────────
// LOW: the 134th pass's own extension of _reconcileNextId() to include
// state.transactions turned it into an argument-spread over a
// potentially unbounded array (Math.max(0,...arr)) -- accounts/vehicles
// are always small, but a heavy multi-year user's transaction history
// isn't, and argument-spread has an engine-dependent stack/arg-count
// ceiling Math.max(...bigArray) can exceed, throwing a RangeError and
// aborting the restore path entirely. Found in the 135th adversarial
// pass, re-verifying the 134th pass's own fix. ──
test("_reconcileNextId: doesn't throw on a very large transactions array (no unbounded argument-spread into Math.max), and is called after state.transactions is restored in all 3 restore paths, not before", () => {
  const bigTransactions = Array.from({ length: 200000 }, (_, i) => ({ id: i }));
  const state = { accounts: [{ id: 1 }], vehicles: [], transactions: bigTransactions, nextId: 2 };
  const { _reconcileNextId } = loadFunctions(["_reconcileNextId"], { state });
  assert.doesNotThrow(() => _reconcileNextId(), "should not throw a RangeError on a large transactions array");
  assert.equal(state.nextId, 200000, "should still correctly compute the max id (199999) + 1 across a large array");

  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const localIdx = source.search(/state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)/);
  const localReconcileIdx = source.indexOf("_reconcileNextId();", localIdx);
  assert.ok(localIdx >= 0 && localReconcileIdx > localIdx && localReconcileIdx - localIdx < 1200, "loadFromLocalStorage() should call _reconcileNextId() shortly after restoring state.transactions, not before");
  const backupIdx = source.search(/state\.transactions=arr\(payload\.transactions\)/);
  const backupReconcileIdx = source.indexOf("_reconcileNextId();", backupIdx);
  assert.ok(backupIdx >= 0 && backupReconcileIdx > backupIdx && backupReconcileIdx - backupIdx < 1200, "importBackup() should call _reconcileNextId() shortly after restoring state.transactions, not before");
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
  assert.match(source, /state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)[\s\S]{0,900}?_reconcileNextId\(\);/, "nextId should be reconciled against the actually-restored accounts/vehicles/transactions ids (131st/134th adversarial passes) AFTER transactions are restored, not just Number()-coerced");
  assert.match(source, /const txSource=txRaw\?JSON\.parse\(txRaw\):saved\.transactions;[\s\S]{0,900}?state\.transactions=\(Array\.isArray\(txSource\)\?txSource:state\.transactions\)/, "the transactions txSource should be Array.isArray-checked before .filter()");
});
test("importBackup/loadUserData: both also call _reconcileNextId() after restoring nextId, matching loadFromLocalStorage()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/_reconcileNextId\(\);/g) || [];
  assert.equal(matches.length, 3, "all 3 restore paths (cloud sync, local storage, backup restore) should call _reconcileNextId() once each");
});
test("importBackup and loadUserData both route vehicles/catRules/vendorAliases/customCategories (and, for loadUserData -- the least-guarded of the three ingestion paths -- hiddenPills/transactions/nextId too) through the shared guard helpers", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  assert.match(source, /state\.vehicles=_arrOfObj\(saved\.vehicles\);/, "importBackup: vehicles should route through _arrOfObj()");
  assert.match(source, /state\.catRules=_arrOfObj\(saved\.catRules\)\.filter\(r=>typeof r\.keyword==='string'\);/, "importBackup: catRules should be entry-filtered plus a string-keyword check");
  assert.match(source, /state\.vendorAliases=_strValueObj\(saved\.vendorAliases\);/, "importBackup: vendorAliases should route through _strValueObj()");
  assert.match(source, /state\.customCategories=_arrOfObj\(saved\.customCategories\);/, "importBackup: customCategories should route through _arrOfObj() (simplified from the 103rd pass's manual inline filter)");

  assert.match(source, /if \(prefs\.customCategories\) state\.customCategories = _arrOfObj\(prefs\.customCategories\);/, "loadUserData: customCategories should route through _arrOfObj() -- this was pass 103's own gap on the cloud-sync path");
  assert.match(source, /if \(Array\.isArray\(prefs\.vehicles\)\) state\.vehicles = _arrOfObj\(prefs\.vehicles\);/, "loadUserData: vehicles should route through _arrOfObj()");
  assert.match(source, /if \(prefs\.catRules\) state\.catRules = _arrOfObj\(prefs\.catRules\)\.filter\(r=>typeof r\.keyword==='string'\);/, "loadUserData: catRules should be entry-filtered plus a string-keyword check");
  assert.match(source, /if \(prefs\.vendorAliases\) state\.vendorAliases = _strValueObj\(prefs\.vendorAliases\);/, "loadUserData: vendorAliases should route through _strValueObj()");
  assert.match(source, /if \(Array\.isArray\(prefs\.hiddenPills\)\) state\.hiddenPills = new Set\(prefs\.hiddenPills\);/, "loadUserData: hiddenPills should be Array.isArray-guarded, not just truthy-checked");
  assert.match(
    source,
    /state\.transactions = prefs\.transactions\s*\.filter\(t=>t&&typeof t==='object'\)\s*\.map\(t=>\(\{\.\.\.t,date:typeof t\.date==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(t\.date\)\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset\}\)\);/,
    "loadUserData: transactions should get the same entry-filter and date-coercion pass 103 already applied to importBackup()/loadFromLocalStorage()"
  );
  assert.match(source, /if \(prefs\.nextId\) state\.nextId = Number\(prefs\.nextId\)\|\|state\.nextId;/, "loadUserData: nextId should be Number()-coerced");
});

// ── 105th adversarial pass: fresh findings after re-verifying pass 104's
// systematic audit held up (it did, in full) -- a genuine 10th gap the
// audit's own field-level scoping didn't cover (transaction desc/cat/card
// subfields, not the entry/date-level guards already fixed), plus two
// unrelated fresh-territory findings. ──

test("transaction ingestion: desc/cat/card are string-coerced (with cat defaulting to 'Other') at all 3 ingestion points, not just date/amount -- and resolveVendor/displayVendor's own guards are falsy-only, confirming the fix is necessary", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const pattern = /date:typeof t\.date==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(t\.date\)\?t\.date:'',desc:typeof t\.desc==='string'\?t\.desc:'',cat:typeof t\.cat==='string'\?t\.cat:'Other',card:typeof t\.card==='string'\?t\.card:'',amount:parseFloat\(t\.amount\)\|\|0,excluded:!!t\.excluded,is_offset:!!t\.is_offset/g;
  const matches = source.match(pattern) || [];
  assert.equal(matches.length, 3, "all 3 ingestion points (loadUserData, loadFromLocalStorage, importBackup) should coerce desc/cat/card the same way -- a truthy non-string desc previously threw in resolveVendor()/displayVendor(), reachable from the Treemap, Spending tab, and the Dashboard's own 'largest charge' card");
  assert.match(source, /const resolveVendor=desc=>\{\s*if\(!desc\)return desc;/, "resolveVendor()'s guard is falsy-only, so a truthy non-string would have slipped through without the ingestion-side fix above");
  assert.match(source, /const displayVendor=name=>\{\s*if\(!name\)return name;/, "displayVendor()'s guard is falsy-only, same reasoning");
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
  const debitcreditMatch = source.match(/\}\s*else if\(importFmt==='debitcredit'\)\{[\s\S]{0,1500}?\n\n  \} else if\(importFmt==='anznz'\)/);
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
  assert.match(source, /callback:v=>fmtC\(v,true\),font:\{size:10\}/, "the vendor/category stacked chart's y-axis tick callback should use raw fmtC");
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
  const fnMatch = source.match(/newTxs=importParsed\.map[\s\S]{0,3700}?\n  \}\);/);
  assert.ok(fnMatch, "confirmTxImport()'s mutateTransactions block should exist");
  assert.match(
    fnMatch[0],
    /const knownCats=new Set\(getAllCats\(\)\.map\(c=>c\.toLowerCase\(\)\)\);\s*newTxs\.forEach\(t=>\{\s*if\(t\.cat&&!knownCats\.has\(t\.cat\.toLowerCase\(\)\)\)\{\s*state\.customCategories\.push\(\{name:t\.cat,color:null\}\);\s*knownCats\.add\(t\.cat\.toLowerCase\(\)\);\s*\}\s*\}\);/,
    "confirmTxImport() should push {name,color:null} (addCustomCat()'s own shape) for every newly-imported category not already in getAllCats(), deduping case-insensitively (109th pass) via a local Set so a repeated new category isn't pushed twice"
  );
});

// Found live-testing the demo-to-real transition (August 2026): a demo
// profile's own state.catRules (e.g. Demo Profile 1's 'SHELL'->
// Transportation, 'RENT'->Rent -- both custom categories that only exist
// because the demo seed data registered them) categorize CSV rows during
// the file preview, BEFORE the user clicks Import and before
// _replaceDemoDataWithReal() wipes those same catRules. The auto-register-
// unknown-category step above (108th/109th passes) then permanently
// re-added 'Transportation'/'Rent' as if the user had created them, on the
// strength of a rule that no longer existed by the time it ran. Live-
// verified: importing a plain Date,Description,Amount,Type CSV with a
// "Shell Oil" row from a Demo Profile 1 session left "Transportation" in
// getAllCats() for the "real" post-transition account. Fixed by having
// normalizeTxRow() flag which categorization came from state.catRules
// (catFromUserRule) and having confirmTxImport() re-derive those specific
// categories via community rules only -- the next real, non-demo-specific
// tier -- whenever this is a first-real-save transition, before the
// auto-register step ever sees them.
test("normalizeTxRow: flags catFromUserRule only when state.catRules is what assigned the category", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /let catFromUserRule=false;/,
    "normalizeTxRow() should declare catFromUserRule, defaulting to false"
  );
  assert.match(
    source,
    /if\(rule\.keyword&&descUpper\.includes\(rule\.keyword\.toUpperCase\(\)\)\)\{\s*cat=rule\.cat;catFromUserRule=true;break;/,
    "the state.catRules tier (the one that runs before community rules/MCC, and 'always wins, even over ATM') should set catFromUserRule=true when it fires"
  );
  assert.match(
    source,
    /return \{date,desc:desc\.slice\(0,50\),cat,card:card\|\|source,amount:Math\.round\(amount\*100\)\/100,excluded,is_offset:isOffset,isIncome:isIncome\|\|false,biz:biz\|\|false,catFromUserRule\};/,
    "catFromUserRule should be part of normalizeTxRow()'s return object"
  );
});
test("confirmTxImport: re-derives catFromUserRule categories via community rules on a first-real-save transition, before auto-registering them as permanent custom categories", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const wasFirstRealSave=!state\.hasRealData;/,
    "confirmTxImport() should capture whether this is a first-real-save transition before _replaceDemoDataWithReal() runs"
  );
  const fnMatch = source.match(/newTxs=importParsed\.map[\s\S]{0,3700}?\n  \}\);/);
  assert.ok(fnMatch, "confirmTxImport()'s mutateTransactions block should exist");
  assert.match(
    fnMatch[0],
    /if\(wasFirstRealSave\)\{\s*newTxs\.forEach\(t=>\{\s*if\(t\.catFromUserRule\)\{/,
    "the catFromUserRule re-derivation should be gated on wasFirstRealSave -- an ordinary (non-demo-transition) import must never second-guess an already-correct user-rule categorization"
  );
  assert.match(
    fnMatch[0],
    /newTxs\.forEach\(t=>\{delete t\.catFromUserRule;\}\);/,
    "catFromUserRule should be stripped from every transaction before it reaches state.transactions -- it's a transient signal, not part of the persisted transaction shape"
  );
  // The re-derivation must run (and the flag must be stripped) before the
  // auto-register-unknown-category step, or a demo-rule-derived category
  // would already have been permanently registered by the time it's
  // corrected.
  const rederiveIdx = fnMatch[0].indexOf("if(wasFirstRealSave){");
  const stripIdx = fnMatch[0].indexOf("delete t.catFromUserRule");
  const registerIdx = fnMatch[0].indexOf("const knownCats=");
  assert.ok(rederiveIdx > -1 && stripIdx > -1 && registerIdx > -1, "all three steps should exist");
  assert.ok(rederiveIdx < registerIdx && stripIdx < registerIdx, "re-derivation and stripping must both happen before the auto-register step reads t.cat");
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
  const fnMatch = source.match(/function copyYirSummary\(\)\{[\s\S]{0,5300}?\n\}/);
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
  const fnMatch = source.match(/function confirmTxImport\(\)\{[\s\S]{0,2700}?_replaceDemoDataWithReal\(\);/);
  assert.ok(fnMatch, "confirmTxImport() should call _replaceDemoDataWithReal()");
  assert.doesNotMatch(
    source.match(/function confirmTxImport\(\)\{[\s\S]{0,6600}?\n  closeModals\(\);/)[0],
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
  const fnMatch = source.match(/function saveAccount\(\)\{[\s\S]{0,4100}?closeModals\(\);renderAll\(\);\}/);
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
  const fnMatch = source.match(/function saveSnapshot\(\)\{[\s\S]{0,4500}?\n\}/);
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
  const fnMatch = source.match(/function saveTx\(\)\{[\s\S]{0,3900}?\n\}/);
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
test("saveSnapshot: requires state.hasRealAccounts before wiping demo data or computing netWorth()/totalAssets()/totalLiab(), and the old mid-function demo-preview branch it made unreachable is gone", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveSnapshot\(\)\{[\s\S]{0,4500}?\n\}/);
  assert.ok(fnMatch, "saveSnapshot() should exist");
  const guardIdx = fnMatch[0].search(/if\(!state\.hasRealAccounts\)\{/);
  const wipeIdx = fnMatch[0].search(/_replaceDemoDataWithReal\(\);/);
  const nwIdx = fnMatch[0].search(/nw:netWorth\(\)/);
  assert.ok(guardIdx >= 0, "saveSnapshot() should check state.hasRealAccounts");
  assert.ok(wipeIdx >= 0 && nwIdx >= 0, "the wipe call and netWorth() computation should both exist");
  assert.ok(guardIdx < wipeIdx, "the hasRealAccounts guard must run BEFORE the wipe");
  assert.ok(wipeIdx < nwIdx, "the wipe must still run before netWorth() is computed (for defense-in-depth), but only after the guard above has already ensured real accounts exist");
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
  const fnMatch = source.match(/function saveTx\(\)\{[\s\S]{0,3900}?\n\}/);
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
  const valueGuardIdx = fnMatch[0].search(/if\(value<0\|\|!Number\.isFinite\(value\)\)return;/);
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
  const fnMatch = source.match(/function saveHistoricalSnapshot\(\)\{[\s\S]{0,7700}?_editingSnapshotMonthKey=null;[\s\S]{0,300}?closeModals\(\);renderAll\(\);scheduleSave\(\);/);
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

// ── A real production report (a user's own DevTools showed accounts:[] and
// hasRealData:true immediately after a CSV import, while the Accounts tab
// still rendered full demo data one screen over) traced back to
// confirmTxImport() only calling renderSpending() after
// _replaceDemoDataWithReal() wipes state.accounts -- renderAccountLists()
// is only reachable via renderAll() (confirmed by checking every call
// site), so the Accounts tab kept showing stale, no-longer-backed demo
// rows (with dead Edit buttons -- editAccount(id) correctly finds nothing
// for a demo id against the now-empty state.accounts) until an unrelated
// renderAll() or a full reload. The same gap existed in 3 sibling "first
// real save" entry points that also call _replaceDemoDataWithReal():
// saveTx() (also only called renderSpending()) and saveSnapshot()/
// saveHistoricalSnapshot() (each called a hand-picked
// renderMetrics()/renderNwBreakdown()/renderHistory()/renderNwChart()
// quartet -- itself a fix for the identical bug class, 110th adversarial
// pass -- that never actually included renderAccountLists() either).
// saveAccount()/saveVehicle()/handleCsv() already called renderAll() and
// don't have this problem. Fixed by widening all 4 to renderAll(),
// matching those three. Found and fixed August 2026. ──
test("confirmTxImport()/saveTx()/saveSnapshot()/saveHistoricalSnapshot() all call renderAll() after their demo-to-real wipe, not a narrower render subset that omits the Accounts tab", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const confirmTxImportSrc = source.match(/function confirmTxImport\(\)\{[\s\S]{0,11600}?\n}\n/)[0];
  assert.match(
    confirmTxImportSrc,
    /state\.hasRealData=true;\s*hideDemoBadge\(\);\s*\/\/[\s\S]{0,1400}?renderAll\(\);\s*\/\/ Show post-import success modal/,
    "confirmTxImport() should call renderAll() (not renderSpending()) right after state.hasRealData=true/hideDemoBadge() -- renderAll() itself reads state.hasRealData to decide whether to hide demo notices, so it must run after that flag flips, not right after closeModals() where an earlier version of this fix mistakenly placed it (caught live-testing: the 'Demo accounts' banner stayed stuck visible)"
  );
  assert.doesNotMatch(
    confirmTxImportSrc,
    /closeModals\(\);\s*renderSpending\(\);/,
    "confirmTxImport() should no longer call renderSpending() alone after closeModals()"
  );
  assert.doesNotMatch(
    confirmTxImportSrc,
    /closeModals\(\);\s*renderAll\(\);/,
    "renderAll() should not sit directly after closeModals() either -- it must come after state.hasRealData=true is set, later in the function"
  );
  assert.match(
    source.match(/function saveTx\(\)\{[\s\S]{0,3900}?\n\}/)[0],
    /closeModals\(\);renderAll\(\);\s*\n\}/,
    "saveTx() should call renderAll() (not renderSpending()) as its final line"
  );
  assert.match(
    source.match(/function saveSnapshot\(\)\{[\s\S]{0,4500}?\n\}/)?.[0] || "",
    /hideDemoBadge\(\);[\s\S]{0,900}?renderAll\(\);/,
    "saveSnapshot() should call renderAll(), not the old renderMetrics()/renderNwBreakdown()/renderHistory()/renderNwChart() quartet that omitted the Accounts tab"
  );
  assert.match(
    source.match(/function saveHistoricalSnapshot\(\)\{[\s\S]{0,7700}?_editingSnapshotMonthKey=null;[\s\S]{0,300}?closeModals\(\);renderAll\(\);scheduleSave\(\);/)[0],
    /closeModals\(\);renderAll\(\);scheduleSave\(\);$/,
    "saveHistoricalSnapshot() should call renderAll() (not the old quartet), still followed by scheduleSave() since this path doesn't sync snapshots to Supabase any other way"
  );
});

// ── Swept every other state.transactions mutator for the same "narrower
// render than renderAll() after a state change other tabs depend on" bug
// class the demo-to-real render gap (test above) turned out to be one
// instance of -- these 5 aren't demo-to-real related at all, just ordinary
// day-to-day transaction editing, which makes them higher-traffic than the
// one-time demo transition. All correctly rebuild MONTHLY/ALL_MONTHS via
// mutateTransactions() already; only the DOM re-render was too narrow.
// Found August 2026. ──
test("applyRulesToExisting()/saveEditTx()/deleteTx()/toggleTxBiz()/applyVenmoOpt() all call renderAll(), not just renderSpending(), after mutating state.transactions", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  const applyRulesSrc = source.match(/function applyRulesToExisting\(\)\{[\s\S]{0,1900}?\n\}/)?.[0] || "";
  assert.match(
    applyRulesSrc,
    /\}\);\s*\/\/[\s\S]{0,700}?renderAll\(\);\s*const el=document\.getElementById\('apply-rules-result'\);/,
    "applyRulesToExisting() should call renderAll() right after its mutateTransactions() block, before touching #apply-rules-result"
  );
  assert.doesNotMatch(applyRulesSrc, /\}\);\s*renderSpending\(\);/, "applyRulesToExisting() should no longer call renderSpending() alone");

  const saveEditTxSrc = source.match(/function saveEditTx\(\)\{[\s\S]{0,4400}?\n\}/)?.[0] || "";
  assert.match(
    saveEditTxSrc,
    /\/\/[\s\S]{0,400}?closeModals\(\);renderAll\(\);\s*\/\/ Offer to save a categorization rule/,
    "saveEditTx() should call renderAll() (not renderSpending()) right after closeModals()"
  );

  const deleteTxSrc = source.match(/function deleteTx\(\)\{[\s\S]{0,800}?\n\}/)?.[0] || "";
  assert.match(
    deleteTxSrc,
    /closeModals\(\);\s*\/\/[\s\S]{0,300}?renderAll\(\);\s*\}/,
    "deleteTx() should call renderAll() (not renderSpending()) after closeModals()"
  );

  const toggleTxBizSrc = source.match(/function toggleTxBiz\(id\)\{[\s\S]{0,700}?\n\}/)?.[0] || "";
  assert.match(
    toggleTxBizSrc,
    /\}\);\s*\/\/[\s\S]{0,300}?renderAll\(\);\s*\}/,
    "toggleTxBiz() should call renderAll() (not renderSpending()) after its mutateTransactions() block"
  );

  const applyVenmoOptSrc = source.match(/function applyVenmoOpt\(skip\)\{[\s\S]{0,2000}?\n\}/)?.[0] || "";
  assert.match(
    applyVenmoOptSrc,
    /closeModals\(\);\s*\/\/[\s\S]{0,400}?renderAll\(\);\s*showToast\('✓ Venmo cashouts updated'\);/,
    "applyVenmoOpt() should call renderAll() (not renderSpending()) before its success toast"
  );
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
  const fnMatch = source.match(/function detectSubscriptions\(allMonths,latestFullM\)\{[\s\S]{0,5500}?return\{subVendors,subTotal\};/);
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

// ── 132nd adversarial pass ──────────────────────────────────────────────
// LOW: the legacy College-Fund migration's sibling branch (saved.
// collegeFund present, vs. the >=10-accounts branch just below it, which
// the 114th pass already fixed) still pushed id:state.nextId++ -- at push
// time state.nextId still holds its pre-load default (5000), since
// saved.nextId isn't restored until later in this same function, risking
// a collision with an existing restored account already holding that id.
// The 114th pass's fix only touched the branch it was investigating and
// missed this identical-shaped sibling. Found in the 132nd adversarial
// pass, confirming the account/vehicle restore-path area otherwise
// converged after the 130th/131st passes. ──
test("loadFromLocalStorage: the legacy College-Fund migration's saved.collegeFund branch also uses a locally-computed collision-safe id, matching its sibling branch", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const collegeFundSafeId=Math\.max\(0,\.\.\.state\.accounts\.map\(a=>a\.id\|\|0\)\)\+1;/,
    "the saved.collegeFund branch should compute a safe id from the current max id in state.accounts, not push state.nextId++ before nextId is restored from the payload"
  );
  assert.match(
    source,
    /state\.accounts\.push\(\{id:collegeFundSafeId,name:saved\.collegeFund\.name/,
    "the safe id should actually be used in the push"
  );
});

// ── 133rd adversarial pass ──────────────────────────────────────────────
// Applying the 132nd pass's own "fixed in one restore branch, missed in a
// sibling" methodology across the 3 account-restore paths themselves
// (cloud sync, local storage, backup restore) surfaced 3 more instances
// of the exact same shape, all in income-related fields:
//
// MEDIUM: declaredIncome was only Number()-coerced in importBackup() --
// loadFromLocalStorage() used `??0` (only catches null/undefined, not a
// numeric string) and loadUserData() didn't coerce at all. A numeric
// string from a corrupted cloud row or hand-edited localStorage passes
// state.declaredIncome>0 checks and then poisons sumIncomeForMonths()'s
// reduce into string concatenation -- corrupting the savings-rate
// insight, the Flow chart, and Year in Review -- and both save paths
// write declaredIncome back verbatim, so the corruption persists across
// reloads instead of self-healing.
//
// LOW: importBackup()'s income restore was missing the !Array.isArray()
// guard the 105th pass already added to the other two paths.
//
// LOW: the College-Fund migration's balance:saved.collegeFund.balance||0
// bypassed the 130th pass's balance coercion entirely, since this
// account is pushed directly rather than passed through
// _normalizeAccountTypes() -- the exact same hand-edited-legacy-blob
// threat model pass 130 was built around.
//
// Found in the 133rd adversarial pass. ──
test("loadUserData/loadFromLocalStorage: declaredIncome is Number()-coerced on restore, matching importBackup()'s existing coercion", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if \(prefs\.declaredIncome !== undefined\) state\.declaredIncome = Number\(prefs\.declaredIncome\)\|\|0;/,
    "loadUserData() should Number()-coerce prefs.declaredIncome, not assign it verbatim"
  );
  assert.match(
    source,
    /state\.declaredIncome=Number\(saved\.declaredIncome\)\|\|0;/g,
    "loadFromLocalStorage() (and importBackup(), which already had this) should Number()-coerce saved.declaredIncome, not just ??0"
  );
  const matches = source.match(/state\.declaredIncome=Number\(saved\.declaredIncome\)\|\|0;/g) || [];
  assert.equal(matches.length, 2, "both loadFromLocalStorage() and importBackup() should share the identical Number()-coerced declaredIncome line");
});
test("importBackup: income restore is array-guarded, matching loadFromLocalStorage()/loadUserData()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/\(saved\.income&&typeof saved\.income==='object'&&!Array\.isArray\(saved\.income\)\)\?saved\.income:\{method:null,monthlyAmount:0\}/g) || [];
  assert.equal(matches.length, 2, "both loadFromLocalStorage() and importBackup() should share the identical array-guarded income restore expression");
});
test("loadFromLocalStorage: the College-Fund migration's balance is coerced the same way _normalizeAccountTypes() coerces every other account's balance", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const collegeFundParsedBalance=parseFloat\(String\(saved\.collegeFund\.balance\)\.replace\(\/,\/g,''\)\);\s*const collegeFundBalance=Number\.isFinite\(collegeFundParsedBalance\)\?collegeFundParsedBalance:0;/,
    "the College-Fund migration should coerce balance via the same comma-strip + Number.isFinite pattern as _normalizeAccountTypes()"
  );
  assert.match(
    source,
    /balance:collegeFundBalance,excludeFromNW:true\}\);/,
    "the coerced balance should actually be used in the push, not the raw saved.collegeFund.balance||0"
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
test("the 8 manual-entry save functions (saveTx, saveEditTx, saveAccount, saveVehicle, saveBudget, saveHistoricalSnapshot, saveDeclaredIncome, saveManualIncome) all reject non-finite (Infinity/1e400) values, not just falsy/NaN ones", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  const saveTxMatch = source.match(/function saveTx\(\)\{[\s\S]{0,1600}/);
  assert.ok(saveTxMatch, "saveTx() should exist");
  assert.match(
    saveTxMatch[0],
    /if\(!desc\|\|!amount\|\|!Number\.isFinite\(amount\)\)\{/,
    "saveTx should reject a non-finite amount alongside the existing falsy check"
  );

  assert.match(
    source,
    /if\(!Number\.isFinite\(amountVal\)\)\{showToast\('⚠ Invalid amount — edit not saved'/,
    "saveEditTx should use !Number.isFinite instead of isNaN, so Infinity is also rejected"
  );

  assert.match(
    source,
    /_balanceRaw=parseFloat\(document\.getElementById\('f-balance'\)\.value\),\s*balance=Number\.isFinite\(_balanceRaw\)\?_balanceRaw:0,/,
    "saveAccount's balance should be derived via a Number.isFinite check, not a bare `||0` fallback that Infinity survives"
  );

  assert.match(
    source,
    /if\(value<0\|\|!Number\.isFinite\(value\)\)return;/,
    "saveVehicle should reject a non-finite value alongside the existing negative-value guard (the equivalent purchase-price guard was removed alongside the field itself, August 2026)"
  );

  assert.match(
    source,
    /if\(val>0&&Number\.isFinite\(val\)\)state\.budgets\[cat\]=Math\.round\(val\);/,
    "saveBudget should require Number.isFinite alongside val>0 before saving"
  );

  assert.match(
    source,
    /const assetsRaw=parseFloat\(document\.getElementById\('hist-snap-assets'\)\.value\);\s*const assets=Number\.isFinite\(assetsRaw\)\?assetsRaw:nw;/,
    "saveHistoricalSnapshot's assets should fall back to nw only via a Number.isFinite check, not a bare `||nw` that Infinity survives"
  );
  assert.match(
    source,
    /const liabRaw=parseFloat\(document\.getElementById\('hist-snap-liab'\)\.value\);\s*const liab=Number\.isFinite\(liabRaw\)\?liabRaw:0;/,
    "saveHistoricalSnapshot's liab should fall back to 0 only via a Number.isFinite check"
  );
  assert.match(
    source,
    /if\(!date\|\|!Number\.isFinite\(nw\)\)\{showToast\('Please enter a date and net worth'/,
    "saveHistoricalSnapshot's nw should be rejected via !Number.isFinite, not just isNaN"
  );

  assert.match(
    source,
    /if\(Number\.isFinite\(val\)&&val>0\)\{/,
    "saveDeclaredIncome should use Number.isFinite instead of !isNaN, so Infinity is also rejected"
  );

  assert.match(
    source,
    /if\(!val\|\|val<=0\|\|!Number\.isFinite\(val\)\)\{showToast\('Please enter a valid monthly income'/,
    "saveManualIncome should reject a non-finite value alongside the existing checks"
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
test("parseCsvAccounts and confirmCustomGoal (the 120th pass's extension of the 119th pass's Number.isFinite sweep) both reject non-finite (Infinity/1e400) values, not just NaN", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(!name\.trim\(\)\|\|!normType\|\|!Number\.isFinite\(balance\)\)\{skipped\+\+;return;\}/,
    "parseCsvAccounts should reject a non-finite balance alongside the existing name/type checks"
  );
  assert.match(
    source,
    /if\(!Number\.isFinite\(parsed\)\|\|parsed<=0\)\{/,
    "confirmCustomGoal should reject a non-finite parsed value alongside the existing parsed<=0 check"
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
    /return \{date,desc:desc\.slice\(0,50\),cat,card:card\|\|source,amount:Math\.round\(amount\*100\)\/100,excluded,is_offset:isOffset,isIncome:isIncome\|\|false,biz:biz\|\|false,catFromUserRule\};/,
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

// ── 136th adversarial pass ──────────────────────────────────────────────
// LOW: .demo-picker-overlay centers its child the same way .modal-overlay
// does (align-items:center), but unlike .modal (which caps at
// max-height:90vh;overflow-y:auto), .demo-picker had no scroll/height
// cap -- on a short viewport (a landscape phone, a small split-screen/PWA
// window) the box overflowed symmetrically past both the top and bottom
// edges with nothing to scroll. The mandatory first-visit picker is
// deliberately non-dismissible (no Escape, no cancel button), so a user
// whose profile buttons clipped below the fold had no way to reach them
// and no way to enter the app at all. Found in the 136th adversarial
// pass. ──
test(".demo-picker carries the same max-height/overflow-y scroll cap as .modal, so it can't clip unreachable content on a short viewport", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.demo-picker\{background:var\(--bg-card\);border:1px solid var\(--border-mid\);border-radius:16px;padding:1\.75rem;width:min\(420px,100%\);max-height:90vh;overflow-y:auto;box-shadow:/,
    "the .demo-picker rule should include max-height:90vh and overflow-y:auto, matching .modal's own treatment"
  );
});

// ── 137th adversarial pass ──────────────────────────────────────────────
// LOW: #toast (position:fixed, centered, white-space:nowrap, no
// max-width) had no way to wrap or cap its own width. Several real toast
// messages run 60-80+ characters (the demo-preview-guard message, cloud-
// sync-failure messages), so on a narrow phone a long message rendered
// wider than the viewport and overflowed past both edges with nothing to
// scroll (html/body both have overflow-x:hidden) -- the same class of
// unreachable-content gap the 136th pass fixed for the demo picker, just
// horizontal instead of vertical. Found in the 137th adversarial pass. ──
test("#toast carries a max-width and wraps long messages, instead of overflowing past both edges of a narrow viewport", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div id="toast" role="status" aria-live="polite" aria-atomic="true" style="[^"]*max-width:92vw;white-space:normal;text-align:center"><\/div>/,
    "#toast should have max-width:92vw and white-space:normal (not nowrap), so long messages wrap inside the viewport instead of clipping"
  );
});

// LOW (marginal -- fully dismissible, not a trap): #pill-tip-overlay's
// content box had no max-height/overflow-y, unlike .modal's own
// max-height:90vh;overflow-y:auto cap for the identical centered-overlay
// pattern. A long insight-pill tip could overflow top and bottom on a
// very short viewport with nothing to scroll -- lower urgency than the
// demo-picker fix since tapping anywhere (including the clipped area)
// dismisses this overlay. Found in the 137th adversarial pass. ──
test("showPillTip: the tip content box carries max-height/overflow-y, matching .modal's own scroll cap", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /max-width:320px;width:100%;max-height:80vh;overflow-y:auto;font-size:12px;color:#94A3B8;line-height:1\.6;white-space:pre-line/,
    "the pill-tip content box should include max-height:80vh and overflow-y:auto"
  );
});

// ── 138th adversarial pass ──────────────────────────────────────────────
// MEDIUM: the (i) info-pill trigger's dark-theme (default theme) glyph
// (#475569 on #1E293B, ~1.9:1) and border (#334155 on #1E293B, ~1.4:1)
// both failed WCAG AA (3:1 UI-component / 4.5:1 text). The pill is the
// ONLY affordance signaling an inline explanation exists, so this was a
// real usability gap for the theme most users see by default. The light-
// theme equivalent (~4.2:1) was already fine. Found in the 138th
// adversarial pass. ──
test("dark theme's --pill-info-border/--pill-info-color reach at least 3:1 contrast against --pill-info-bg, matching --text-muted", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /--pill-info-border:#8595A8;\s*--pill-info-color:#8595A8;/,
    "dark theme's pill-info border/color should both be #8595A8 (matching --text-muted, ~4.8:1 against the #1E293B bg), not the old #334155/#475569 (~1.4:1/~1.9:1)"
  );
});

// LOW: showPillTip()'s overlay is styled exactly like a modal (full-
// screen, dark backdrop, centered box) but was dismissible only via its
// own onclick handler -- never wired into the global Escape handler,
// unlike every other dismissible surface it walks (cat-hide popover,
// community rules, hidden popover, demo picker, .modal-overlay). The (i)
// trigger at the spending/analytics label rows is a real <button>, so a
// keyboard user can focus and open it with Enter, then has no keyboard
// route to close it. Found in the 138th adversarial pass. ──
test("Escape key handler dismisses the pill-tip overlay, matching every other dismissible surface it walks", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const escMatch = source.match(/if\(e\.key==='Escape'\)\{[\s\S]{0,1000}/);
  assert.ok(escMatch, "the Escape key handler should exist");
  assert.match(
    escMatch[0],
    /const pillTip=document\.getElementById\('pill-tip-overlay'\);\s*if\(pillTip\)\{pillTip\.remove\(\);return;\}/,
    "the Escape handler should remove #pill-tip-overlay if present, matching its own onclick dismiss behavior"
  );
});

// ── 139th adversarial pass ──────────────────────────────────────────────
// LOW-MEDIUM: --text-dim (dark theme) was #475569 -- the exact color the
// 138th pass already flagged as too dark when it was --pill-info-color
// (~1.9:1 against --bg-card, ~2.4:1 against --bg-input), but it survived
// here as --text-dim, driving .form-label (32 uses, including the sync-
// passphrase modal's "Passphrase"/"Confirm passphrase" labels),
// .modal-sub, .fmt-btn, and the search placeholder. Failed WCAG AA in
// dark theme, the app's default -- light theme's own #6B7280 (~4.8:1)
// was already fine. Found in the 139th adversarial pass. ──
test("dark theme's --text-dim reaches at least WCAG AA contrast against --bg-card (matching --text-muted's already-verified-safe value), and the fully-dead --text-faint token is removed", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /--text-dim:#8595A8;/,
    "dark theme's --text-dim should be #8595A8 (matching --text-muted, ~4.8:1 against --bg-card), not the old #475569 (~1.9:1)"
  );
  // --text-faint had zero var(--text-faint) consumers anywhere in the file,
  // and its light-theme declaration was duplicated within the same rule (a
  // genuinely dead, silently-overridden value on top of being entirely
  // unread). Found in the 139th adversarial pass.
  assert.doesNotMatch(
    source,
    /--text-faint:#(334155|9CA3AF|6B7280);/,
    "none of the 3 dead --text-faint declarations should remain"
  );
});

// ── 140th adversarial pass ──────────────────────────────────────────────
// LOW (dead code): an exhaustive dark-theme contrast sweep (checking
// every text/icon token against every real surface it's used on) found
// the dark-theme contrast angle itself had converged after the 138th/
// 139th passes -- every remaining token clears WCAG AA. But the sweep's
// own "grep every var() usage to find the real background" methodology
// surfaced a cluster of 9 more fully-dead custom properties (defined in
// both theme blocks, zero var() consumers anywhere, and the app has no
// getComputedStyle()/getPropertyValue() call so nothing reads them from
// JS either) -- the same class pass 139 only partially cleaned up when
// it removed --text-faint. Found in the 140th adversarial pass. ──
test("dead CSS custom properties from the 140th pass's sweep are removed from both theme blocks", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const deadTokens = [
    "--bg-elevated", "--chart-bg", "--chart-grid", "--chart-tick",
    "--card-nudge-border", "--info-box-bg", "--info-box-border",
    "--tab-strip-bg", "--analytics-title",
  ];
  deadTokens.forEach(token => {
    const re = new RegExp(`${token.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}:`);
    assert.doesNotMatch(source, re, `${token} should have no remaining declaration (dark or light theme)`);
  });
  // --card-nudge-bg is the live sibling of the removed --card-nudge-border
  // -- confirm it's untouched, not accidentally swept up in the cleanup.
  assert.match(source, /--card-nudge-bg:#1E293B;/, "the live --card-nudge-bg token should still be defined in dark theme");
  assert.match(source, /--card-nudge-bg:#F8FAFC;/, "the live --card-nudge-bg token should still be defined in light theme");
});

// ── 143rd adversarial pass ──────────────────────────────────────────────
// MEDIUM: the cross-tab "another tab is open" warning only reacted to
// e.key===LS_KEY -- but state and transactions live in two separate
// localStorage keys (LS_KEY/LS_TXS_KEY), and editing or deleting a
// transaction (mutateTransactions() -> saveEditTx()/deleteTx()) touches
// no serializeState() field, so saveToLocalStorage() writes an UNCHANGED
// value to LS_KEY. Per the storage-event spec, setItem() with an
// unchanged value never fires a storage event, so the listener saw
// nothing at all for the two most common transaction operations --
// silently reintroducing the exact "whichever tab saves last wins, zero
// indication" failure mode this listener exists to warn about, just for
// LS_TXS_KEY instead of LS_KEY. Adding a transaction is unaffected
// (saveTx() bumps state.nextId, which IS serialized). Found in the 143rd
// adversarial pass. ──
test("cross-tab storage warning also fires for LS_TXS_KEY, not just LS_KEY -- transaction edits/deletes wouldn't otherwise trigger a storage event at all", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if\(\(e\.key===LS_KEY\|\|e\.key===LS_TXS_KEY\)&&!window\._isDemoPreview&&!window\._viewingDemoOverReal\)\{/,
    "the storage listener should react to both LS_KEY and LS_TXS_KEY"
  );
});

// ── 146th adversarial pass ──────────────────────────────────────────────
// LOW: copyYirSummary()'s navigator.clipboard.writeText(lines).then(...)
// had no .catch(). writeText() rejects ASYNCHRONOUSLY on permission-denied/
// document-not-focused/sandboxed-webview, which the surrounding synchronous
// try/catch can't see -- so a rejection was totally silent: no success
// toast, no failure toast, nothing. This is the one .then() in the whole
// file that broke the established convention of every other async chain
// catching and surfacing a toast. Especially relevant for users opening the
// app inside Reddit/Instagram/Facebook in-app browsers, which commonly
// expose navigator.clipboard but deny writes. Found in the 146th
// adversarial pass. ──
test("copyYirSummary()'s clipboard write has a .catch() so a permission-denied rejection surfaces a toast instead of failing silently", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /navigator\.clipboard\.writeText\(lines\)\.then\(\(\)=>showToast\('📋 Copied to clipboard','#34D399'\)\)\.catch\(\(\)=>showToast\('Could not copy','#FCD34D'\)\);/,
    "the clipboard writeText() call should have a .catch() showing the same 'Could not copy' toast used by the surrounding sync try/catch"
  );
});

// ── 148th adversarial pass ──────────────────────────────────────────────
// MEDIUM: the category/vendor filter tiles (renderBucketGrid()'s
// .bucket-card elements) and the active-filter-pill "✕" chips were
// <div>/<span> with data-action + cursor:pointer, activated only via the
// global click-delegation listener -- no tabindex, no role="button", no
// keydown handling. A keyboard-only or switch-access user could not focus
// or activate them at all, meaning the app's single most prominent,
// explicitly-advertised interaction ("Click any category tile to filter")
// was entirely unreachable without a mouse -- a WCAG 2.1.1 (Keyboard,
// Level A) failure. Every sibling control (sort buttons, mode toggles,
// chart-view toggles, the per-tile hide button) was already a real
// <button>, so this was an inconsistent gap, not a deliberate no-keyboard
// stance. Fixed by adding tabindex="0"/role="button" (plus aria-pressed on
// the two toggle tiles, aria-label on the filter pills) to the 5 affected
// elements, and a new document-level keydown listener that treats Enter/
// Space on any non-native-control data-action element with tabindex="0"
// the same as a click -- gated on tagName so it can't double-fire on
// actual <button>/<a> elements, which already get Enter/Space for free.
// Found in the 148th adversarial pass. ──
test("category/vendor bucket-card tiles and active-filter pills are keyboard-focusable and keyboard-activatable, with a visible focus outline that isn't silently overridden by the unconditional .active-bucket outline", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /data-action="toggleVendorFilterByIdx" data-arg="\$\{vi\}" tabindex="0" role="button" aria-pressed="\$\{isActive\}"/,
    "vendor bucket-card tile should be focusable and expose its toggle state"
  );
  assert.match(
    source,
    /data-action="openOtherVendorsModal" style="[^"]*" data-tip="Click to see all \$\{otherVendors\.length\} vendors" tabindex="0" role="button"/,
    "'other vendors' tile should be focusable"
  );
  assert.match(
    source,
    /data-action="showPillTip" data-tip="\$\{hiddenCount\} categories:&#10;\$\{otherCatBreakdown\}" tabindex="0" role="button"/,
    "'other categories' tile should be focusable"
  );
  assert.match(
    source,
    /data-action="toggleCatFilter" data-arg="\$\{sc\}" aria-pressed="\$\{isActive\}" aria-label="Filter by \$\{esc\(sc\)\}"/,
    "category bucket-card tile's stretched hit-button (a real <button>, not a nested role=button div) should expose its toggle state"
  );
  assert.match(
    source,
    /data-action="toggleCatFilter" data-arg="\$\{esc\(c\)\}" tabindex="0" role="button" aria-label="Remove \$\{esc\(c\)\} filter"/,
    "active-filter pills should be focusable with a descriptive label"
  );
  assert.match(
    source,
    /document\.addEventListener\('keydown',function\(e\)\{\s*if\(e\.key!=='Enter'&&e\.key!==' '\)return;\s*const tag=e\.target\.tagName;\s*if\(tag==='BUTTON'\|\|tag==='A'\|\|tag==='INPUT'\|\|tag==='SELECT'\|\|tag==='TEXTAREA'\)return;\s*if\(!e\.target\.hasAttribute\('data-action'\)\|\|e\.target\.getAttribute\('tabindex'\)!=='0'\)return;\s*e\.preventDefault\(\);\s*dispatch\(e,'data-action',false\);\s*\}\);/,
    "a keydown listener should activate Enter/Space on focusable non-native data-action elements"
  );

  // 149th adversarial pass, only reachable once these tiles gained
  // tabindex="0" in the 148th pass above: .bucket-card.active-bucket{
  // outline:1.5px solid currentColor} is an unconditional author-origin
  // rule, so it beats the UA default :focus-visible outline on the same
  // property outright (author normal always wins over UA normal,
  // regardless of specificity) -- an already-active tile showed no visual
  // change at all when it received keyboard focus.
  assert.match(
    source,
    /\.bucket-hit:focus-visible\{outline:2px solid currentColor;outline-offset:2px\}/,
    "non-active bucket-card tiles should have an explicit focus-visible outline on their stretched hit-button"
  );
  assert.match(
    source,
    /\.bucket-card\.active-bucket \.bucket-hit:focus-visible\{outline:2\.5px dashed currentColor;outline-offset:2px\}/,
    "active bucket-card tiles should have a focus-visible outline distinct from the plain active-only outline"
  );
});

// ── 151st adversarial pass ──────────────────────────────────────────────
// MEDIUM: extends the pass-148 keyboard-accessibility pattern (tabindex=
// "0"/role="button" + the shared Enter/Space keydown handler) to the
// transaction row (tx-row, data-action="openEditTxModal") -- the primary
// way to edit/recategorize/exclude a transaction, and the highest-impact
// item remaining from the pass-123 click-only-elements finding. Also
// covers its nested BIZ/PERS toggle pill (data-action="toggleTxBiz"), the
// only path to flip a transaction's business/personal flag -- saveEditTx()
// has no biz control of its own, so this pill was the sole way to change
// it, and was itself click-only inside an already-click-only row. Both now
// carry tabindex="0"/role="button"/a descriptive aria-label, plus explicit
// :focus-visible outlines (matching the app's existing #2563EB input-focus
// color). data-stop="1" on the pill (pre-existing) keeps the two controls'
// keyboard activation independent, same as their click behavior. Found and
// fixed in the 151st adversarial pass; live-verified in a local browser
// (Tab reaches the row, Enter opens the edit modal; Tab reaches the pill,
// Enter/Space toggles biz/personal without opening the modal). ──
test("transaction rows and their nested BIZ/PERS toggle pill are keyboard-focusable and keyboard-activatable", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /data-action="openEditTxModal" data-arg="\$\{t\.id\}" tabindex="0" role="button" aria-label="\$\{fmtDate\(t\.date\)\}/,
    "the transaction row should be focusable with a descriptive label that leads with the same visible text order as the row itself (date first), not a generic 'Edit transaction:' prefix that fails the label-content-name-mismatch a11y rule"
  );
  assert.match(
    source,
    /data-action="toggleTxBiz" data-arg="\$\{t\.id\}" data-stop="1" tabindex="0" role="button" aria-label="Toggle business or personal/,
    "the nested BIZ\/PERS pill should be independently focusable, isolated from the row's own action by data-stop"
  );
  assert.match(
    source,
    /\.tx-row:focus-visible\{outline:2px solid #2563EB;outline-offset:1px\}/,
    "the transaction row should have an explicit focus-visible outline"
  );
  assert.match(
    source,
    /\.tx-row \.pill\[role="button"\]:focus-visible\{outline:2px solid #2563EB;outline-offset:2px\}/,
    "the nested BIZ/PERS pill should have its own explicit focus-visible outline"
  );
});

// ── 153rd adversarial pass ──────────────────────────────────────────────
// LOW: fmtDate(d) only sanitizes the month segment (via a MON3[] array
// lookup) -- the year and day segments were interpolated verbatim into
// three unescaped render sinks (the tx-row's own aria-label attribute, the
// visible .tx-date cell, and the recategorize-confirm list), unlike every
// sibling transaction field (desc/cat/card), which all go through esc()/
// highlight(). All 3 transaction-ingestion sites (importBackup(),
// loadUserData(), loadFromLocalStorage()) only type-guarded t.date as a
// string, never format-validated it -- so a hand-edited backup/cloud row
// with e.g. a date of '</div><img src=x> -01-01' would inject raw HTML/
// break out of the aria-label attribute on render. The CSP has no
// 'unsafe-inline' in script-src, so this can't execute a <script>/onerror
// handler -- confined to benign HTML/attribute injection, not full XSS --
// but it's a genuine escaping/validation inconsistency the file's own
// established pattern (validate shape once at ingestion, not per-render-
// sink) already exists to prevent for every other field. Fixed by
// requiring t.date to match /^\d{4}-\d{2}-\d{2}$/ at all 3 ingestion
// sites, falling back to '' (the same fallback already used for a
// non-string date) otherwise -- reusing the exact date-shape regex already
// established elsewhere in the file (editSnapshot()'s _normDateToISO()).
// Found in the 153rd adversarial pass. ──
test("transaction date is format-validated (not just type-guarded) at all 3 restore paths, closing the one unescaped tx render sink", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const matches = source.match(/date:typeof t\.date==='string'&&\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(t\.date\)\?t\.date:''/g) || [];
  assert.equal(matches.length, 3, "all 3 transaction restore paths (importBackup/loadUserData/loadFromLocalStorage) should format-validate date, not just type-guard it");
});

// ── 156th adversarial pass ──────────────────────────────────────────────
// MEDIUM: renderTreemap()/renderSankey() summed raw (possibly negative)
// transaction amounts per category/vendor with no positivity guard, then
// fed those totals into a geometry-based layout (d3.hierarchy().sum() ->
// d3.treemap(); d3Sankey.sankey()) and computed %-share as
// Math.round(value/total*100) -- so a category/vendor whose refunds/
// offsets exceed its spend within the filtered window (net <=0) produced
// negative-area tiles, a broken/invisible Sankey link, and nonsensical
// percentages like "-150% of Shopping" or "Infinity%" (0/0).
// detectSubscriptions() already guards against exactly this shape with an
// explicit amount>0 filter; these two chart functions didn't. Fixed by
// deleting non-positive entries from catTotals/catVendors (treemap) and
// catTotals/filteredOutCatTotals (sankey) immediately after aggregation,
// so total/percentages/the drill-in data are all automatically consistent
// downstream -- sankey's totalSpendAll (which feeds the correctly-signed
// "Remaining/saved" calc, where a refund SHOULD increase savings) is
// deliberately left untouched. Found in the 156th adversarial pass. ──
test("renderTreemap and renderSankey drop non-positive-net categories/vendors immediately after aggregation, before any total/percentage math reads them", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /Object\.keys\(catTotals\)\.forEach\(cat=>\{if\(catTotals\[cat\]<=0\)delete catTotals\[cat\];\}\);\s*Object\.keys\(catVendors\)\.forEach\(cat=>\{\s*Object\.keys\(catVendors\[cat\]\)\.forEach\(v=>\{if\(catVendors\[cat\]\[v\]<=0\)delete catVendors\[cat\]\[v\];\}\);\s*\}\);/,
    "renderTreemap() should drop non-positive-net categories and vendors right after building catTotals/catVendors"
  );
  assert.match(
    source,
    /Object\.keys\(catTotals\)\.forEach\(cat=>\{if\(catTotals\[cat\]<=0\)delete catTotals\[cat\];\}\);\s*Object\.keys\(filteredOutCatTotals\)\.forEach\(cat=>\{if\(filteredOutCatTotals\[cat\]<=0\)delete filteredOutCatTotals\[cat\];\}\);/,
    "renderSankey() should drop non-positive-net categories from both catTotals and filteredOutCatTotals right after aggregation"
  );
});

// ── 158th adversarial pass ──────────────────────────────────────────────
// LOW: renderHistory()'s annualized-growth-rate formula guarded only
// first.nw>0, not last.nw>0. Math.pow() of a negative base to a non-
// integer exponent is NaN, and the render check is annRate!==null, which
// NaN satisfies -- so a net worth that goes positive-to-negative between
// two snapshots (a real, reachable state through normal use, e.g. taking
// on a large loan) rendered the literal text "NaN%/yr annualized" in the
// History growth banner. renderInsights()'s NW pill has the identical
// formula and already guards both first.nw>0 AND last.nw>0 (99th
// adversarial pass) -- this sibling in renderHistory() never got the
// matching guard. Found in the 158th adversarial pass. ──
test("renderHistory()'s annualized growth-rate guard checks both first.nw>0 and last.nw>0, matching renderInsights()'s already-correct sibling formula", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const annRate=first\.nw>0&&last\.nw>0&&days>=60\?Math\.min\(999,Math\.round\(\(Math\.pow\(last\.nw\/first\.nw,365\/days\)-1\)\*100\)\):null;/,
    "renderHistory()'s annRate calculation should guard against last.nw going negative, not just first.nw"
  );
});

// ── 163rd adversarial pass ──────────────────────────────────────────────
// LOW: index.html's "Time for a refresh" landing-page nudge reads
// localStorage's 'trakyo_last_import' key (same origin, shared storage) to
// show "Last import: N days ago" once 25+ days have passed since a CSV
// import -- but the 88th adversarial pass removed the ONLY write to that
// key from confirmTxImport(), having grepped trakyodollas.html and found
// zero read sites *in that file* (index.html is a separate file the 88th
// pass's search never checked). That "dead code removal" silently broke a
// real, working landing-page feature rather than actually removing dead
// code -- the nudge could never appear for any user afterward. Restored
// the write, exactly matching its original form (confirmed via
// `git log -S 'trakyo_last_import'`, commit cb67285's removal diff).
// Found in the 163rd adversarial pass. ──
test("confirmTxImport() writes trakyo_last_import to localStorage, which index.html's landing-page nudge depends on", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /try\{localStorage\.setItem\('trakyo_last_import',new Date\(\)\.toISOString\(\)\);\}catch\(e\)\{\}/,
    "confirmTxImport() should write trakyo_last_import on every successful import"
  );
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(
    indexSource,
    /localStorage\.getItem\('trakyo_last_import'\)/,
    "index.html's landing-page nudge should still read the same key this test just confirmed is written"
  );
});

// ── 166th adversarial pass ──────────────────────────────────────────────
// LOW: the Year-in-Review modal's "Top categories"/"Top vendors" rows were
// the one place in the file that rendered a vendor/category name with no
// overflow handling -- every sibling render site (.tx-desc, the spending-
// tab top-5-vendors list) uses overflow:hidden;text-overflow:ellipsis;
// white-space:nowrap (plus a title tooltip for the full text). A long
// unbreakable vendor descriptor (common in real bank CSV exports, e.g.
// "SQ*..."/"AMZNMKTP...") or a custom category name (no maxlength exists
// on either the add-category input or addCustomCat()) could force the row
// past the modal's content width at a narrow viewport, since flex items
// default to min-width:auto (min-content) without an explicit min-width:0.
// Live-verified in a local browser (forced the modal to its true 375px-
// viewport width and injected a long synthetic name): before the fix the
// modal's scrollWidth exceeded its clientWidth by 75px; after, it's
// contained with a truncated, hover-titled name matching every sibling
// site's convention. Found in the 166th adversarial pass. ──
test("Year-in-Review's top-categories/top-vendors rows truncate long names with ellipsis + a title tooltip, matching every sibling vendor/category render site", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div style="flex:1;min-width:0;font-size:12px;color:var\(--text-primary\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\$\{esc\(cat\)\}">\$\{esc\(cat\)\}<\/div>/,
    "the YIR top-categories row should truncate the category name with ellipsis and a title tooltip"
  );
  assert.match(
    source,
    /<span style="flex:1;min-width:0;font-size:12px;color:var\(--text-primary\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\$\{esc\(displayVendor\(v\)\)\}">\$\{esc\(displayVendor\(v\)\)\}<\/span>/,
    "the YIR top-vendors row should truncate the vendor name with ellipsis and a title tooltip"
  );
});

// ── 167th adversarial pass ──────────────────────────────────────────────
// LOW: the 166th pass's "the one place in the file" characterization was
// inaccurate -- its own directly-adjacent sibling (the Spending tab's
// top-5 CATEGORIES inline panel, 12 lines above its already-fixed top-5
// VENDORS twin) had the identical no-overflow-handling gap, plus two more
// structurally identical sites: the dashboard net-worth breakdown's
// account name (.nw-item-name) and the Accounts tab's account name
// (.account-name, 2 call sites sharing one CSS class). All three render
// user-controlled, unbounded-length text (category/account names have no
// maxlength anywhere) inside a flex row with no min-width:0/ellipsis
// treatment, the same shape pass 166 just fixed for Year-in-Review. Fixed
// by matching the same established pattern at all 4 sites (the category
// panel span, the 2-level flex-center+wrapper min-width:0 chain for both
// .nw-item-name and .account-name, plus their shared CSS classes gaining
// overflow:hidden;text-overflow:ellipsis;white-space:nowrap and a title
// tooltip on each name element). Found in the 167th adversarial pass. ──
test("the top-5-categories inline panel truncates long category names, matching its already-fixed top-5-vendors sibling 12 lines below", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<span style="color:\$\{state\.activeCats\.has\(cat\)\?'var\(--text-primary\)':'var\(--text-secondary\)'\};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="\$\{esc\(cat\)\}">\$\{esc\(cat\)\}<\/span>/,
    "the top-5-categories panel's category span should truncate with ellipsis and a title tooltip"
  );
});
test("nw-item-name and account-name CSS classes truncate overlong text, and their render sites give the flex chain min-width:0 so the truncation can actually take effect", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.nw-item-name\{font-size:13px;font-weight:500;color:var\(--text-primary\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/,
    "the .nw-item-name class should truncate overlong account names"
  );
  assert.match(
    source,
    /\.account-name\{font-size:13px;font-weight:600;color:var\(--text-primary\);overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/,
    "the .account-name class should truncate overlong account names"
  );
  assert.match(
    source,
    /<div class="flex-center gap-8" style="min-width:0">\s*<div style="width:8px;height:8px;border-radius:50%;background:\$\{g\.color\}88;flex-shrink:0"><\/div>\s*<div style="min-width:0"><div class="nw-item-name" title="\$\{esc\(a\.name\)\}">\$\{esc\(a\.name\)\}<\/div>/,
    "the net-worth breakdown's flex chain should have min-width:0 at both levels so the name can actually shrink/truncate"
  );
});

// ── 168th adversarial pass ──────────────────────────────────────────────
// LOW: a systematic search (following the 166th/167th passes finding this
// same shape 4 times already) found the overflow/truncation gap recurs at
// 6 more sites, the clearest a direct twin of the 167th pass's own edit
// in the SAME function (renderExcludedAccounts()'s NW-tab excluded-
// account block, ~20 lines from its now-fixed Accounts-tab twin). Rather
// than continuing to patch one site per pass, consolidated into a shared
// .truncate utility class (overflow:hidden;text-overflow:ellipsis;
// white-space:nowrap;min-width:0) and applied it to all 5 clearly-real
// sites at once: the NW-tab excluded-account name, the CSV "similar
// transactions" recategorize list's vendor name, the budget row's
// category label, the category manager list's category name, and the
// vehicle "other asset" card's name. Found in the 168th adversarial
// pass. ──
test("the .truncate utility class exists and is applied to the 5 sites the 168th pass's systematic search found sharing the overflow/ellipsis gap", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.truncate\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0\}/,
    "the shared .truncate utility class should be defined"
  );
  const truncateUsages = source.match(/class="truncate"/g) || [];
  assert.equal(truncateUsages.length, 8, "the .truncate class should be applied at the 5 sites this pass fixed, plus 3 more added in a later small-fixes round (see the dedicated test below), plus the CSV import preview's category pill (an unbounded-length custom category name could otherwise misalign the new column-sort header, found in the adversarial pass right after that header was added), minus 1: renderVehicles()'s 'other asset' row switched from a bare class=\"truncate\" div to .account-name (which already carries the identical overflow:hidden;text-overflow:ellipsis;white-space:nowrap truncation, plus the account-row-grouped layout this row was rebuilt around), when Physical assets was rebuilt to match the rest of the Accounts tab's tighter row format");
  assert.match(
    source,
    /<div class="truncate" style="font-size:12px;font-weight:700;color:var\(--amber-text\)" title="\$\{esc\(a\.name\)\}">\$\{esc\(a\.name\)\}<\/div>/,
    "the NW-tab excluded-account block should truncate the account name, matching its already-fixed Accounts-tab twin"
  );
  assert.match(
    source,
    /<span class="truncate" style="color:var\(--text-primary\)" title="\$\{esc\(displayVendor\(t\.desc\)\)\}">\$\{esc\(displayVendor\(t\.desc\)\)\}<\/span>/,
    "the recategorize list should truncate the vendor name"
  );
  assert.match(
    source,
    /<span class="truncate" style="font-size:13px;font-weight:700;color:var\(--text-primary\)" title="\$\{esc\(cat\)\}">\$\{esc\(cat\)\}<\/span>/,
    "the budget row should truncate the category label"
  );
  assert.match(
    source,
    /<span class="truncate" style="flex:1;font-size:12px;color:var\(--text-primary\)" title="\$\{esc\(c\.name\)\}">/,
    "the category manager list should truncate the category name"
  );
  // The vehicle "other asset" card's name div moved off the bare
  // .truncate class onto .account-name when Physical assets was rebuilt
  // around the same tight .account-row-grouped-style row Financial
  // assets/Liabilities/Outside net worth use -- .account-name's own CSS
  // already carries the identical overflow:hidden;text-overflow:
  // ellipsis;white-space:nowrap truncation (see its own CSS rule,
  // ~line 272), so this is a like-for-like swap, not a regression.
  assert.match(
    source,
    /<div class="account-name" title="\$\{esc\(v\.name\)\} — \$\{esc\(v\.make\)\}">\$\{esc\(v\.name\)\}/,
    "the vehicle 'other asset' card should still truncate the vehicle name, now via .account-name"
  );
});

// July 28, 2026: the rules-manager keyword chip and the two vendor-alias
// chips were the 2 lower-priority sites the 168th pass's consolidation
// deliberately left out (raised as a still-open consistency gap, not a
// bug -- both already sat inside a flex-wrap parent, so an overlong
// keyword/alias wrapped to its own line rather than overflowing). Unlike
// the 168th pass's 5 sites (which are flex:1 children that naturally
// shrink in a non-wrapping row), these are fixed-badge chips with no
// competing sibling to force a shrink, so .truncate alone would be a
// no-op -- each also gets an explicit max-width so the ellipsis has
// something to actually truncate against.
test("the rules-manager keyword chip and vendor-alias chips truncate with the same .truncate+title pattern as the 168th pass's 5 sites", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<span class="truncate" style="font-family:monospace;font-size:12px;font-weight:700;color:var\(--accent-blue-light\);background:var\(--bg-card\);padding:2px 8px;border-radius:4px;max-width:220px" title="\$\{esc\(r\.keyword\)\}">\$\{esc\(r\.keyword\)\}<\/span>/,
    "the rules-manager keyword chip should truncate with a title tooltip"
  );
  assert.match(
    source,
    /<span class="truncate" style="font-family:monospace;font-size:12px;color:var\(--accent-red\);background:#F8717118;padding:1px 7px;border-radius:4px;max-width:220px" title="\$\{esc\(from\)\}">\$\{esc\(from\)\}<\/span>/,
    "the vendor-alias 'from' chip should truncate with a title tooltip"
  );
  assert.match(
    source,
    /<span class="truncate" style="font-family:monospace;font-size:12px;color:var\(--accent-green\);background:#34D39918;padding:1px 7px;border-radius:4px;max-width:220px" title="\$\{esc\(to\)\}">\$\{esc\(to\)\}<\/span>/,
    "the vendor-alias 'to' chip should truncate with a title tooltip"
  );
});

// July 2026: added real CSV-import support for ANZ NZ, BNZ, Westpac NZ, and
// ING Australia, following an adversarial-pass finding that the landing
// page's "supports banks by name" claim wasn't backed for AU/NZ/SG. Each
// bank's column format was researched from independently-verified real
// sources (official bank help pages plus tested open-source converters),
// not guessed -- see _HANDOFF.md for sourcing/confidence per bank.
// normalizeTxRow() has established source-pattern-only test precedent in
// this suite (see the chase/debitcredit test above) since it's a 280+ line
// DOM/state-heavy function.
test("normalizeTxRow: ANZ NZ/BNZ/Westpac NZ branches read the correct real column names, and ING Australia's Credit/Debit Amount columns are recognized by the debitcredit branch", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  const debitcreditMatch = source.match(/\}\s*else if\(importFmt==='debitcredit'\)\{[\s\S]{0,1400}?\n\n  \} else if\(importFmt==='anznz'\)/);
  assert.ok(debitcreditMatch, "the debitcredit import branch should exist and be immediately followed by the new anznz branch");
  assert.match(
    debitcreditMatch[0],
    /row\['debit amount'\]/,
    "debitcredit should recognize ING Australia's 'Debit Amount' column"
  );
  assert.match(
    debitcreditMatch[0],
    /row\['credit amount'\]/,
    "debitcredit should recognize ING Australia's 'Credit Amount' column"
  );

  const anznzMatch = source.match(/\}\s*else if\(importFmt==='anznz'\)\{[\s\S]{0,1300}?\n\n  \} else if\(importFmt==='bnz'\)/);
  assert.ok(anznzMatch, "the anznz import branch should exist");
  assert.match(anznzMatch[0], /row\['details'\]/, "anznz should read the 'Details' column for its description");
  assert.match(anznzMatch[0], /const rawAmt=parseFloat\(row\['amount'\]/, "anznz should read the 'Amount' column as a single signed value");

  const bnzMatch = source.match(/\}\s*else if\(importFmt==='bnz'\)\{[\s\S]{0,1300}?\n\n  \} else if\(importFmt==='westpacnz'\)/);
  assert.ok(bnzMatch, "the bnz import branch should exist");
  assert.match(
    bnzMatch[0],
    /row\['processed date'\]\|\|row\['date'\]/,
    "bnz should prefer the 'Processed Date' column over the plain 'Date' column, matching the real production converter it's sourced from"
  );
  assert.match(bnzMatch[0], /row\['payee'\]/, "bnz should read the 'Payee' column for its description");

  const westpacnzMatch = source.match(/\}\s*else if\(importFmt==='westpacnz'\)\{[\s\S]{0,1200}?\n\n  \} else if\(importFmt==='starling'\)/);
  assert.ok(westpacnzMatch, "the westpacnz import branch should exist and be immediately followed by the new starling branch");
  assert.match(
    westpacnzMatch[0],
    /row\['description'\]\|\|row\['other party'\]/,
    "westpacnz should read the 'Description' column, falling back to 'Other Party'"
  );

  const starlingMatch = source.match(/\}\s*else if\(importFmt==='starling'\)\{[\s\S]{0,1200}?\n\n  \} else if\(importFmt==='midata'\)/);
  assert.ok(starlingMatch, "the starling import branch should exist and be immediately followed by the new midata branch");
  assert.match(starlingMatch[0], /row\['counter party'\]\|\|row\['reference'\]/, "starling should read the 'Counter Party' column for its description, falling back to 'Reference'");
  assert.match(starlingMatch[0], /const rawAmt=parseFloat\(row\['amount \(gbp\)'\]/, "starling should read the 'Amount (GBP)' column as a single signed value");

  const midataMatch = source.match(/\}\s*else if\(importFmt==='midata'\)\{[\s\S]{0,2000}?\n\n  \} else if\(importFmt==='bofa'\)/);
  assert.ok(midataMatch, "the midata import branch should exist");
  assert.match(midataMatch[0], /row\['date'\]\|\|row\['transaction date'\]/, "midata should read 'Date', falling back to 'Transaction Date'");
  assert.match(midataMatch[0], /row\['merchant\/description'\]\|\|row\['description'\]/, "midata should read the 'Merchant/Description' column for its description");
  assert.match(midataMatch[0], /const rawAmt=parseFloat\(row\['debit\/credit'\]/, "midata should read the 'Debit/Credit' column as a single signed value");
});

test("parseTxFile: UK midata auto-detect is checked before the generic debit+credit check (its header contains both substrings), uses the right delimiter, and normalizeTxRow reads its real column names", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  assert.match(
    source,
    /firstLine\.includes\('merchant\/description'\)&&firstLine\.includes\('debit\/credit'\)\)\{\s*importFmt='midata';/,
    "midata auto-detect should require both 'merchant/description' and 'debit/credit', its real distinctive column pair"
  );
  const midataDetectIdx = source.indexOf("importFmt='midata'; importFmtAutoDetected=true;");
  const debitcreditDetectIdx = source.indexOf("firstLine.includes('debit')&&firstLine.includes('credit')");
  assert.ok(midataDetectIdx > -1 && debitcreditDetectIdx > -1, "both the midata and generic debit+credit auto-detect checks should exist");
  assert.ok(
    midataDetectIdx < debitcreditDetectIdx,
    "midata's auto-detect check must come before the generic debit+credit check in source order -- a midata header contains both 'debit' and 'credit' as substrings, so if the generic check ran first every midata file would be wrongly claimed as 'debitcredit'"
  );

  // Sniffs the actual detected header row (scanLines[headerLineIdx]), not
  // always text.split('\n')[0] -- updated alongside the 125th adversarial
  // pass's header-scan fix (see the preamble-row test below), which
  // surfaced a related bug: a semicolon-delimited midata file with a
  // comma-only preamble row above its real header sniffed the wrong line
  // and silently failed to split on ';'.
  assert.match(
    source,
    /const csvDelim=\(importFmt==='midata'&&\(scanLines\[headerLineIdx\]\|\|''\)\.includes\(';'\)\)\?';':',';/,
    "midata is the only format allowed a non-comma delimiter (real exports use comma or semicolon); every other format must stay comma-only"
  );
});

// Found live-testing the header-scan fix: dropping a second, unparseable
// file into an already-open import modal left the first file's preview and
// enabled Import button on screen. confirmTxImport() itself guards on
// importParsed (correctly empty), so this could never actually import
// stale data -- but the UI kept claiming a file was "ready to import" when
// nothing had actually parsed.
test("showImportPreview: the zero-transactions branch hides any stale preview/Import button left over from an earlier file in the same modal session", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");
  const zeroBranch = fnMatch[0].match(/if\(!importParsed\.length\)\{[\s\S]*?\n {4}return;\n {2}\}/);
  assert.ok(zeroBranch, "showImportPreview() should have a zero-transactions early-return branch");
  assert.match(
    zeroBranch[0],
    /getElementById\('import-preview'\)[\s\S]*?classList\.add\('hidden'\)/,
    "the zero-transactions branch should hide #import-preview, not leave a prior file's preview showing"
  );
  assert.match(
    zeroBranch[0],
    /getElementById\('import-confirm-btn'\)[\s\S]*?classList\.add\('hidden'\)/,
    "the zero-transactions branch should hide #import-confirm-btn, not leave a prior file's Import button enabled"
  );
});

// Requested by Nicholas on launch day (August 2026): the import preview
// showed transaction count/total/top-categories but not the date range
// covered, so a bank export that silently only covered part of the period
// a user expected (or the wrong account's history) wasn't obvious until
// after the data was already merged in.
test("showImportPreview: the preview stats line includes the imported date range, computed the same way confirmTxImport()'s post-import success modal already does", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");
  assert.match(
    fnMatch[0],
    /const importMonths=\[\.\.\.new Set\(importParsed\.map\(t=>t\.date\.slice\(0,7\)\)\)\]\.sort\(\);/,
    "should collect the distinct YYYY-MM months present in importParsed"
  );
  assert.match(
    fnMatch[0],
    /const dateRangeStr=importMonths\.length>1\?`\$\{fmtMonthShort\(importMonths\[0\]\)\} – \$\{fmtMonthShort\(importMonths\[importMonths\.length-1\]\)\}`:fmtMonthShort\(importMonths\[0\]\);/,
    "should format as a 'Jul '25 – Jul '26' range for multi-month imports, or a single fmtMonthShort() label for a one-month import"
  );
  assert.match(
    fnMatch[0],
    /stats\.innerHTML=`<strong[^`]*importParsed\.length[^`]*<\/strong> · <span[^`]*>\$\{esc\(dateRangeStr\)\}<\/span> ·/,
    "dateRangeStr should be escaped and rendered into the stats line, right after the transaction count"
  );
});
test("showImportPreview's date-range formula: single-month imports show one label, multi-month imports show a range, matching fmtMonthShort()'s real output", () => {
  // fmtMonthShort and MON3 are top-level `const`s (an arrow function and a
  // plain array), not `function name(){}` declarations -- loadFunctions()'s
  // extractor only pulls the latter out of trakyodollas.html (see
  // scripts/extract-testable-fns.js), so this mirrors fmtMonthShort()'s
  // exact one-line body instead. The source-pattern test just above already
  // confirms the real showImportPreview() calls the real fmtMonthShort(),
  // so this test is purely about the range-vs-single-label formula being
  // correct, not about which formatter produces the label text.
  const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtMonthShort = (ym) => { const [y, m] = ym.split('-'); return `${MON3[parseInt(m) - 1]} '${y.slice(2)}`; };
  const rangeFor = (dates) => {
    const importMonths = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
    return importMonths.length > 1
      ? `${fmtMonthShort(importMonths[0])} – ${fmtMonthShort(importMonths[importMonths.length - 1])}`
      : fmtMonthShort(importMonths[0]);
  };
  assert.equal(rangeFor(["2026-07-05", "2026-07-20", "2026-07-31"]), "Jul '26", "a single-month import should show one label, not a redundant range");
  assert.equal(rangeFor(["2025-08-01", "2026-07-31"]), "Aug '25 – Jul '26", "a multi-month import should show the earliest-to-latest range regardless of row order");
  assert.equal(rangeFor(["2026-07-31", "2025-08-01"]), "Aug '25 – Jul '26", "order in the source file shouldn't matter -- the range is derived from the full set of months, not first/last row");
});

// Three findings from live use on launch day, August 2026: the row dates in
// the preview table were hard to read, the Detected badge and the PREVIEW
// stats line both stated the transaction count (the same duplication this
// week's date-range addition made more noticeable, not something it
// introduced), and there was no way to see both ends of a large import's
// date range without trusting the summary line -- the 8-row sample only
// ever showed whichever end the file happened to list first.
test("showImportPreview: the Detected badge no longer repeats the transaction count already shown in the PREVIEW stats line", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");
  assert.match(
    fnMatch[0],
    /detFmtTxt\.textContent=`Detected: \$\{fmtLabels\[importFmt\]\|\|importFmt\}`;/,
    "the Detected badge should only name the format, not repeat the transaction count"
  );
  assert.doesNotMatch(
    fnMatch[0],
    /detFmtTxt\.textContent=`Detected: \$\{fmtLabels\[importFmt\]\|\|importFmt\} —/,
    "the Detected badge should not re-introduce a trailing '-- N transactions ready' clause"
  );
});
test("showImportPreview: the stats line's date-range/total spans use --text-muted, not the hardcoded #475569 hex removed elsewhere for failing WCAG AA; preview row dates use the higher-contrast --text-secondary", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");

  const statsLine = fnMatch[0].match(/stats\.innerHTML=`[^\n]*`;/);
  assert.ok(statsLine, "the stats.innerHTML assignment should exist");
  assert.doesNotMatch(statsLine[0], /#475569/, "the actual stats.innerHTML line should not contain the known-failing hardcoded hex color the 139th adversarial pass removed everywhere else for failing WCAG AA (1.93:1 in dark theme) -- a nearby explanatory comment mentioning it for context is fine");
  assert.match(
    fnMatch[0],
    /<span style="color:var\(--text-muted\)">\$\{esc\(dateRangeStr\)\}<\/span> · <span style="color:var\(--text-muted\)">\$\{fmtD\(total\)\} total<\/span>/,
    "both the date-range and total spans should use var(--text-muted) instead"
  );

  assert.match(
    fnMatch[0],
    /<span style="font-size:11px;color:var\(--text-secondary\);min-width:72px">\$\{esc\(t\.date\)\}<\/span>/,
    "the row date span should use --text-secondary (5.71:1 against dark theme's --bg-card, vs --text-muted's 4.78:1) -- bumped after a direct 'hard to read, too faint' report"
  );
});
// Follow-up feedback, same launch day: the single date-only oldest/newest
// toggle got replaced with real column sorting (Date/Description/Category/
// Amount, each clickable, click again to flip direction) -- e.g. sorting
// by Amount surfaces the single largest transaction in the whole import,
// not just the date-range's two ends. The stats line also moved out of
// #import-preview to sit right next to the Detected badge near the top of
// the modal, instead of below the format-picker/reset links.
test("setImportPreviewSort(): clicking a new column sorts by it with a sensible default direction; clicking the same column again flips direction", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function setImportPreviewSort\(col\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "setImportPreviewSort() should exist");
  assert.match(fnMatch[0], /if\(_importPreviewSortCol===col\)\{\s*_importPreviewSortAsc=!_importPreviewSortAsc;/, "clicking the already-active column should flip direction");
  assert.match(fnMatch[0], /_importPreviewSortCol=col;/, "clicking a different column should switch to it");
  assert.match(fnMatch[0], /_importPreviewSortAsc=\(col==='desc'\|\|col==='cat'\);/, "switching to a new column should default date/amount to descending and desc/cat to ascending");
  assert.match(fnMatch[0], /showImportPreview\(\);/, "should re-render after changing the sort");
  assert.match(source, /let _importPreviewSortCol='date';/, "should default to sorting by date");
  assert.match(source, /let _importPreviewSortAsc=false;/, "date should default to descending (newest first), matching the original single-purpose toggle's default");
  // Reset on both a fresh modal open and a new file dropped into an
  // already-open modal -- same two entry points every other per-file
  // import flag (importFmt, _importDateFmt, etc.) already resets at.
  const openModalFn = source.match(/function openTxImportModal\(\)\{[\s\S]*?\n\}/);
  assert.ok(openModalFn, "openTxImportModal() should exist");
  assert.match(openModalFn[0], /_importPreviewSortCol='date';\s*_importPreviewSortAsc=false;/, "opening the modal fresh should reset the sort column/direction");
  const parseFileFn = source.match(/function parseTxFile\(file\)\{[\s\S]*?reader\.onload=e=>\{[\s\S]{0,700}/);
  assert.ok(parseFileFn, "parseTxFile()'s reader.onload should exist");
  assert.match(parseFileFn[0], /_importPreviewSortCol='date';\s*_importPreviewSortAsc=false;/, "loading a new file into an already-open modal should also reset the sort, not carry over the prior file's setting");
});
test("showImportPreview: the 8-row sample is sorted by whichever column/direction is active, over the full importParsed set, with visible sort-direction arrows", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");
  assert.match(
    fnMatch[0],
    /date:\(a,b\)=>a\.date\.localeCompare\(b\.date\),\s*desc:\(a,b\)=>a\.desc\.localeCompare\(b\.desc\),\s*cat:\(a,b\)=>a\.cat\.localeCompare\(b\.cat\),\s*amount:\(a,b\)=>a\.amount-b\.amount,/,
    "should define a comparator for all 4 sortable columns"
  );
  assert.match(
    fnMatch[0],
    /const sorted=\[\.\.\.importParsed\]\.sort\(\(a,b\)=>\{\s*const cmp=sortCmp\[_importPreviewSortCol\]\(a,b\);\s*return _importPreviewSortAsc\?cmp:-cmp;\s*\}\);/,
    "the sample should be sorted by the active column/direction over the full importParsed array, not sliced straight from file order"
  );
  assert.match(fnMatch[0], /const sample=sorted\.slice\(0,8\);/, "the 8-row sample should come from the freshly-sorted array");
  assert.match(
    fnMatch[0],
    /arrow\.textContent=col===_importPreviewSortCol\?\(_importPreviewSortAsc\?' ▲':' ▼'\):'';/,
    "the active column's header should show a direction arrow; every other column's arrow should be cleared"
  );
});
test("the import-preview column headers exist for all 4 sortable fields, width-aligned with the row template below them", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  ["date", "desc", "cat", "amount"].forEach((col) => {
    assert.match(
      source,
      new RegExp(`data-action="setImportPreviewSort" data-arg="${col}"[^>]*>[A-Za-z]+<span id="import-sort-arrow-${col}">`),
      `the ${col} column header button should exist and wire to setImportPreviewSort('${col}')`
    );
  });
});
test("the import summary line (#import-preview-stats) now sits right after the Detected badge, not nested inside #import-preview below the format-picker/reset links", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const detectedBadgeMatch = source.match(/<div id="import-detected-fmt"[\s\S]*?<\/div>[\s\S]{0,600}?<div id="import-preview-stats"/);
  assert.ok(detectedBadgeMatch, "#import-preview-stats should immediately follow the #import-detected-fmt block in the markup");
  const previewStatsMatch = source.match(/<div id="import-preview-stats" class="hidden"/);
  assert.ok(previewStatsMatch, "#import-preview-stats should start hidden like #import-detected-fmt, since it's no longer inside #import-preview's own hidden wrapper");
  // showImportPreview() must now explicitly show/hide it itself in both
  // directions, since it's a sibling of #import-preview, not a child that
  // inherits visibility from the parent's hidden class toggling anymore.
  const fnMatch = source.match(/function showImportPreview\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "showImportPreview() should exist");
  assert.match(fnMatch[0], /stats\.classList\.remove\('hidden'\);/, "showImportPreview()'s success path should explicitly un-hide the relocated stats element");
  const zeroBranch = fnMatch[0].match(/if\(!importParsed\.length\)\{[\s\S]*?\n {4}return;\n {2}\}/);
  assert.ok(zeroBranch, "showImportPreview() should have a zero-transactions early-return branch");
  assert.match(zeroBranch[0], /staleStats\.classList\.add\('hidden'\)/, "the zero-transactions branch should also hide the relocated stats element, not just #import-preview/#import-confirm-btn");
});

// Two findings from the adversarial pass run immediately after the
// relocation/column-sort work above, both fixed same day.
test("openTxImportModal() also hides the relocated #import-preview-stats on a fresh modal open, not just #import-preview/#import-confirm-btn", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function openTxImportModal\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "openTxImportModal() should exist");
  // Moving #import-preview-stats out of #import-preview (so it could sit
  // next to the Detected badge) meant it stopped inheriting the parent's
  // hidden-class reset on modal open -- without its own explicit line
  // here, reopening the modal after a successful import left the
  // previous file's "N transactions · date range · total" text visibly
  // sitting above an otherwise-empty drop zone. Live-reproduced before
  // this fix: called openTxImportModal() with the stats element
  // deliberately left visible with stale content, confirmed it stayed
  // visible and unchanged.
  assert.match(
    fnMatch[0],
    /const stalePreviewStats=document\.getElementById\('import-preview-stats'\);\s*if\(stalePreviewStats\)stalePreviewStats\.classList\.add\('hidden'\);/,
    "openTxImportModal() should explicitly hide #import-preview-stats, matching how it already hides #import-preview and #import-detected-fmt"
  );
});
test("the import-preview category pill truncates with the shared .truncate class, so an unusually long custom category name can't blow out the row or misalign the new Amount column header", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  // addCustomCat() enforces no max length on category names, and the new
  // column-sort header (added same day) made any resulting misalignment
  // visually noticeable for the first time -- previously an unbounded-
  // width pill was harmless since there was no fixed-position header
  // label for it to drift out from under.
  assert.match(
    source,
    /<span class="truncate" style="font-size:11px;padding:1px 6px;border-radius:99px;background:\$\{getCatColor\(t\.cat\)\}22;color:\$\{getCatColor\(t\.cat\)\};max-width:100px;flex-shrink:0" title="\$\{esc\(t\.cat\)\}">\$\{esc\(t\.cat\)\}<\/span>/,
    "the category pill should use .truncate with a max-width, flex-shrink:0 (so short names stay their natural width instead of getting squeezed), and a title tooltip for the truncated case, matching this codebase's established truncation pattern"
  );
});

test("parseTxFile: ANZ NZ/BNZ/Westpac NZ/Starling/midata have mutually-exclusive auto-detect signatures, and force DD/MM date parsing when a sample is otherwise ambiguous", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /firstLine\.includes\('particulars'\)&&firstLine\.includes\('foreign'\)\)\{\s*importFmt='anznz';/,
    "ANZ NZ auto-detect should require both 'particulars' and 'foreign' (from ForeignCurrencyAmount), distinguishing it from BNZ/Westpac NZ which also have a Particulars column"
  );
  assert.match(
    source,
    /firstLine\.includes\('particulars'\)&&firstLine\.includes\('processed'\)\)\{\s*importFmt='bnz';/,
    "BNZ auto-detect should require 'processed' (from Processed Date), distinguishing it from ANZ NZ/Westpac NZ"
  );
  assert.match(
    source,
    /firstLine\.includes\('particulars'\)&&firstLine\.includes\('analysis'\)\)\{\s*importFmt='westpacnz';/,
    "Westpac NZ auto-detect should require 'analysis' (from Analysis Code), distinguishing it from ANZ NZ/BNZ"
  );
  assert.match(
    source,
    /firstLine\.includes\('counter party'\)&&firstLine\.includes\('reference'\)\)\{\s*importFmt='starling';/,
    "Starling auto-detect should require both 'counter party' and 'reference', its real distinctive column pair"
  );
  assert.match(
    source,
    /alwaysDmyFmt=\(importFmt==='anznz'\|\|importFmt==='bnz'\|\|importFmt==='westpacnz'\|\|importFmt==='starling'\|\|importFmt==='midata'\)&&detectedFmt===null/,
    "an ambiguous date sample (no day>12 in the first 15 rows) should force DD/MM for these five DD/MM-only formats instead of falling back to the US-oriented MM/DD default"
  );
});

// July 28, 2026: added a "view as table" toggle to the Flow (Sankey)
// chart, Flow-only at first. Generalized to Split/Trend/Daily too (this
// session) once an adversarial pass on the accessibility gap found all 3
// shared Flow's exact problem -- Split's SVG tiles truncate/hide labels
// when small, Trend's Chart.js <canvas> has no DOM text nodes for its
// data points at all, and Daily's calendar cells had literally no text,
// title, or aria-label anywhere (the exact spend amount only ever
// surfaced via a mouse-only #cal-tip hover, unreachable by keyboard or
// screen reader). Each of the 4 reuses the identical sr-only <table> the
// 124th adversarial pass built for Flow's screen readers -- same markup,
// same data, just swapping its class between sr-only (diagram mode) and
// .chart-data-table (table mode) -- rather than 4 separate, potentially
// drifting copies. Shared toggle/sync/export functions (below) replace
// what was originally Flow-only bespoke code (toggleSankeyTableView()).
test("_chartTableView/TABLE_VIEW_LS_KEYS: all 4 modes persist independently, sankey keeps its original localStorage key", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const TABLE_VIEW_LS_KEYS=\{sankey:'trakyo_sankey_table',split:'trakyo_split_table',trend:'trakyo_trend_table',daily:'trakyo_daily_table'\};/,
    "all 4 modes should have their own localStorage key, sankey's unchanged from before this generalization so an existing user's persisted Flow preference isn't reset"
  );
  assert.match(
    source,
    /let _chartTableView=\(\(\)=>\{\s*const v=\{\};\s*for\(const mode in TABLE_VIEW_LS_KEYS\)\{\s*try\{v\[mode\]=localStorage\.getItem\(TABLE_VIEW_LS_KEYS\[mode\]\)==='true';\}catch\(e\)\{v\[mode\]=false;\}\s*\}\s*return v;\s*\}\)\(\);/,
    "_chartTableView should restore each mode's own boolean from its own localStorage key, defaulting to false (chart view) like _sankeyTableView originally did"
  );
});

test("toggleChartTableView(): flips the current mode's own boolean, persists it, resyncs the button, and re-renders via the existing renderActiveChart() dispatcher", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function toggleChartTableView\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "toggleChartTableView() should exist");
  assert.match(fnMatch[0], /if\(!\(mode in TABLE_VIEW_LS_KEYS\)\)return;/, "should no-op outside the 4 eligible modes as a safety net");
  assert.match(fnMatch[0], /_chartTableView\[mode\]=!_chartTableView\[mode\];/, "should flip only the current mode's own entry, not a single shared boolean");
  assert.match(fnMatch[0], /localStorage\.setItem\(TABLE_VIEW_LS_KEYS\[mode\],_chartTableView\[mode\]\);/, "should persist to that mode's own key");
  assert.match(fnMatch[0], /_syncChartTableBtn\(\);/, "should resync the shared button");
  assert.match(fnMatch[0], /renderActiveChart\(\);/, "should re-render through the existing mode dispatcher rather than calling a specific render function directly");
});

test("_syncChartTableBtn(): shows/hides #chart-table-btn and #chart-table-export-btn together based on mode eligibility, syncs the toggle button's label/color to the current mode's own state", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function _syncChartTableBtn\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "_syncChartTableBtn() should exist");
  assert.match(fnMatch[0], /const eligible=mode in TABLE_VIEW_LS_KEYS;/, "eligibility should be derived from the same TABLE_VIEW_LS_KEYS map toggleChartTableView() uses, not a separate hardcoded list that could drift out of sync");
  assert.match(fnMatch[0], /btn\.style\.display=eligible\?'':'none';/, "the toggle button should show only in the 4 eligible modes");
  assert.match(fnMatch[0], /exportBtn\.style\.display=eligible\?'':'none';/, "the export button should show/hide in lockstep with the toggle button, not independently");
  assert.match(fnMatch[0], /const active=_chartTableView\[mode\];/, "label/color sync should read the CURRENT mode's own entry, not a stale single boolean");
});

// Each of the 4 render functions builds the identical table unconditionally
// (sr-only in chart-view, visible in table-view) and skips its own visual
// chart entirely when that mode's table-view is active, matching
// renderSankey()'s original established pattern -- no accessibility loss
// either way, and table-view mode never wastes work building a diagram/
// chart nobody can see.
for (const [renderFn, tableViewKey, tableVarName] of [
  ["renderSankey", "sankey", "flowTableHtml"],
  ["renderTreemap", "split", "tmTableHtml"],
  ["renderDailyCal", "daily", "dailyTableHtml"],
]) {
  test(`${renderFn}(): swaps its table between sr-only and .chart-data-table based on _chartTableView.${tableViewKey}, and skips its own visual chart entirely in table-view mode`, () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
    const fnMatch = source.match(new RegExp(`function ${renderFn}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
    assert.ok(fnMatch, `${renderFn}() should exist`);
    assert.match(
      fnMatch[0],
      new RegExp(`class="\\$\\{_chartTableView\\.${tableViewKey}\\?'chart-data-table':'sr-only'\\}"`),
      `${renderFn}()'s table should swap classes based on _chartTableView.${tableViewKey}`
    );
    assert.match(
      fnMatch[0],
      new RegExp(`if\\(_chartTableView\\.${tableViewKey}\\)\\{[\\s\\S]{0,200}?return;\\s*\\}`),
      `${renderFn}() should return early in table-view mode, before building its own visual chart`
    );
  });
}

// Found from a direct question comparing all 7 Spending-breakdown views:
// Flow was the only one with a standalone title ("PERIOD -> INCOME TO
// SPENDING FLOW") above its diagram. On inspection it was mostly
// redundant -- the date range it restated is already shown once,
// persistently, by the page-level date-range picker above all 7 views,
// and "what this is" is already the selected "Flow" tab label directly
// above it. The one piece of context a title alone provided -- that the
// numbers are summed across multiple months, not a single point in time,
// since a Sankey diagram (unlike Trend's labeled bars or Daily's dated
// cells) has no axis or per-cell dates to infer that from -- already
// lives on the Income node's own label ("Nmo income"), independent of
// the title. Removed rather than added to the other 6.
test("renderSankey() no longer builds a standalone period/title label above the diagram -- the Income node's own '${monthCount}mo income' label already carries the duration context a title provided", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderSankey\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderSankey() should exist");
  assert.doesNotMatch(fnMatch[0], /periodLabelHtml/, "periodLabelHtml (the standalone title div) should no longer exist");
  assert.doesNotMatch(fnMatch[0], /INCOME → SPENDING FLOW/, "the title text itself should be gone");
  assert.match(fnMatch[0], /name:`\$\{monthCount\}mo income`/, "the Income node's own label should still carry the multi-month duration context the removed title used to also state");
  assert.match(fnMatch[0], /if\(_chartTableView\.sankey\)\{\s*wrap\.innerHTML=flowTableHtml;\s*return;\s*\}/, "table-view mode should render just the table now, with no title prefix");
});

test("renderSpendChart()'s trend branch: same table/skip-chart pattern as the other 3, but writes into #trend-table-wrap rather than replacing its own wrap (Trend's canvas is a persistent element, unlike the other 3's self-owned wrap divs)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const trendMatch = source.match(/\} else if\(state\.chartMode==='trend'\)\{[\s\S]*?\n  \} else if\(state\.chartMode==='vendor'\)\{/);
  assert.ok(trendMatch, "the trend branch of renderSpendChart() should exist");
  assert.match(trendMatch[0], /class="\$\{_chartTableView\.trend\?'chart-data-table':'sr-only'\}"/, "the trend table should swap classes based on _chartTableView.trend");
  assert.match(trendMatch[0], /document\.getElementById\('trend-table-wrap'\)/, "should target trend-table-wrap, not spend-chart-wrap (which holds the persistent <canvas> Chart.js attaches to)");
  assert.match(trendMatch[0], /if\(_chartTableView\.trend\)\{[\s\S]{0,150}?return;\s*\}/, "should return early in table-view mode, before building the Chart.js instance");
  assert.doesNotMatch(trendMatch[0].split(/if\(_chartTableView\.trend\)\{[\s\S]{0,150}?return;\s*\}/)[0], /new Chart\(/, "no Chart.js construction should happen before the table-view early return");
});

test("Daily's table lists only days with spend (matching the stats bar's own 'N days with spend'), not one row per calendar day", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderDailyCal\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderDailyCal() should exist");
  assert.match(
    fnMatch[0],
    /Object\.entries\(byDay\)\.filter\(\(\[,v\]\)=>v>0\)\.sort\(\(a,b\)=>a\[0\]\.localeCompare\(b\[0\]\)\)\.map/,
    "the table's rows should filter byDay to spend>0 entries, sorted chronologically, not iterate every calendar day in range"
  );
});

// Found from a direct question comparing the table's date format against
// every other CSV export in this file -- txToCsvRow()/exportNetWorthCSV()
// both use the raw YYYY-MM-DD string with no reformatting, since it's what
// actually sorts correctly as plain text in a spreadsheet and round-trips
// unambiguously across locales (no US MM/DD vs. rest-of-world DD/MM
// guessing). Daily's table was the only one that broke that convention
// with a "Sat, Feb 1, 2025" string. Split into two columns rather than
// dropping weekday entirely -- Day still lets someone eyeball the pattern
// behind the Weekends stat card above the table without cross-referencing
// a calendar themselves.
test("Daily's table splits Date (raw YYYY-MM-DD, matching every other CSV export in this file) and Day (weekday name) into their own columns, not one combined human-readable string", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderDailyCal\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderDailyCal() should exist");
  assert.match(
    fnMatch[0],
    /<th scope="col">Date<\/th><th scope="col">Day<\/th><th scope="col">Amount<\/th><th scope="col">Transactions<\/th>/,
    "the table should have 4 columns in this order: Date, Day, Amount, Transactions"
  );
  assert.match(
    fnMatch[0],
    /<tr><td>\$\{esc\(d\)\}<\/td><td>\$\{esc\(dayName\)\}<\/td>/,
    "Date should render the raw `d` key (YYYY-MM-DD) unformatted, with weekday in its own separate Day cell"
  );
  assert.match(
    fnMatch[0],
    /const dayName=new Date\(d\+'T12:00:00'\)\.toLocaleDateString\('default',\{weekday:'short'\}\);/,
    "the table's own Day cell should format only the weekday, not the old combined month/day/year string (that combined format is still legitimately used elsewhere in this function, by #cal-tip's hover tooltip, so a whole-function negative check would be a false positive there)"
  );
});

test("Split's table reflects whichever level the treemap itself is currently on (top-level categories vs. drillCat's vendors), matching the breadcrumb", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderTreemap\(drillCat\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderTreemap() should exist");
  assert.match(
    fnMatch[0],
    /<th scope="col">\$\{drillCat\?'Vendor':'Category'\}<\/th>/,
    "the table's first column header should say Vendor when drilled in, Category otherwise"
  );
  assert.match(
    fnMatch[0],
    /const tmTableRows=data\.map\(d=>\{/,
    "the table's rows should be built from the same `data` array the diagram itself renders (top-level catTotals or drillCat's catVendors), so table view can never contradict the breadcrumb above it"
  );
});

// Export: each of the 4 tables is already built unconditionally (sr-only
// or visible), so export doesn't require switching to table view first --
// reads straight from whichever table's own cells, guaranteeing the
// export always matches exactly what's on screen (or what a screen
// reader hears), with no separate data-shaping code to keep in sync.
test("exportChartTable()/exportTableCSV(): maps each of the 4 modes to the wrapper its table actually lives in, and reuses the existing downloadCSVFile()/csvSafeField()/todayDateStr() helpers rather than reinventing CSV escaping", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const CHART_TABLE_WRAP_IDS=\{sankey:'sankey-wrap',split:'treemap-wrap',trend:'trend-table-wrap',daily:'daily-cal-wrap'\};/,
    "should map all 4 modes to their table's actual containing wrapper -- trend-table-wrap for Trend specifically, not spend-chart-wrap"
  );
  const exportFnMatch = source.match(/function exportChartTable\(\)\{[\s\S]*?\n\}/);
  assert.ok(exportFnMatch, "exportChartTable() should exist");
  assert.match(exportFnMatch[0], /CHART_TABLE_WRAP_IDS\[state\.chartMode\]/, "should look up the wrapper id for the CURRENT chart mode");
  const csvFnMatch = source.match(/function exportTableCSV\(tableEl,filenameBase\)\{[\s\S]*?\n\}/);
  assert.ok(csvFnMatch, "exportTableCSV(tableEl, filenameBase) should exist as the shared generic export, taking any table element");
  assert.match(csvFnMatch[0], /csvSafeField\(td\.textContent\)/, "cell values should go through the existing csvSafeField() (CSV-injection guard + quote escaping), not a new ad-hoc escape");
  assert.match(csvFnMatch[0], /downloadCSVFile\(`trak-yo-dollas-\$\{filenameBase\}-\$\{todayDateStr\(\)\}\.csv`,headers,rows\)/, "should trigger the download through the existing shared downloadCSVFile() helper, matching every other CSV export in this file");
  assert.match(csvFnMatch[0], /if\(!rows\.length\)\{showToast\('No data to export'/, "should toast rather than silently no-op when the table has no data rows (including when tableEl itself is null, e.g. Flow's own 'no income set up' empty state never built a table at all)");
});

test("HTML: #chart-table-btn and #chart-table-export-btn exist, dispatch through the standard data-action mechanism, and #trend-table-wrap exists as Trend's dedicated table container", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /id="chart-table-btn" data-action="toggleChartTableView"/, "the toggle button should exist with the generalized id/action");
  assert.match(source, /id="chart-table-export-btn" data-action="exportChartTable"/, "the export button should exist alongside it");
  assert.match(source, /<div id="trend-table-wrap" style="display:none"><\/div>/, "trend-table-wrap should exist as its own sibling container, separate from spend-chart-wrap's persistent <canvas>");
});

test("setChartMode(): calls _syncChartTableBtn() in all 4 branches (daily/split/sankey/fallthrough) instead of the old hardcoded per-branch button visibility, and shows trend-table-wrap whenever mode is trend", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function setChartMode\(mode\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "setChartMode() should exist");
  const syncCount = (fnMatch[0].match(/_syncChartTableBtn\(\);/g) || []).length;
  assert.equal(syncCount, 4, "_syncChartTableBtn() should be called once per branch (daily, split, sankey, and the category/vendor/source/trend fallthrough)");
  assert.match(fnMatch[0], /if\(trendTableWrap\)trendTableWrap\.style\.display=mode==='trend'\?'block':'none';/, "trend-table-wrap should be shown whenever mode is trend, independent of table vs. chart view, so its sr-only copy stays reachable to screen readers even in chart view");
});

// Found live-testing on dev: toggleChartTableView() re-renders through
// renderActiveChart(), which never goes through setChartMode() at all (that
// function has side effects -- resetting filters etc. -- correct for an
// actual mode switch but wrong for a same-mode view toggle). setChartMode()
// was the ONLY place chartBorder/chartWrap/chart-texture-btn's visibility
// got set based on Trend's table-view state, so clicking "View as table"
// while already on Trend left the canvas's now-empty bordered box and the
// Patterns button both still visible underneath the table. Fixed by having
// renderSpendChart()'s own trend branch own that visibility on every
// render, regardless of entry path, rather than relying on setChartMode()
// alone -- setChartMode()'s own copy of this logic was removed as
// redundant once renderSpendChart() (called synchronously right after)
// became the actual source of truth.
test("renderSpendChart()'s trend branch owns chartBorder/chartWrap/chart-texture-btn's visibility itself (not just setChartMode()), so toggling table view while already on Trend actually hides the empty canvas underneath", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const trendMatch = source.match(/\} else if\(state\.chartMode==='trend'\)\{[\s\S]*?\n  \} else if\(state\.chartMode==='vendor'\)\{/);
  assert.ok(trendMatch, "the trend branch of renderSpendChart() should exist");
  assert.match(trendMatch[0], /trendChartBorder\.style\.display=_chartTableView\.trend\?'none':'';/, "should hide spend-chart-border based on the CURRENT _chartTableView.trend, not a value computed once elsewhere");
  assert.match(trendMatch[0], /trendChartWrap\.style\.display=_chartTableView\.trend\?'none':'';/, "should hide spend-chart-wrap (the canvas's own container) the same way");
  assert.match(trendMatch[0], /trendTextureBtn\.style\.display=_chartTableView\.trend\?'none':'';/, "should hide chart-texture-btn (Patterns toggle) the same way -- it's meaningless once there's no chart to apply a fill pattern to");
  // setChartMode()'s own copy of this logic should be gone now that
  // renderSpendChart() (called synchronously right after, in the same
  // function) is the real source of truth -- leaving both would just be
  // dead, confusing duplication.
  const setChartModeMatch = source.match(/function setChartMode\(mode\)\{[\s\S]*?\n\}/);
  assert.doesNotMatch(setChartModeMatch[0], /trendTableActive/, "setChartMode() should no longer compute or reference trendTableActive -- that logic now lives solely in renderSpendChart()'s trend branch");
});

// Found live-testing the original Flow-only toggle: the page-load "restore
// last chart mode" block is a separate, narrower mirror of setChartMode()
// (can't just call setChartMode() itself at init -- it has side effects,
// like resetting activeDate/activeVendors/treemapDrillCat, that are
// correct for a real user click but wrong for restoring persisted state).
// That mirror only ever synced the wrapper divs, never the secondary
// buttons -- so reloading on a persisted daily/split/sankey/trend mode
// showed the wrong secondary button until the user manually re-clicked a
// tab. Now shares _syncChartTableBtn() with setChartMode() itself rather
// than hand-duplicating the sync logic a 3rd time.
test("the page-load chart-mode restore block also syncs chart-texture-btn/cal-transfers-btn/the table-view buttons (via the shared _syncChartTableBtn()), and trend-table-wrap/trendTableActive, not just the wrapper divs", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const restoreBlockMatch = source.match(/\/\/ Restore last chart mode \(spending tab\)[\s\S]{0,3000}?\n  \}catch\(e\)\{\}/);
  assert.ok(restoreBlockMatch, "the chart-mode restore block should exist");
  const block = restoreBlockMatch[0];
  assert.match(block, /const trendTableActive=savedMode==='trend'&&_chartTableView\.trend;/, "should compute the same trendTableActive setChartMode() does");
  assert.match(block, /if\(ttw\)ttw\.style\.display=savedMode==='trend'\?'block':'none';/, "should sync trend-table-wrap's visibility to the restored mode");
  assert.match(block, /modeTextureBtn\.style\.display=\(isCanvas&&!trendTableActive\)\?'':'none';/, "should sync chart-texture-btn's visibility, also accounting for trendTableActive now");
  assert.match(block, /modeTransfersBtn\.style\.display=\(savedMode==='daily'&&!state\.excludedCats\.has\('Transfers'\)\)\?'':'none';/, "should sync cal-transfers-btn's visibility to the restored mode, matching setChartMode()'s own daily-only condition");
  assert.match(block, /_syncChartTableBtn\(\);/, "should resync the table-view buttons through the same shared function setChartMode() uses, not a hand-duplicated 3rd copy");
});

// Found July 29, 2026: a demo session saved to localStorage before a demo
// data edit (e.g. the Nov'24-Jan'25 trim) stayed stale forever after --
// hard refresh reloads the page's code, not already-saved localStorage
// state, and loadDemoProfile() only ever auto-runs when localStorage is
// completely empty. Fixed with a version stamp compared on load, mirroring
// sw.js's own cache-version pattern, guarded so it can never touch real
// user data.
test("demo data is version-stamped, persisted, and silently refreshed on load if stale", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /const DEMO_DATA_VERSION='\d{4}-\d{2}-\d{2}';/, "DEMO_DATA_VERSION should be declared as a dated constant");
  assert.match(source, /demoDataVersion: state\.demoDataVersion\?\?null,\s*activeDemoProfileNum: state\.activeDemoProfileNum\?\?null,/, "serializeState() should persist both new fields");
  assert.match(source, /state\.demoDataVersion=saved\.demoDataVersion\?\?null;\s*state\.activeDemoProfileNum=saved\.activeDemoProfileNum\?\?null;/, "loadFromLocalStorage() should restore both new fields");
  assert.match(source, /state\.demoDataVersion=DEMO_DATA_VERSION;\s*state\.activeDemoProfileNum=n;/, "loadDemoProfile() should stamp the current version and the profile number that was actually loaded");
  // The init block's third branch: only fires for an already-saved, still-demo,
  // version-stamped session whose stamp no longer matches -- never for real
  // user data (guarded on !state.hasRealData) and never for a pre-this-fix
  // demo session with no stamp at all (guarded on activeDemoProfileNum being
  // truthy, so those just fall through unrefreshed rather than misfiring).
  assert.match(
    source,
    /\}else if\(hadSavedData&&!state\.hasRealData&&state\.activeDemoProfileNum&&state\.demoDataVersion!==DEMO_DATA_VERSION\)\{/,
    "the init block should gate the auto-refresh on saved+demo+stamped+stale, in that combination"
  );
  assert.match(
    source,
    /loadDemoProfile\(state\.activeDemoProfileNum, true, true\); \/\/ silent \+ skipRender — renderAll fires below\s*\n\s*requestAnimationFrame\(\(\)=>showToast\('🔄 Demo data refreshed to the latest version'/,
    "the stale-demo branch should reload the same profile number that was active, silently, then tell the user it happened"
  );
});

// ── check-cloudsync-coverage.py flagged 5 fields as persisted locally
// (serializeState()) but missing from syncToCloud()'s savePrefs() payload --
// the same "real preference, never synced" gap already fixed for nwGoal/
// excludedCats/budgetWarnPct/currency in earlier passes. All 5 are set via a
// deliberate user action (the chart-grain toggle, the range chips/date
// pickers, checkSourceAlignment()'s own resolution), not incidental view
// state, and loadFromLocalStorage()/importBackup() already restored all 5 --
// only the cloud-sync path was missing them. Found August 2026. ──
test("syncToCloud()/loadUserData() sync and restore chartGrain/rangeFrom/rangeTo/sourceAlignSkipped/sourceAlignDate, closing check-cloudsync-coverage.py's advisory", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");

  const syncSrc = source.match(/async function syncToCloud\(\) \{[\s\S]{0,4800}?\n\}/)?.[0] || "";
  assert.match(syncSrc, /chartGrain: state\.chartGrain,/, "syncToCloud() should include chartGrain in the savePrefs() payload");
  assert.match(syncSrc, /rangeFrom: state\.rangeFrom,/, "syncToCloud() should include rangeFrom");
  assert.match(syncSrc, /rangeTo: state\.rangeTo,/, "syncToCloud() should include rangeTo");
  assert.match(syncSrc, /sourceAlignSkipped: state\.sourceAlignSkipped,/, "syncToCloud() should include sourceAlignSkipped");
  assert.match(syncSrc, /sourceAlignDate: state\.sourceAlignDate,/, "syncToCloud() should include sourceAlignDate");

  const loadSrc = source.match(/async function loadUserData\(uid\) \{[\s\S]{0,17300}?\n  \} catch/)?.[0] || "";
  assert.match(
    loadSrc,
    /if \(prefs\.chartGrain !== undefined\) state\.chartGrain = prefs\.chartGrain \?\? 'month';/,
    "loadUserData() should restore chartGrain, defaulting to 'month' like the other two restore paths"
  );
  assert.match(
    loadSrc,
    /if \(prefs\.rangeFrom !== undefined\) state\.rangeFrom = prefs\.rangeFrom \?\? null;/,
    "loadUserData() should restore rangeFrom"
  );
  assert.match(
    loadSrc,
    /if \(prefs\.rangeTo !== undefined\) state\.rangeTo = prefs\.rangeTo \?\? null;/,
    "loadUserData() should restore rangeTo"
  );
  assert.match(
    loadSrc,
    /if \(prefs\.sourceAlignSkipped !== undefined\) state\.sourceAlignSkipped = !!prefs\.sourceAlignSkipped;/,
    "loadUserData() should restore sourceAlignSkipped, boolean-coerced like the other two restore paths"
  );
  assert.match(
    loadSrc,
    /if \(prefs\.sourceAlignDate !== undefined\) state\.sourceAlignDate = typeof prefs\.sourceAlignDate === 'string' \? prefs\.sourceAlignDate : null;/,
    "loadUserData() should restore sourceAlignDate, type-guarded to a string like the other two restore paths"
  );
});

// Found from a direct question about whether two people could safely share
// one login to get "household" access to the same synced data: the prefs
// row (the user's ENTIRE cloud-synced state) was a blind upsert with no
// merge, no version check, nothing -- whichever debounced syncToCloud()
// landed last silently won, overwriting anyone else's more recent changes
// with no warning. Not just a hypothetical household-sharing risk: the
// identical bug already existed for a single person using their own
// account on two devices (phone + laptop) at once. Fixed with optimistic
// concurrency: savePrefs() takes expectedUpdatedAt/newUpdatedAt and does
// one atomic conditional UPDATE (.eq('updated_at', expectedUpdatedAt))
// instead of a blind upsert -- 0 rows matched means the row moved since
// our last load, so the caller can tell "someone wrote first" apart from
// a real error without a separate check-then-write step that would leave
// its own race window. loadUserData() caches the baseline on every
// successful load (including null for a brand-new user, which correctly
// means "nothing to conflict with yet"); syncToCloud() blocks the push and
// warns once (not on every subsequent debounced attempt) when it's stale.
test("_fb.savePrefs(): takes an expected/new updated_at pair and does an atomic conditional UPDATE (not a blind upsert) whenever a baseline exists, falling back to upsert only when there isn't one yet", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/async savePrefs\(uid, prefs, expectedUpdatedAt, newUpdatedAt\) \{[\s\S]*?\n  \},/);
  assert.ok(fnMatch, "savePrefs(uid, prefs, expectedUpdatedAt, newUpdatedAt) should exist with this signature");
  assert.match(
    fnMatch[0],
    /if \(expectedUpdatedAt\) \{/,
    "should branch on whether a baseline exists"
  );
  assert.match(
    fnMatch[0],
    /\.update\(\{ data: encrypted, updated_at: newUpdatedAt \}\)\s*\.eq\('user_id', uid\)\.eq\('updated_at', expectedUpdatedAt\)\s*\.select\('updated_at'\);/,
    "with a baseline, should do one atomic conditional UPDATE scoped to both user_id and the expected updated_at, not a separate check-then-write"
  );
  assert.match(
    fnMatch[0],
    /return !!\(data && data\.length\);/,
    "should return false (not throw) when the conditional UPDATE matched 0 rows, so the caller can distinguish 'someone wrote first' from a real error"
  );
  assert.match(
    fnMatch[0],
    /const \{ error \} = await _sb\.from\('prefs'\)\.upsert\(\{\s*user_id: uid, data: encrypted, updated_at: newUpdatedAt\s*\}, \{ onConflict: 'user_id' \}\);/,
    "without a baseline (brand-new user, nothing to conflict with), should fall back to the plain upsert, still with its explicit onConflict target"
  );
});

test("_fb.loadPrefs(): also selects and returns updated_at alongside the decrypted data, so callers get the sync baseline in the same round-trip instead of a second query", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/async loadPrefs\(uid\) \{[\s\S]*?\n  \},/);
  assert.ok(fnMatch, "loadPrefs() should exist");
  assert.match(fnMatch[0], /\.select\('data, updated_at'\)/, "should select updated_at alongside data in the same query");
  assert.match(fnMatch[0], /return \{ data: null, updatedAt: null \};/, "should return updatedAt:null (not just data:null) when no row exists, matching 'nothing to conflict with' semantics");
  assert.match(fnMatch[0], /return \{ data: prefs, updatedAt: row\.updated_at \};/, "should return the row's updated_at alongside the decrypted prefs");
});

test("loadUserData() caches _cloudPrefsUpdatedAt from every successful load (even a null one, for a brand-new user) and resets _syncConflictWarned, so a fresh load is what actually recovers from a detected conflict", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const loadSrc = source.match(/async function loadUserData\(uid\) \{[\s\S]{0,17300}?\n  \} catch/)?.[0] || "";
  assert.match(
    loadSrc,
    /const \{ data: prefs, updatedAt: _loadedUpdatedAt \} = await window\._fb\.loadPrefs\(uid\);/,
    "should destructure loadPrefs()'s new {data, updatedAt} shape"
  );
  assert.match(
    loadSrc,
    /_cloudPrefsUpdatedAt = _loadedUpdatedAt;\s*_syncConflictWarned = false;/,
    "should set the baseline and clear the warned flag unconditionally, before the `if (prefs)` branch -- a brand-new user's null updatedAt is a valid baseline (nothing to conflict with), not a case to skip"
  );
});

test("syncToCloud(): passes the cached baseline and a fresh timestamp to savePrefs(), and when it reports the row already moved, blocks the push, warns once (not on every debounced retry), and leaves the local save (already done by scheduleSave()) untouched", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const syncSrc = source.match(/async function syncToCloud\(\) \{[\s\S]{0,4800}?\n\}/)?.[0] || "";
  assert.match(syncSrc, /const newUpdatedAt = new Date\(\)\.toISOString\(\);/, "should generate the new timestamp itself, not rely on savePrefs() to generate one internally");
  assert.match(syncSrc, /const wrote = await window\._fb\.savePrefs\(user\.uid, \{/, "should capture savePrefs()'s boolean result");
  assert.match(syncSrc, /\}, _cloudPrefsUpdatedAt, newUpdatedAt\);/, "should pass the cached baseline and the new timestamp as the trailing arguments");
  assert.match(
    syncSrc,
    /if \(!wrote\) \{\s*if \(!_syncConflictWarned\) \{\s*_syncConflictWarned = true;\s*showSyncConflictBanner\(\);/,
    "should warn only the first time a conflict is detected, not on every subsequent blocked attempt"
  );
  assert.match(syncSrc, /return;\s*\}\s*_cloudPrefsUpdatedAt = newUpdatedAt;/, "should return early on conflict (skipping the baseline update and the 'Saved' flash) and only advance the baseline after a confirmed successful write");
});

test("signing out resets _cloudPrefsUpdatedAt/_syncConflictWarned, so a stale baseline from whoever was signed in before can't leak into the next sign-in on the same tab", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /window\._awaitingCloudMerge = false;\s*\/\/ Not required for correctness[\s\S]{0,700}?_cloudPrefsUpdatedAt = null;\s*_syncConflictWarned = false;/,
    "the sign-out branch of onAuthStateChange should reset both, right alongside its existing _awaitingCloudMerge reset"
  );
});

// Found from a direct question comparing this modal's confirm-input against
// the Clear all data modal's ("should we be clear that case does not
// matter?"), then a follow-up asking for consistency between the two.
// Originally, confirmForgotPassphraseReset() uppercased the typed value and
// compared to 'RESET' -- functionally case-insensitive same as
// validateClearConfirm()'s lowercase-and-compare-to-'clear', but the two
// modals normalized in opposite directions for no reason, and this one's
// label/error text prompted "RESET" in caps -- worse, the error text
// explicitly (and falsely) claimed "(all caps)" was required. Both now
// lowercase before comparing and prompt lowercase, matching each other,
// while still silently accepting any case typed.
test("confirmForgotPassphraseReset(): lowercases before comparing (matching validateClearConfirm()'s style) and prompts/errors in lowercase, with no claim of a case requirement", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/async function confirmForgotPassphraseReset\(\) \{[\s\S]{0,3100}?\n\}/);
  assert.ok(fnMatch, "confirmForgotPassphraseReset() should exist");
  assert.match(fnMatch[0], /resetInput\.value\.trim\(\)\.toLowerCase\(\)/, "should lowercase the typed value before comparing, matching validateClearConfirm()'s own normalization direction");
  assert.match(fnMatch[0], /if \(typed !== 'reset'\) \{ showResetError\('Type reset to confirm\.'\); return; \}/, "should compare against and prompt lowercase 'reset', not uppercase 'RESET'");
  assert.doesNotMatch(source, /Type RESET to confirm/, "the old uppercase label/error text should be gone from the file entirely");
  assert.match(source, /<label class="form-label" for="sync-pp-reset-input">Type reset to confirm<\/label>/, "the modal's own label should also prompt lowercase, not just the error text");
  // Folded in from a since-removed test that otherwise just re-verified, via
  // a negative regex, what the positive assertions above already prove --
  // this is the one piece of that test with standalone value: the only
  // place in the file that checks validateClearConfirm()'s own comparison
  // direction, confirming it matches rather than opposes this fix's.
  assert.match(
    source,
    /function validateClearConfirm\(val\)\{[\s\S]*?val\.trim\(\)\.toLowerCase\(\)===['"]clear['"]/,
    "validateClearConfirm() should lowercase before comparing to 'clear', the same direction confirmForgotPassphraseReset() now uses"
  );
});

// Found from a direct question about why the sync passphrase couldn't be
// verified before submitting: unlike a regular sign-in password (muscle
// memory, or sitting in a password manager already), this is a one-off
// secret the user has to get exactly right while typing it blind -- and
// the warning directly below the field says a typo here means permanently,
// unrecoverably losing synced data, with no reset path. Added a shared
// Show/Hide toggle rather than a per-field one, since sync-pp-confirm only
// ever exists alongside sync-pp-input during first-time setup -- nobody
// wants to reveal one but not the other in the same breath.
//
// First version put the toggle as a plain text link up in the label row --
// technically present and correctly rendered (verified in devtools), but
// easy to miss entirely, since a quiet 11px muted-gray link floating above
// the field looks nothing like the near-universal eye-icon-inside-the-
// field convention every other password field uses. Found from a second,
// separate direct question after the first fix still wasn't discoverable
// live. Moved inside the input itself as an absolutely-positioned icon
// button. The eye glyph itself doesn't change between states (no widely-
// supported "eye with slash" emoji) -- the masked/unmasked text right next
// to it already signals which mode it's in -- but the accessible label
// does update, so a screen reader always hears the action the next press
// will take rather than a static, sometimes-wrong "Show".
//
// Reset to hidden every time the modal freshly opens (promptSyncPassphrase()),
// so a previous session's "revealed" state can't linger into the next.
test("toggleSyncPassphraseVisibility(): renders as an icon button inside the input (not a text link above it), toggles sync-pp-input and sync-pp-confirm together, updates the accessible label to reflect the next action, and promptSyncPassphrase() resets everything on every fresh open", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div style="position:relative">\s*<input type="password" id="sync-pp-input"[\s\S]{0,400}?<button type="button" id="sync-pp-visibility-btn" data-action="toggleSyncPassphraseVisibility" aria-label="Show passphrase" title="Show passphrase"[\s\S]{0,200}?>👁<\/button>/,
    "the toggle should be an icon button absolutely positioned inside the same wrapper as sync-pp-input, not a text link in the label row above it"
  );
  const fnMatch = source.match(/function toggleSyncPassphraseVisibility\(_, btn\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "toggleSyncPassphraseVisibility() should exist");
  assert.match(fnMatch[0], /input\.type = newType;/, "should set sync-pp-input's type");
  assert.match(fnMatch[0], /if \(confirmInput\) confirmInput\.type = newType;/, "should set sync-pp-confirm's type too, in the same call -- not a separate toggle a user has to click twice");
  assert.match(fnMatch[0], /btn\.setAttribute\('aria-label', label\);/, "should update the accessible label to reflect whichever action comes next, since the eye glyph itself doesn't change");
  const promptMatch = source.match(/async function promptSyncPassphrase\(uid\) \{[\s\S]{0,3000}?visBtn\.setAttribute\('title', 'Show passphrase'\); \}/);
  assert.ok(promptMatch, "promptSyncPassphrase() should exist");
  assert.match(promptMatch[0], /input\.type = 'password';/, "should reset the main field to hidden on every fresh open");
  assert.match(promptMatch[0], /if \(confirmInput\) confirmInput\.type = 'password';/, "should reset the confirm field to hidden too");
  assert.match(promptMatch[0], /visBtn\.setAttribute\('aria-label', 'Show passphrase'\);/, "should reset the toggle's accessible label back to 'Show passphrase', not leave it reading 'Hide' from a previous session");
});

// Finding: the sync-passphrase modal's description paragraph (11px, via the
// shared .modal-sub class) and its "we never see this passphrase" warning
// box (11px) both fell below this app's own established 12px legibility
// floor -- and this is the one modal where getting the words actually read
// matters most, since it's explaining an unrecoverable, one-way action.
// Scoped to just this modal's own instances rather than raising .modal-sub
// itself, which 9 other modals also share and haven't been individually
// reviewed here. Found from a direct question about the modal's text
// feeling small overall.
test("The sync-passphrase modal's description and warning-box text are 12px, not 11px, matching this app's established legibility floor", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<p class="modal-sub" id="sync-pp-desc" style="margin-bottom:\.75rem;font-size:12px"><\/p>/,
    "sync-pp-desc should override .modal-sub's 11px default with an explicit 12px"
  );
  assert.match(
    source,
    /<span style="font-size:12px;font-weight:700;color:var\(--amber-text-strong\)">We never see this passphrase/,
    "the warning box's own text should be 12px, not the old 11px"
  );
});

test("syncToCloud()'s conflict guard shows a persistent, dismissible banner instead of an auto-dismissing toast", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div id="sync-conflict-banner" role="alert" style="display:none[^"]*">/,
    "the banner should exist in the DOM, hidden by default"
  );
  assert.match(
    source,
    /<button data-action="reloadForSyncConflict"[^>]*>Reload now<\/button>/,
    "the banner should offer a one-click reload, the actual recovery step"
  );
  assert.match(
    source,
    /<button data-action="dismissSyncConflictBanner"[^>]*title="Dismiss"[^>]*>✕<\/button>/,
    "the banner should be dismissible, unlike the demo-preview banner it sits next to"
  );
  const fnMatch = source.match(/function showSyncConflictBanner\(\)\{[\s\S]{0,200}?\n\}/);
  assert.ok(fnMatch, "showSyncConflictBanner() should be defined");
  assert.match(fnMatch[0], /style\.display\s*=\s*'block'/, "should unhide the banner element");
  const dismissMatch = source.match(/function dismissSyncConflictBanner\(\)\{[\s\S]{0,100}?\n\}/);
  assert.ok(dismissMatch, "dismissSyncConflictBanner() should be defined");
  assert.match(dismissMatch[0], /hideSyncConflictBanner\(\)/, "dismissing should delegate to the same hide helper used on recovery");
  assert.doesNotMatch(
    source,
    /showToast\('⚠ Your synced data changed on another device/,
    "the old auto-dismissing toast call should be fully replaced, not left alongside the banner"
  );
});

test("the sync-conflict banner is hidden on every recovery path that also resets _syncConflictWarned (a fresh load, and sign-out)", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const resets = [...source.matchAll(/(?<!let )_syncConflictWarned = false;/g)];
  assert.strictEqual(resets.length, 2, "expected exactly two _syncConflictWarned=false resets (fresh load, sign-out), excluding the initial `let` declaration");
  for (const m of resets) {
    const after = source.slice(m.index, m.index + 120);
    assert.match(after, /hideSyncConflictBanner\(\);/, "every _syncConflictWarned reset should hide the banner too, or a stale conflict warning could survive the exact moment it's meant to be resolved");
  }
});

// ── The banner initially shipped in normal document flow, like every other
// top banner in this file (#demo-preview-banner, #offline-banner, etc) --
// but unlike those, it's meant to stay visible for as long as the
// underlying "your edits aren't syncing" condition holds, which can span
// plenty of scrolling on a page with hundreds of transactions. A quick
// manual test caught it: the banner scrolled away after the very first
// scroll tick, same as any other normal-flow element, defeating the whole
// point of making it persistent instead of a toast in the first place. ──
test("the sync-conflict banner is position:fixed (so it survives scrolling, unlike every other top banner) and pushes .nav/body down via updateBannerOffset() to avoid overlapping it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const bannerMatch = source.match(/<div id="sync-conflict-banner" role="alert" style="([^"]+)">/);
  assert.ok(bannerMatch, "the banner element should exist");
  assert.match(bannerMatch[1], /position:fixed;top:0;left:0;right:0;/, "should be taken out of normal document flow so scrolling can't carry it away");
  const navZIndexMatch = source.match(/\.nav\{[^}]*z-index:(\d+)/);
  const bannerZIndexMatch = bannerMatch[1].match(/z-index:(\d+)/);
  assert.ok(navZIndexMatch && bannerZIndexMatch, "both .nav and the banner should declare a z-index");
  assert.ok(
    Number(bannerZIndexMatch[1]) > Number(navZIndexMatch[1]),
    "the banner's z-index should be higher than .nav's, so it renders above the nav it's meant to sit on top of, not underneath it"
  );
  const offsetFnMatch = source.match(/function updateBannerOffset\(\)\{[\s\S]{0,1500}?\n\}/);
  assert.ok(offsetFnMatch, "updateBannerOffset() should be defined");
  assert.match(
    offsetFnMatch[0],
    /const conflictBanner=document\.getElementById\('sync-conflict-banner'\);/,
    "should also measure the sync-conflict banner, not just the pre-existing (and always-empty) #demo-chip"
  );
  assert.match(
    offsetFnMatch[0],
    /conflictBanner\.offsetHeight/,
    "should factor the conflict banner's real rendered height into the offset, since fixed positioning takes it out of flow and nothing else would push .nav/body down for it"
  );
  const showFn = source.match(/function showSyncConflictBanner\(\)\{[\s\S]{0,200}?\n\}/)?.[0] || "";
  const hideFn = source.match(/function hideSyncConflictBanner\(\)\{[\s\S]{0,200}?\n\}/)?.[0] || "";
  assert.match(showFn, /updateBannerOffset\(\);/, "showing the banner should immediately recompute the nav/body offset, not wait for a resize");
  assert.match(hideFn, /updateBannerOffset\(\);/, "hiding the banner (including via dismiss, which delegates to this) should recompute the offset back down, or nav/body would keep the gap after the banner is gone");
});

// ── A self-review pass on the fix above caught this: the original guard
// was `if(!banner||!nav)return` where `banner` is #demo-chip -- an element
// nothing ever populates with content (always 0 height), an easy target
// for a future cleanup pass to remove outright. If it were ever removed,
// that guard would silently short-circuit the whole function on an
// unrelated null check, breaking the sync-conflict banner's own offset
// with zero visible connection between the two. Caught before it shipped,
// not after. ──
test("updateBannerOffset() only requires .nav to exist -- #demo-chip and the sync-conflict banner are each independently optional, so removing one can't silently break the other's offset", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const offsetFnMatch = source.match(/function updateBannerOffset\(\)\{[\s\S]{0,1500}?\n\}/);
  assert.ok(offsetFnMatch, "updateBannerOffset() should be defined");
  assert.match(offsetFnMatch[0], /if\(!nav\)return;/, "the early-return guard should check only nav, not #demo-chip");
  assert.doesNotMatch(offsetFnMatch[0], /if\(!banner\|\|!nav\)return;/, "should no longer bail the whole function when #demo-chip alone is missing");
  assert.match(
    offsetFnMatch[0],
    /banner&&banner\.style\.display!=='none'\?banner\.offsetHeight:0/,
    "#demo-chip's own height should be computed independently (0 if missing or hidden), not gate the function's early return"
  );
});

// ── Two more #334155-as-text instances found sweeping for the same
// contrast-failure shape #475569 turned out to have (both measured well
// under WCAG AA's 4.5:1: 1.41:1/1.47:1 for the NW-goal milestone chip,
// 1.41:1/2.54:1 for the hidden-pill label, dark/light respectively) --
// neither was ever part of the #475569 sweep since #334155 is a distinct
// hex value. Found August 2026. ──
test("the NW-goal milestone chip and pill-customizer hidden-pill label no longer use #334155 as text color", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /color:\$\{isReached\?tc\('#8595A8','#64748B'\):isSelected\?'#fff':tc\('#64748B','#374151'\)\};/,
    "the NW-goal milestone chip's isReached text color should use the same proven-safe muted pair as the rest of this session's #475569 fixes"
  );
  assert.match(
    source,
    /color:\$\{hidden\?tc\('#8595A8','#64748B'\):'var\(--text-primary\)'\}/,
    "the pill-customizer's hidden-pill label color should use the same proven-safe muted pair"
  );
  assert.doesNotMatch(
    source.replace(/\/\/.*#334155.*/g, ""), // strip explanatory comments that legitimately mention the old hex
    /color:\$\{isReached\?tc\('#334155'|color:\$\{hidden\?tc\('#334155'/,
    "neither site should still use #334155 as a text color"
  );
});

// ── "Vehicle" in the generic Add Account modal's Type dropdown (f-type)
// created a permanently invisible ghost account: renderAccountLists()
// blanket-excludes type==='vehicle' from the Financial Assets list (a
// deliberate exclusion, since the Physical Assets flow is supposed to be
// the only path for them), but renderVehicles() (Physical Assets) renders
// exclusively from state.vehicles, which only saveVehicle() populates --
// never saveAccount(). An account created here had no matching
// state.vehicles entry, so it rendered in neither list, had no reachable
// Edit/Delete button anywhere, and still fully counted in
// netWorth()/totalAssets() (both just sum state.accounts). Found from a
// direct question about why "Vehicle" appeared in both flows, August 2026. ──
test("the Add Account modal's Type dropdown no longer offers \"Vehicle\", which had no working render path outside the dedicated vehicle modal", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fTypeMatch = source.match(/<select id="f-type"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(fTypeMatch, "the f-type select should exist");
  assert.doesNotMatch(
    fTypeMatch[1],
    /<option value="vehicle">/,
    "f-type should no longer offer a \"Vehicle\" option -- renderAccountLists() blanket-excludes type==='vehicle' from Financial Assets, and renderVehicles() (Physical Assets) only ever reads state.vehicles, which saveAccount() never populates, so an account created with this type rendered nowhere while still counting toward net worth"
  );
  // Home/Mortgage/other-asset etc. should still all be present -- this
  // should only have removed the one problematic option, not regressed
  // the rest of the dropdown.
  assert.match(fTypeMatch[1], /<option value="home">Home<\/option>/, "Home should still be an option");
  assert.match(fTypeMatch[1], /<option value="mortgage">Mortgage<\/option>/, "Mortgage should still be an option");
  assert.match(fTypeMatch[1], /<option value="other-asset">Other asset<\/option>/, "Other asset should still be an option");
});

// ── Closes the same "invisible ghost account" bug class at its second
// entry point: a hand-crafted or corrupted backup/cloud-sync payload could
// set an account's type to 'vehicle' directly, bypassing the dropdown
// entirely (now removed) and saveVehicle()'s pairing. Found August 2026. ──
test("_reclassifyOrphanedVehicleAccounts: reclassifies a vehicle-type account with no matching state.vehicles record to 'other-asset', leaving genuinely-paired ones (both modern acctId and legacy type+name matches) untouched", () => {
  const state = {
    accounts: [
      { id: 1, type: "vehicle", name: "2021 Honda CR-V" },   // paired via acctId
      { id: 2, type: "vehicle", name: "Legacy Boat" },        // paired via legacy type+name match
      { id: 3, type: "vehicle", name: "Orphaned Ghost" },     // no matching vehicle at all
      { id: 4, type: "cash", name: "Checking" },              // unrelated, must be untouched
    ],
    vehicles: [
      { id: 101, acctId: 1, name: "2021 Honda CR-V" },
      { id: 102, acctId: null, name: "Legacy Boat" },
    ],
  };
  const { _reclassifyOrphanedVehicleAccounts: run } = loadFunctions(
    ["_reclassifyOrphanedVehicleAccounts", "isPairedAccount"],
    { state }
  );
  run();
  assert.equal(state.accounts.find(a => a.id === 1).type, "vehicle", "the acctId-paired vehicle account should stay type:'vehicle'");
  assert.equal(state.accounts.find(a => a.id === 2).type, "vehicle", "the legacy type+name-paired vehicle account should stay type:'vehicle'");
  assert.equal(state.accounts.find(a => a.id === 3).type, "other-asset", "the orphaned vehicle-type account (no matching state.vehicles record) should be reclassified to 'other-asset'");
  assert.equal(state.accounts.find(a => a.id === 4).type, "cash", "an unrelated account type should be untouched");
});
test("_reclassifyOrphanedVehicleAccounts() is called after both state.accounts and state.vehicles are restored, in loadUserData()/loadFromLocalStorage()/importBackup()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /if \(Array\.isArray\(prefs\.vehicles\)\) state\.vehicles = _arrOfObj\(prefs\.vehicles\);\s*\n\s*_reclassifyOrphanedVehicleAccounts\(\);/,
    "loadUserData() should call _reclassifyOrphanedVehicleAccounts() right after restoring state.vehicles"
  );
  assert.match(
    source,
    /state\.vehicles=Array\.isArray\(saved\.vehicles\)\?_arrOfObj\(saved\.vehicles\):state\.vehicles;\s*\n\s*_reclassifyOrphanedVehicleAccounts\(\);/,
    "loadFromLocalStorage() should call _reclassifyOrphanedVehicleAccounts() right after restoring state.vehicles"
  );
  assert.match(
    source,
    /state\.vehicles=_arrOfObj\(saved\.vehicles\);\s*\n\s*_reclassifyOrphanedVehicleAccounts\(\);/,
    "importBackup() should call _reclassifyOrphanedVehicleAccounts() right after restoring state.vehicles"
  );
});

// ── Zillow/Redfin (both US-only) were the only real-estate valuation
// sources in #f-source, despite this same dropdown already supporting
// UK/Canada/Australia/NZ bank institutions -- a non-US user adding a Home
// account had no locally-relevant option and fell back to generic
// "Other". Added the closest known equivalent per market: Zoopla (UK),
// Domain (Australia), homes.co.nz (NZ), and -- after a follow-up web
// search specifically to confirm both are real, current services before
// shipping a factual claim to real users -- Zolo (Canada, a national
// "Home Value Estimator") and SRX/its "X-Value" tool (Singapore, used to
// price 1.8m+ homes/year). Found August 2026. ──
test("#f-source includes Zoopla/Domain/homes.co.nz/Zolo/SRX alongside Zillow/Redfin, each with a matching SC_M color pair and SA_M abbreviation", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fSourceMatch = source.match(/<select id="f-source">([\s\S]*?)<\/select>/);
  assert.ok(fSourceMatch, "the f-source select should exist");
  for (const name of ["Zoopla", "Domain", "homes.co.nz", "Zolo", "SRX"]) {
    assert.match(fSourceMatch[1], new RegExp(`<option>${name.replace(/\./g, "\\.")}</option>`), `f-source should offer "${name}"`);
  }
  const scMatch = source.match(/const SC_M=\{[\s\S]*?\};/);
  assert.ok(scMatch, "SC_M should exist");
  assert.match(scMatch[0], /Domain:\{bg:tc\('#2E1065','#EDE9FE'\),fg:tc\('#A78BFA','#7C3AED'\)\}/, "SC_M should have a color pair for Domain");
  assert.match(scMatch[0], /'homes\.co\.nz':\{bg:tc\('#065F46','#ECFDF5'\),fg:tc\('#34D399','#059669'\)\}/, "SC_M should have a color pair for homes.co.nz");
  assert.match(scMatch[0], /Zoopla:\{bg:tc\('#7C2D12','#FFF7ED'\),fg:tc\('#FB923C','#EA580C'\)\}/, "SC_M should have a color pair for Zoopla");
  assert.match(scMatch[0], /Zolo:\{bg:tc\('#065F46','#ECFDF5'\),fg:tc\('#34D399','#059669'\)\}/, "SC_M should have a color pair for Zolo");
  assert.match(scMatch[0], /SRX:\{bg:tc\('#1E3A5F','#EFF6FF'\),fg:tc\('#60A5FA','#2563EB'\)\}/, "SC_M should have a color pair for SRX");
  const saMatch = source.match(/const SA_M=\{[\s\S]*?\};/);
  assert.ok(saMatch, "SA_M should exist");
  assert.match(saMatch[0], /Domain:'DM'/, "SA_M should abbreviate Domain");
  assert.match(saMatch[0], /'homes\.co\.nz':'HZ'/, "SA_M should abbreviate homes.co.nz");
  assert.match(saMatch[0], /Zoopla:'ZP'/, "SA_M should abbreviate Zoopla");
  assert.match(saMatch[0], /Zolo:'ZO'/, "SA_M should abbreviate Zolo");
  assert.match(saMatch[0], /SRX:'SX'/, "SA_M should abbreviate SRX");
});

// ── #f-source showed the full ~40-bank list regardless of #f-type, even
// though a bank like Chase or Ally will never own a home -- only the 7
// dedicated real-estate valuation sources (Zillow, Redfin, Zoopla, Domain,
// homes.co.nz, Zolo, SRX) plus "Other" are ever relevant once Type is set
// to Home. Filtering to just those on Type=Home removes real noise with no
// downside, unlike the other types (a bank like Ally spans both Cash and
// Investment, so filtering those would as often hide the institution
// someone's looking for as help them find it). updateSourceOptionsForType()
// is DOM-only (no return value) -- checking the source pattern directly,
// matching this suite's precedent for DOM-mutation-only functions (see
// openAddModal(), 87th adversarial pass). Requested directly by Nicholas,
// August 2026. ──
test("updateSourceOptionsForType() filters #f-source to real-estate sources only when #f-type is Home, wired via data-change and called from both openAddModal() and editAccount()", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<select id="f-type" data-change="updateSourceOptionsForType">/,
    "#f-type should call updateSourceOptionsForType() on change, so switching Type live re-filters #f-source"
  );
  const fnMatch = source.match(/function updateSourceOptionsForType\(\)\{[\s\S]{0,700}?\n\}/);
  assert.ok(fnMatch, "updateSourceOptionsForType() should exist");
  assert.match(
    fnMatch[0],
    /REAL_ESTATE_SOURCES\.map\(s=>`<option>\$\{s\}<\/option>`\)\.join\(''\)\+'<option>Other<\/option>'/,
    "when #f-type is 'home', #f-source's options should be replaced with just the real-estate sources plus Other"
  );
  assert.match(
    source,
    /const REAL_ESTATE_SOURCES=\['Domain','homes\.co\.nz','Redfin','SRX','Zillow','Zolo','Zoopla'\];/,
    "REAL_ESTATE_SOURCES should list all 7 dedicated real-estate valuation sources currently in #f-source"
  );
  assert.match(
    source,
    /const ft=document\.getElementById\('f-type'\);if\(ft\)ft\.selectedIndex=0;updateSourceOptionsForType\(\);const fs=document\.getElementById\('f-source'\);if\(fs\)fs\.value='Other';/,
    "openAddModal() should set #f-type first, then filter #f-source, so a fresh Add-account open isn't left showing a stale filtered list from a prior Home-type session"
  );
  assert.match(
    source,
    /document\.getElementById\('f-type'\)\.value=a\.type;updateSourceOptionsForType\(\);document\.getElementById\('f-source'\)\.value=a\.source;/,
    "editAccount() should set #f-type before filtering #f-source, then set #f-source's value after filtering, so editing an existing Home account shows the filtered list with its actual institution still correctly selected"
  );
});

// ── The vehicle "Check value" link had two gaps: (1) it always pointed at
// kbb.com regardless of where the user actually is, even though KBB is
// verified US-only (Canada's KBB was discontinued after being folded into
// Autotrader.ca; there's no UK edition; kbb.com.au doesn't even resolve --
// its only real AU product turned out to be a dealer-only login tool, not
// a public site) -- verified via web search before shipping, same
// caution this app already applies to real-estate-institution brand
// claims. (2) it only ever appeared transiently inside #v-vin-status right
// after a fresh, successful VIN lookup -- editVehicle() clears that same
// status field to blank on every reopen, so editing an existing vehicle
// (the common case) showed no valuation link in the modal at all, only
// from the physical-assets list row. Added a #v-region selector (US
// default, so pre-existing vehicles with no stored region keep pointing
// at KBB exactly as before) and a persistent #v-valuation-link area that
// updates live from year/make/model/region, wired into both modal-open
// paths and saveVehicle()'s persistence. Requested directly by Nicholas,
// August 2026. ──
test("vehicle valuation links are region-aware (US/CA/AU/UK) and persistently visible in the modal, not just after a fresh VIN lookup", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<select id="v-region" data-change="updateVehicleValuationLink"><option value="US" selected>United States<\/option><option value="CA">Canada<\/option><option value="AU">Australia<\/option><option value="UK">United Kingdom<\/option><option value="Other">Other<\/option><\/select>/,
    "#v-region should offer US (default)/Canada/Australia/UK/Other"
  );
  assert.match(
    source,
    /<div id="v-valuation-link"/,
    "the vehicle modal should have a persistent #v-valuation-link area, separate from the VIN-lookup-only #v-vin-status"
  );
  const vmMatch = source.match(/const VALUATION_M=\{[\s\S]*?\n\};/);
  assert.ok(vmMatch, "VALUATION_M should exist");
  assert.match(vmMatch[0], /US:\{label:'Kelley Blue Book',url:\(y,mk,mo\)=>`https:\/\/www\.kbb\.com\/\$\{encodeURIComponent\(String\(mk\|\|''\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g,'-'\)\)\}\/\$\{encodeURIComponent\(String\(mo\|\|''\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g,'-'\)\)\}\/\$\{y\}\/`\}/, "VALUATION_M.US should keep the original kbb.com/{make}/{model}/{year}/ deep-link pattern");
  assert.match(vmMatch[0], /CA:\{label:'Canadian Black Book'/, "VALUATION_M.CA should point at Canadian Black Book");
  assert.match(vmMatch[0], /AU:\{label:'RedBook'/, "VALUATION_M.AU should point at RedBook, not kbb.com.au (unresolvable) or the dealer-only MarketLens product");
  assert.match(vmMatch[0], /UK:\{label:'Parkers'/, "VALUATION_M.UK should point at Parkers");
  assert.match(
    source,
    /const vr=document\.getElementById\('v-region'\);if\(vr\)vr\.value='US';\s*updateVehicleValuationLink\(\);/,
    "openVehicleModal() should reset #v-region to US and refresh the valuation link on every fresh open, so a stale filtered region from a prior vehicle can't leak into a new one"
  );
  assert.match(
    source,
    /const vr=document\.getElementById\('v-region'\);if\(vr\)vr\.value=v\.region\|\|'US';/,
    "editVehicle() should restore the vehicle's own stored region (defaulting to US for pre-existing vehicles saved before this field existed)"
  );
  const editVehicleMatch = source.match(/function editVehicle\(id\)\{[\s\S]*?\n\}/);
  assert.ok(editVehicleMatch, "editVehicle() should exist");
  assert.match(editVehicleMatch[0], /updateVehicleValuationLink\(\);/, "editVehicle() should refresh the valuation link so it's visible immediately on reopen, not just after a fresh VIN lookup");
  const saveVehicleMatch = source.match(/function saveVehicle\(\)\{[\s\S]*?\n\}/);
  assert.ok(saveVehicleMatch, "saveVehicle() should exist");
  assert.match(saveVehicleMatch[0], /region=\(document\.getElementById\('v-region'\)\|\|\{\}\)\.value\|\|'US';/, "saveVehicle() should read #v-region");
  assert.match(saveVehicleMatch[0], /Object\.assign\(v,\{year,make,model,condition,miles,value,vin,assetType,name,region\}\);/, "editing an existing vehicle should persist the updated region");
  assert.match(saveVehicleMatch[0], /state\.vehicles\.push\(\{id:vehId,year,make,model,condition,miles,value,vin,assetType,name,acctId,region\}\);/, "creating a new vehicle should persist its region");
  assert.match(
    source,
    /data-action="openValuationLink" data-arg="\$\{esc\(String\(v\.year\)\)\}" data-arg2="\$\{esc\(v\.make\|\|''\)\}" data-arg3="\$\{esc\(String\(v\.model\|\|''\)\.split\(' '\)\[0\]\)\}" data-region="\$\{esc\(v\.region\|\|'US'\)\}"[^>]*>🔍 Check value on \$\{esc\(valuationInfo\(v\.region\|\|'US'\)\.label\)\} ↗<\/a>/,
    "the physical-assets list row should pass the vehicle's own region and swap the link label to match (not hardcode 'Kelley Blue Book' regardless of destination)"
  );
});

// ── Purchase price and Purchase year (and the "% value retained"/$X-per-
// year depreciation stat they drove) were cut from the vehicle modal --
// nobody's tracking their car's depreciation closely enough to justify
// two extra fields on every single add, and Est. Value alone already
// drives net worth with nothing else depending on them. Purchase Year was
// also quietly doing double duty as the fallback "year" for Other-asset
// entries (boats, jewelry, etc., which have no #v-year field of their
// own) -- that now falls back to the current year instead. Requested
// directly by Nicholas, August 2026. ──
test("Purchase price/year fields are gone from the vehicle modal; Other-asset entries fall back to the current year instead of a removed Purchase Year field", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(source, /id="v-purchase"/, "#v-purchase should no longer exist");
  assert.doesNotMatch(source, /id="v-purchase-year"/, "#v-purchase-year should no longer exist");
  assert.doesNotMatch(source, /\.depn-bg|\.depn-fill/, "the now-meaningless depreciation progress bar's CSS should be removed too, not left dead");
  const saveVehicleMatch = source.match(/function saveVehicle\(\)\{[\s\S]{0,7900}?closeModals\(\);renderAll\(\);\n\}/);
  assert.ok(saveVehicleMatch, "saveVehicle() should exist");
  assert.doesNotMatch(saveVehicleMatch[0], /v-purchase/, "saveVehicle() should no longer read #v-purchase/#v-purchase-year");
  assert.match(
    saveVehicleMatch[0],
    /if\(!oName\)return;name=oName;make=oCat;model='';year=new Date\(\)\.getFullYear\(\);condition='good';miles=0;assetType='other';/,
    "an Other-asset entry's year should fall back to the current year, not a removed purchaseYear variable"
  );
});

// ── Legibility sweep, Dashboard tier: the earlier modal-wide legibility
// pass (12-13px floor) never touched the Dashboard ("Net Worth" tab)
// itself -- its demo-data notices, the trend-chart's interpolate/
// extrapolate explanation, and the snapshot section's own demo/monthly-
// nudge notices were all still sitting at 10-11px, the same class of
// "genuine reading paragraph, not a badge/label" issue the shared
// .info-box fix (Accounts tab) addressed. Left short link/button labels
// ("Track a goal →", "Hide goal tracking") and the metric cards'
// deliberately-small uppercase eyebrow labels alone -- those are a
// different, legitimate small-text category the earlier sweep also never
// touched. The "+ Add historical" button was a separate, smaller find: an
// inline font-size:10px override matching the *mobile* .btn-sm size even
// on desktop, one size below its sibling "+ Save snapshot" button (11px
// desktop) for no reason -- removed so it just inherits .btn-sm like its
// sibling. Requested directly by Nicholas, August 2026. ──
test("Dashboard tier of the legibility sweep: demo notices and the trend-chart explanation are at least 12px, and the '+ Add historical' button matches its sibling's size", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const dashMatch = source.match(/<div class="page" id="page-dashboard">[\s\S]*?\n<\/div>\n\n<!-- ACCOUNTS -->/);
  assert.ok(dashMatch, "the Dashboard page block should exist");
  const dash = dashMatch[0];
  assert.match(dash, /id="demo-notice-dash"[\s\S]{0,200}?<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">Demo data/, "#demo-notice-dash's paragraph text should be at least 12px");
  assert.match(dash, /id="nw-chart-note" style="font-size:12px/, "#nw-chart-note's interpolate/extrapolate explanation should be at least 12px");
  assert.match(dash, /id="snap-demo-notice"[\s\S]{0,200}?<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">Demo snapshots/, "#snap-demo-notice's paragraph text should be at least 12px");
  assert.match(dash, /id="snap-monthly-nudge"[\s\S]{0,200}?<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">💡 No snapshot yet this month/, "#snap-monthly-nudge's paragraph text should be at least 12px");
  assert.match(
    dash,
    /<button class="btn btn-sm" data-action="openHistoricalSnapshotModal"[^>]*style="color:var\(--accent-blue-light\);border-color:#2563EB44"[^>]*>\+ Add historical<\/button>/,
    "the '+ Add historical' button should no longer force the mobile-only 10px size on desktop, so it matches its '+ Save snapshot' sibling"
  );
});

// ── Legibility sweep, Tier 1 (highest-traffic pages): Spending is the
// default landing tab, so its Insights pills' explanatory sub-lines --
// the savings-rate nudge, the subscriptions stat line, and the "nothing
// needs attention" positive empty state -- were the highest-impact
// leftover from the Dashboard-only pass above. Bundled in the Accounts
// tab's own remaining "Demo accounts" notice (10px), the sibling of the
// two already-fixed via .info-box and #demo-notice-dash, since it's the
// same paragraph-notice pattern. Left the pills' own uppercase eyebrow
// labels ("Savings rate", "Subscriptions", "⚑/✓ Worth your attention")
// alone -- same deliberate small-label design chrome excluded from the
// Dashboard tier. Requested directly by Nicholas, August 2026. ──
test("Legibility sweep Tier 1: Spending tab's Insights sub-lines and the Accounts tab's remaining demo notice are at least 12px", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /id="demo-notice-accounts"[\s\S]{0,200}?<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">Demo accounts/,
    "#demo-notice-accounts's paragraph text should be at least 12px"
  );
  const insightsMatch = source.match(/function renderInsights\(\)\{[\s\S]*?\n\}/);
  assert.ok(insightsMatch, "renderInsights() should exist");
  const insights = insightsMatch[0];
  assert.match(insights, /<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.35">See what % of your income you save each month<\/div>/, "the savings-rate nudge's explanatory line should be at least 12px");
  assert.match(insights, /<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.35">That's \$\{fmtC\(subTotal\*12\)\}\/yr/, "the subscriptions pill's stat line should be at least 12px");
  assert.match(insights, /<div style="font-size:12px;color:var\(--text-secondary\);margin-top:3px;line-height:1\.45">Nothing needs attention right now\. Nice work\.<\/div>/, "the positive empty-state subtitle should be at least 12px");
  // The eyebrow labels immediately beside/above each of these should be
  // untouched -- still 9-10px, confirming this pass targeted only the
  // reading-paragraph lines, not the deliberately-small section labels.
  assert.match(insights, /<span style="font-size:10px;font-weight:700;color:var\(--text-muted\)">Savings rate<\/span>/, "the 'Savings rate' eyebrow label should remain untouched");
  assert.match(insights, /<div style="font-size:9px;font-weight:800;color:var\(--accent-green\);letter-spacing:\.08em;text-transform:uppercase;padding:0 2px">✓ Worth your attention<\/div>/, "the '✓ Worth your attention' eyebrow label should remain untouched");
});

// ── Legibility sweep, Tier 2 (held from Tier 1 per Nicholas's request):
// the Income Setup modal ("💰 Income & savings rate") turned out to hold
// every remaining find, not just the 2 originally spotted -- its intro
// blurb, both Method A/B descriptions, the auto-detect preview card, and
// the live savings-rate preview's stat line were all still 11px. Bumped
// all 5 to 12px, matching the floor the rest of this sweep settled on. ──
test("Legibility sweep Tier 2: every remaining 11px paragraph line in the Income Setup modal is at least 12px", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const modalMatch = source.match(/<div class="modal-overlay hidden" id="income-modal">[\s\S]*?\n<\/div>\n\n<!-- Flow chart declared income modal -->/);
  assert.ok(modalMatch, "the Income Setup modal block should exist");
  const modal = modalMatch[0];
  assert.match(modal, /<p style="font-size:12px;color:var\(--text-muted\);background:var\(--bg-card\);border-radius:8px;padding:\.5rem \.75rem;margin-bottom:1rem;line-height:1\.5">Once saved, your savings rate will appear/, "the intro blurb should be at least 12px");
  assert.match(modal, /<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">Most accurate\. Enter your monthly after-tax income/, "Method A's description should be at least 12px");
  assert.match(modal, /<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.5">Scans your imported transactions for deposits/, "Method B's description should be at least 12px");
  assert.match(modal, /<div id="income-auto-preview" class="hidden" style="margin-top:\.65rem;background:var\(--bg-card\);border-radius:8px;padding:\.5rem \.75rem;font-size:12px;color:var\(--text-secondary\);line-height:1\.6"><\/div>/, "#income-auto-preview's container should be at least 12px, so its 'Detected $X/mo...' content inherits that instead of 11px");
  const previewFnMatch = source.match(/function updateIncomePreview\(incomeVal\)\{[\s\S]*?\n\}/);
  assert.ok(previewFnMatch, "updateIncomePreview() should exist");
  assert.match(previewFnMatch[0], /<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.6">\$\{fmt\(saved\)\} kept of \$\{fmt\(incomeVal\)\} take-home/, "the live preview's stat line should be at least 12px");
});

// ── The Accounts tab's Financial assets/Liabilities lists were flat --
// every row repeated its type in a "Institution · Type" sub-line (e.g.
// "Zillow · Real estate") even though the Net Worth tab's own "Where your
// wealth lives" breakdown already groups the exact same accounts by that
// same type, one page over. Rebuilt renderAccountLists() to group by type
// the same way (same labels/colors/order, so a category reads the same
// color on both tabs), which let the redundant per-row type text be
// dropped in favor of moving the institution onto the name's own line
// instead -- one line per account instead of two. No 'Vehicles' group
// here (unlike Net Worth's breakdown) since vehicle-type accounts are
// already blanket-excluded to the separate Physical assets section.
// Requested directly by Nicholas, August 2026. ──
test("renderAccountLists: groups Financial assets/Liabilities by type (matching renderNwBreakdown()'s labels/colors), drops the per-row type suffix, and skips empty groups", () => {
  const accounts = [
    { id: 1, type: "investment", name: "401k", source: "Fidelity", balance: 1000 },
    { id: 2, type: "cash", name: "Checking", source: "Chase", balance: 500 },
    { id: 3, type: "credit", name: "Visa", source: "Chase", balance: 200 },
    { id: 4, type: "mortgage", name: "Mortgage", source: "Other", balance: 9000 },
    // A legacy/invalid type value (predates saveAccount()'s validity guard,
    // see the 30th adversarial pass) -- must still render somewhere rather
    // than silently vanishing the way a strict type==='other-asset' match
    // would drop it.
    { id: 5, type: "loan", name: "Old Student Loan Account", source: "Other", balance: 300 },
  ];
  const { ctx, getAssetHTML, getLiabHTML } = renderAccountListsCtx([], accounts);
  const { renderAccountLists } = loadFunctions(["renderAccountLists", "isPairedAccount"], ctx);
  renderAccountLists();
  const assetHTML = getAssetHTML();
  const liabHTML = getLiabHTML();
  assert.match(assetHTML, /Investments/, "should render an Investments group");
  assert.match(assetHTML, /Cash/, "should render a Cash group");
  assert.match(assetHTML, /Other assets/, "the legacy 'loan' type should fall back into Other assets, not vanish");
  assert.doesNotMatch(assetHTML, /Real estate/, "an empty group (no home-type accounts) should be skipped entirely, not rendered with zero rows");
  assert.doesNotMatch(assetHTML, /class="account-sub"/, "rows should no longer render the old two-line account-sub (institution · type) markup");
  assert.match(assetHTML, /<span class="account-inst">Fidelity<\/span>/, "institution should render inline via .account-inst, not a separate sub-line");
  assert.match(liabHTML, /Liabilities/, "should render a single Liabilities group");
  assert.match(liabHTML, /Visa/, "the credit-type account should be in the Liabilities group");
  assert.match(liabHTML, /Mortgage/, "the mortgage-type account should be in the same Liabilities group, not sub-split further");
});

// Finding: a first-time user who imports a CSV without adding any accounts
// (a normal path -- the import-success modal explicitly calls adding an
// account "totally optional") landed on the Accounts tab with "Financial
// assets" and "Liabilities" headers rendering with nothing under them --
// no different-looking from a rendering bug. renderVehicles()'s "No
// physical assets yet." already handled this correctly one panel over.
test("renderAccountLists: zero accounts shows 'No financial accounts yet'/'No liabilities yet' instead of a blank section under each header", () => {
  const { ctx, getAssetHTML, getLiabHTML } = renderAccountListsCtx([], []);
  const { renderAccountLists } = loadFunctions(["renderAccountLists", "isPairedAccount"], ctx);
  renderAccountLists();
  assert.match(getAssetHTML(), /No financial accounts yet/, "empty Financial assets should show an explanatory empty state");
  assert.match(getLiabHTML(), /No liabilities yet/, "empty Liabilities should show an explanatory empty state");
});

// ── User-friendliness pass, August 2026 -- a batch of 5 findings from a
// hands-on walkthrough of the live app with fresh demo data, none of them
// caught by prior bug-hunting passes since nothing here was incorrect,
// just unclear or silent. ──

// Finding: saveAccount()'s !name||!type guard used to fail completely
// silently -- no toast, no highlighted field, nothing telling the user
// why Save wasn't working. Confirmed live: clicking Save on an empty Add
// Account form left the modal open with zero visible feedback.
test("saveAccount: shows an error toast when name or type is missing, instead of failing silently", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function saveAccount\(\)\{[\s\S]{0,4100}?closeModals\(\);renderAll\(\);\}/);
  assert.ok(fnMatch, "saveAccount() should exist");
  assert.match(
    fnMatch[0],
    /if\(!name\|\|!type\)\{\s*showToast\(!name\?'Enter an account name':'Choose an account type','#F87171',4000\);\s*return;\s*\}/,
    "saveAccount() should show an error toast naming the missing field, matching the established error-toast color used elsewhere (e.g. saveEditTx()'s invalid-date guard)"
  );
});

// Finding: renderNwBreakdown() rendered every group in GROUPS regardless
// of whether it had any accounts -- confirmed live, a user with zero
// other-asset-type accounts still saw an "Other assets -- 0.0% of assets
// -- $0" header with nothing under it, reading like something was broken
// rather than "you have none of these."
test("renderNwBreakdown: skips empty groups instead of rendering a bare '$0' header with no accounts under it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderNwBreakdown\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderNwBreakdown() should exist");
  assert.match(
    fnMatch[0],
    /const visible=\(f==='assets'\?GROUPS\.filter\(g=>g\.label!=='Liabilities'\):f==='liabilities'\?GROUPS\.filter\(g=>g\.label==='Liabilities'\):GROUPS\)\.filter\(g=>g\.accts\.length\);/,
    "the visible groups list should be filtered to only groups with at least one account"
  );
});

// Finding: the group-skipping fix above still left one gap -- a user with
// ZERO accounts of any type (every group empty, not just one) saw the
// "Where your wealth lives" section header with a fully blank body under
// it, since visible.map([]).join('') is just ''. Confirmed live: import a
// CSV without adding any accounts and the Net Worth tab shows this exact
// state.
test("renderNwBreakdown: a fully-empty accounts list shows 'No accounts yet' instead of a blank body under 'Where your wealth lives'", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderNwBreakdown\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "renderNwBreakdown() should exist");
  assert.match(
    fnMatch[0],
    /if\(!visible\.length\)\{[\s\S]*?No accounts yet[\s\S]*?return;\s*\}/,
    "renderNwBreakdown() should short-circuit to an explanatory empty state when every group is empty"
  );
});

// Finding: #insights-pills forced exactly repeat(4,1fr) above 600px with
// no minimum floor per column -- at medium widths (601-999px, a
// plausible split-screen/smaller-laptop range) this compressed pills
// below what their content needs. Confirmed live at a ~917px viewport:
// scrollWidth (1069px) exceeded clientWidth (842px), with a "4/10" stat
// visibly cut to "4/1" and a whole pill's caption clipped off-screen.
test("#insights-pills uses auto-fit/minmax on desktop instead of a rigid 4-column grid with no minimum width", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /@media\(min-width:601px\)\{#insights-pills\{grid-template-columns:repeat\(auto-fit,minmax\(300px,1fr\)\)!important\}\}/,
    "the desktop breakpoint should use auto-fit/minmax so column count adapts to available width instead of forcing exactly 4"
  );
  assert.doesNotMatch(source, /grid-template-columns:repeat\(4,1fr\)/, "the rigid 4-equal-column rule should be gone entirely");
});

// Finding: the Net Worth tab's snapshot rows used a "✕" for delete, while
// Budget's category rows use a "🗑️" for the identical action -- both had
// proper confirmation dialogs and title tooltips, so not a safety issue,
// just an inconsistent visual language for the same action across tabs.
test("deleteSnapshot's button uses the same 🗑️ delete icon as removeBudget, not a mismatched ✕", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /data-action="deleteSnapshot" data-arg="\$\{i\}"[^>]*title="Delete snapshot" type="button">🗑️<\/button>/,
    "the snapshot row's delete button should use 🗑️, matching removeBudget's icon for the same action"
  );
});

// Finding: the Add Vehicle modal's Year/Make/Model fields had no
// placeholder example text, unlike the VIN field directly above them
// (which shows "E.G. 1FMCU9J96NUB12345") -- an inconsistency within the
// same modal.
test("the Add Vehicle modal's Year/Make/Model fields have example placeholder text, matching the VIN field's convention", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(source, /id="v-year" placeholder="e\.g\. 2020"/, "#v-year should have example placeholder text");
  assert.match(source, /id="v-make" placeholder="e\.g\. Honda"/, "#v-make should have example placeholder text");
  assert.match(source, /id="v-model" placeholder="e\.g\. Civic EX"/, "#v-model should have example placeholder text");
});

// ── Follow-up to the user-friendliness pass above: 4 list-row areas
// (Accounts' Financial assets/Liabilities, Spending's transaction list,
// Net Worth's snapshot list, Net Worth's breakdown) use a two-cluster
// flex layout (name/date left, value+actions right) with nothing to fill
// the middle -- confirmed live at a 1491px viewport: roughly 900px of
// dead space in every row. Capped just these specific containers, not
// the whole page, since charts/the category-tile grid already use extra
// width well.
//
// First attempt capped just the list, left-aligned -- Nicholas pointed
// out (with live screenshots) that this just relocated the same dead
// space to one block on the right instead of distributing it, and each
// section's header row still spanned full width above the now-narrower
// list, misaligned from it. Centering just the list would have made that
// worse, not better. Reworked into a shared .list-col class wrapping each
// section's header together with its list, so both share the same
// centered max-width as one unit -- the border-top divider lines above
// the Net Worth breakdown/snapshots sections deliberately stay full width
// (.list-col wraps only their inner content), so the divider itself
// doesn't also shrink and float in the middle. ──
test("list-col wraps each area's header together with its list, centered, instead of leaving one relocated to the right or left orphaned from the other", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.list-col\{max-width:800px;margin-left:auto;margin-right:auto\}/,
    ".list-col should cap max-width and center itself"
  );
  assert.doesNotMatch(source, /\.nw-section\{[^}]*max-width/, ".nw-section itself should no longer carry the max-width -- centering now happens per-section via the wrapping .list-col");
  assert.match(
    source,
    /<div class="list-col">\s*<div class="flex-between" style="margin-top:\.9rem;margin-bottom:\.3rem">[\s\S]{0,2000}?<div id="tx-list"><\/div>/,
    "the transaction list's header and #tx-list should share one .list-col wrapper"
  );
  assert.match(
    source,
    /<div class="list-col">\s*<div class="sh" style="margin-bottom:\.5rem">Where your wealth lives<\/div>\s*<div class="nw-section" id="nw-breakdown"><\/div>/,
    "the Net Worth breakdown's header and #nw-breakdown should share one .list-col wrapper"
  );
  assert.match(
    source,
    /<div class="list-col">\s*<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:\.45rem">\s*<div class="sh" style="margin:0">Net worth snapshots<\/div>/,
    "the Net Worth snapshots header and #snapshot-list should share one .list-col wrapper"
  );
  assert.match(
    source,
    /<div class="list-col"><div class="sh">Financial assets<\/div><div id="asset-list" class="nw-section"><\/div><\/div>/,
    "Financial assets' header and #asset-list should share one .list-col wrapper"
  );
  assert.match(
    source,
    /<div class="list-col"><div class="sh">Liabilities<\/div><div id="liability-list" class="nw-section"><\/div><\/div>/,
    "Liabilities' header and #liability-list should share one .list-col wrapper"
  );
});

// Finding: Nicholas caught, via a live screenshot of dev, that this same
// max-width treatment never reached Outside net worth or Physical
// assets -- both were rebuilt onto the tighter .nw-group row format on
// August 10 (same day as this sweep), but neither got wrapped in
// .list-col, so they stayed full-width and stretched edge-to-edge on a
// wide monitor while Financial assets/Liabilities right above them
// stayed capped at 800px and centered -- the exact "same tab, two
// different widths" inconsistency this whole sweep was meant to fix.
test("Outside net worth and Physical assets are also wrapped in .list-col, matching Financial assets/Liabilities right above them", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div class="list-col">\s*<div id="acct-excluded-header" class="sh"[^>]*>Outside net worth<\/div>\s*<div id="excluded-accounts-list"><\/div>\s*<\/div>/,
    "Outside net worth's header and #excluded-accounts-list should share one .list-col wrapper"
  );
  assert.match(
    source,
    /<div class="list-col">\s*<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;margin-bottom:\.5rem"><div class="sh" style="margin:0">Physical assets<\/div>[\s\S]{0,500}?<div id="vehicle-list"><\/div>\s*<\/div>/,
    "Physical assets' header, info-box, and #vehicle-list should share one .list-col wrapper"
  );
});

// Finding: Nicholas asked whether the Budget tab's support text was too
// small, quoting the subtitle sentence directly. It and the gate notice
// below it were both 11px, under the 12px legibility floor established
// earlier this session for genuine reading/instructional text.
test("Budget tab's subtitle and gate notice meet the 12px legibility floor, not 11px", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div id="budget-view-subtitle" style="font-size:12px;/,
    "#budget-view-subtitle should be 12px"
  );
  assert.match(
    source,
    /<div id="budget-view-gate" style="display:none;background:var\(--bg-card\);border:1px solid var\(--border-mid\);border-left:3px solid #FBBF24;border-radius:6px;padding:\.5rem \.75rem;margin-bottom:\.5rem;font-size:12px;/,
    "#budget-view-gate should be 12px"
  );
});

// Finding: fixing deleteSnapshot's icon to 🗑️ earlier this session only
// compared it against removeBudget (2 data points) -- when Nicholas asked
// "did we settle on garbage cans or X as our site wide delete icon?", a
// full site-wide grep showed ✕/× was still used at 4 other delete sites.
// ✕ conventionally signals "close/dismiss", but all 6 of these actions are
// permanent deletions, so standardized every one on 🗑️.
test("deleteRule, startDeleteCat, deleteVendorAlias, and the source chip's remove button all use 🗑️, not a mismatched ✕/×", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /data-action="deleteRule" data-arg="\$\{i\}"[^>]*title="Delete rule" type="button">🗑️<\/button>/,
    "deleteRule's button should use 🗑️"
  );
  assert.match(
    source,
    /data-action="startDeleteCat" data-arg="\$\{esc\(c\.name\)\}"[^>]*title="Delete" type="button">🗑️<\/button>/,
    "startDeleteCat's button should use 🗑️"
  );
  assert.match(
    source,
    /data-action="deleteVendorAlias" data-arg="\$\{esc\(from\)\}"[^>]*title="Remove merge" type="button">🗑️<\/button>/,
    "deleteVendorAlias's button should use 🗑️"
  );
  assert.match(
    source,
    /<button class="src-x-btn" data-action="openSrcRemovePop"[^>]*title="Remove this source" type="button">🗑️<\/button>/,
    "the source chip's remove button should use 🗑️"
  );
});

// Finding: Nicholas asked about text sizing in Spending's "at a glance"
// insights card. The month narrative sentence ("July came in right around
// your usual pace...") was 10px collapsed / 11px expanded, and each
// insight pill's sub-line ("$5,537 kept this month...", "52% of the way
// to $750k...") was 10px -- both are genuine reading sentences, not short
// badge labels, so both were under this session's 12px legibility floor.
test("the insights card's month narrative and pill sub-lines meet the 12px legibility floor, not 10-11px", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div style="font-size:12px;color:\$\{_narrativeExpanded\?'var\(--text-secondary\)':'var\(--text-muted\)'\};line-height:\$\{_narrativeExpanded\?'1\.7':'1\.5'\}">\$\{_narrativeExpanded\?full:preview\}<\/div>/,
    "the month narrative sentence should be 12px in both its collapsed and expanded states"
  );
  assert.match(
    source,
    /\$\{\(sub\|\|cta\)\?`<div style="font-size:12px;color:var\(--text-muted\);line-height:1\.35">\$\{sub\}\$\{cta\?` · <button data-action="\$\{_ctaAction\(cta\)\}"/,
    "each insight pill's sub-line (and its CTA link) should be 12px"
  );
});

// Finding: Nicholas noticed Spending's Total Spend card shows Top 5
// Categories/Top 5 Vendors on desktop but not mobile, and asked whether
// at least one could fit. Simulating the mobile layout directly showed
// plenty of room once the card already stacks vertically below 600px --
// the old rule (#spend-top5-inline,#spend-top5-vendors{display:none})
// removed both outright rather than just reflowing them. First attempt
// kept categories but stacked it full-width below Total Spend -- Nicholas
// pushed back with a live phone screenshot: he wanted it to stay screen
// right, matching desktop's side-by-side layout, not relocated under the
// total. Reworked to keep .spend-total-card in its default row layout on
// mobile (just a smaller gap + min-width:0 on the Top 5 wrapper so it can
// shrink), instead of forcing flex-direction:column -- confirmed it still
// fits with zero overflow down to a 310px card width (iPhone SE range).
// Kept only categories visible (pairs with the category tile grid
// directly below; vendor detail stays reachable via that grid's own
// Vendor toggle). Along the way both lists' rows were found at 10px,
// under this session's 12px floor -- bumped those too, which required
// widening the name column's truncation cap from 90px to 120px since
// "Checks Written" (91px wide at 12px) started clipping to "Checks
// Writt…" at the old cap -- caught live via scrollWidth vs clientWidth
// before it shipped.
test("Top 5 Categories stays screen-right on mobile, matching desktop's side-by-side layout (Top 5 Vendors still hides), and both lists' rows are 12px with room for their longest names", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.spend-total-card\{gap:12px\}/,
    "the mobile breakpoint should not force .spend-total-card into a column -- it should stay in its default row layout, just with a small gap"
  );
  assert.doesNotMatch(
    source,
    /@media\(max-width:600px\)\{[\s\S]*?\.spend-total-card\{flex-direction:column/,
    "the mobile breakpoint should no longer force .spend-total-card to stack vertically"
  );
  assert.match(
    source,
    /\.spend-total-card>div:last-child\{min-width:0!important\}/,
    "the Top 5 wrapper should be able to shrink below its desktop min-width on mobile, not stack full-width"
  );
  assert.match(
    source,
    /\.spend-top5-col-vendors\{display:none\}/,
    "only the vendors column should hide on mobile"
  );
  assert.doesNotMatch(
    source,
    /#spend-top5-inline,#spend-top5-vendors\{display:none\}/,
    "the old rule hiding both lists outright should be gone"
  );
  // color:var(--text-primary), not the original hardcoded color:rgba(255,255,255,.75)
  // -- that hardcoded white was invisible in light theme (white-on-near-white),
  // found August 11, 2026 from a landing-page hero screenshot Nicholas took that
  // showed the "TOP 5 CATEGORIES"/"TOP 5 VENDORS" headers with no rows visible
  // underneath in light mode. The row content was present in the DOM the whole
  // time (confirmed live) -- purely a contrast bug, not missing data.
  const rowStyle = 'font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:2px;display:flex;justify-content:space-between;gap:14px';
  assert.equal(
    source.split(rowStyle).length - 1,
    2,
    "both the categories and vendors row templates should be 12px"
  );
  assert.match(
    source,
    /white-space:nowrap;max-width:120px" title="\$\{esc\(v\)\}">\$\{esc\(displayVendor\(v\)\)\}<\/span>/,
    "the vendor name column should be widened to 120px so 12px text (e.g. 'Checks Written') doesn't clip"
  );
});

// Finding: Nicholas asked for a full sweep of the Spending tab's text
// sizes. Swept every render function that builds it (summary card,
// category/vendor tiles, chart tabs, Sankey, calendar heatmap,
// transaction list) and split what was under 12px into genuine reading
// text (worth fixing) vs. deliberate design chrome -- short badges,
// pills, icon buttons, and chart axis/tooltip text (kept as-is; the
// floor only applies to text a user actually reads as a sentence).
// Bumped the 8 genuine-reading-text sites to 12px: .bucket-name/
// .bucket-meta (the category tile's name and "Avg: $X/mo · Peak: ..."
// line -- both shared classes touching every tile on the page), the
// in-tile budget line ("$X of $Y budget"), two transaction-list empty
// states, the "select a source" hint, the calendar legend's click hint,
// and the "Hidden from spending" note. Live-verified all 8 in the
// browser, including triggering both empty states and the calendar
// hint directly via state -- no wrapping/clipping in the now-taller
// category tiles.
test("Spending tab's category tile name/meta/budget line, both empty states, the no-source hint, calendar hint, and hidden-transactions note are all 12px, not 9-11px", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.bucket-name\{font-size:12px;font-weight:700;margin-bottom:\.3rem;line-height:1\.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical\}/,
    ".bucket-name (the category/vendor tile's title) should be 12px"
  );
  assert.match(
    source,
    /\.bucket-meta\{font-size:12px;color:var\(--text-muted\);margin-top:3px;line-height:1\.4\}/,
    ".bucket-meta (the tile's 'Avg: $X/mo · Peak: ...' line) should be 12px"
  );
  assert.match(
    source,
    /<span style="font-size:12px;color:var\(--text-muted\)">\$\{fmt\(curAmt\)\} \/ \$\{fmt\(budget\)\}<\/span>/,
    "the in-tile budget line should be 12px, formatted as '$X / $Y' matching the Budget tab's own convention"
  );
  assert.match(
    source,
    /\(noneSelected\?`<span style="font-size:12px;color:var\(--accent-red\);align-self:center;margin-left:2px">← select a source to show spending<\/span>`:''\)/,
    "the 'select a source' hint above the chart should be 12px"
  );
  assert.match(
    source,
    /<span id="cal-legend-hint" style="font-size:12px;color:var\(--text-muted\);margin-left:6px;display:none">· click a shade to filter<\/span>/,
    "the calendar heatmap's legend click-hint should be 12px"
  );
  assert.match(
    source,
    /<div style="font-size:12px;font-weight:700;color:var\(--text-muted\);letter-spacing:\.07em;text-transform:uppercase;padding:\.5rem \.25rem \.25rem;opacity:\.6">Hidden from spending \(\$\{alwaysShowExcl\.length\}\) — click to edit &amp; restore<\/div>/,
    "the 'Hidden from spending' note should be 12px"
  );
  assert.match(
    source,
    /<div style="font-size:12px;color:var\(--text-muted\);margin-bottom:\.75rem">Click a source chip above to show spending<\/div>/,
    "the 'no sources selected' empty state should be 12px"
  );
  assert.match(
    source,
    /<div style="font-size:12px;color:var\(--text-muted\);margin-bottom:\.75rem">Import a bank, credit union, or credit card CSV to get started<\/div>/,
    "the 'no transactions yet' empty state should be 12px"
  );
});

// Finding: bumping the in-tile budget line to 12px in the previous
// commit introduced a real wrap -- "$1,269 of $1,200 budget" (a 4-digit
// budget, e.g. the Home tile) no longer fit in a 170px tile at the
// larger size and wrapped to 2 lines, confirmed live via a height
// measurement (28px vs. 14px for a single line) before and after.
// Nicholas asked whether switching to a compact "$X / $Y" fraction
// format was worth it; checked first and found the Budget tab's own
// per-category row already displays this same data as "$518 / $200"
// (see the sibling amountHTML template a few hundred lines below) --
// so this wasn't just a space-saving nicety, it was fixing both the
// wrap and an inconsistency with the app's own primary budget UI in
// one move. Dropped "of"/"budget" since the tile's colored status dot,
// its own tooltip, and its position under a budget-tracking header
// already carry that context.
test("the in-tile budget line uses a compact '$X / $Y' fraction instead of '$X of $Y budget', preventing 4-digit budgets from wrapping to 2 lines", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<span style="font-size:12px;color:var\(--text-muted\)">\$\{fmt\(curAmt\)\} \/ \$\{fmt\(budget\)\}<\/span>/,
    "the budget line should read '$X / $Y', matching the Budget tab's own format"
  );
  assert.doesNotMatch(
    source,
    /\$\{fmt\(curAmt\)\} of \$\{fmt\(budget\)\} budget/,
    "the old verbose 'of ... budget' wording should be gone"
  );
});

// Finding: even after switching the budget line to a compact fraction,
// every single category tile's "Avg/Peak" meta line was still wrapping
// to 2 lines (34px vs. 17px for one line, confirmed live across all 8
// visible tiles) -- the 12px bump alone wasn't enough once "Peak: 'YY
// Mon" was in the mix too. Nicholas asked whether adding the peak
// dollar amount (making the info actually useful) or cutting it
// entirely was the better fix. Tested both directly: adding the amount
// ("Peak: $1,269 ('25 Mar)") stayed at 34px, still wrapped -- longer
// text in the same space doesn't fix a space problem. Cutting it
// dropped straight to 17px, one line. Also worth knowing: the peak
// amount was already computed (getCatStats()'s s.peakAmt) but never
// once displayed anywhere, and s.peakLabel now has zero remaining
// consumers in the file -- both are dead data pass 168 (whichever pass
// this becomes) may want to remove, left untouched here since only the
// display was in scope.
test("category tiles no longer show 'Peak: 'YY Mon' in the meta line, since it stayed 2-line-wrapped even with the amount added and had no consumer worth the space", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div class="bucket-meta">\$\{signal\?`\$\{signal\} · `:''\}Avg: \$\{fmt\(Math\.round\(s\.total\/Math\.max\(grainedPeriods\.length,1\)\)\)\}\$\{grainLabel\}<\/div>/,
    "the tile's meta line should end after the average, with no trailing Peak text"
  );
  assert.doesNotMatch(
    source,
    /Avg: \$\{fmt\(Math\.round\(s\.total\/Math\.max\(grainedPeriods\.length,1\)\)\)\}\$\{grainLabel\} · Peak:/,
    "the meta line should no longer append '· Peak: ...'"
  );
});

// Finding: Nicholas asked to unify text size at 11px across the
// Spending breakdown tab strip (By category/By vendor/.../Flow), the
// "Patterns: on/off" toggle, and the "3mo/6mo/.../All" +
// "Monthly/Quarterly/Yearly" range chips -- the latter two were already
// 11px on mobile (a touch-target-driven override) but only 10px on
// desktop, while the breakdown tabs and Patterns toggle were 10px
// everywhere. Bumping the shared .h-btn base class from 10px to 11px
// covers all of these at once since none of them carry their own
// font-size override (verified by checking every class="h-btn" site in
// the file -- the few that do have inline font-size overrides, e.g. the
// Category/Vendor bucket-mode toggle at 11px and the Vehicle/Other
// asset-type toggle at 12px, were confirmed untouched by this change).
// The old mobile-only override on .quick-chips/.grain-row duplicating
// font-size:11px became redundant once the base class matched, so it
// was dropped from that rule (kept the padding/min-height, which are
// still mobile-specific for touch-target sizing).
test("the Spending breakdown tab strip, the Patterns toggle, and both range-chip rows are unified at 11px on desktop, matching what mobile already had", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.h-btn\{flex:1;background:none;border:none;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;color:var\(--text-muted\);cursor:pointer;white-space:nowrap\}/,
    "the shared .h-btn base class should be 11px"
  );
  assert.match(
    source,
    /<button id="chart-texture-btn" data-action="toggleChartTexture" style="background:none;border:1px solid var\(--border-mid\);border-radius:6px;padding:2px 8px;font-size:11px;/,
    "the Patterns toggle should be 11px"
  );
  assert.match(
    source,
    /\.quick-chips \.h-btn,\.grain-row \.h-btn\{padding:8px 6px;min-height:36px\}/,
    "the mobile-only override should drop its now-redundant font-size:11px, keeping only the touch-target padding/min-height"
  );
});

// Finding: Nicholas asked whether the in-tile "% of budget" badge
// (e.g. "106%", "259%") was worth making bigger. It was 10px, smaller
// than the 12px "$X / $Y" fraction sitting right next to it, even
// though it's the more important signal in that row -- bold,
// color-coded red/amber/green, the actual "am I over budget" answer.
// Tested live first: bumping it to 12px keeps every tile on one line,
// including the tightest case ("$1,269 / $1,200 106%" on the Home
// tile, confirmed via rowHeight staying at 14px/single-line rather
// than the 28px this exact row hit during the earlier Peak-line
// wrapping investigation).
test("the in-tile '% of budget' badge is 12px, matching the '$X / $Y' fraction next to it instead of being smaller than its own less-important neighbor", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<span style="font-size:12px;font-weight:700;color:\$\{curAmt>budget\+0\.005\?'#F87171':curAmt\/budget>0\.8\?'#FBBF24':'#34D399'\}">\$\{Math\.round\(curAmt\/budget\*100\)\}%<\/span>/,
    "the budget percentage badge should be 12px"
  );
});

// Finding: fixing the Subscriptions pill's score=0 default surfaced a
// deeper bug -- score had NEVER been used to choose the 2 visible
// "regular" insight pills, only to pick the single lead pill. The
// regular slots were always whichever pills got pushed first in
// renderInsights() (Savings rate, then Net worth), regardless of score,
// so a higher-scoring pill pushed later could never displace them
// without the user expanding "+more insights". Sorting regularPills by
// score before slicing fixes this for every pill, not just
// Subscriptions. Live-verified: with the demo data's own numbers
// (Subscriptions scoring 15, both Savings/Net worth scoring 10),
// Subscriptions and Top mover became the two visible pills instead of
// Savings/Net worth, matching what their scores actually say should be
// most notable.
test("the insights card's 2 visible regular pills are chosen by score, not by which pill happened to be pushed first in the function", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /const regularPills=pillsArr\.filter\(p=>p\.key!==leadPill\.key\)\.sort\(\(a,b\)=>b\.score-a\.score\);/,
    "regularPills should be sorted by score (descending) before the visible slice is taken"
  );
});

// Finding: Nicholas asked to build a duplicate-charge detection insight,
// following the same "detected pattern -> click for modal" shape as the
// Subscriptions pill. detectDuplicateCharges() flags same-vendor +
// EXACT-same-amount charges landing within 2 days of each other ($15+,
// last 35 days) -- deliberately narrow (exact amount, not "similar";
// tight day window, not a loose one) specifically to avoid flagging
// ordinary repeat purchases, which was the main false-positive risk
// considered before building this. Stress-tested live in the browser
// before writing these (injecting synthetic transactions, since the
// demo data has no genuine duplicates to exercise the code path):
// confirmed an exact-match pair/triple cluster correctly, and confirmed
// each of a different-amount same-vendor pair, a same-amount
// different-vendor pair, a same-vendor/amount pair 6 days apart (outside
// the window), a same-vendor/amount pair under $15, and a charge
// immediately followed by its own refund (negative amount) all
// correctly do NOT cluster. Known, accepted limitation documented in
// the function's own comment: a genuine split payment (same vendor,
// same amount, within the window) is indistinguishable from a real
// duplicate by this heuristic -- same class of limitation
// detectSubscriptions()'s own consistency check already has.
test("detectDuplicateCharges: clusters an exact same-vendor/same-amount charge within the day window, and correctly excludes each near-miss case", () => {
  const today = new Date();
  const d = (daysAgo) => {
    const x = new Date(today);
    x.setDate(x.getDate() - daysAgo);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const mk = (id, desc, amount, daysAgo) => ({ id, date: d(daysAgo), desc, cat: "Gas", card: "chase", amount, excluded: false, isIncome: false, is_offset: false, biz: false });

  const runWith = (txs) => {
    const { detectDuplicateCharges: fn } = loadFunctions(["detectDuplicateCharges"], {
      isRealSpend: (t) => !t.excluded && !t.isIncome,
      resolveVendor: (d) => d,
      state: { transactions: txs, excludedCats: new Set(), activeSources: new Set(["chase"]) },
      _bizFilter: "all",
    });
    return fn();
  };

  const exactDup = runWith([mk(1, "EXXON", 52.47, 3), mk(2, "EXXON", 52.47, 2)]);
  assert.equal(exactDup.clusters.length, 1, "an exact same-vendor/same-amount pair 1 day apart should cluster");
  assert.equal(exactDup.clusters[0].txs.length, 2);
  assert.equal(exactDup.dupTotal, 52.47, "dupTotal should count only the 'extra' charge past the first, not both");

  const diffAmount = runWith([mk(1, "STARBUCKS", 20, 3), mk(2, "STARBUCKS", 25, 2)]);
  assert.equal(diffAmount.clusters.length, 0, "same vendor but a different amount should not cluster");

  const diffVendor = runWith([mk(1, "TARGET", 40, 3), mk(2, "WALMART", 40, 2)]);
  assert.equal(diffVendor.clusters.length, 0, "same amount but a different vendor should not cluster");

  const tooFarApart = runWith([mk(1, "COSTCO", 120, 20), mk(2, "COSTCO", 120, 14)]);
  assert.equal(tooFarApart.clusters.length, 0, "same vendor/amount but 6 days apart (outside the 2-day window) should not cluster");

  const belowMin = runWith([mk(1, "VENDING", 3, 2), mk(2, "VENDING", 3, 1)]);
  assert.equal(belowMin.clusters.length, 0, "same vendor/amount within the window but under the $15 minimum should not cluster");

  const chargeAndRefund = runWith([mk(1, "BEST BUY", 200, 3), mk(2, "BEST BUY", -200, 2)]);
  assert.equal(chargeAndRefund.clusters.length, 0, "a charge immediately followed by its own refund (negative amount) should not be flagged as a duplicate");
});

// Finding: the pill and its modal should be registered/wired the same
// way Subscriptions (its closest sibling) already is.
test("Possible duplicates pill is registered in PILL_DEFS and its modal is wired to openDuplicateChargesModal", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\{key:'duplicates', icon:'⚠️', label:'Possible duplicates', note:'Same vendor \+ amount charged within 2 days, in the last 35 days'\},/,
    "the pill customizer's PILL_DEFS should include an entry for duplicates"
  );
  assert.match(
    source,
    /<div class="modal-overlay hidden" id="duplicate-charges-modal">/,
    "the duplicate charges modal markup should exist"
  );
  assert.match(
    source,
    /data-action="openDuplicateChargesModal" tabindex="0" role="button"/,
    "the pill itself should open the modal on click"
  );
});

// Finding: Nicholas asked whether either demo profile actually has
// possible duplicate charges to show off the feature above -- neither
// did (detectDuplicateCharges() returned zero clusters against both).
// Added two real duplicate pairs to Demo Profile 2's ALL_TX_RAW so a
// fresh demo load surfaces the "Possible duplicates" pill/modal without
// needing synthetic data injected by hand. Live-verified via
// detectDuplicateCharges() against the loaded profile before writing
// this: both pairs cluster correctly and nothing else in the profile's
// ~35-day lookback window does.
test("Demo Profile 2's ALL_TX_RAW includes two genuine duplicate-charge pairs, so the Possible duplicates pill has something to show on a fresh demo load", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\{"date":"2026-07-09","desc":"BEST BUY","cat":"Shopping","card":"Checking","amount":89\.97,"excluded":false\},\{"date":"2026-07-10","desc":"BEST BUY","cat":"Shopping","card":"Checking","amount":89\.97,"excluded":false\}/,
    "ALL_TX_RAW should contain a same-vendor/same-amount Best Buy pair one day apart"
  );
  assert.match(
    source,
    /\{"date":"2026-07-18","desc":"TARGET","cat":"Shopping","card":"Gold Card","amount":54\.32,"excluded":false\},\{"date":"2026-07-19","desc":"TARGET","cat":"Shopping","card":"Gold Card","amount":54\.32,"excluded":false\}/,
    "ALL_TX_RAW should contain a same-vendor/same-amount Target pair one day apart"
  );
});

// Finding: Nicholas asked whether the landing page mentions duplicate-
// charge detection at all -- it didn't (grep for "duplicate" in
// index.html came back empty), even though the feature has had its own
// pill/modal in the app for a while. Added a clause to the existing
// "Recurring charge detection" feature-list entry rather than a whole
// new .fi card, since it's a close sibling of subscription detection
// (same "flag a pattern in your charges" shape) and the feature list
// was already fairly long.
test("index.html's landing page mentions duplicate-charge detection", () => {
  const fs = require("fs");
  const path = require("path");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(
    indexSource,
    /flags possible duplicate charges/i,
    "the landing page's feature list should mention duplicate-charge detection"
  );
});

// Finding: detectSubscriptions() satisfied on both Mortgage and a gas
// station (BP) in the live demo data -- confirmed live before writing
// this test (Profile 2: Mortgage $426.76/mo/3mo; BP $77.29/mo/4mo, both
// well within the 20% variance band). First fix used a description
// keyword regex (mortgage/loan) scoped to just the mortgage case.
// Nicholas asked not to overengineer separate gas/mortgage exclusions
// and instead lean on this app's existing category-exclusion pattern
// (TRANSFER_LIKE_CATS/YIR_EXCLUDE_CATS) for consistency -- reworked into
// one SUBSCRIPTION_EXCLUDED_CATS set (Gas, Home) instead, dropping the
// keyword regex entirely. Gas station visits are inherently non-
// contractual, never a subscription. Home is where mortgage/rent
// payments land (per the CSV auto-categorization map); accepted
// tradeoff, tested explicitly below: a genuine Home-category
// subscription (lawn care, home security) is excluded too, narrower and
// rarer than mortgage/rent dominating that category.
test("detectSubscriptions: excludes Gas and Home categories entirely (mortgage/rent and gas-station visits), not via a bespoke keyword list", () => {
  const mkMonths = (vendor, cat) =>
    [1, 2, 3].map((n) => ({
      id: n,
      date: `2026-0${4 + n}-01`,
      desc: vendor,
      cat,
      card: "chase",
      amount: 500,
      excluded: false,
      isIncome: false,
      is_offset: false,
      biz: false,
    }));
  const ctx = (txs) => ({
    MONTHLY: { "2026-05": {}, "2026-06": {}, "2026-07": {} },
    isRealSpend: (t) => !t.excluded && !t.isIncome,
    resolveVendor: (d) => d,
    SUBSCRIPTION_EXCLUDED_CATS: new Set(["Gas", "Home"]),
    state: { transactions: txs, excludedCats: new Set(), activeSources: new Set(["chase"]) },
    _bizFilter: "all",
  });

  const { detectSubscriptions: fnMortgage } = loadFunctions(["detectSubscriptions"], ctx(mkMonths("MORTGAGE PAYMENT", "Home")));
  const mortgageResult = fnMortgage(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.deepEqual(mortgageResult.subVendors, [], "a mortgage payment (category Home) should not be listed as a subscription even though it's recurring and consistent");

  const { detectSubscriptions: fnGas } = loadFunctions(["detectSubscriptions"], ctx(mkMonths("BP", "Gas")));
  const gasResult = fnGas(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.deepEqual(gasResult.subVendors, [], "a gas station visited consistently (category Gas) should not be listed as a subscription");

  const { detectSubscriptions: fnLawn } = loadFunctions(["detectSubscriptions"], ctx(mkMonths("LAWN CARE SERVICE", "Home")));
  const lawnResult = fnLawn(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.deepEqual(lawnResult.subVendors, [], "known, accepted tradeoff of the category-level exclusion: a genuine Home-category subscription is excluded too, not just mortgage/rent");

  const { detectSubscriptions: fnReal } = loadFunctions(["detectSubscriptions"], ctx(mkMonths("NETFLIX", "Entertainment")));
  const realResult = fnReal(["2026-05", "2026-06", "2026-07"], "2026-07");
  assert.equal(realResult.subVendors.length, 1, "an ordinary, genuinely discretionary subscription in an unaffected category should still be detected");
});

// Finding: Nicholas said moving "Switch profile" text into the
// #demo-nudge banner's flex-wrap layout was a regression (less clear,
// and didn't fix the real problem: tap targets stacking too close
// together for touch users) and asked for a better location instead.
// #demo-nav-badge ("DEMO DATA" in the top-right nav) already does the
// identical action and sits nowhere near Import CSV -- but live-testing
// it turned up two compounding, pre-existing bugs that meant it had
// never actually been visible in any scenario tested this session:
// (1) only loadDemoProfile()'s own render callback ever explicitly
// showed it -- renderAll(), which runs on every ordinary page load/
// refresh, only ever hid it, never showed it; (2) every "show" call
// site used style.display='', which is a no-op against this element's
// own CSS rule hardcoding display:none (unlike #demo-chip, a sibling
// with no such rule, where the identical style.display='' pattern
// correctly works). Confirmed live: calling showDemoNudge() by hand on
// a fresh boot with demo data active left the badge invisible before
// this fix, and confirmed visible+clickable (opens the actual demo
// picker) after it, on a genuinely fresh boot (cleared localStorage,
// not just an in-memory state mutation).
test("#demo-nav-badge is reliably shown by showDemoNudge() (not just loadDemoProfile()'s callback) with an explicit visible display value (not the no-op '')", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function showDemoNudge\(\)\{[\s\S]{0,2500}?\n\}/);
  assert.ok(fnMatch, "showDemoNudge() should exist");
  assert.match(
    fnMatch[0],
    /const badge=document\.getElementById\('demo-nav-badge'\);\s*if\(badge&&!state\.hasRealData\)badge\.style\.display=hasDemoData\?'inline-block':'none';/,
    "showDemoNudge() should manage #demo-nav-badge's visibility with an explicit 'inline-block', matching the same condition #demo-nudge/#spending-start-here already use"
  );
});

// Finding: putting "Switch profiles" only in the nav's DEMO DATA badge
// (previous commit) turned out to lack clarity of its own -- "DEMO
// DATA" reads as a label, not a call-to-action, so Nicholas asked for
// "Switch profiles" back in the banner text itself, in place of
// "explore them", balancing concision against clarity without adding a
// new element. This also incidentally re-solves the original fat-
// finger concern without any flex-wrap redesign: "Switch profiles" and
// "Import a CSV" are no longer adjacent, separated only by " · ", the
// way the very first version had them -- they now sit at different
// points in the sentence, with "to explore, then" running text between
// them. Live-verified at a simulated 375px width: the two land on
// different lines, never touching. The #demo-nav-badge fix from the
// previous commit stays -- it's a legitimate independent bug fix, and
// the badge remains as a secondary, always-visible way to switch
// profiles even after the top banner scrolls out of view or gets
// dismissed.
test("#demo-nudge's banner text uses 'Switch profiles' in place of 'explore them', positioned well before Import a CSV rather than adjacent to it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /Demo data fills all 4 tabs —\s*<button data-action="openDemoPicker" data-arg="false" style="background:none;border:none;color:#D97706;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline;padding:0;font-family:inherit" type="button">Switch profiles<\/button>\s*to explore, then\s*<button data-action="openTxImportModal"/,
    "the banner should read 'Switch profiles' (as a secondary text-link button) positioned before 'Import a CSV', not adjacent to it at the end"
  );
  assert.doesNotMatch(
    source,
    /explore them/,
    "the old 'explore them' wording should be gone, replaced by the Switch profiles link"
  );
  assert.doesNotMatch(
    source,
    /👇 Demo data fills all 4 tabs/,
    "the leading pointing-hand emoji should be gone -- it pointed at nothing specific (this banner is the very first element on the page) and the amber background/border already draw attention on their own"
  );
});

// Finding: while questioning whether the #demo-nav-badge fix from
// 2 commits ago actually delivered on "stays reachable while
// scrolling," live-tested it directly -- scrolled 1200px and the badge
// (and the entire sticky .nav bar around it) scrolled away with the
// page, landing far off-screen, despite .nav's explicit
// position:sticky. Root cause: html/body both had overflow-x:hidden
// (deliberately, to block horizontal-scroll bugs) -- per spec, setting
// overflow-x to any non-'visible' value while overflow-y is left unset
// forces overflow-y to auto-compute to 'auto' too, turning <body> into
// its own scroll container and breaking position:sticky's "stick to
// the viewport" behavior for everything inside it, not just one
// element. This wasn't scoped to the demo badge -- the entire nav bar
// had silently never actually stayed pinned while scrolling, for any
// user, the whole time position:sticky has been in this file.
// Confirmed via getComputedStyle(body).overflow before the fix:
// "hidden auto" (overflow-y auto-computed, exactly as the spec
// predicts), no transform/filter/contain/willChange on any ancestor to
// blame instead. Fixed by switching overflow-x:hidden to
// overflow-x:clip on both html and body -- :clip blocks the same
// horizontal overflow :hidden did (preserving the original intent)
// without establishing a scroll container, so it doesn't trigger the
// overflow-y side effect. Live-verified after the fix: computed
// overflow is "clip visible" (overflow-y correctly stays visible now),
// .nav's bounding rect stays pinned at top:0 after scrolling 1200px
// (was -1122.5px before), and no horizontal scrollbar appeared
// (document.documentElement.scrollWidth still equals clientWidth),
// confirming the original horizontal-overflow protection still holds.
test("html/body use overflow-x:clip, not :hidden, so position:sticky (.nav and everything in it) isn't silently broken by the overflow-y auto-compute side effect", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /html\{overflow-x:clip;max-width:100%\}/,
    "html should use overflow-x:clip"
  );
  assert.match(
    source,
    /body\{font-family:var\(--font-sans,system-ui,sans-serif\);background:var\(--bg-page\)!important;color:var\(--text-primary\);font-size:14px;overflow-x:clip;max-width:100%\}/,
    "body should use overflow-x:clip"
  );
  assert.doesNotMatch(
    source,
    /^html\{overflow-x:hidden/m,
    "html should no longer use overflow-x:hidden"
  );
});

// Finding: Nicholas pointed out that Outside net worth and Physical
// assets, on the Accounts tab, still used older, bulkier row/card
// styles -- each entry as its own full standalone bordered box -- while
// Financial assets/Liabilities had already been rebuilt (August 6) into
// tight .account-row-grouped rows sharing one .nw-group border. Rebuilt
// both to match: Outside net worth wraps its accounts in a plain
// .nw-group (no redundant inner colored header, since the page-level
// "Outside net worth" heading already labels it) using the identical
// account-row-grouped row template Financial assets/Liabilities use,
// just in amber. Physical assets does the same, but by hand rather than
// reusing the shared classes directly, since vehicles carry a second
// sub-row (valuation link + VIN) a single flex row can't hold.
test("Outside net worth (Accounts tab) uses the tight .account-row-grouped format, not the older, bulkier .account-row-529 card", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /acctEl\.innerHTML=`<div class="nw-group">\$\{excluded\.map\(a=>`\s*<div class="account-row account-row-grouped">/,
    "the Accounts tab's excluded-accounts list should wrap rows in .nw-group using .account-row-grouped"
  );
  assert.doesNotMatch(
    source,
    /acctEl\.innerHTML=excluded\.map\(a=>`\s*<div class="account-row account-row-529">/,
    "the old .account-row-529 card style should be gone from the Accounts tab's excluded-accounts list"
  );
});

test("renderVehicles() (Physical assets) wraps entries in one shared .nw-group with border-top dividers, not each getting its own standalone bordered card", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function renderVehicles\(\)\{[\s\S]{0,3500}?\n\}/);
  assert.ok(fnMatch, "renderVehicles() should exist");
  assert.match(
    fnMatch[0],
    /el\.innerHTML=`<div class="nw-group">\$\{state\.vehicles\.map\(v=>\{/,
    "renderVehicles() should wrap all entries in one shared .nw-group"
  );
  assert.doesNotMatch(
    fnMatch[0],
    /border:1px solid var\(--border-mid\);border-radius:10px;(overflow:hidden;)?(padding:\.7rem 1rem;)?margin-bottom:8px/,
    "no vehicle/asset row should still get its own standalone bordered+margined card"
  );
});

// Finding: Nicholas asked whether a CSV download offered any utility
// alongside the JSON "Export data backup" -- JSON is full-fidelity but
// isn't readable in Excel/Sheets or shareable with an accountant, and the
// only existing CSV export (exportTransactionsCSV, Spending tab) silently
// scopes to whatever filter/search happens to be active, easy to mistake
// for "everything." Added exportAllTransactionsCSV() (always the complete,
// unfiltered state.transactions, wired into the overflow menu next to
// Export data backup) and exportNetWorthCSV() (the Net Worth tab's
// snapshot history -- date/net worth/assets/liabilities, an even more
// natural CSV shape than transactions since it's already a clean tabular
// time series). Extracted the shared row/download logic
// (txToCsvRow/downloadCSVFile/todayDateStr) out of the pre-existing
// exportTransactionsCSV() so the filtered and unfiltered transaction
// exports can't drift apart the way the file's own comments warn similar
// duplicated CSV-building logic has drifted before (the 27th/36th
// adversarial passes' IsIncome/Business/IsOffset findings).
test("exportAllTransactionsCSV: exports every transaction regardless of active filters, unlike exportTransactionsCSV", () => {
  let capturedCsv = null;
  const ctx = {
    state: { transactions: [
      { date: "2026-02-01", desc: "A", cat: "Groceries", amount: 10, card: "Checking", excluded: false, isIncome: false, biz: false, is_offset: false },
      { date: "2026-01-01", desc: "B", cat: "Shopping", amount: 20, card: "Gold Card", excluded: false, isIncome: false, biz: false, is_offset: false },
    ] },
    csvSafeField: (s) => s,
    resolveVendor: (d) => d,
    showToast: () => {},
    document: { createElement: () => ({ click: () => {} }) },
    Blob: function (parts) { capturedCsv = parts[0]; },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    TX_CSV_HEADERS: ["Date", "Description", "Vendor", "Category", "Amount", "Source", "Excluded", "IsIncome", "Business", "IsOffset"],
  };
  const { exportAllTransactionsCSV } = loadFunctions(["exportAllTransactionsCSV", "txToCsvRow", "downloadCSVFile", "todayDateStr"], ctx);
  exportAllTransactionsCSV();
  const lines = capturedCsv.split("\n");
  assert.equal(lines.length, 3, "header row plus both transactions, regardless of any filter state (none was even passed in)");
  assert.ok(lines[1].startsWith("2026-01-01"), "should be sorted oldest-first");
  assert.ok(lines[2].startsWith("2026-02-01"));
});

// Finding: Nicholas asked whether the mobile-collapsed Export CSV button
// should show its desktop hover-tip ("respects current filters and
// search") before downloading, since title tooltips don't fire on touch
// at all -- but digging into getFilteredTxs()/getBaseTxs() found the
// underlying claim was already inaccurate on desktop too: the filename
// label only checked searchQuery/activeCats, 2 of the 9 real filter
// dimensions applied (also active sources, date range, excluded
// categories, business/personal, vendor, a single clicked date), so a
// source or date-range filter alone produced a file silently mislabeled
// "unfiltered" with no mention anywhere, mobile or desktop. Fixed by
// comparing the exported count against state.transactions.length instead
// of enumerating filter types -- a count comparison can't miss a
// dimension the way a checklist can, and the toast (unlike the button's
// title attribute) is visible on every input method.
test("exportTransactionsCSV: toast and filename both reflect filtered-vs-total counts, not just search/category", () => {
  let capturedCsv = null, capturedFilename = null, toastMsg = null;
  const allTxs = [
    { date: "2026-02-01", desc: "A", cat: "Groceries", amount: 10, card: "Checking", excluded: false, isIncome: false, biz: false, is_offset: false },
    { date: "2026-01-01", desc: "B", cat: "Shopping", amount: 20, card: "Gold Card", excluded: false, isIncome: false, biz: false, is_offset: false },
    { date: "2026-01-15", desc: "C", cat: "Shopping", amount: 5, card: "Gold Card", excluded: false, isIncome: false, biz: false, is_offset: false },
  ];
  const ctx = {
    state: { transactions: allTxs, searchQuery: "" },
    // Standing in for getSortedTxs() -- only 1 of 3 transactions "shown"
    // here, simulating a source/date filter neither the old searchQuery
    // nor activeCats check would have caught.
    getSortedTxs: () => [allTxs[0]],
    csvSafeField: (s) => s,
    resolveVendor: (d) => d,
    showToast: (msg) => { toastMsg = msg; },
    document: { createElement: () => ({ click: () => {} }) },
    Blob: function (parts) { capturedCsv = parts[0]; },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    TX_CSV_HEADERS: ["Date", "Description", "Vendor", "Category", "Amount", "Source", "Excluded", "IsIncome", "Business", "IsOffset"],
    todayDateStr: () => "2026-08-13",
  };
  ctx.document.createElement = () => {
    const el = { click: () => {} };
    Object.defineProperty(el, "download", { set: (v) => { capturedFilename = v; }, get: () => capturedFilename });
    return el;
  };
  const { exportTransactionsCSV } = loadFunctions(["exportTransactionsCSV", "txToCsvRow", "downloadCSVFile"], ctx);
  exportTransactionsCSV();
  assert.equal(capturedCsv.split("\n").length, 2, "header row plus the 1 transaction getSortedTxs() returned");
  assert.match(capturedFilename, /-filtered\.csv$/, "filename should flag this as filtered even though no search/category filter was involved");
  assert.equal(toastMsg, "⬇ Exported 1 of 3 transactions (filtered)", "toast should state both counts -- the only place a mobile user (no hover, no title tooltip) sees this at all");
});

test("exportNetWorthCSV: exports snapshot history as Date/Net Worth/Assets/Liabilities, oldest first", () => {
  let capturedCsv = null;
  const ctx = {
    state: { snapshots: [
      { date: "Jun 30, 2026", monthKey: "2026-06", nw: 100000, assets: 120000, liab: 20000 },
      { date: "Jan 31, 2026", monthKey: "2026-01", nw: 90000, assets: 110000, liab: 20000 },
    ] },
    csvSafeField: (s) => s,
    showToast: () => {},
    document: { createElement: () => ({ click: () => {} }) },
    Blob: function (parts) { capturedCsv = parts[0]; },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
  };
  const { exportNetWorthCSV } = loadFunctions(["exportNetWorthCSV", "downloadCSVFile", "todayDateStr", "getSortedSnaps", "_snapshotSortCompare"], ctx);
  exportNetWorthCSV();
  const lines = capturedCsv.split("\n");
  assert.equal(lines[0], "Date,Net Worth,Assets,Liabilities");
  assert.equal(lines[1], "Jan 31, 2026,90000.00,110000.00,20000.00", "should sort oldest-first, matching getSortedSnaps()");
  assert.equal(lines[2], "Jun 30, 2026,100000.00,120000.00,20000.00");
});

test("Export all transactions (CSV) and Export CSV (Net Worth snapshots) are wired into the UI", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /data-action="exportAllTransactionsCSV\|closeGlobalSettings"/,
    "the nav's global settings menu should have an entry wired to exportAllTransactionsCSV"
  );
  assert.match(
    source,
    /data-action="exportNetWorthCSV" title="Export snapshot history as CSV"/,
    "the Net Worth tab's snapshot header should have an Export CSV button wired to exportNetWorthCSV"
  );
  assert.match(
    source,
    /const TX_CSV_HEADERS=\['Date','Description','Vendor','Category','Amount','Source','Excluded','IsIncome','Business','IsOffset'\];/,
    "TX_CSV_HEADERS should match the header list the exportAllTransactionsCSV test mocks in its context"
  );
});

// Finding: Nicholas asked whether the overflow menu's cross-tab items
// (currency, backup/restore, CSV export, clear data, PWA install) should
// be reachable from every tab, not just Spending -- they weren't; a user
// on Budget/Net Worth/Accounts had to switch to Spending first to reach
// "Export data backup" or "Clear all data." Moved those 6 items out of
// Spending's own overflow menu into a new ⚙ menu inside <nav> (present on
// every tab, since it's one shared element, not per-page markup), leaving
// Spending's overflow with only the genuinely Spending-scoped items
// (income toggle, income settings, auto-categorization rules, vendor
// merge, category manager). toggleGlobalSettings()/closeGlobalSettings()
// mirror toggleSpendingOverflow()/closeSpendingOverflow()'s exact
// toggle/outside-click-close shape as a deliberate choice, not
// duplication avoided -- the two menus live in different DOM locations
// and either can be open while the other tab is showing.
test("The nav has a global ⚙ settings menu with the cross-tab items, and Spending's own overflow menu no longer duplicates them", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const navMatch = source.match(/<nav class="nav"[\s\S]{0,6000}?<\/nav>/);
  assert.ok(navMatch, "the main <nav> element should exist");
  assert.match(navMatch[0], /id="global-settings-btn" data-action="toggleGlobalSettings"/, "nav should have a ⚙ button that opens the global settings menu");
  assert.match(navMatch[0], /id="global-settings-menu"/, "nav should contain the global settings menu");
  for (const action of ["triggerPwaInstall", "openCurrencyModal", "exportAllTransactionsCSV", "exportBackup", "triggerImportBackup", "openClearDataModal"]) {
    assert.match(navMatch[0], new RegExp(`data-action="${action}\\|closeGlobalSettings"`), `nav's global settings menu should include ${action}`);
  }

  const overflowMatch = source.match(/<div id="toolbar-overflow-menu"[\s\S]{0,1600}?<\/div>\s*<\/div>/);
  assert.ok(overflowMatch, "Spending's own overflow menu should still exist");
  for (const action of ["toggleIncludeIncome", "openIncomeModal", "openRulesModal", "openVendorAliasModal", "openCatModal"]) {
    assert.match(overflowMatch[0], new RegExp(`data-action="${action}\\|closeSpendingOverflow"`), `Spending's overflow menu should keep ${action}`);
  }
  for (const action of ["triggerPwaInstall", "openCurrencyModal", "exportAllTransactionsCSV", "exportBackup", "triggerImportBackup", "openClearDataModal"]) {
    assert.doesNotMatch(overflowMatch[0], new RegExp(action), `${action} should have moved to the global menu, not stayed duplicated in Spending's overflow`);
  }
});

test("toggleGlobalSettings/closeGlobalSettings mirror toggleSpendingOverflow/closeSpendingOverflow's toggle behavior", () => {
  const menuStyle = { display: "none" };
  const ctx = {
    document: {
      getElementById: (id) => (id === "global-settings-menu" ? { style: menuStyle } : null),
    },
  };
  const { toggleGlobalSettings, closeGlobalSettings } = loadFunctions(["toggleGlobalSettings", "closeGlobalSettings"], ctx);
  toggleGlobalSettings();
  assert.equal(menuStyle.display, "block", "first toggle should open the menu");
  toggleGlobalSettings();
  assert.equal(menuStyle.display, "none", "second toggle should close it again");
  menuStyle.display = "block";
  closeGlobalSettings();
  assert.equal(menuStyle.display, "none", "closeGlobalSettings should force it closed regardless of current state");
});

// Finding: the community-pattern suggestion form was only reachable via a
// two-click path buried inside the CSV import modal (Import → "View
// patterns" → the community-rules sub-modal's own button), or by reading
// the GitHub README -- nowhere near where a user would actually notice the
// need (a transaction sitting in "Other"). Added directly to Spending's own
// overflow menu, alongside the other categorization-related items it
// already has (auto-categorization rules, manage categories), which is a
// path users already associate with fixing categorization. Same Google
// Form URL used everywhere else in the app (README, index.html,
// privacy.html, the two existing in-app links) -- not a new destination.
test("Spending's overflow menu includes a direct link to suggest a merchant category", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const overflowMatch = source.match(/<div id="toolbar-overflow-menu"[\s\S]{0,1600}?<\/div>\s*<\/div>/);
  assert.ok(overflowMatch, "Spending's own overflow menu should exist");
  assert.match(
    overflowMatch[0],
    /<a href="https:\/\/forms\.gle\/6oV9UPtv8RKKUHM96" target="_blank" rel="noopener noreferrer" data-action="closeSpendingOverflow" class="overflow-item"/,
    "the overflow menu should link directly to the same suggestion form used elsewhere in the app, and close itself on click"
  );
});

// Finding: the "Import fresh" screen's own categorization-priority blurb
// stated the same wrong order README's table used to have (rules ->
// community patterns -> MCC -> built-in keywords) -- a third, independently
// wrong copy of the same fact, found live while testing the import flow.
// The real runtime order (traced through parseTxRow's shared block) is
// rules -> built-in keywords -> community patterns -> MCC.
test("The import-fresh blurb states the categorization order as rules -> built-in keywords -> community patterns -> MCC, matching the real runtime order", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /Categorization uses your rules, built-in keywords, community patterns, and.*MCC codes.*— in that order\./,
    "should list built-in keywords before community patterns, matching the app's actual priority order"
  );
});

// Finding: the sync-passphrase modal's "we never see this passphrase and
// can't reset it" warning -- the only thing standing between a user and
// permanently losing their synced data -- was styled with the same green
// (--accent-green) the app uses everywhere else for success/on-track
// states, so it visually read as reassurance instead of a warning right
// when someone most needed to stop and think. Nicholas explicitly chose
// not to add extra friction (a confirm-you've-saved-it checkbox, etc.) on
// top of the existing "Confirm passphrase" field -- just fixing the color
// so the existing text actually lands.
test("The sync-passphrase warning uses amber (warning) styling, not green (success) styling", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const warningMatch = source.match(/<div style="margin-top:\.75rem;[^"]*">\s*<span style="[^"]*">We never see this passphrase[\s\S]*?<\/span>\s*<\/div>/);
  assert.ok(warningMatch, "the sync-passphrase warning box should exist");
  assert.match(warningMatch[0], /var\(--amber-bg-mid\)/, "background should use the amber warning token, not a green success token");
  assert.match(warningMatch[0], /var\(--amber-border-strong\)/, "border should use the amber warning token, not a green success token");
  assert.match(warningMatch[0], /var\(--amber-text-strong\)/, "text should use the amber warning token, not var(--accent-green)");
  assert.doesNotMatch(warningMatch[0], /accent-green/, "should no longer use the success-green token anywhere in this box");
});

// Finding: the Spending tab's "⬇ Export CSV" button (next to the
// Transactions header) is one of three visually-identical inline export
// buttons (Budget and Net Worth have their own) -- considered folding it
// into the "Transactions" header text itself to save mobile width, but
// that would overload a label that's also a live transaction-count display
// with an undiscoverable click target, undoing the same kind of
// discoverability problem the suggestion-form link above was just fixed
// for. Used the existing .hide-mobile pattern instead (already used by the
// "Sort:" label two rows below this one): the ⬇ icon always shows, the
// "Export CSV" text collapses under 600px, button stays a real, visible,
// explicitly-labeled control at every width.
test("The Spending tab's Export CSV button collapses to icon-only on mobile via .hide-mobile, not by folding into the Transactions label", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<button data-action="exportTransactionsCSV" title="Export visible transactions as CSV — respects current filters and search" class="tx-icon-btn" type="button"><span class="tx-icon">⬇<\/span><span class="hide-mobile"> Export CSV<\/span><\/button>/,
    "the Spending tab's Export CSV button should keep its ⬇ icon always visible and hide only the text label on mobile"
  );
});

// Finding: an initial touch-target pass (min-width/min-height:36px,
// borrowed from .quick-chips/.grain-row) made +Add/Export CSV look
// oversized once Nicholas saw it on a real device, next to the Date/
// $ Amount/Category sort pills sharing that same row. Replaced the
// touch-target figure with .sort-btn's own scale (padding:3px 9px;
// font-size:11px, no forced min-size) instead, applied at every width
// (not just mobile -- the same 10px/2px 8px vs 11px/3px 9px mismatch
// existed on desktop too, just less visible there with the text label
// still shown). The glyph itself (not the whole button) gets a bump via
// .tx-icon, so it reads as "same-scale pill, bigger icon" rather than "a
// bigger button" -- also inlined into the shared .tx-icon-btn class
// instead of duplicated per-button inline styles, so both buttons can't
// drift apart the way the file's own comments warn duplicated styling has
// drifted before.
test("The +Add and Export CSV buttons match the Date/Amount/Category sort pills' scale via .tx-icon-btn, with just the glyph sized up via .tx-icon", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.tx-icon-btn\{background:none;border:1px solid #2563EB44;border-radius:5px;padding:3px 9px;font-size:11px;font-weight:600;color:var\(--accent-blue-light\);cursor:pointer\}/,
    ".tx-icon-btn should match .sort-btn's own padding:3px 9px;font-size:11px scale, not a touch-target-driven size"
  );
  assert.match(
    source,
    /\.tx-icon-btn \.tx-icon\{font-size:15px/,
    ".tx-icon should size up just the glyph, not the whole button"
  );
  assert.match(
    source,
    /<button data-action="openAddTxModal" title="Add a single transaction manually" class="tx-icon-btn" type="button"><span class="tx-icon">\+<\/span>/,
    "the +Add button should use the shared class with no per-button inline style duplicating it"
  );
  assert.match(
    source,
    /<button data-action="exportTransactionsCSV" title="Export visible transactions as CSV — respects current filters and search" class="tx-icon-btn" type="button"><span class="tx-icon">⬇<\/span>/,
    "the Export CSV button should use the shared class with no per-button inline style duplicating it"
  );
});

// Finding: Nicholas asked whether an icon in front of "Sign In" on desktop,
// collapsing to icon-only on mobile, would help free up nav space -- same
// .hide-mobile/.show-mobile pattern the 🔒 Privacy button already uses.
// Picked 👤 specifically to avoid sitting next to 🔒 with a second
// lock-family icon (🔑/🔐 were the obvious alternatives) -- confirmed
// unused anywhere else in the file first, so it carries no conflicting
// meaning. updateAuthUI() only toggles signInBtn's hidden class, never
// touches its innerHTML/textContent, so restructuring its contents into
// two spans doesn't risk that logic silently wiping the icon back out.
test("#auth-sign-in-btn shows '👤 Sign in' on desktop and just 👤 on mobile, matching the Privacy button's hide-mobile/show-mobile pattern", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<button id="auth-sign-in-btn"[^>]*><span class="hide-mobile">👤 Sign in<\/span><span class="show-mobile">👤<\/span><\/button>/,
    "#auth-sign-in-btn should wrap its label in hide-mobile/show-mobile spans, matching the Privacy button"
  );
  assert.doesNotMatch(
    source,
    /🔑|🔐/,
    "should not have introduced a second lock-family icon next to the existing 🔒 Privacy button"
  );
});

// Finding: Nicholas reported #auth-sign-in-btn didn't look the same size as
// the Privacy button next to it on mobile, and that the 👤 icon was hard to
// see against Sign In's solid blue background. Root-caused, not just
// restyled:
// (1) #global-settings-btn/#theme-toggle-btn/#auth-sign-in-btn all carry an
//     inline style="...font-size:...;padding:..." set directly on the
//     element -- an inline style always beats an external selector rule of
//     ANY specificity unless that rule has !important. The mobile-shrink
//     rules for these three (and this session's own earlier desktop-bump
//     rule for the first two) lacked !important, so none of them had ever
//     actually applied -- confirmed directly via getComputedStyle before
//     fixing, not assumed. .btn-privacy-nav's own mobile rule already
//     (correctly) used !important, which is exactly why Privacy looked
//     right while its neighbors didn't.
// (2) #demo-nav-badge had a DIFFERENT bug with the same symptom: no inline
//     style, but its "mobile" rule and its later unconditional base rule
//     have tied specificity (same #id selector) -- media-query wrapping
//     doesn't add specificity, so the LATER rule in source order (the
//     unconditional base, listed after the mobile block) always won
//     regardless of viewport. Confirmed with an isolated two-rule test
//     before concluding this wasn't just a "make it smaller" request.
// (3) Sign In's 👤 contrast: dropped the btn-primary class (solid blue
//     fill) for the same ghost-blue treatment "+ Add historical" already
//     uses elsewhere (color:#60A5FA;border-color:#2563EB44;background
//     inherited as none from .btn's own base) -- emoji glyphs render in a
//     fixed color set by the OS font, not CSS `color`, so no amount of
//     text-color tuning fixes a low-contrast icon on a strong fill; only
//     removing the fill does. ──
test("The nav's mobile-shrink and desktop-bump rules for #demo-nav-badge/#theme-toggle-btn/#global-settings-btn/#auth-sign-in-btn use !important so they actually beat inline styles and source-order ties, and Sign In no longer has a solid blue fill", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /#demo-nav-badge\{font-size:8px!important;padding:4px 5px!important;letter-spacing:\.03em!important/,
    "#demo-nav-badge's mobile rule should use !important to beat the later, tied-specificity base rule"
  );
  assert.match(
    source,
    /#theme-toggle-btn\{padding:2px 5px!important;font-size:11px!important\}\s*\n\s*#auth-sign-in-btn\{font-size:9px!important;padding:2px 7px!important\}/,
    "#theme-toggle-btn and #auth-sign-in-btn's mobile rules should use !important to beat their own inline styles"
  );
  assert.match(
    source,
    /@media\(min-width:601px\)\{#global-settings-btn,#theme-toggle-btn\{font-size:15px!important;padding:3px 9px!important\}\}/,
    "the desktop icon-bump rule should use !important to beat the inline styles on both buttons"
  );
  assert.match(
    source,
    /<button id="auth-sign-in-btn" class="btn btn-sm" data-action="openAuthModal" style="font-size:10px;padding:3px 10px;color:var\(--accent-blue-light\);border-color:#2563EB44"/,
    "#auth-sign-in-btn should no longer carry btn-primary's solid blue fill, using the same ghost-blue treatment as '+ Add historical'"
  );
});

// Finding: immediate follow-up report after the fix above -- #global-
// settings-btn was missing from the mobile-shrink block entirely (never
// added when the ⚙ menu itself was built), so it stayed at its unshrunk
// 12px/2px 8px inline base on mobile while its desktop-paired sibling
// #theme-toggle-btn correctly shrunk to 11px -- the two looked mismatched
// despite always being sized together on desktop. Separately, Privacy's
// solid btn-primary blue fill became the one visually "loud" element once
// Sign In moved to a ghost-blue outline -- dropped it to the identical
// treatment so the whole 4-icon cluster (⚙/🌙 neutral-gray, 🔒/👤
// blue-accented) reads as one consistent row instead of three ghost
// buttons and one solid-filled one.
test("#global-settings-btn has a mobile-shrink rule matching #theme-toggle-btn, and Privacy no longer has a solid blue fill either", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /#global-settings-btn\{padding:2px 5px!important;font-size:11px!important\}\s*\n\s*#theme-toggle-btn\{padding:2px 5px!important;font-size:11px!important\}/,
    "#global-settings-btn's mobile rule should exist and match #theme-toggle-btn's exactly"
  );
  assert.match(
    source,
    /<button data-action="openPrivacyPanel" class="btn btn-sm btn-privacy-nav" style="font-size:10px;padding:3px 10px;white-space:nowrap;color:var\(--accent-blue-light\);border-color:#2563EB44"/,
    "the Privacy nav button should use the same ghost-blue treatment as Sign In, not btn-primary's solid fill"
  );
});

// Finding: converting Manage categories/Community patterns/Year in review/
// Tips & shortcuts from centered modals to right-side drawers (long-list or
// report-shaped content, not short decisions) had a real regression trap --
// closeModals() and the a11y focus-trap observer both select elements by
// the literal '.modal-overlay' class, so simply swapping the class to
// '.drawer-overlay' would have silently broken Escape-key/backdrop-click
// closing and the accessibility observer for exactly these 4 dialogs.
// Fixed by keeping BOTH classes (modal-overlay drawer-overlay / modal
// drawer) so existing selectors still find them, with .drawer-overlay's
// later cascade position doing the actual positioning override.
test("The 4 drawer-converted modals (cat/community-rules/year-review/shortcuts) keep the modal-overlay/modal classes alongside the new drawer classes, so closeModals() and the a11y observer still find them", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  for (const id of ["cat-modal", "community-rules-modal", "year-review-modal", "shortcuts-modal"]) {
    const overlayRe = new RegExp(`<div class="modal-overlay drawer-overlay hidden" id="${id}">`);
    assert.match(source, overlayRe, `#${id}'s overlay should carry both modal-overlay and drawer-overlay`);
    const innerRe = new RegExp(`id="${id}">\\s*<div class="modal drawer"`);
    assert.match(source, innerRe, `#${id}'s inner panel should carry both modal and drawer classes`);
  }
});

test("The .drawer-overlay/.drawer CSS variant docks right, fills viewport height, and overrides the global .hidden{display:none!important} with an !important of its own so the slide transition can run", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.drawer-overlay\{[^}]*justify-content:flex-end/,
    "drawer-overlay should dock its content to the right edge, not center it like .modal-overlay"
  );
  assert.match(
    source,
    /\.drawer-overlay\.hidden\{display:flex!important;visibility:hidden;pointer-events:none/,
    "the hidden override needs display:flex!important (higher specificity than the global .hidden rule) plus visibility+pointer-events to actually hide it, since display can't be transitioned"
  );
  assert.match(
    source,
    /\.drawer\{[^}]*height:100vh[^}]*transform:translateX\(100%\)/,
    "the drawer panel should be full viewport height and start translated off-screen"
  );
  assert.match(
    source,
    /\.drawer-overlay:not\(\.hidden\) \.drawer\{transform:translateX\(0\)\}/,
    "removing .hidden from the overlay should slide the drawer panel into view"
  );
  assert.match(
    source,
    /@media\(prefers-reduced-motion:reduce\)\{\.drawer-overlay,\.drawer\{transition:none\}\}/,
    "the slide/fade transition should be disabled under prefers-reduced-motion, matching this app's existing animation convention"
  );
});

// Finding: visibility applies instantly with no transition-delay by default,
// and visibility:hidden stops an element from being painted immediately --
// so even though transform/background-color were still "transitioning" in
// the underlying computed values on close, the box stopped rendering the
// instant .hidden was added and the slide-out/fade-out never actually
// showed. Open animated fine (visibility:visible has nothing to wait for);
// close silently snapped shut. Caught live-testing the close specifically,
// not something a static screenshot right after the click could show.
test("The drawer's close animation actually plays -- visibility has a matching transition-delay so it stays painted through the slide-out instead of vanishing instantly", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.drawer-overlay\{[^}]*transition:background-color \.25s ease,visibility 0s linear 0s/,
    "opening (visibility:visible) should apply with zero delay so the slide-in is visible from frame 1"
  );
  assert.match(
    source,
    /\.drawer-overlay\.hidden\{[^}]*transition:background-color \.25s ease,visibility 0s linear \.25s/,
    "closing (visibility:hidden) needs a .25s delay matching the slide-out duration, or the box stops being painted before the animation is visible"
  );
});

// Finding: two things surfaced testing live on an actual phone, not a
// simulated viewport -- (1) the drawer's opaque, blurred backdrop
// (rgba(0,0,0,.7)+blur(4px), copy-pasted from .modal-overlay) made the app
// behind it unreadable on both desktop and mobile, directly contradicting
// the "stay oriented in the app underneath" reasoning for using a drawer
// instead of another modal in the first place. (2) .drawer{height:100vh}
// measures against the largest possible mobile viewport (chrome
// collapsed), not what's actually visible with the address bar showing, so
// the drawer rendered taller than the real viewport and its top (title,
// close button) got pushed off-screen.
test("The drawer backdrop is a lighter, unblurred tint (not .modal-overlay's opaque blur) so the app stays visible behind it, and height falls back from 100vh to 100dvh to avoid the mobile-address-bar cutoff", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const overlayMatch = source.match(/\.drawer-overlay\{[^}]*\}/);
  assert.ok(overlayMatch, "the base .drawer-overlay rule should exist");
  assert.match(overlayMatch[0], /background:rgba\(0,0,0,\.15\)/, "backdrop should be meaningfully lighter than .modal-overlay's rgba(0,0,0,.7) -- .35 alone (an earlier pass) still wasn't enough per live user feedback, lightened further to .15");
  assert.doesNotMatch(overlayMatch[0], /backdrop-filter/, "no blur -- blur alone makes the app behind it illegible even at lower opacity");
  const drawerMatch = source.match(/\.drawer\{[^}]*\}/);
  assert.ok(drawerMatch, "the .drawer panel rule should exist");
  assert.match(drawerMatch[0], /height:100vh;height:100dvh/, "100vh fallback first, 100dvh override second so unsupported browsers still get a value");
  assert.match(drawerMatch[0], /max-height:100vh;max-height:100dvh/, "max-height needs the same vh->dvh fallback pattern as height");
});

// Finding: a batch of 3 things surfaced live-testing Manage categories --
// (1) the "(built-in)" tag rendered at 9px, below this app's own
// established 12px legibility floor (see the Tier 1/2 legibility-sweep
// precedents elsewhere in this file); (2) built-in rows used --text-muted
// against custom rows' --text-primary, a big enough contrast gap that it
// read as a different FONT SIZE, not just intentionally dimmed, even
// though both are actually 12px; (3) cat-modal inherited the shared
// drawer's 480px default width, but its content (a single short category
// name, no secondary data column) left built-in rows -- which have no
// action buttons at all -- with a wide, awkward blank gap on the right
// that the old 440px modal never had room to expose.
test("Manage categories: the '(built-in)' tag meets the 12px legibility floor, built-in and custom rows share one text color instead of a brightness gap that read as a boldness/size difference, and the drawer is narrowed to fit its actual content", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\(built-in\)<\/span>/,
    "the built-in tag markup should still exist"
  );
  assert.match(
    source,
    /<span style="font-size:12px;color:var\(--text-muted\)">\(built-in\)<\/span>/,
    "the '(built-in)' tag should be 12px, not the old 9px which was below this app's own established legibility floor"
  );
  assert.match(
    source,
    /<span class="truncate" style="flex:1;font-size:12px;color:var\(--text-primary\)" title="\$\{esc\(c\.name\)\}">/,
    "built-in and custom rows should share one text color -- a first pass (text-muted vs text-primary, then a softer text-secondary vs text-primary) both still read as a font-weight/size difference rather than intentional de-emphasis, even though font-size was identical throughout. The (built-in) label and the presence/absence of edit/delete icons already differentiate the two without needing a color gap too."
  );
  assert.match(
    source,
    /id="cat-modal">\s*<div class="modal drawer"[^>]*style="width:min\(400px,94vw\)"/,
    "cat-modal should override the shared drawer's 480px default -- its content (short category names, no secondary data column) doesn't need that much width and was leaving a wide blank gap on built-in rows, which have no action buttons at all"
  );
});

// Finding: on request, Tips & shortcuts became a genuinely persistent,
// non-blocking panel on wide-enough viewports (>=900px) instead of another
// blocking modal -- staying open while you go try the thing a tip just
// described is the whole point. The mechanism: openShortcutsModal() drops
// the shared .modal-overlay class at open time, which is what actually
// opts it out of closeModals()'s sweep, the Tab-focus-trap, and Escape's
// "close any open modal" branch -- all three key off that class
// specifically elsewhere in this file, so removing it is a single lever
// rather than needing to special-case each one. aria-modal is flipped to
// match (true when it's genuinely modal on narrow viewports, false when
// it isn't), since leaving aria-modal="true" on a panel that no longer
// blocks anything would actively mislead screen reader users. Mobile
// (<900px) is completely unchanged -- there's no room for simultaneous
// side-by-side use on a phone regardless.
test("Tips & shortcuts opens as a persistent, non-blocking panel on wide viewports (drops .modal-overlay, flips aria-modal) instead of always being a blocking modal", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const fnMatch = source.match(/function openShortcutsModal\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "openShortcutsModal() should exist");
  assert.match(fnMatch[0], /window\.innerWidth>=900/, "should gate persistent mode on a viewport-width check");
  assert.match(fnMatch[0], /classList\.toggle\('modal-overlay',!persistent\)/, "should drop .modal-overlay in persistent mode -- that's the single lever every other piece of shared modal machinery keys off");
  assert.match(fnMatch[0], /setAttribute\('aria-modal',persistent\?'false':'true'\)/, "aria-modal should track whether it's genuinely blocking, not stay hardcoded true once it isn't");
  assert.match(source, /function closeShortcutsModal\(\)\{document\.getElementById\('shortcuts-modal'\)\.classList\.add\('hidden'\)/, "needs its own dedicated close function -- the shared closeModals() sweep only finds .modal-overlay elements, which this one no longer is in persistent mode");
  assert.match(source, /function toggleShortcutsModal\(\)/, "the '?' key and any other single entry point should toggle rather than only ever open, so re-pressing '?' closes it");
});

// Finding: extended the same persistent-panel treatment from shortcuts-
// modal to the other three "reference/browse" drawers -- community-rules
// and year-review are read-only, cat-modal is the one with real mutating
// actions (add/rename/delete), which is why it got its own extra-scrutiny
// comment in openCatModal() rather than being assumed identical to the
// other two just because the mechanism is copy-pasted.
for (const [openFn, closeFn, modalId] of [
  ["openCommunityRulesModal", "closeCommunityRulesModal", "community-rules-modal"],
  ["openYearInReview", "closeYearInReview", "year-review-modal"],
  ["openCatModal", "closeCatModal", "cat-modal"],
]) {
  test(`${openFn}() opens as a persistent, non-blocking panel on wide viewports (drops .modal-overlay, flips aria-modal), matching shortcuts-modal's mechanism`, () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
    const fnMatch = source.match(new RegExp(`function ${openFn}\\(\\)\\{[\\s\\S]*?\\n\\}`));
    assert.ok(fnMatch, `${openFn}() should exist`);
    assert.match(fnMatch[0], /window\.innerWidth>=900/, "should gate persistent mode on the same viewport-width check as shortcuts-modal");
    assert.match(fnMatch[0], /classList\.toggle\('modal-overlay',!persistent\)/, "should drop .modal-overlay in persistent mode");
    assert.match(fnMatch[0], /setAttribute\('aria-modal',persistent\?'false':'true'\)/, "aria-modal should track whether it's genuinely blocking");
    const closeRe = new RegExp(`function ${closeFn}\\(\\)\\{document\\.getElementById\\('${modalId}'\\)\\.classList\\.add\\('hidden'\\)`);
    assert.match(source, closeRe, `needs its own dedicated close function -- the shared closeModals() sweep no longer finds this modal once it drops .modal-overlay`);
  });
}

test("Every one of the 4 persistent panels' Done/×/Got it buttons uses its own dedicated close function, not the generic closeModals() -- a real regression risk once .modal-overlay can be dropped at runtime", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const catBlock = source.match(/<!-- Category manager modal -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*\n\n<!-- Transaction CSV import modal -->/);
  assert.ok(catBlock, "cat-modal's markup block should exist");
  assert.match(catBlock[0], /data-action="closeCatModal"/, "cat-modal's Done button should use the dedicated close function");
  assert.doesNotMatch(catBlock[0], /data-action="closeModals"/, "cat-modal should have no remaining buttons wired to the generic sweep");
  const yirBlock = source.match(/<div class="modal-overlay drawer-overlay hidden" id="year-review-modal">[\s\S]*?<div id="yir-content"><\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(yirBlock, "year-review-modal's markup block should exist");
  assert.match(yirBlock[0], /data-action="closeYearInReview"/, "year-review-modal's Done button should use the dedicated close function");
  assert.doesNotMatch(yirBlock[0], /data-action="closeModals"/, "year-review-modal should have no remaining buttons wired to the generic sweep");
});

// Finding: an adversarial pass caught a real bug once all 4 panels could
// be persistent -- none of the 4 open functions closed any of the other
// 3 first. All four dock to the same position with the same z-index, so
// opening a second one while the first was still open silently stacked
// them on top of each other, with the "replaced" one still technically
// open (not hidden), just invisible behind the new one. Only reachable
// once persistent (the old blocking backdrop made triggering a second
// modal while one was open physically impossible, on both desktop and
// mobile) -- which is exactly why this gap only opened up as a side
// effect of the persistence feature itself, not something the original
// blocking-modal design ever had to guard against.
test("_closeOtherPersistentPanels() is called at the start of all 4 open functions, so opening one persistent panel closes any other that's already open instead of silently stacking on top of it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /function _closeOtherPersistentPanels\(exceptId\)\{\s*\['shortcuts-modal','community-rules-modal','year-review-modal','cat-modal'\]\.forEach/,
    "the helper should exist and enumerate all 4 persistent-eligible panels"
  );
  for (const [openFn, exceptId] of [
    ["openShortcutsModal", "shortcuts-modal"],
    ["openYearInReview", "year-review-modal"],
    ["openCommunityRulesModal", "community-rules-modal"],
    ["openCatModal", "cat-modal"],
  ]) {
    const fnMatch = source.match(new RegExp(`function ${openFn}\\(\\)\\{[\\s\\S]*?\\n\\}`));
    assert.ok(fnMatch, `${openFn}() should exist`);
    assert.match(
      fnMatch[0],
      new RegExp(`_closeOtherPersistentPanels\\('${exceptId}'\\)`),
      `${openFn}() should close the other 3 panels before opening, passing its own id so it doesn't close itself`
    );
  }
});

// Finding: click-through alone still left a persistent panel sitting
// visually on top of whatever was underneath it, including the nav's own
// right-edge controls (⚙ settings, theme toggle, demo badge -- all live in
// #auth-bar) and the Spending tab's "..." overflow button. A panel whose
// whole pitch is "go try the thing a tip just pointed you at without
// closing this" defeats itself if the control it's pointing at is the one
// thing it's covering. Fixed by having the app's own content genuinely
// narrow by the panel's width (via a body class + CSS custom property)
// instead of just being overlaid.
test("body.persistent-panel-open adds a >=900px-only margin-right driven by --pp-width, so the app genuinely narrows instead of just being overlaid", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /@media\(min-width:900px\)\{body\.persistent-panel-open\{margin-right:var\(--pp-width,480px\)/,
    "the reflow margin should only apply at >=900px, matching the same breakpoint every open function gates persistence on"
  );
  assert.match(
    source,
    /@media\(prefers-reduced-motion:reduce\)\{body\.persistent-panel-open\{transition:none\}\}/,
    "should respect prefers-reduced-motion like the drawer's own transitions do"
  );
});

for (const [openFn, closeFn, width] of [
  ["openShortcutsModal", "closeShortcutsModal", "480px"],
  ["openCommunityRulesModal", "closeCommunityRulesModal", "560px"],
  ["openYearInReview", "closeYearInReview", "580px"],
  ["openCatModal", "closeCatModal", "400px"],
]) {
  test(`${openFn}()/${closeFn}() set and clear persistent-panel-open + --pp-width:${width}, matching this panel's own drawer width`, () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
    const openMatch = source.match(new RegExp(`function ${openFn}\\(\\)\\{[\\s\\S]*?\\n\\}`));
    assert.ok(openMatch, `${openFn}() should exist`);
    assert.match(
      openMatch[0],
      /classList\.toggle\('persistent-panel-open',persistent\)/,
      `${openFn}() should toggle the body class to match its own persistent state, which also self-heals any stale class left by _closeOtherPersistentPanels() bypassing the other panel's own close function`
    );
    assert.match(
      openMatch[0],
      new RegExp(`style\\.setProperty\\('--pp-width','${width}'\\)`),
      `${openFn}() should set --pp-width to match this panel's own .drawer width override`
    );
    const closeMatch = source.match(new RegExp(`function ${closeFn}\\(\\)\\{[^\\n]*?\\n?[^}]*\\}`));
    assert.ok(closeMatch, `${closeFn}() should exist`);
    assert.match(
      closeMatch[0],
      /classList\.remove\('persistent-panel-open'\)/,
      `${closeFn}() should remove the body class -- since only one persistent panel can be open at a time, closing it always means the reflow margin should go away too`
    );
  });
}

test("The .drawer-overlay:not(.modal-overlay) CSS lets clicks pass through to the app everywhere except the panel itself, and no other drawer's markup can accidentally match it", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /\.drawer-overlay:not\(\.modal-overlay\)\{background:transparent;pointer-events:none\}/,
    "the overlay itself should be click-through and untinted once it's not blocking anything"
  );
  assert.match(
    source,
    /\.drawer-overlay:not\(\.modal-overlay\) \.drawer\{pointer-events:auto\}/,
    "the panel itself should opt back into receiving clicks even though its parent overlay doesn't"
  );
  for (const id of ["cat-modal", "community-rules-modal", "year-review-modal"]) {
    const overlayRe = new RegExp(`<div class="modal-overlay drawer-overlay hidden" id="${id}">`);
    assert.match(source, overlayRe, `#${id} should always carry both classes in its markup -- only shortcuts-modal ever drops .modal-overlay, and only at runtime via JS`);
  }
});

test("Escape closes whichever persistent panel is open (shortcuts, community-rules, year-review, cat) -- all four checks sit after any real modal closes, before falling through to Clear filters, since none of them match the generic .modal-overlay:not(.hidden) close check anymore once persistent", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const blockMatch = source.match(/closeModals\(\);return;\s*\}\s*\/\/ Persistent panels[\s\S]{0,3000}?\/\/ Clear active filters/);
  assert.ok(blockMatch, "the persistent-panels Escape block should sit between the real-modal-closing branch and the 'Clear active filters' fallback");
  const order = ["closeShortcutsModal", "closeCommunityRulesModal", "closeYearInReview", "closeCatModal"];
  let lastIndex = -1;
  for (const fn of order) {
    const idx = blockMatch[0].indexOf(`${fn}();return;`);
    assert.ok(idx !== -1, `${fn}() should be called in the persistent-panels Escape block`);
    assert.ok(idx > lastIndex, `${fn}() should appear after the previous check, in the same order the panels were built`);
    lastIndex = idx;
  }
});

test("community-rules-modal's Escape handling moved out of its old, much-earlier bespoke check (which closed ahead of a real modal even when both were open) into the same consolidated, correctly-ordered block as the other three persistent panels", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.doesNotMatch(
    source,
    /if\(pillTip\)\{pillTip\.remove\(\);return;\}\s*\/\/ Close community rules modal/,
    "the old early bespoke community-rules-modal Escape check (before the real-modal-closing branch) should be gone, not left duplicated alongside the new consolidated one"
  );
});

// Finding: two content bugs surfaced auditing the Tips table while
// building the above. (1) "Clear all data" lives in the ⚙ global settings
// menu, but the tip said "··· → Clear all data" (the Spending tab's own,
// different overflow menu) -- the exact same stale-menu-reference bug
// already caught and fixed in privacy.html earlier, just missed here. (2)
// The "Net Worth → Save snapshot: do this monthly" row was redundant with
// an existing *active* banner nudge on the Net Worth tab itself (only
// shown to real users who haven't saved a snapshot this month) -- a
// passive line in a reference panel doesn't actually remind anyone of
// anything ongoing the way a proactive banner does, and it was also a
// different kind of content than every other row (a behavioral suggestion
// vs. "what does clicking this do").
test("Tips & shortcuts: 'Clear all data' correctly points at the ⚙ menu (not the stale '···' Spending-overflow reference), and the redundant monthly-snapshot reminder row is gone", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  const modalMatch = source.match(/<!-- Keyboard shortcuts \/ tips modal -->[\s\S]*?<div class="modal-footer">/);
  assert.ok(modalMatch, "the shortcuts-modal block should exist");
  assert.match(modalMatch[0], />⚙ → Clear all data</, "should point at the ⚙ menu, where Clear all data actually lives");
  assert.doesNotMatch(modalMatch[0], /··· → Clear all data/, "should no longer reference the Spending tab's own, different overflow menu");
  assert.doesNotMatch(modalMatch[0], /Net Worth → Save snapshot/, "the redundant monthly-reminder row should be removed -- the Net Worth tab's own active banner nudge already does this job");
});

test("Tips & shortcuts' Keyboard section is hidden on mobile -- '?' and Esc need an actual keyboard, which a typical touchscreen phone doesn't have", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "..", "trakyodollas.html"), "utf8");
  assert.match(
    source,
    /<div class="hide-mobile" style="margin-bottom:1\.25rem">\s*<div class="label-upper" style="margin-bottom:\.5rem">Keyboard<\/div>/,
    "the Keyboard section should use the app's existing .hide-mobile convention, matching every other mobile-irrelevant content elsewhere"
  );
});
