#!/usr/bin/env python3
"""
Heuristic scanner for a bug class that's recurred three times across the
pre-launch review cycle (all 2026-07-11): a field gets added to
serializeState() (local persistence, via localStorage) but syncToCloud()'s
savePrefs() payload and/or loadUserData()'s restore logic are never
updated to match, so the field silently doesn't round-trip across
devices. First found for nwGoal/hideNwGoal, then again for excludedCats
and declaredIncome (37th pass) -- excludedCats in particular gates spend
totals at dozens of call sites app-wide, so this isn't a cosmetic gap: a
user who customizes it on one device sees every headline number disagree
on another, with no error or warning either way.

This script extracts the top-level object-literal keys from three
places:
  1. serializeState()'s JSON.stringify({...}) argument -- the local
     persistence "menu" of what a field needs to survive a save/reload.
  2. syncToCloud()'s savePrefs(uid, {...}) call -- what actually reaches
     the cloud.
  3. Every `prefs.KEY` read inside loadUserData() -- what the cloud pull
     actually restores back into state.

It then reports:
  - Keys in (1) but missing from (2): persisted locally, never synced.
  - Keys in (2) but never read in (3): synced to the cloud, but a fresh
    pull on another device would silently ignore the field forever.

This is a heuristic, not a JS parser -- it WILL have false positives:
- Fields that are intentionally view/session/device-local rather than
  data that should follow the user across devices (e.g. which chart
  grain is selected, or a date-range filter someone was mid-browsing) --
  judgment call each time, not an automatic bug.
- state.transactions/state.snapshots are deliberately NOT in
  serializeState() at all (transactions live in a separate localStorage
  key; snapshots sync via their own saveSnapshot()/loadSnapshots() calls,
  not through prefs) -- these show up as "in syncToCloud but not
  serializeState" or vice versa and are expected, not bugs.
- hasRealData/hasRealAccounts/hasRealSnapshot are re-derived flags, not
  really "data" -- plausible to intentionally exclude from cloud sync.

Every flagged key needs a human look, not blind trust. Run manually:
    python3 scripts/check-cloudsync-coverage.py [file ...]
Defaults to trakyodollas.html if no args given.
Exits 0 always (reporting tool, not a hard deploy gate) -- same posture
as the other advisory scanners in this directory.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

KEY_RE = re.compile(r'^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:', re.MULTILINE)


def extract_balanced(text, open_idx, open_ch='{', close_ch='}'):
    """Given the index of an opening brace, return (end_idx, inner_text)
    for its balanced match."""
    depth = 0
    i = open_idx
    n = len(text)
    start = open_idx + 1
    while i < n:
        c = text[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i, text[start:i]
        i += 1
    return n, text[start:n]


def extract_function_body(text, fn_name):
    m = re.search(r'(?:async\s+)?function\s+' + re.escape(fn_name) + r'\s*\([^)]*\)\s*\{', text)
    if not m:
        return None
    open_idx = m.end() - 1
    _, body = extract_balanced(text, open_idx)
    return body


def extract_object_keys_after(text, marker_re):
    """Find marker_re, then the next '{' after it, extract its balanced
    contents, and return the set of top-level 'key:' names found."""
    m = marker_re.search(text)
    if not m:
        return None
    brace_idx = text.index('{', m.end() - 1)
    _, inner = extract_balanced(text, brace_idx)
    return {km.group(1) for km in KEY_RE.finditer(inner)}


def scan_file(path):
    text = path.read_text(encoding='utf-8')

    serialize_body = extract_function_body(text, 'serializeState')
    sync_body = extract_function_body(text, 'syncToCloud')
    load_body = extract_function_body(text, 'loadUserData')

    if serialize_body is None or sync_body is None or load_body is None:
        return None  # structural change too big for this heuristic to follow

    local_keys = extract_object_keys_after(serialize_body, re.compile(r'JSON\.stringify\s*\('))
    cloud_keys = extract_object_keys_after(sync_body, re.compile(r'savePrefs\s*\([^,]+,'))
    restored_keys = set(re.findall(r'prefs\.([A-Za-z_$][A-Za-z0-9_$]*)', load_body))

    if local_keys is None or cloud_keys is None:
        return None

    never_synced = sorted(local_keys - cloud_keys)
    never_restored = sorted(cloud_keys - restored_keys)
    return never_synced, never_restored


def main():
    targets = sys.argv[1:] or ['trakyodollas.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        result = scan_file(path)
        if result is None:
            print(f"\n=== {name}: serializeState()/syncToCloud()/loadUserData() not found in expected shape — skipped ===")
            continue
        never_synced, never_restored = result
        print(f"\n=== {name} ===")
        if never_synced:
            print(f"  In serializeState() but missing from syncToCloud()'s savePrefs() payload ({len(never_synced)}):")
            for k in never_synced:
                print(f"    - {k}")
        if never_restored:
            print(f"  In syncToCloud()'s payload but never read as prefs.X in loadUserData() ({len(never_restored)}):")
            for k in never_restored:
                print(f"    - {k}")
        total += len(never_synced) + len(never_restored)
    print(f"\n{total} candidate field(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
