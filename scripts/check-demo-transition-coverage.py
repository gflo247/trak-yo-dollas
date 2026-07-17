#!/usr/bin/env python3
"""
Heuristic scanner for the bug class that recurred across 5 consecutive
adversarial review passes (108-112, all 2026-07-17): a function adds real,
user-entered data to a persisted state array (state.accounts, state.vehicles,
state.snapshots, state.transactions) without first calling
_replaceDemoDataWithReal() -- the shared helper that wipes every
demo-scripted field back to fresh-state defaults the instant a user's first
genuinely real action lands, so fabricated demo data (loaded by
loadDemoProfile()) never gets permanently mixed into what becomes the user's
real, persisted data.

7 "first real save" entry points have needed this treatment so far:
saveAccount, saveSnapshot, parseCsvAccounts, saveTx, confirmTxImport,
saveVehicle, saveHistoricalSnapshot. Each was found the same way: a
function that pushes/unshifts onto one of the four arrays above, discovered
only because a LATER pass's fix to a sibling function didn't cover it. The
112th adversarial pass explicitly recommended this scanner (a dedicated
systematic audit, the 113th pass, is what finally enumerated every existing
writer) specifically so a future new save function can't be written without
the treatment and silently reopen this exact class.

This scanner flags any function whose body calls .push(/.unshift( on
state.accounts/state.vehicles/state.snapshots/state.transactions but never
references _replaceDemoDataWithReal( -- and isn't on the allowlist below of
functions confirmed (by the 113th pass's own audit) to be legitimately
exempt: wholesale load/migration/demo-loading paths (which are a
fundamentally different case -- full replacement, not incremental
real-data addition -- and already correctly excluded), or the helper
itself.

This is a heuristic, not a JS parser -- it WILL have false positives:
- Function-body extraction is brace-balanced but not string/comment-aware.
- A function that adds to one of these arrays via a call to ANOTHER
  function that itself handles the wipe (one level of indirection) won't
  be recognized as covered -- this script only looks at the flagged
  function's own body.
- assign-only mutations to array indices, or .filter()/.splice() removals
  (deletions don't need this treatment at all -- see deleteAcct()/
  deleteVehicle()'s own hasRealAccounts=false reset instead, a different
  bug class) are deliberately NOT matched, only .push(/.unshift(.

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-demo-transition-coverage.py [file ...]
Defaults to trakyodollas.html if no args given.
Exits 0 always (reporting tool, not a hard deploy gate) -- same posture as
check-persistence-coverage.py and check-cloudsync-coverage.py.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

FUNC_RE = re.compile(r'function\s+(\w+)\s*\([^)]*\)\s*\{')

# Confirmed by the 113th adversarial pass's own exhaustive enumeration:
# wholesale load/migration/demo-loading paths (fundamentally different --
# full replacement, not incremental real-data addition) and the wipe
# helper itself. Do not add a function here without independently
# confirming it's a load/migration/reset path, not a genuine save path.
EXEMPT_FNS = {
    'loadUserData', 'loadFromLocalStorage', 'importBackup', 'runMigrations',
    'loadDemoProfile', '_replaceDemoDataWithReal',
}

MONITORED_ARRAYS = ['accounts', 'vehicles', 'snapshots', 'transactions']
PUSH_RE = re.compile(
    r'state\.(?:' + '|'.join(MONITORED_ARRAYS) + r')\.(?:push|unshift)\('
)
WIPE_HELPER_RE = re.compile(r'_replaceDemoDataWithReal\(')


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


def extract_functions(text):
    for m in FUNC_RE.finditer(text):
        name = m.group(1)
        brace_idx = m.end() - 1
        end_idx, body = extract_balanced_braces(text, brace_idx)
        yield name, m.start(), body


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []
    for name, start, body in extract_functions(text):
        if name in EXEMPT_FNS:
            continue
        push_match = PUSH_RE.search(body)
        if push_match and not WIPE_HELPER_RE.search(body):
            findings.append((line_of(text, start), name, push_match.group(0)))
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
        print(f"\n=== {name} ===")
        for line, fn_name, matched in findings:
            print(f"  line {line}: function {fn_name}() calls '{matched}' but never references _replaceDemoDataWithReal( -- new 'first real save' entry point?")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
