# trak-yo-dolla$ — improvement backlog

Roughly in priority order. Stop and re-evaluate after each item ships.

---

## 1. ~~Accessibility pass~~ — DONE

Contrast violations fixed (opacity stacking, raw hex values in JS templates).
axe-core WCAG 2.1 AA now passes clean in both dark and light themes.
Remaining open items from the original review: none — contrast, aria-labels, and touch targets all addressed.

---

## 2. ~~axe-core in deploy.sh~~ — DONE

axe-core is a hard gate in both deploy.sh and CI (dark + light themes).

---

## 3. Playwright test 5 — Supabase sync round-trip

Encrypt → upload → wipe localStorage → decrypt → verify transaction count.
Deferred until after user testing confirms the sync flow is stable end-to-end.

---

## Structural (post-launch, no rush)

- `rebuildMonthly()` still bakes `_bizFilter` into MONTHLY. Every reader that
  should be unfiltered has been individually fixed. The structural fix (keep
  MONTHLY unfiltered; apply filter only at read in renderSpending/renderInsights)
  is cleaner long-term but not urgent — all user-visible paths are correct.
- Function/global count (497 fns, 127 globals) — module split and rendering
  cleanup, after launch.
- ~~CSS class naming standardization~~ — DONE. `.h-btn`, `.fmt-btn`, `.sort-btn`,
  `.src-x-btn` renamed to `.btn-h`, `.btn-fmt`, `.btn-sort`, `.btn-src-x`.

---

## Launch

HN and r/SideProject posts are drafted. PH account warmed. Pending: screenshot
assets and a short screen-recording. Do the accessibility pass first so the
product is in good shape before any traffic spike.
