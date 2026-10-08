# trak-yo-dolla$ — improvement backlog

Roughly in priority order. Stop and re-evaluate after each item ships.

---

## 1. Accessibility pass (contrast, aria-labels, touch targets)

Flagged in an external layout/UX review. Three buckets:
- **Contrast** — a handful of muted text colors that don't clear WCAG AA at small sizes
- **aria-labels** — icon-only buttons (⚙, 🌙, ✕) missing accessible names
- **Touch targets** — some action buttons below 44×44px on mobile

Larger effort; do as a dedicated pass rather than piecemeal.

---

## 2. axe-core in deploy.sh

Add `axe-core` as a hard deploy gate (same pattern as the existing scanners).
Blocked on item 1 — run axe clean first, then gate on it so it can't regress.

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

---

## Launch

HN and r/SideProject posts are drafted. PH account warmed. Pending: screenshot
assets and a short screen-recording. Do the accessibility pass first so the
product is in good shape before any traffic spike.
