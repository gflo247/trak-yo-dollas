#!/usr/bin/env python3
"""Update <lastmod> in sitemap.xml using each file's last modification time."""
import os
import re
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).parent.parent
SITEMAP = REPO / 'sitemap.xml'


def file_lastmod(filename):
    path = REPO / filename
    if path.exists():
        return datetime.fromtimestamp(os.path.getmtime(path)).strftime('%Y-%m-%d')
    return None


def update_url_block(m):
    block = m.group(1)
    loc = re.search(r'<loc>(.*?)</loc>', block)
    if not loc:
        return m.group(0)
    filename = loc.group(1).rstrip('/').split('/')[-1]
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
