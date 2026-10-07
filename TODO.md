# trak-yo-dolla$ — improvement backlog

Roughly in priority order. Stop and re-evaluate after each item ships.

---

## ✅ Done (this session and prior)

- Goal line axis scaling, Emergency cushion rename, demo snapshot math
- Offline verified; "load demo, turn off Wi-Fi" on landing page
- Life Changes Stage 1 (result to top + goal-date line); Stage 3 (before/after cut)
- Bank export guides (Chase, BofA, Wells Fargo, Capital One, Ally)
- Monthly re-import panel ("last imported X days ago" per source)
- Landing page trimmed to ~5 cards
- Travel tile avg denominator fix
- iOS Safari 7-day data-loss banner (shows on first real import; home-screen exempt)
- avgTotalMonthlySpend() fix (cushion reads from transactions, unfiltered)
- Budget tab: independent _budgetBizFilter toggle (shown when Include Income is on)
- Life Changes + Budget Health pill: always unfiltered ('all')
- getBudgetHistMonths: reads transactions directly (not MONTHLY)
- getLatestDataMonth: reads transactions directly (not MONTHLY)
- getBudgetRowMetrics YTD start: uses histMonths[0] not ALL_MONTHS[0]
- NW goal widget avgSpend: reads transactions directly (not MONTHLY)
- All 7 deploy gate scanners hardened to hard gates

---

## 1. Monthly recap (print / save as PDF)

Plain-English summary, top movers, budget status, NW change — one page for a monthly money check-in with a partner. No sync or account required. Gets stronger once Life Changes can add "on track for [goal] by [date]."

---

## 2. Schema version on user data

Add a version field to `serializeState()`/`savePrefs()` before the next change to the data shape. No migration needed yet — just the version stamp so future changes have a safe upgrade path.

**When:** before the next deploy that changes any field in the saved state.

---

## 3. Deploy guard + visible build ID

`deploy.sh` doesn't currently block uncommitted or unpushed changes. The app shows no build ID. Two small additions:
- Block deploy if `git status` is dirty or branch is behind remote
- Inject a build timestamp/commit hash into the page (footer or `<meta>`)

---

## 4. Browser-level test suite (Playwright)

The existing pure.test.js suite catches logic bugs but can't catch render/interaction bugs. A ~30-line Playwright harness covering:
- Cushion stays constant while biz filter changes
- Import → reload round-trip
- Backup round-trip
- Demo-to-real switch
- Sync encrypt/decrypt round-trip

This is the highest-leverage process improvement. Enables retiring some scanners.

---

## Structural (post-launch, no rush)

- `rebuildMonthly()` still bakes `_bizFilter` into MONTHLY. Every reader that should be unfiltered has been individually fixed (cushion, Budget, Life Changes, getLatestDataMonth, NW goal widget). The structural fix (keep MONTHLY unfiltered; apply filter at read in renderSpending/renderInsights only) is cleaner long-term but not urgent — all user-visible paths are correct.
- Function/global count (497 fns, 127 globals) — module split and rendering cleanup, after launch.
