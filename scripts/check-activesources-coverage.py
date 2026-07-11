#!/usr/bin/env python3
"""
Heuristic scanner for the bug class found across passes 34/35/36 (all
2026-07-11): a function computes a spend total or transaction list by
hand-rolling its own loop over state.transactions — reimplementing
getBaseTxs()'s exclusion logic (isRealSpend/t.excluded/excludedCats) inline
— instead of calling getBaseTxs() itself, and in doing so quietly drops
state.activeSources (the deselected card/account filter) that
getBaseTxs() already checks. Concretely: getTxForMonth() (feeding most of
the Budget tab), renderInsights()'s sumMonth and 6 more of its own pill
computations, renderYearInReview()/copyYirSummary(), and
renderBucketGrid()'s tile sparklines/"vs average" badges all had their own
separate transaction loops that never referenced activeSources at all —
11 sites fixed in the 35th pass alone, plus 2 more (detectSubscriptions(),
checkForVenmoCashouts()) in adjacent passes.

This is the same underlying pattern check-bizfilter-coverage.py already
catches for _bizFilter, just checking for a different guard clause that
getBaseTxs() also provides. Kept as a separate script rather than merged
into that one so each scanner's baseline/false-positive list stays
independently reviewable — the two guards are dropped independently (a
function can correctly check _bizFilter while still missing
activeSources, and vice versa), so merging them would obscure which
specific guard a given candidate is actually missing.

This script flags every state.transactions.filter(...)/.forEach(...)/
.some(...)/.every(...) call whose predicate references a signal that it's
reimplementing base spend-filtering (isRealSpend(t), t.excluded,
excludedCats, t.isIncome) but does NOT reference state.activeSources
anywhere in the same expression.

This is a heuristic, not a JS parser — it WILL have false positives:
- A loop deliberately searching for excluded/income transactions (the
  opposite of filtering them out) that's genuinely meant to look at
  every source's history, not just active ones. Caution: this shape
  isn't automatically a false positive — detectDepositIncome() (line
  ~8093, `t.excluded && !t.is_offset`) looked like exactly this pattern
  when the scanner was first built, but the 38th adversarial pass found
  it was a real bug: its output feeds getEffectiveIncome(), and
  computePeriodSpendVsIncome()'s spend side already checks
  activeSources while the income side (via this function) didn't,
  silently inflating the displayed savings rate whenever a source was
  deselected. Confirm the surrounding call chain actually stays
  unfiltered-by-design end to end before waving one of these through.
- A loop that's deliberately meant to be lifetime/unfiltered-by-design
  rather than an oversight (e.g. buildCatColorMap()'s permanent color
  assignment, which intentionally looks at all-time spend regardless of
  the current source selection).
- A loop that operates on a single, already-known-active source (e.g.
  counting transactions on the specific card a user just clicked to
  remove) — activeSources doesn't apply because there's no "other
  sources" to filter out.
- A loop that already gets its transactions pre-filtered by a caller
  (e.g. operates on a variable derived from getBaseTxs() rather than
  state.transactions directly — those aren't matched by this script at
  all, since it only anchors on the literal `state.transactions` receiver).
- A loop that's a deletion/count/id-lookup rather than a spend total
  (e.g. removing a source's own transactions when that source itself is
  being deleted — activeSources is beside the point there).

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-activesources-coverage.py [file ...]
Defaults to trakyodollas.html if no args given (the other HTML files
don't have a transactions model).
Exits 0 always (reporting tool, not a hard deploy gate) — same posture as
check-bizfilter-coverage.py, and for the same reason: false-positive rate
isn't known to be low enough yet to block deploys on.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

ANCHOR_RE = re.compile(r'state\.transactions\.(filter|forEach|map|reduce|some|every)\(')

# Presence of any of these inside the call's arguments means the call is
# reimplementing some piece of getBaseTxs()'s exclusion logic by hand.
SIGNAL_RE = re.compile(r'isRealSpend\(|\.excluded\b|excludedCats|\.isIncome\b')

# The guard every one of these should have picked up from getBaseTxs() but
# didn't, in each confirmed bug so far.
GUARD_RE = re.compile(r'activeSources')


def extract_balanced_parens(text, open_paren_idx):
    """Given the index of an opening '(' , returns (end_idx, inner_text)
    for its balanced match, handling nested parens/braces/brackets so an
    arrow function body with its own function calls or object literals
    doesn't truncate the extraction early."""
    depth = 0
    i = open_paren_idx
    n = len(text)
    start = open_paren_idx + 1
    while i < n:
        c = text[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                return i, text[start:i]
        i += 1
    return n, text[start:n]


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []
    for m in ANCHOR_RE.finditer(text):
        open_idx = m.end() - 1
        end_idx, inner = extract_balanced_parens(text, open_idx)
        signal = SIGNAL_RE.search(inner)
        if not signal:
            continue
        if GUARD_RE.search(inner):
            continue
        snippet = inner.strip().replace('\n', ' ')
        snippet = re.sub(r'\s+', ' ', snippet)[:140]
        findings.append((line_of(text, m.start()), m.group(1), signal.group(0), snippet))
    return findings


def main():
    targets = sys.argv[1:] or ['trakyodollas.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        findings = scan_file(path)
        print(f"\n=== {name} ({len(findings)} candidate site{'s' if len(findings) != 1 else ''}) ===")
        for line, method, signal, snippet in findings:
            print(f"  line {line}: .{method}(...) reimplements exclusion via '{signal}' with no activeSources guard")
            print(f"    {snippet}")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
