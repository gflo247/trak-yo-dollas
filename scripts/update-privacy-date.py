#!/usr/bin/env python3
"""
Updates privacy.html's "Last updated" date to the date of the most recent
git commit that actually changed the file.

Deliberately git-based, not mtime-based, unlike update-sitemap-dates.py.
update-csp-hashes.py rewrites all 3 HTML files unconditionally on every
deploy, even when the content is byte-identical -- that bumps mtime every
single deploy regardless of whether privacy.html's actual policy content
changed. A privacy policy's "last updated" date carries real trust weight
(a reader takes it to mean the policy hasn't materially changed since
then), so it needs a signal that only advances on a real content change.
git log only records a commit for a file when its tracked content
actually differs from the previous commit, which is exactly that signal.

Run before every deploy: python3 scripts/update-privacy-date.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
TARGET = ROOT / 'privacy.html'
DATE_RE = re.compile(r'(Last updated )([A-Z][a-z]+ \d{1,2}, \d{4})')


def main():
    if not TARGET.exists():
        print('ERROR: privacy.html not found')
        sys.exit(1)

    result = subprocess.run(
        ['git', 'log', '-1', '--format=%cd', '--date=format:%B %-d, %Y', '--', str(TARGET)],
        cwd=ROOT, capture_output=True, text=True,
    )
    date = result.stdout.strip()
    if result.returncode != 0 or not date:
        # No commit history for the file yet (e.g. a fresh checkout before
        # the first commit) -- leave whatever's already there rather than
        # writing a blank/wrong date.
        print('No git history for privacy.html yet -- leaving date as-is')
        return

    html = TARGET.read_text(encoding='utf-8')
    if not DATE_RE.search(html):
        print('ERROR: "Last updated <date>" text not found in privacy.html')
        sys.exit(1)

    new_html, n = DATE_RE.subn(r'\g<1>' + date, html, count=1)
    if new_html == html:
        print(f'Privacy policy date already current ({date})')
        return

    TARGET.write_text(new_html, encoding='utf-8')
    print(f'Updated privacy policy "Last updated" date to {date}')


if __name__ == '__main__':
    main()
