#!/usr/bin/env python3
"""
Heuristic scanner for the one bug class that has recurred more than any
other across this app's security reviews: a template-literal interpolation
(${...}) that renders free-text, user/CSV/backup-derived data (a category
name, vendor, description, color, etc.) without wrapping it in esc() first.

Every real finding across four separate adversarial review passes on
2026-07-06 was exactly this shape — not a new bug category each time, the
same one recurring in a sibling spot the previous pass hadn't looked at
yet. This script exists so the next sibling instance doesn't require a
fifth agent to find it: it flags every ${...} expression that touches a
known "risky" field name and isn't wrapped in esc(...) anywhere within
that expression.

This is a heuristic, not a JS parser — it WILL have false positives
(e.g. a risky-named field used in a boolean check, not rendered as text).
Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-escaping.py [file ...]
Defaults to trakyodollas.html, index.html, privacy.html if no args given.
Exits 0 always (reporting tool, not a hard deploy gate) — the false-positive
rate isn't low enough yet to block deploys automatically; see the bottom
of the output for a summary count.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# Field names this codebase has repeatedly stored free-text, attacker- or
# user-reachable content in, based on every finding from the 2026-07-06
# review passes (category names, vendor/description text, community-rules
# entries, custom category color/type, etc.) plus generically risky ones.
RISKY_FIELDS = [
    'cat', 'desc', 'description', 'name', 'keyword', 'vendor', 'source',
    'type', 'color', 'make', 'model', 'memo', 'note', 'label', 'comment',
    'card', 'tag', 'city', 'address', 'trim', 'series', 'condition', 'vin',
]
# Bare identifiers (not just `.field` access) already proven risky by a
# real past finding — checked as exact-identifier matches only, to keep
# the false-positive rate down.
RISKY_BARE_NAMES = ['tip', 'q']

FIELD_RE = re.compile(r'\.(' + '|'.join(RISKY_FIELDS) + r')\b')
BARE_RE = re.compile(r'(?<![\w.$])(' + '|'.join(RISKY_BARE_NAMES) + r')(?![\w$])')


def extract_template_exprs(text):
    """Yields (start, end, expr_text) for every ${...} in the source,
    handling nested braces so an expression containing an object literal
    or a nested function call doesn't truncate early."""
    i = 0
    n = len(text)
    while i < n:
        if text[i] == '$' and i + 1 < n and text[i + 1] == '{':
            start = i + 2
            depth = 1
            j = start
            while j < n and depth > 0:
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                j += 1
            end = j - 1
            yield (start, end, text[start:end])
            i = j
        else:
            i += 1


def esc_wrapped_spans(expr):
    """Returns a list of (start, end) spans within `expr` that are inside
    an esc(...) call's arguments, handling balanced parens so esc(a, f(b))
    style nesting doesn't break the containment check."""
    spans = []
    for m in re.finditer(r'\besc\(', expr):
        start = m.end()
        depth = 1
        j = start
        while j < len(expr) and depth > 0:
            if expr[j] == '(':
                depth += 1
            elif expr[j] == ')':
                depth -= 1
            j += 1
        spans.append((start, j - 1))
    return spans


def is_covered(pos_start, pos_end, spans):
    return any(s <= pos_start and pos_end <= e for s, e in spans)


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []
    for start, end, expr in extract_template_exprs(text):
        esc_spans = esc_wrapped_spans(expr)
        for m in FIELD_RE.finditer(expr):
            if not is_covered(m.start(), m.end(), esc_spans):
                findings.append((line_of(text, start + m.start()), expr.strip()[:120], m.group(0)))
        for m in BARE_RE.finditer(expr):
            if not is_covered(m.start(), m.end(), esc_spans):
                findings.append((line_of(text, start + m.start()), expr.strip()[:120], m.group(0)))
    # de-dupe identical (line, expr) pairs — a single expression can match
    # more than one risky field name
    seen = set()
    deduped = []
    for f in findings:
        key = (f[0], f[1])
        if key not in seen:
            seen.add(key)
            deduped.append(f)
    return sorted(deduped)


def main():
    targets = sys.argv[1:] or ['trakyodollas.html', 'index.html', 'privacy.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        findings = scan_file(path)
        print(f"\n=== {name} ({len(findings)} candidate site{'s' if len(findings)!=1 else ''}) ===")
        for line, expr, matched in findings:
            print(f"  line {line}: matched '{matched}' in ${{{expr}}}")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
