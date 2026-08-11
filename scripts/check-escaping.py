#!/usr/bin/env python3
"""
Heuristic scanner for the one bug class that has recurred more than any
other across this app's security reviews: a template-literal interpolation
(${...}) that renders free-text, user/CSV/backup-derived data (a category
name, vendor, description, color, etc.) without wrapping it in esc() first.

Every real finding across four separate adversarial review passes on
2026-07-06 was exactly this shape — not a new bug category each time, the
same one recurring in a sibling spot the previous pass hadn't looked at
yet. This script exists so the next sibling instance doesn't require a
fifth agent to find it: it flags every ${...} expression that touches a
known "risky" field name and isn't wrapped in esc(...) anywhere within
that expression.

This is a heuristic, not a JS parser — it WILL have false positives
(e.g. a risky-named field used in a boolean check, not rendered as text).
Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-escaping.py [file ...]
Defaults to trakyodollas.html, index.html, privacy.html if no args given.
Exits 0 always (reporting tool, not a hard deploy gate) — the false-positive
rate isn't low enough yet to block deploys automatically; see the bottom
of the output for a summary count.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# Field names this codebase has repeatedly stored free-text, attacker- or
# user-reachable content in, based on every finding from the 2026-07-06
# review passes (category names, vendor/description text, community-rules
# entries, custom category color/type, etc.) plus generically risky ones.
RISKY_FIELDS = [
    'cat', 'desc', 'description', 'name', 'keyword', 'vendor', 'source',
    'type', 'color', 'make', 'model', 'memo', 'note', 'label', 'comment',
    'card', 'tag', 'city', 'address', 'trim', 'series', 'condition', 'vin',
]
# Bare identifiers (not just `.field` access) already proven risky by a
# real past finding — checked as exact-identifier matches only, to keep
# the false-positive rate down.
RISKY_BARE_NAMES = ['tip', 'q']

FIELD_RE = re.compile(r'\.(' + '|'.join(RISKY_FIELDS) + r')\b')
BARE_RE = re.compile(r'(?<![\w.$])(' + '|'.join(RISKY_BARE_NAMES) + r')(?![\w$])')


def _blank_full_line_comments(text):
    """Replaces every line whose trimmed content starts with '//' with
    equal-length whitespace, so a documentation comment that happens to
    quote example code (e.g. `${c.color}` inside a sentence explaining a
    past bug) doesn't get scanned as if it were real, executable code --
    found via the 170th adversarial pass, where exactly that shape let a
    single suppression-allowlist key silently stand in for two different
    sites (one real, one just prose) with only one of the two actually
    justified. Deliberately conservative: only lines that are ENTIRELY a
    // comment (nothing but whitespace precedes it) are blanked, not
    inline `code(); // trailing comment` -- an inline `//` could appear
    inside a string or URL, and this scanner has no real JS tokenizer to
    tell that apart safely. Preserves total length and every line number
    exactly (same-length whitespace, nothing deleted), so line_of() below
    stays accurate for every genuine finding."""
    return '\n'.join(
        ' ' * len(line) if line.strip().startswith('//') else line
        for line in text.split('\n')
    )


def extract_template_exprs(text):
    """Yields (start, end, expr_text) for every ${...} in the source,
    handling nested braces so an expression containing an object literal
    or a nested function call doesn't truncate early."""
    i = 0
    n = len(text)
    while i < n:
        if text[i] == '$' and i + 1 < n and text[i + 1] == '{':
            start = i + 2
            depth = 1
            j = start
            while j < n and depth > 0:
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                j += 1
            end = j - 1
            yield (start, end, text[start:end])
            i = j
        else:
            i += 1


def esc_wrapped_spans(expr):
    """Returns a list of (start, end) spans within `expr` that are inside
    an esc(...) call's arguments, handling balanced parens so esc(a, f(b))
    style nesting doesn't break the containment check."""
    spans = []
    for m in re.finditer(r'\besc\(', expr):
        start = m.end()
        depth = 1
        j = start
        while j < len(expr) and depth > 0:
            if expr[j] == '(':
                depth += 1
            elif expr[j] == ')':
                depth -= 1
            j += 1
        spans.append((start, j - 1))
    return spans


def is_covered(pos_start, pos_end, spans):
    return any(s <= pos_start and pos_end <= e for s, e in spans)


