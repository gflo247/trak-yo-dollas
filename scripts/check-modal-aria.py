#!/usr/bin/env python3
"""
Verification script for the modal keyboard-accessibility work (pass 52's
deferred systemic finding: no modal had a focus trap, ARIA dialog
semantics, or return-focus-on-close).

Unlike this project's other check-*.py scripts (which are heuristic
lint scanners for a fuzzy code-shape pattern, always exit 0, and need a
human to triage false positives), this one verifies a mechanical,
deterministic invariant: every `.modal-overlay`'s `.modal` child must
carry role="dialog", aria-modal="true", tabindex="-1", and an
aria-labelledby that resolves to a real id somewhere else in the file.
There's no ambiguity here -- either the attribute is present and the id
resolves, or it doesn't. So this exits 1 on any failure and is safe to
treat as a hard check, not just advisory triage material.

This does NOT perform the edit itself -- it exists purely to catch
transcription mistakes (a typo'd id, a mismatched aria-labelledby, a
forgotten attribute) across the many modals this covers.

Run manually:
    python3 scripts/check-modal-aria.py [file ...]
Defaults to trakyodollas.html if no args given (the only file with
modal-overlay dialogs).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

MODAL_OVERLAY_RE = re.compile(r'class="modal-overlay hidden" id="([^"]+)"')
DEMO_PICKER_RE = re.compile(r'id="demo-picker-overlay"')
ID_RE = re.compile(r'\bid="([^"]+)"')
REQUIRED_ATTRS = ['role="dialog"', 'aria-modal="true"', 'tabindex="-1"']
ARIA_LABELLEDBY_RE = re.compile(r'aria-labelledby="([^"]+)"')


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def check_modal_div(text, dialog_id, search_start, search_end, all_ids, findings):
    """Find the immediate '.modal' (or '.demo-picker') child within
    [search_start, search_end) and verify its attributes."""
    window = text[search_start:search_end]
    m = re.search(r'<div class="(modal|demo-picker)\b[^"]*"[^>]*>', window)
    if not m:
        findings.append(f"{dialog_id}: no .modal/.demo-picker child div found nearby")
        return
    tag = m.group(0)
    for attr in REQUIRED_ATTRS:
        if attr not in tag:
            findings.append(f"{dialog_id}: missing {attr} on the dialog panel div")
    lm = ARIA_LABELLEDBY_RE.search(tag)
    if not lm:
        findings.append(f"{dialog_id}: missing aria-labelledby on the dialog panel div")
    else:
        target_id = lm.group(1)
        if target_id not in all_ids:
            findings.append(
                f"{dialog_id}: aria-labelledby=\"{target_id}\" does not resolve to any id=\"{target_id}\" in the file"
            )


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    all_ids = set(ID_RE.findall(text))
    findings = []

    overlay_matches = list(MODAL_OVERLAY_RE.finditer(text))
    checked = 0
    for idx, m in enumerate(overlay_matches):
        dialog_id = m.group(1)
        search_start = m.end()
        search_end = overlay_matches[idx + 1].start() if idx + 1 < len(overlay_matches) else len(text)
        before = len(findings)
        check_modal_div(text, dialog_id, search_start, min(search_end, search_start + 2000), all_ids, findings)
        checked += 1
        if len(findings) == before:
            pass  # PASS, no output needed per-item (summary below)

    # #demo-picker-overlay -- different toggle mechanism (style.display),
    # different class (.demo-picker not .modal), added in a later chunk.
    # Only checked if present, so this script works before that chunk lands.
    dp = DEMO_PICKER_RE.search(text)
    if dp:
        check_modal_div(text, 'demo-picker-overlay', dp.end(), dp.end() + 2000, all_ids, findings)
        checked += 1

    return checked, findings


def main():
    targets = sys.argv[1:] or ['trakyodollas.html']
    any_fail = False
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        checked, findings = scan_file(path)
        passed = checked - len({f.split(':')[0] for f in findings})
        print(f"\n=== {name}: {checked} dialog(s) checked ===")
        if findings:
            any_fail = True
            for f in findings:
                print(f"  FAIL: {f}")
        else:
            print(f"  PASS: all {checked} dialog(s) have role=\"dialog\", aria-modal=\"true\", tabindex=\"-1\", and a resolvable aria-labelledby")
    sys.exit(1 if any_fail else 0)


if __name__ == '__main__':
    main()
