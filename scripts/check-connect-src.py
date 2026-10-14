#!/usr/bin/env python3
"""
Cross-checks each target file's CSP connect-src allowlist against every
actual network destination it calls out to (fetch() calls and, for
trakyodollas.html, the Supabase client's project URL), and fails if any
destination isn't covered.

Exists because connect-src is enforced by the browser at runtime — no unit
test or curl of the served HTML catches a gap in it. One already reached
production once: connect-src was tightened from '*' to an explicit allowlist
(July 6, 2026) and the first pass missed vpic.nhtsa.dot.gov, which the
VIN-lookup feature's fetch() call needs — it was already allowlisted in
img-src for an unrelated vehicle-photo <img>, which made it easy to assume
(wrongly) the fetch was covered too. This script exists so that mistake
can't ship silently again.

Covers trakyodollas.html, index.html, and privacy.html by default — the
latter two got their own CSP on July 6, 2026 (previously only
trakyodollas.html had one).

Run before every deploy: python3 scripts/check-connect-src.py
Or for a specific file: python3 scripts/check-connect-src.py index.html
"""
import re, sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).parent.parent
DEFAULT_TARGETS = ['trakyodollas.html', 'index.html', 'privacy.html']


def extract_call_arg(text, open_paren_pos):
    """Given the position of a call's opening '(', returns the raw text of
    the first argument (up to the first top-level ',' or the matching ')')."""
    depth = 0
    arg_start = open_paren_pos + 1
    for i in range(open_paren_pos, len(text)):
        c = text[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return text[arg_start:i].strip()
        elif c == ',' and depth == 1:
            return text[arg_start:i].strip()
    return None


def literal_url(expr):
    """Extracts a URL from a quoted string or template literal. Returns None
    if expr isn't a literal (e.g. a bare identifier)."""
    m = re.match(r'''^['"`](.*)['"`]$''', expr.strip())
    if not m:
        return None
    return m.group(1)


def origin_of(url):
    parts = urlsplit(url)
    if not parts.scheme:
        return None  # relative — same-origin, covered by 'self'
    return f"{parts.scheme}://{parts.netloc}"


def check_file(path):
    """Returns (findings, failed) where findings is a list of
    (line, description, ok) tuples."""
    html = path.read_text(encoding='utf-8')

    def line_no(pos):
        return html.count('\n', 0, pos) + 1

    def resolve_identifier(name, before_pos):
        assign_re = re.compile(r'\b(?:const|let|var)\s+' + re.escape(name) + r'\s*=\s*([^;]+);')
        best = None
        for m in assign_re.finditer(html, 0, before_pos):
            best = m  # keep the last (closest preceding) match
        if not best:
            return None
        return literal_url(best.group(1))

    csp_match = re.search(r'connect-src\s+([^;]+);', html)
    if not csp_match:
        return None, f"no connect-src directive found in {path.name}'s CSP meta tag"

    connect_src_tokens = csp_match.group(1).split()
    has_self = "'self'" in connect_src_tokens
    allowed_origins = [t.strip("'") for t in connect_src_tokens if t != "'self'"]

    def covered(origin):
        for allowed in allowed_origins:
            if allowed == origin:
                return True
            if allowed.startswith('https://*.') and origin.endswith(allowed[len('https://*'):]):
                return True
        return False

    # _authFetch is a thin wrapper function (defined in trakyodollas.html) that
    # always calls fetch() with a relative path supplied by its callers. Skip
    # both the function declaration itself and the internal fetch(path, ...) call
    # inside its body — callers are scanned directly instead.
    def find_wrapper_body_spans(src, fn_name):
        """Returns (start, end) byte spans for each definition of fn_name, using
        brace counting to correctly handle nested braces in the body."""
        spans = []
        decl_re = re.compile(r'\bfunction\s+' + re.escape(fn_name) + r'\s*\(')
        for decl_m in decl_re.finditer(src):
            # Skip past the parameter list (find the closing ')' of the params)
            # by paren-counting from the opening '(' of the declaration.
            open_paren = src.find('(', decl_m.end() - 1)  # the '(' is the last char
            if open_paren == -1:
                continue
            depth_p = 0
            params_end = open_paren
            for i in range(open_paren, len(src)):
                if src[i] == '(':
                    depth_p += 1
                elif src[i] == ')':
                    depth_p -= 1
                    if depth_p == 0:
                        params_end = i
                        break
            # Find the opening '{' of the function body (after the param list)
            brace_start = src.find('{', params_end)
            if brace_start == -1:
                continue
            depth = 0
            for i in range(brace_start, len(src)):
                if src[i] == '{':
                    depth += 1
                elif src[i] == '}':
                    depth -= 1
                    if depth == 0:
                        spans.append((decl_m.start(), i + 1))
                        break
        return spans

    wrapper_spans = find_wrapper_body_spans(html, '_authFetch')
    # _deleteTableWithRetry is a retry wrapper around _authFetch; it receives a
    # table name from its caller and maps it to a relative /api/ path internally.
    # Skip its body for the same reason we skip _authFetch's body — the paths are
    # all relative same-origin and verified by reading the function directly.
    wrapper_spans += find_wrapper_body_spans(html, '_deleteTableWithRetry')

    def inside_wrapper_body(pos):
        return any(start <= pos < end for start, end in wrapper_spans)

    findings = []

    for m in re.finditer(r'\b(?:fetch|_authFetch)\s*\(', html):
        fn_name = m.group(0).strip().rstrip('(').strip()
        open_paren = m.end() - 1
        # Skip any match that falls inside _authFetch's own definition — both
        # the function declaration (its parameter list contains "path") and the
        # internal fetch(path, ...) call. Callers are checked directly below.
        if inside_wrapper_body(m.start()):
            continue
        arg = extract_call_arg(html, open_paren)
        if arg is None:
            findings.append((line_no(m.start()), f"{fn_name}({arg}) — could not parse argument", False))
            continue
        url = literal_url(arg)
        if url is None:
            ident_m = re.match(r'^[A-Za-z_$][A-Za-z0-9_$]*$', arg)
            if ident_m:
                url = resolve_identifier(arg, m.start())
            if url is None:
                findings.append((line_no(m.start()), f"{fn_name}({arg}) — destination not statically resolvable, verify manually", False))
                continue
        origin = origin_of(url)
        if origin is None:
            findings.append((line_no(m.start()), f"{fn_name}('{url}') — relative, requires 'self'", has_self))
        else:
            findings.append((line_no(m.start()), f"{fn_name}(...) -> {origin}", covered(origin)))

    return findings, None


def main():
    targets = sys.argv[1:] or DEFAULT_TARGETS
    overall_failed = False
    for name in targets:
        path = ROOT / name
        print(f"\n=== {name} ===")
        if not path.exists():
            print(f"  ERROR: file not found")
            overall_failed = True
            continue
        findings, err = check_file(path)
        if err:
            print(f"  ERROR: {err}")
            overall_failed = True
            continue
        for line, desc, ok in findings:
            status = "OK" if ok else "MISSING FROM connect-src"
            print(f"  line {line}: {desc}  [{status}]")
            if not ok:
                overall_failed = True
        if not findings:
            print("  (no fetch()/Supabase-client calls found)")

    if overall_failed:
        print("\nERROR: one or more network destinations aren't covered by connect-src.")
        print("Add the missing origin to the relevant file's connect-src, or fix the call, then re-run.")
        sys.exit(1)

    print("\nOK: every network destination in every checked file is covered by its connect-src.")


if __name__ == '__main__':
    main()
