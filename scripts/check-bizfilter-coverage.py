#!/usr/bin/env python3
"""
Heuristic scanner for the bug class that recurred across three straight
adversarial review passes (15, 16, 17, all 2026-07): a function computes a
spend total or transaction list by hand-rolling its own loop over
state.transactions — reimplementing getBaseTxs()'s exclusion logic
(isRealSpend/t.excluded/excludedCats) inline — instead of calling
getBaseTxs() itself, and in doing so quietly drops whatever guard
getBaseTxs() has that the hand-rolled copy doesn't. Concretely: the
Business/Personal filter (_bizFilter) was added to getBaseTxs() on
2026-07-02, but Treemap, Daily Calendar (pass 15), the tx-row "% of
month" badge (pass 16), and the MONTHLY cache + computePeriodSpendVsIncome
(pass 17) all had their own separate transaction loops that never got the
same guard added, because nothing forced every call site touching this
logic to be looked at together.

This script flags every state.transactions.filter(...)/.forEach(...)/
.some(...)/.every(...) call whose predicate references a signal that it's
reimplementing base spend-filtering (isRealSpend(t), t.excluded,
excludedCats, t.isIncome) but does NOT reference _bizFilter anywhere in
the same expression. That is exactly the shape of every confirmed bug in
this class so far. (.some()/.every() were added after the 18th pass found
a real instance -- renderBucketGrid()'s category-tile "latest month with
spend" check -- that the original filter/forEach/map/reduce-only regex
missed entirely.)

This is a heuristic, not a JS parser — it WILL have false positives:
- A loop deliberately searching for excluded/income transactions (the
  opposite of filtering them out), e.g. `t.excluded && !t.is_offset` when
  scanning specifically for excluded deposits.
- A loop that's deliberately meant to be lifetime/unfiltered-by-design
  rather than an oversight.
- A loop that already gets its transactions pre-filtered by a caller
  (e.g. operates on a variable derived from getBaseTxs() rather than
  state.transactions directly — those aren't matched by this script at
  all, since it only anchors on the literal `state.transactions` receiver).

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-bizfilter-coverage.py [file ...]
Defaults to trakyodollas.html if no args given (the other HTML files
don't have a transactions model).
Exits 0 always (reporting tool, not a hard deploy gate) — same posture as
check-escaping.py, and for the same reason: false-positive rate isn't
known to be low enough yet to block deploys on.
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
GUARD_RE = re.compile(r'_bizFilter')


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
            print(f"  line {line}: .{method}(...) reimplements exclusion via '{signal}' with no _bizFilter guard")
            print(f"    {snippet}")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
