#!/usr/bin/env python3
"""
Heuristic scanner for the bug class found in the 21st adversarial pass
(2026-07-09): a function mutates state.transactions in a way that affects
MONTHLY's bucketing (adds/removes a transaction, or changes its date,
amount, card, excluded, isIncome, or biz field) but never calls
rebuildMonthly() to refresh the MONTHLY object and ALL_MONTHS array that
cache those results. saveTx(), saveEditTx(), and deleteTx() (the manual
add/edit/delete transaction flows) all had this gap since this review
cycle's baseline commit -- 14 other transaction-mutating handlers in the
file call rebuildMonthly(), these three didn't, and nothing forced every
mutator to be checked against this requirement in one pass.

This script extracts every top-level `function name(...){...}` body and
flags one whose body mutates state.transactions (a full reassignment, a
push/unshift/splice call, or a .forEach()/.filter().forEach() callback
that assigns to one of the fields that actually matters to MONTHLY) but
never calls rebuildMonthly() anywhere in the same body.

Important scoping decision: MONTHLY buckets purely by month + card,
summing amount, filtered by excluded/isIncome/_bizFilter -- it does NOT
depend on category at all. A function that only reassigns a transaction's
`cat` field (e.g. deleteCustomCat()'s cascade, confirmRenameCat()) has no
effect on MONTHLY's output and correctly does not need to call
rebuildMonthly(). This scanner's field-assignment check is deliberately
narrowed to date/amount/card/excluded/isIncome/biz for that reason --
broadening it to "any field assignment" would falsely flag every
category-only mutator.

This is a heuristic, not a JS parser -- it WILL have false positives and
false negatives:
- Function-body extraction is brace-balanced but not string/comment-aware,
  so a `{`/`}` inside a string literal could throw off extraction for that
  one function. Rare in practice, but a genuine limitation.
- A function that mutates transactions found via a variable bound outside
  a simple `state.transactions.forEach(...)` shape (e.g. a helper that
  receives an already-filtered array as a parameter) won't be recognized
  as touching state.transactions at all, since this only anchors on the
  literal `state.transactions` receiver.
- A function that's a thin wrapper calling another function which itself
  calls rebuildMonthly() will be flagged even though the real work is
  covered indirectly -- this script only looks one level deep, at the
  literal text of the flagged function's own body.

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-rebuild-coverage.py [file ...]
Defaults to trakyodollas.html if no args given (the other HTML files
don't have a transactions model).
Exits 0 always (reporting tool, not a hard deploy gate) -- same posture as
check-escaping.py and check-bizfilter-coverage.py.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

FUNC_RE = re.compile(r'function\s+(\w+)\s*\([^)]*\)\s*\{')
TX_REASSIGN_RE = re.compile(r'state\.transactions\s*=(?!=)')
TX_ARRAY_METHOD_RE = re.compile(r'state\.transactions\.(push|unshift|splice)\(')
TX_FOREACH_RE = re.compile(r'state\.transactions\.(?:filter\([^)]*\)\.)?forEach\(')

# Only these fields actually change what rebuildMonthly() computes --
# category is deliberately excluded, see the module docstring.
MONTHLY_RELEVANT_FIELD_ASSIGN_RE = re.compile(r'\.(date|amount|card|excluded|isIncome|biz)\s*=(?!=)')

REBUILD_RE = re.compile(r'rebuildMonthly\(')

# Functions whose whole purpose is loading/replacing all of state.transactions
# wholesale (import, backup restore, demo/account load) -- these call
# rebuildMonthly() under a different, harder-to-match spelling in some cases,
# or are validated separately; kept here only as a documented allowlist if a
# future run needs one. Currently empty: every real mutator so far has been
# checkable via the direct regex approach above.
KNOWN_SAFE_FNS = set()


def extract_balanced_braces(text, open_brace_idx):
    depth = 0
    i = open_brace_idx
    n = len(text)
    start = open_brace_idx + 1
    while i < n:
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i, text[start:i]
        i += 1
    return n, text[start:n]


def extract_balanced_parens(text, open_paren_idx):
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


def extract_functions(text):
    for m in FUNC_RE.finditer(text):
        name = m.group(1)
        brace_idx = m.end() - 1
        end_idx, body = extract_balanced_braces(text, brace_idx)
        yield name, m.start(), body


def mutates_monthly_relevant_field(body):
    if TX_REASSIGN_RE.search(body):
        return True
    if TX_ARRAY_METHOD_RE.search(body):
        return True
    for m in TX_FOREACH_RE.finditer(body):
        open_idx = m.end() - 1
        _, inner = extract_balanced_parens(body, open_idx)
        if MONTHLY_RELEVANT_FIELD_ASSIGN_RE.search(inner):
            return True
    return False


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []
    for name, start, body in extract_functions(text):
        if name in KNOWN_SAFE_FNS:
            continue
        if not mutates_monthly_relevant_field(body):
            continue
        if REBUILD_RE.search(body):
            continue
        findings.append((line_of(text, start), name))
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
        for line, fn_name in findings:
            print(f"  line {line}: function {fn_name}() mutates a MONTHLY-relevant transaction field but never calls rebuildMonthly()")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
