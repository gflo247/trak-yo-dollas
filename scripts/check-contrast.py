#!/usr/bin/env python3
"""
Verification script for WCAG AA text contrast on the app's accent color
tokens (--accent-*, --clr-*, --amber-text*), in both themes, across all
three HTML files.

Why this exists: an axe-core audit (August 2026) found 68 dark-theme and
243 light-theme color-contrast violations, despite this codebase having
fixed contrast issues in this same area at least ten separate times before
(see git log for "contrast"/"WCAG"). The pattern every time: a component
hardcodes a literal hex value instead of referencing the theme-aware
--accent-*/--clr-*/--amber-text* CSS variable, so it never picks up the
light-theme override those variables carry -- it just silently ships
whatever the dark-theme value happens to render as on a light background.
138 hardcoded instances of exactly this shape were found and fixed in one
pass (see the commit that added this script). Fixing the instances found
by one audit doesn't fix the pattern -- the next new component that
hardcodes `color:#F87171` instead of `color:var(--accent-red)` regresses
exactly the same way, and nothing before this script would have caught it
before it shipped.

This does two independent, deterministic checks, both exit 1 on failure:

1. TOKEN CONTRAST: every --accent-*/--clr-*/--amber-text* custom property,
   in each theme it's declared for, must reach a 4.5:1 contrast ratio
   against every neutral background token that theme defines
   (--bg-page/--bg-card/--bg-deep). This catches a badly-tuned token
   value even when every consumer correctly uses var().

2. HARDCODED BYPASS: any `color:#RRGGBB` elsewhere in the file (outside
   the variable declaration blocks themselves) whose hex matches a
   declared dark-theme accent/clr/amber-text value is flagged --  it
   should be `color:var(--the-token)` instead, so it inherits the
   light-theme override rather than silently skipping it.

Run manually:
    python3 scripts/check-contrast.py [file ...]
Defaults to trakyodollas.html, index.html, privacy.html.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

ACCENT_TOKEN_RE = re.compile(r'--((?:accent|clr|amber-text)[\w-]*)\s*:\s*(#[0-9A-Fa-f]{6})\b')
BG_TOKEN_RE = re.compile(r'--(bg-page|bg-card|bg-deep)\s*:\s*(#[0-9A-Fa-f]{6})\b')
COLOR_USE_RE = re.compile(r'(?<![\w-])color:(#[0-9A-Fa-f]{6})\b')
MIN_RATIO = 4.5


def relative_luminance(hexcolor):
    hexcolor = hexcolor.lstrip('#')
    r, g, b = (int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))

    def chan(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)


def contrast_ratio(hex1, hex2):
    l1, l2 = relative_luminance(hex1), relative_luminance(hex2)
    l1, l2 = max(l1, l2), min(l1, l2)
    return (l1 + 0.05) / (l2 + 0.05)


def block_from(text, after_pos):
    """Return (start, end) of the {...} block whose opening brace is the
    first '{' at or after after_pos, via brace counting (handles nested
    braces well enough for this file's CSS, which has none inside these
    specific blocks)."""
    brace_start = text.index('{', after_pos)
    depth = 0
    for i in range(brace_start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return brace_start, i + 1
    return None


def find_block(text, opener_re):
    """Return (start, end) of the {...} block immediately following the
    first match of opener_re."""
    m = opener_re.search(text)
    if not m:
        return None
    return block_from(text, m.end() - 1)


def extract_tokens(block_text, pattern):
    found = {}
    for name, hexval in pattern.findall(block_text):
        found[name] = hexval.upper()
    return found


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []

    root_span = find_block(text, re.compile(r':root\s*\{'))
    light_span = find_block(text, re.compile(r'\[data-theme="light"\]\s*\{'))

    dark_block = text[root_span[0]:root_span[1]] if root_span else ''
    light_block = text[light_span[0]:light_span[1]] if light_span else ''

    dark_accents = extract_tokens(dark_block, ACCENT_TOKEN_RE)
    dark_bgs = extract_tokens(dark_block, BG_TOKEN_RE)
    light_accents = extract_tokens(light_block, ACCENT_TOKEN_RE)
    light_bgs = extract_tokens(light_block, BG_TOKEN_RE)
    # Tokens not re-declared in the light block inherit the dark value
    # (CSS custom property fallthrough) -- check those too.
    for name, hexval in dark_accents.items():
        light_accents.setdefault(name, hexval)
    for name, hexval in dark_bgs.items():
        light_bgs.setdefault(name, hexval)

    # Only enforce 4.5:1 on tokens actually used as text color (`color:
    # var(--name)`) somewhere in the file -- some accent tokens (e.g.
    # --accent-blue) are deliberately background/border/focus-ring-only
    # and never render as text, where WCAG's looser 3:1 non-text
    # threshold applies instead. Checking every declared token regardless
    # of how it's used produced false positives for exactly those.
    #
    # A color:var() usage inside a `[data-theme="light"] SELECTOR{...}`
    # rule only ever renders with the light-theme value (that CSS block
    # doesn't apply when data-theme isn't "light"), so it shouldn't count
    # as a dark-theme text usage even though the token's dark-theme value
    # technically exists -- checking it there produced a false positive
    # for --accent-purple-strong (only used as text inside such a block).
    light_scoped_ranges = []
    for m in re.finditer(r'\[data-theme="light"\]', text):
        span = block_from(text, m.end())
        if span:
            light_scoped_ranges.append(span)

    def in_light_scope(pos):
        return any(start <= pos < end for start, end in light_scoped_ranges)

    used_as_text_dark, used_as_text_light = set(), set()
    for m in re.finditer(r'(?<![\w-])color:var\(--((?:accent|clr|amber-text)[\w-]*)\)', text):
        used_as_text_light.add(m.group(1))
        if not in_light_scope(m.start()):
            used_as_text_dark.add(m.group(1))

    for theme, accents, bgs, used_as_text in [
        ('dark', dark_accents, dark_bgs, used_as_text_dark),
        ('light', light_accents, light_bgs, used_as_text_light),
    ]:
        if not bgs:
            continue
        for name, hexval in accents.items():
            if name not in used_as_text:
                continue
            ratios = {bg: contrast_ratio(hexval, bghex) for bg, bghex in bgs.items()}
            worst_bg, worst_ratio = min(ratios.items(), key=lambda kv: kv[1])
            if worst_ratio < MIN_RATIO:
                findings.append(
                    f"[token-contrast] --{name} ({theme} theme, {hexval}) is only "
                    f"{worst_ratio:.2f}:1 against --{worst_bg} ({bgs[worst_bg]}) -- needs {MIN_RATIO}:1"
                )

    # Bypass detector: hardcoded color:#HEX outside the variable-declaration
    # blocks, matching a known dark-theme accent/clr/amber-text value.
    scan_text = text
    for span in sorted([s for s in (root_span, light_span) if s], reverse=True):
        # Blank out the block but keep its newlines, so line numbers for
        # anything after it stay accurate.
        masked = ''.join(c if c == '\n' else ' ' for c in scan_text[span[0]:span[1]])
        scan_text = scan_text[:span[0]] + masked + scan_text[span[1]:]
    hex_to_names = {}
    for name, hexval in dark_accents.items():
        hex_to_names.setdefault(hexval, []).append(name)

    for m in COLOR_USE_RE.finditer(scan_text):
        hexval = m.group(1).upper()
        if hexval in hex_to_names:
            line_no = scan_text.count('\n', 0, m.start()) + 1
            names = '/'.join(f'--{n}' for n in hex_to_names[hexval])
            findings.append(
                f"[hardcoded-bypass] line {line_no}: color:{m.group(1)} matches {names}'s "
                f"dark-theme value -- use color:var({names.split('/')[0]}) instead so light "
                f"theme doesn't silently skip its override"
            )

    return findings


def main():
    targets = sys.argv[1:] or ['trakyodollas.html', 'index.html', 'privacy.html']
    any_fail = False
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        findings = scan_file(path)
        print(f"\n=== {name} ===")
        if findings:
            any_fail = True
            for f in findings:
                print(f"  FAIL: {f}")
        else:
            print("  PASS: all accent/clr/amber-text tokens clear 4.5:1 in both themes, no hardcoded bypasses found")
    sys.exit(1 if any_fail else 0)


if __name__ == '__main__':
    main()
