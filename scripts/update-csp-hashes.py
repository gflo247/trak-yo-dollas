#!/usr/bin/env python3
"""
Recomputes SHA-256 hashes for all inline <script> blocks in trakyodollas.html
and updates the Content-Security-Policy meta tag accordingly.

Run before every deploy: python3 scripts/update-csp-hashes.py
"""
import hashlib, base64, re, sys
from pathlib import Path

TARGET = Path(__file__).parent.parent / 'trakyodollas.html'

html = TARGET.read_text(encoding='utf-8')

# Compute hashes for all inline (no src=) script blocks
script_re = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.DOTALL)
hashes = []
for m in script_re.finditer(html):
    content = m.group(1)
    if content.strip():
        digest = hashlib.sha256(content.encode('utf-8')).digest()
        hashes.append("'sha256-" + base64.b64encode(digest).decode() + "'")

if not hashes:
    print("ERROR: no inline scripts found"); sys.exit(1)

# Replace the script-src line in the CSP meta tag
csp_re = re.compile(r"(script-src\s+'self'\s*)(?:'sha256-[^']+'\s*)*(https://)", re.MULTILINE)
replacement = r"\g<1>" + ' '.join(hashes) + r" \g<2>"
new_html, n = csp_re.subn(replacement, html, count=1)

if n == 0:
    print("ERROR: could not find script-src in CSP"); sys.exit(1)

TARGET.write_text(new_html, encoding='utf-8')
print(f"Updated CSP with {len(hashes)} script hash(es)")
