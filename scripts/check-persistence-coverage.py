#!/usr/bin/env python3
"""
Heuristic scanner for the bug class that recurred across three adversarial
review passes (14, 16, 20, all 2026-07): a function mutates persisted app
state but never actually triggers a save for it. Two distinct, previously
confirmed shapes:

(A) A function mutates state.transactions (adds/removes/edits a row) but
    never sets _txsDirty=true. saveToLocalStorage()'s split-key design
    only rewrites the transactions localStorage key when _txsDirty is
    true (or a one-time bootstrap case) -- being wrapped by the auto-save
    patch list (below) is NOT sufficient on its own, since the patch only
    calls scheduleSave(), which does nothing for the transactions key
    without _txsDirty also being set. This is exactly the CRITICAL bug in
    saveTx() (pass 20): it WAS patch-listed, scheduleSave() genuinely
    fired, and the transaction still silently never reached disk for any
    returning user, because _txsDirty was never set. applyVenmoOpt()
    (pass 16) was the same shape, minus even being patch-listed.

(B) A function mutates one of the other persisted state fields (accounts,
    vehicles, budgets, customCategories, catRules, vendorAliases,
    excludedCats, snapshots, income, nwGoal, declaredIncome, hiddenPills,
    includeIncome -- all serialized into trakyo_state_v2 by
    serializeState(), called unconditionally by saveToLocalStorage() on
    every invocation) but never calls scheduleSave() (or saveToLocalStorage()
    directly, the pattern loadUserData() uses to force an immediate write
    after a cloud sync rather than waiting on the debounce) and isn't one
    of the patch-listed function names. Pass 14 found this shape once
    (deleteSnapshot vs confirmDeleteSnapshot -- the wrong name was in the
    patch list).

The patch list itself, for reference (trakyodollas.html, right before
DOMContentLoaded finishes):
    ['saveAccount','saveVehicle','saveTx','confirmTxImport',
     'confirmDeleteSnapshot','saveSnapshot','saveBudget','importCsvText']
Being in this list satisfies requirement (B) -- scheduleSave() genuinely
fires after the function runs. It does NOT satisfy requirement (A) for a
transaction-mutating function, since _txsDirty is a separate, explicit
flag the function itself must set; scheduleSave() firing without it is a
no-op for the transactions key specifically.

This is a heuristic, not a JS parser -- it WILL have false positives:
- Function-body extraction is brace-balanced but not string/comment-aware.
- A field assignment that's genuinely ephemeral/UI-only despite matching
  one of the curated field names (unlikely given the curated list is
  scoped to fields with a confirmed persistence role, but not impossible).
- A function that mutates state indirectly by calling another function
  that itself handles the save -- this script only looks at the flagged
  function's own body, one level deep.

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-persistence-coverage.py [file ...]
Defaults to trakyodollas.html if no args given (the other HTML files
don't have a state/save model).
Exits 0 always (reporting tool, not a hard deploy gate) -- same posture as
check-escaping.py and check-bizfilter-coverage.py.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

FUNC_RE = re.compile(r'function\s+(\w+)\s*\([^)]*\)\s*\{')

PATCHED_FNS = {
    'saveAccount', 'saveVehicle', 'saveTx', 'confirmTxImport',
    'confirmDeleteSnapshot', 'saveSnapshot', 'saveBudget', 'importCsvText',
}

# --- Check A: transaction mutations need _txsDirty=true ---
TX_REASSIGN_RE = re.compile(r'state\.transactions\s*=(?!=)')
TX_ARRAY_METHOD_RE = re.compile(r'state\.transactions\.(push|unshift|splice)\(')
TX_FOREACH_RE = re.compile(r'state\.transactions\.(?:filter\([^)]*\)\.)?forEach\(')
ANY_FIELD_ASSIGN_RE = re.compile(r'\b\w+\.\w+\s*=(?!=)')
TXSDIRTY_RE = re.compile(r'_txsDirty\s*=\s*true')

# --- Check B: other persisted fields need scheduleSave() or patch-list membership ---
PERSISTED_FIELDS = [
    'accounts', 'vehicles', 'budgets', 'customCategories', 'catRules',
    'vendorAliases', 'excludedCats', 'snapshots', 'income', 'nwGoal',
    'declaredIncome', 'hiddenPills', 'includeIncome',
]
FIELD_MUTATION_RE = re.compile(
    r'state\.(?:' + '|'.join(PERSISTED_FIELDS) + r')\s*=(?!=)'
    r'|state\.(?:' + '|'.join(PERSISTED_FIELDS) + r')\.(?:push|unshift|splice|delete|add)\('
    r'|state\.(?:' + '|'.join(PERSISTED_FIELDS) + r')\[[^\]]+\]\s*=(?!=)'
)
SCHEDULE_SAVE_RE = re.compile(r'scheduleSave\(|saveToLocalStorage\(')


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


def mutates_transactions(body):
    if TX_REASSIGN_RE.search(body):
        return True
    if TX_ARRAY_METHOD_RE.search(body):
        return True
    for m in TX_FOREACH_RE.finditer(body):
        open_idx = m.end() - 1
        _, inner = extract_balanced_parens(body, open_idx)
        if ANY_FIELD_ASSIGN_RE.search(inner):
            return True
    return False


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings_a = []
    findings_b = []
    for name, start, body in extract_functions(text):
        if mutates_transactions(body) and not TXSDIRTY_RE.search(body):
            findings_a.append((line_of(text, start), name))
        field_match = FIELD_MUTATION_RE.search(body)
        if field_match and not SCHEDULE_SAVE_RE.search(body) and name not in PATCHED_FNS:
            findings_b.append((line_of(text, start), name, field_match.group(0)))
    return findings_a, findings_b


def main():
    targets = sys.argv[1:] or ['trakyodollas.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        findings_a, findings_b = scan_file(path)
        print(f"\n=== {name} ===")
        print(f"-- Check A: transaction mutations missing _txsDirty=true ({len(findings_a)} candidate{'s' if len(findings_a) != 1 else ''}) --")
        for line, fn_name in findings_a:
            print(f"  line {line}: function {fn_name}() mutates state.transactions but never sets _txsDirty=true")
        print(f"-- Check B: other persisted-field mutations missing scheduleSave()/patch-list ({len(findings_b)} candidate{'s' if len(findings_b) != 1 else ''}) --")
        for line, fn_name, matched in findings_b:
            print(f"  line {line}: function {fn_name}() mutates '{matched}' but never calls scheduleSave() and isn't in the auto-save patch list")
        total += len(findings_a) + len(findings_b)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
