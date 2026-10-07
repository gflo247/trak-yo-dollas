#!/usr/bin/env python3
"""
Heuristic scanner for the bug class that recurred across three straight
adversarial review passes (15, 16, 17, all 2026-07): a function computes a
spend total or transaction list by hand-rolling its own loop over
state.transactions — reimplementing getBaseTxs()'s exclusion logic
(isRealSpend/t.excluded/excludedCats) inline — instead of calling
getBaseTxs() itself, and in doing so quietly drops whatever guard
getBaseTxs() has that the hand-rolled copy doesn't. Concretely: the
Business/Personal filter (_bizFilter) was added to getBaseTxs() on
2026-07-02, but Treemap, Daily Calendar (pass 15), the tx-row "% of
month" badge (pass 16), and the MONTHLY cache + computePeriodSpendVsIncome
(pass 17) all had their own separate transaction loops that never got the
same guard added, because nothing forced every call site touching this
logic to be looked at together.

This script flags every state.transactions.filter(...)/.forEach(...)/
.some(...)/.every(...) call whose predicate references a signal that it's
reimplementing base spend-filtering (isRealSpend(t), t.excluded,
excludedCats, t.isIncome) but does NOT reference _bizFilter anywhere in
the same expression. That is exactly the shape of every confirmed bug in
this class so far. (.some()/.every() were added after the 18th pass found
a real instance -- renderBucketGrid()'s category-tile "latest month with
spend" check -- that the original filter/forEach/map/reduce-only regex
missed entirely.)

This is a heuristic, not a JS parser — it WILL have false positives:
- A loop deliberately searching for excluded/income transactions (the
  opposite of filtering them out), e.g. `t.excluded && !t.is_offset` when
  scanning specifically for excluded deposits.
- A loop that's deliberately meant to be lifetime/unfiltered-by-design
  rather than an oversight.
- A loop that already gets its transactions pre-filtered by a caller
  (e.g. operates on a variable derived from getBaseTxs() rather than
  state.transactions directly — those aren't matched by this script at
  all, since it only anchors on the literal `state.transactions` receiver).

Every flagged line needs a human look, not blind trust. Run manually:
    python3 scripts/check-bizfilter-coverage.py [file ...]
Defaults to trakyodollas.html if no args given (the other HTML files
don't have a transactions model).
Exits non-zero when findings > 0 (hard deploy gate). False positives are
handled via KNOWN_FALSE_POSITIVES; add an entry there with a reason rather
than suppressing the exit.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

ANCHOR_RE = re.compile(r'state\.transactions\.(filter|forEach|map|reduce|some|every)\(')

# Presence of any of these inside the call's arguments means the call is
# reimplementing some piece of getBaseTxs()'s exclusion logic by hand.
SIGNAL_RE = re.compile(r'isRealSpend\(|\.excluded\b|excludedCats|\.isIncome\b')

# The guard every one of these should have picked up from getBaseTxs() but
# didn't, in each confirmed bug so far.
GUARD_RE = re.compile(r'_bizFilter')


# Known false positives, confirmed by manual review (each one matches a
# category already named in this file's docstring/deploy.sh comment).
# Keyed by the exact matched snippet text so a suppression naturally
# expires the moment the underlying code at that site actually changes --
# this silences already-reviewed sites, not a blanket line-number pin.
KNOWN_FALSE_POSITIVES = {
    # buildCatColorMap() -- lifetime/unfiltered-by-design color-assignment
    # cache, not a spend total; explicitly named in this scanner's own
    # deploy.sh comment as a known false positive.
    't=>!t.excluded',
    # openVendorAliasModal() -- populates a vendor-name datalist from all
    # transactions ever entered, not a filtered spend view; "datalist
    # population" is named in this scanner's deploy.sh comment.
    't=>!t.excluded&&!CHECK_RE.test(t.desc)',
    # applyVenmoOpt() -- deliberate bulk-recategorization action, named
    # explicitly in this scanner's deploy.sh comment.
    "t=>{ if(!ids||!ids.has(t.id))return; if(opt==='exclude'){ t.excluded=true;t.is_offset=false; } else { const cat=opt==='custom'?customCat:'Sh",
    # renderTxSourcesPanel() -- finds latest transaction date per card/source
    # to show "last imported X days ago" for each account. Intentionally
    # looks at all sources, not just _bizFilter'd ones -- you want to see
    # when every account was last updated, not just the currently filtered view.
    't=>{ if(!t.card||t.excluded||t.isIncome)return; if(!sourceMax[t.card]||t.date>sourceMax[t.card])sourceMax[t.card]=t.date; }',
    # updateImportSourceHint() -- finds most recent transaction for the
    # specific source name being typed in the import modal ("Last data from
    # this source: X days ago"). Looks up a named source directly; applying
    # _bizFilter here would give wrong results for a biz-only source.
    't=>t.card&&t.card.toLowerCase()===srcLower&&!t.isIncome',
    # avgTotalMonthlySpend() -- intentionally omits _bizFilter; the cushion is
    # a whole-picture number and must not change based on the Spending tab's
    # current business/personal filter. Computes directly from transactions
    # instead of reading the shared MONTHLY cache precisely to avoid this leak.
    't=>{ if(t.excluded||t.isIncome)return; if(state.excludedCats&&state.excludedCats.has(t.cat))return; const mo=t.date.slice(0,7); if(mo>=curre',
    # getTxForMonth() -- the function that enforces _bizFilter IS this function;
    # it now accepts a `bizFilter` parameter so Budget and Life Changes callers
    # can pass their own value. The pattern checks bizFilter (the param) rather
    # than the global _bizFilter -- this is the correct implementation, not a
    # missing guard. Every call site that should respect Spending's _bizFilter
    # still calls getTxForMonth() without a third arg (defaulting to _bizFilter).
    't=>t.date.slice(0,7)===m&&!t.excluded&&!t.isIncome&&state.activeSources.has(t.card)&&(bizFilter!==\'biz\'||t.biz)&&(bizFilter!==\'personal\'||!t',
    # getBudgetHistMonths() -- scans transactions to build the month list with
    # its own `bizFilter` parameter (same rationale as getTxForMonth() above).
    # Budget passes _budgetBizFilter; Life Changes and the cushion pass 'all'.
    't=>{ if(t.excluded||t.isIncome)return; if(!state.activeSources.has(t.card))return; if(bizFilter===\'biz\'&&!t.biz)return; if(bizFilter===\'pers',
    # renderBudgetTab() monthTx -- Budget has its own independent _budgetBizFilter
    # separate from Spending's _bizFilter. Using _budgetBizFilter here is correct:
    # the two tabs' filters are intentionally decoupled so switching Spending's
    # filter doesn't silently change what the Budget tab counts.
    't=>t.date.slice(0,7)===ym&&isRealSpend(t)&&state.activeSources.has(t.card)&&(_budgetBizFilter!==\'biz\'||t.biz)&&(_budgetBizFilter!==\'personal',
    # exportBudgetCSV() -- same _budgetBizFilter rationale as renderBudgetTab()
    # above; the CSV export follows Budget's own filter, not Spending's.
    't=>{ if(t.excluded||t.isIncome)return; if(!state.activeSources.has(t.card))return; if(_budgetBizFilter===\'biz\'&&!t.biz)return; if(_budgetBiz',
    # getLatestDataMonth() -- intentionally reads all transactions unfiltered;
    # the fix for the MONTHLY filter-leak class. Reading _bizFilter here would
    # reintroduce exactly the bug being fixed (Budget tab navigating to the
    # wrong month when Business is active).
    't=>{ if(t.excluded||t.isIncome)return; if(!state.activeSources.has(t.card))return; const mo=t.date.slice(0,7); if(mo>latest)latest=mo; }',
    # NW goal widget avgSpend -- intentionally reads all transactions unfiltered;
    # the NW tab must never follow Spending's _bizFilter, same class of fix.
    't=>{ if(t.excluded||t.isIncome)return; if(!state.activeSources.has(t.card))return; const mo=t.date.slice(0,7); if(mo>=curMo)return; moSpend[',
}


def extract_balanced_parens(text, open_paren_idx):
    """Given the index of an opening '(' , returns (end_idx, inner_text)
    for its balanced match, handling nested parens/braces/brackets so an
    arrow function body with its own function calls or object literals
    doesn't truncate the extraction early."""
    depth = 0
    i = open_paren_idx
    n = len(text)
    start = open_paren_idx + 1
    while i < n:
        c = text[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0:
                return i, text[start:i]
        i += 1
    return n, text[start:n]


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def scan_file(path):
    text = path.read_text(encoding='utf-8')
    findings = []
    for m in ANCHOR_RE.finditer(text):
        open_idx = m.end() - 1
        end_idx, inner = extract_balanced_parens(text, open_idx)
        signal = SIGNAL_RE.search(inner)
        if not signal:
            continue
        if GUARD_RE.search(inner):
            continue
        snippet = inner.strip().replace('\n', ' ')
        snippet = re.sub(r'\s+', ' ', snippet)[:140]
        findings.append((line_of(text, m.start()), m.group(1), signal.group(0), snippet))
    return findings


def main():
    targets = sys.argv[1:] or ['trakyodollas.html']
    total = 0
    for name in targets:
        path = ROOT / name
        if not path.exists():
            print(f"skip {name}: not found")
            continue
        all_findings = scan_file(path)
        findings = [f for f in all_findings if f[3] not in KNOWN_FALSE_POSITIVES]
        suppressed = len(all_findings) - len(findings)
        print(f"\n=== {name} ({len(findings)} candidate site{'s' if len(findings) != 1 else ''}"
              f"{f', {suppressed} already-reviewed suppressed' if suppressed else ''}) ===")
        for line, method, signal, snippet in findings:
            print(f"  line {line}: .{method}(...) reimplements exclusion via '{signal}' with no _bizFilter guard")
            print(f"    {snippet}")
        total += len(findings)
    print(f"\n{total} candidate site(s) across {len(targets)} file(s) — heuristic only; for each finding, either fix the underlying code or add a justified suppression to KNOWN_FALSE_POSITIVES.")
    sys.exit(total > 0)


if __name__ == '__main__':
    main()