# Known false positives for trakyodollas.html, confirmed by a dedicated
# data-provenance trace of every candidate this scanner reported (not
# waved through on shape alone -- see the specific reason on each group
# below). Keyed by (expr, matched_field) so a suppression naturally
# expires the moment the underlying expression's text actually changes --
# this silences already-reviewed sites, not a blanket line-number pin.
# Scoped per-file (see TRAKYODOLLAS_KNOWN_FALSE_POSITIVES usage in main())
# since these snippets were only traced for this one file.
TRAKYODOLLAS_KNOWN_FALSE_POSITIVES = {
    # renderCatManagerList()'s color dot: c.color comes from getCatColor(),
    # same validated-color path as the ('getCatColor(t.cat)','.cat') entry
    # below. (A second, textually-identical `${c.color}` used to also
    # appear inside a documentation comment a few hundred lines above this
    # site -- that one is no longer a candidate at all now that scan_file()
    # blanks out full-line `//` comments before extraction, rather than
    # being silenced by this same key standing in for two different
    # justifications at once.)
    ('c.color', '.color'),

    # pillWithTip()'s `tip` param: the .replace(/"/g,...) here only
    # neutralizes attribute-breakout; the actual render sink,
    # showPillTip(), re-escapes with a real esc(tip) call before its own
    # innerHTML write. Deliberate double-escoping, not a gap.
    ('tip.replace(/"/g,\'&quot;\')', 'tip'),
    ('hint?` <span data-tip="${hint}" data-action="showPillTip" data-stop="1" tabindex="0" role="button" aria-label="More info', 'tip'),
    # False match: the regex matched the literal substring "tip" inside
    # the HTML attribute name `data-tip=` in an otherwise fully hardcoded
    # string (no interpolated risky field at all).
    ('data.isCollapsed?` <span data-tip="Individual check numbers collapsed — categorize a check to split it out" data-action=', 'tip'),

    # cta.label: every pillWithTip() caller passes either a hardcoded
    # string or (the one variable case) a value already esc()-wrapped at
    # construction (biggestCat.cat via `See ${esc(biggestCat.cat)}...`).
    # Key text bumped from font-size:10px to :12px along with the rest of
    # the Spending tab's legibility sweep -- this suppression naturally
    # expiring on that text change (rather than silently continuing to
    # match) is this scanner's own designed behavior; same site, just
    # re-confirmed and re-keyed.
    ('(sub||cta)?`<div style="font-size:12px;color:var(--text-muted);line-height:1.35">${sub}${cta?` · <button data-action="${', '.label'),

    # renderNwBreakdown()'s GROUPS array is a hardcoded literal
    # ({label:'Investments',color:'#34D399',...}), never user-settable.
    ('g.color', '.color'),
    ("isNeg?'#F87171':g.color", '.color'),
    ("g.isLiab?'#F87171':g.color", '.color'),
    ('g.label', '.label'),
    # Whitespace mid-key is real -- this expression's middle line was a
    # full-line comment, now blanked by _blank_full_line_comments() before
    # scanning reaches this point, so the key must match the blanked form.
    ("g.isLiab\n" + " " * 76 + "\n" + " " * 34, '.color'),

    # fmtMonthShort(m) date-formatter output, not free text.
    ("biggestMonth?.label||'—'", '.label'),
    ("quietestMonth?.label||'—'", '.label'),

    # Math.ceil(mo/3), a numeric quarter index -- not a search-query
    # string despite the bare `q` name.
    ('q', 'q'),

    # Hardcoded `chips` array literal ({label:'3mo',...} etc.).
    ('chips.map(c=>`<button class="h-btn${chipActive(c)?\' active\':\'\'}"${c.id?` id="${c.id}"`:\'\'}  data-action="setQuickRange" ', '.label'),

    # t.desc used only inside resolveVendor(t.desc)===vendor, a boolean
    # filter predicate -- never rendered as text.
    # Whitespace mid-key is real -- see the g.isLiab entry above for why.
    ('(()=>{\n' + " " * 76 + "\n" + " " * 36, '.desc'),

    # Sankey chart d.name: set via D3's .attr()/.text(), which use
    # setAttribute/textContent under the hood -- no HTML parsing regardless
    # of content.
    ('d.name', '.name'),

    # Chart.js tooltip callbacks.label return values -- none of the 5
    # tooltip configs use an `external` HTML renderer, so Chart.js draws
    # these via canvas fillText, immune to HTML/script injection.
    ('ctx.dataset.label', '.label'),

    # Routed through the local highlight(text) helper, which wraps every
    # return path in esc(...) internally -- the scanner can't see through
    # a helper function's own escaping.
    ('highlight(displayVendor(t.desc))', '.desc'),
    ('highlight(t.cat)', '.cat'),
    ("highlight(t.card.replace('Chase ','').replace(' Unlimited','Unlim').replace('Ally ',''))", '.card'),

    # a.source used only as an object key into the hardcoded SA_M lookup
    # map -- the map's value (or a literal '??') is what's rendered.
    ("SA_M[a.source]||'??'", '.source'),
    # a.type used only via isLiab(a.type) (boolean) and as a key into a
    # hardcoded map -- never rendered as text.
    ("(isLiab(a.type)?-a.balance:a.balance)<0?'#F87171':tc", '.type'),
    ("(isLiab(a.type)?-a.balance:a.balance)<0?'-':''", '.type'),

    # Already esc(v.vin)-wrapped at the actual render point; the flagged
    # match is just the preceding `v.vin?` existence check. Re-keyed when
    # renderVehicles() was rebuilt around a new outer `${state.vehicles.
    # map(v=>{...}).join('')}` template wrapper (Physical assets rebuilt
    # to match the rest of the Accounts tab's tighter row format) --
    # this scanner's brace-counting expr extractor got confused by the
    # combination of that new outer ${...} boundary and the existing
    # if(isOther){...} block's own braces, and now reports a nonsensical
    # expr slice that doesn't even contain ".vin" as the "match context."
    # Confirmed by direct re-inspection: the actual v.vin usage a few
    # lines later is unchanged, still wrapped in esc() exactly as this
    # entry originally verified.
    ("state.vehicles.map(v=>{\n    const isOther=v.assetType==='other';\n    const vValue=Number(v.value)||0;\n\n    if(isOther){\n", '.vin'),

    # Hardcoded literal object (sortDirLabels.unusual = {desc:...,asc:...}
    # is a sort-direction key, not a transaction description field).
    ('sortDirLabels.unusual.desc', '.desc'),

    # Assigned via `warn.textContent = ...`, not innerHTML -- a plain-text
    # sink, immune regardless of content.
    ('conflict.cat', '.cat'),
    ('shadowed.cat', '.cat'),
    ('shadowed.keyword', '.keyword'),

    # getCatColor()/assignColors() both gate every custom-category color
    # through isValidHexColor() before ever returning it, falling back to
    # a deterministic stringToColor() hash otherwise -- genuinely
    # validated in both code paths, not just documented as such.
    ('getCatColor(t.cat)', '.cat'),
}


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = _blank_full_line_comments(path.read_text(encoding='utf-8'))
    findings = []
    for start, end, expr in extract_template_exprs(text):
        esc_spans = esc_wrapped_spans(expr)
        for m in FIELD_RE.finditer(expr):
            if not is_covered(m.start(), m.end(), esc_spans):
                findings.append((line_of(text, start + m.start()), expr.strip()[:120], m.group(0)))
        for m in BARE_RE.finditer(expr):
            if not is_covered(m.start(), m.end(), esc_spans):
                findings.append((line_of(text, start + m.start()), expr.strip()[:120], m.group(0)))
    # de-dupe identical (line, expr) pairs — a single expression can match
    # more than one risky field name
    seen = set()
    deduped = []
    for f in findings:
        key = (f[0], f[1])
        if key not in seen:
            seen.add(key)
            deduped.append(f)
    return sorted(deduped)


def main():
    targets = sys.argv[1:] or ['trakyodollas.html', 'index.html', 'privacy.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        all_findings = scan_file(path)
        allowlist = TRAKYODOLLAS_KNOWN_FALSE_POSITIVES if name == 'trakyodollas.html' else set()
        findings = [f for f in all_findings if (f[1], f[2]) not in allowlist]
        suppressed = len(all_findings) - len(findings)
        print(f"\n=== {name} ({len(findings)} candidate site{'s' if len(findings)!=1 else ''}"
              f"{f', {suppressed} already-reviewed suppressed' if suppressed else ''}) ===")
        for line, expr, matched in findings:
            print(f"  line {line}: matched '{matched}' in ${{{expr}}}")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only, review each one manually.")


if __name__ == '__main__':
    main()
