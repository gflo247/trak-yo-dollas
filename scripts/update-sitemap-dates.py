#!/usr/bin/env python3
"""Update <lastmod> in sitemap.xml using each file's last git commit date.

Uses git log rather than filesystem mtime — git resets mtime to checkout
time on every clone, so mtime-based dates changed on every deploy regardless
of whether the file's content actually changed.
"""
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).parent.parent
SITEMAP = REPO / 'sitemap.xml'


def file_lastmod(filename):
    result = subprocess.run(
        ['git', 'log', '-1', '--format=%ai', '--', filename],
        capture_output=True, text=True, cwd=REPO
    )
    date_str = result.stdout.strip()
    return date_str[:10] if date_str else None


def resolve_filename(loc):
    # URLs are Cloudflare's clean/extensionless routes (trakyodollas.com/,
    # trakyodollas.com/privacy), not the .html filenames on disk -- a plain
    # last-path-segment split used to produce 'trakyodollas.com' (the
    # hostname itself, once the trailing slash was stripped) or 'privacy'
    # (no .html), neither a real file, so file_lastmod() always returned
    # None and this script silently no-op'd on every run since the
    # Cloudflare migration while still printing "already current" -- found
    # in the 82nd adversarial pass.
    path = re.sub(r'^https?://[^/]+', '', loc).strip('/')
    name = path if path else 'index'
    # /guides/ → guides/index.html (trailing slash signals directory index)
    if not name:
        name = 'index'
    for candidate in (f'{name}.html', name):
        if (REPO / candidate).exists():
            return candidate
    return name


def update_url_block(m):
    block = m.group(1)
    loc = re.search(r'<loc>(.*?)</loc>', block)
    if not loc:
        return m.group(0)
    filename = resolve_filename(loc.group(1))
    date = file_lastmod(filename)
    if date:
        block = re.sub(r'<lastmod>.*?</lastmod>', f'<lastmod>{date}</lastmod>', block)
    return f'<url>{block}</url>'


content = SITEMAP.read_text()
updated = re.sub(r'<url>(.*?)</url>', update_url_block, content, flags=re.DOTALL)

if updated != content:
    SITEMAP.write_text(updated)
    print('Updated sitemap lastmod dates')
else:
    print('Sitemap lastmod dates already current')
