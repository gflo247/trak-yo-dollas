#!/usr/bin/env python3
"""
Recomputes SHA-256 hashes for all inline <script> blocks in each target file
and updates that file's Content-Security-Policy meta tag accordingly.

Run before every deploy: python3 scripts/update-csp-hashes.py
Or for a specific file: python3 scripts/update-csp-hashes.py index.html

Defaults to every CSP-bearing HTML file: trakyodollas.html, index.html,
privacy.html and each guides/*.html page. index.html and privacy.html
got their own CSP on July 6, 2026 (previously only trakyodollas.html had
one) — this script covers all of them by design so a future page never
silently ships without its hashes kept in sync.
"""
import hashlib, base64, re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
_JSONLD_TYPE = 'type="application/ld+json"'
# guides/*.html carry their own CSP too; they were missing here, so their
# theme-toggle and service-worker scripts shipped without hashes and were
# blocked by the browser.
DEFAULT_TARGETS = ['trakyodollas.html', 'index.html', 'privacy.html'] + sorted(
    str(p.relative_to(ROOT)) for p in (ROOT / 'guides').glob('*.html'))


def update_file(path):
    html = path.read_text(encoding='utf-8')

    # Compute hashes for all inline (no src=) script blocks
    script_re = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.DOTALL)
    hashes = []
    for m in script_re.finditer(html):
        if _JSONLD_TYPE in m.group(0):
            continue  # JSON-LD is not executed; browsers don't enforce script-src on it
        content = m.group(1)
        if content.strip():
            digest = hashlib.sha256(content.encode('utf-8')).digest()
            hashes.append("'sha256-" + base64.b64encode(digest).decode() + "'")

    if not hashes:
        print(f"ERROR ({path.name}): no inline scripts found")
        return False

    # Replace the script-src line in the CSP meta tag.
    # The optional trailing group captures any https:// URL that follows the
    # hashes (e.g. a CDN allowlist entry) so it can be preserved. If there is
    # no trailing URL — the normal case since jsDelivr was removed — the group
    # is absent and we just emit the hashes followed by a semicolon terminator.
    csp_re = re.compile(r"(script-src\s+'self'\s*)(?:'sha256-[^']+'\s*)*(https://[^\s;']+\s*)?", re.MULTILINE)

    def _replacer(m):
        suffix = (' ' + m.group(2).strip()) if m.group(2) else ''
        return m.group(1) + ' '.join(hashes) + suffix

    new_html, n = csp_re.subn(_replacer, html, count=1)

    if n == 0:
        print(f"ERROR ({path.name}): could not find script-src in CSP")
        return False

    path.write_text(new_html, encoding='utf-8')
    print(f"Updated CSP with {len(hashes)} script hash(es) in {path.name}")
    return True


def main():
    targets = sys.argv[1:] or DEFAULT_TARGETS
    ok = True
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"ERROR: {name} not found")
            ok = False
            continue
        if not update_file(path):
            ok = False
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
