#!/usr/bin/env python3
"""
Extracts every inline <script> block from each target file and runs
`node --check` against it, failing the deploy on any JavaScript syntax
error.

Exists because this app has no build step or bundler — nothing else in the
deploy pipeline parses the file as a whole. `npm test` only compiles the
specific functions extracted for a given test (see
scripts/extract-testable-fns.js), not the full script block, so a syntax
error anywhere outside a currently-tested function slips through silently.
It nearly shipped once: the 72nd adversarial pass's first attempt at a fix
introduced a second `const today` declaration in the same function scope as
an existing one — caught only by manually running `node --check` on the
extracted script before it reached a browser, not by anything in this
pipeline. This script makes that check automatic instead of something a
person has to remember to do by hand.

Hard gate (not advisory, unlike the heuristic scanners in this directory) —
a syntax error has zero false positives. Node accepts some syntax (e.g.
lookbehinds) that older Safari rejects; this check catches those gaps.
Since every file here is one script tag, one syntax error anywhere breaks
the entire page.

Covers trakyodollas.html, index.html, and privacy.html by default, matching
check-connect-src.py's target list — all three are single/few-script-block
apps with the same risk.

Run before every deploy: python3 scripts/check-syntax.py
Or for a specific file: python3 scripts/check-syntax.py index.html
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
DEFAULT_TARGETS = ['trakyodollas.html', 'index.html', 'privacy.html']

SCRIPT_RE = re.compile(r'<script(?:\s+[^>]*)?>(.*?)</script>', re.DOTALL)
_JSONLD_TYPE = 'type="application/ld+json"'

# Matches lookbehind assertions (?<= and (?<! but NOT named capture groups (?<name>...)
_LOOKBEHIND_RE = re.compile(r'\(\?<[=!]')

# Standalone JS files to scan for lookbehinds alongside inline scripts
_JS_FILES = ['sw.js']


def check_lookbehinds_in_text(text, label):
    """Scans text for lookbehind patterns. Returns a list of error messages."""
    errors = []
    for i, line in enumerate(text.splitlines(), start=1):
        if _LOOKBEHIND_RE.search(line):
            errors.append(
                f'ERROR: lookbehind in {label} line {i} '
                f'(Safari < 16.4 rejects these; use a capture group instead)')
    return errors


def check_lookbehinds(path: Path):
    """Scans inline <script> blocks in an HTML file for lookbehind patterns."""
    text = path.read_text(encoding='utf-8')
    errors = []
    blocks = [m.group(1) for m in SCRIPT_RE.finditer(text)
              if m.group(1).strip() and _JSONLD_TYPE not in m.group(0)]
    for i, block in enumerate(blocks, start=1):
        label = f'{path.name} <script> block {i}'
        errors.extend(check_lookbehinds_in_text(block, label))
    return errors


def check_lookbehinds_js(path: Path):
    """Scans a standalone JS file for lookbehind patterns."""
    if not path.exists():
        return []
    text = path.read_text(encoding='utf-8')
    return check_lookbehinds_in_text(text, path.name)


def check_file(path: Path):
    """Returns a list of error messages (empty if every script block is
    syntactically valid)."""
    text = path.read_text(encoding='utf-8')
    errors = []
    # Skip JSON-LD blocks — they're not executed; node --check would reject valid JSON as JS syntax errors
    blocks = [m.group(1) for m in SCRIPT_RE.finditer(text)
              if m.group(1).strip() and _JSONLD_TYPE not in m.group(0)]
    for i, block in enumerate(blocks, start=1):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write(block)
            tmp_path = f.name
        try:
            result = subprocess.run(
                ['node', '--check', tmp_path],
                capture_output=True, text=True,
            )
            if result.returncode != 0:
                # node's error message references the temp file's REAL path,
                # which can differ from tmp_path as passed to subprocess --
                # macOS's /tmp is a symlink to /private/tmp, and node
                # resolves it before printing. Match against the resolved
                # path too, or the substring swap below leaves a mangled
                # leftover (e.g. "/private" stuck directly onto the
                # replacement with no separator) instead of a clean label.
                real_tmp_path = os.path.realpath(tmp_path)
                msg = result.stderr.strip()
                msg = msg.replace(real_tmp_path, f'{path.name} <script> block {i}')
                msg = msg.replace(tmp_path, f'{path.name} <script> block {i}')
                errors.append(msg)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    return errors


def main():
    targets = sys.argv[1:] or DEFAULT_TARGETS
    any_errors = False
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f'SKIP: {name} not found')
            continue
        errors = check_file(path)
        # Also scan for lookbehinds in inline scripts
        errors.extend(check_lookbehinds(path))
        if errors:
            any_errors = True
            print(f'FAIL: {name}')
            for e in errors:
                print(e)
        else:
            print(f'OK: {name}')
    # Scan standalone JS files for lookbehinds
    for name in _JS_FILES:
        path = ROOT / name
        errors = check_lookbehinds_js(path)
        if errors:
            any_errors = True
            print(f'FAIL: {name}')
            for e in errors:
                print(e)
        else:
            if path.exists():
                print(f'OK: {name}')
    if any_errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
