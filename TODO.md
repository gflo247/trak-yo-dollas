# trak-yo-dolla$ — improvement backlog

Roughly in priority order. Stop and re-evaluate after each item ships.

---

## 1. Fix Net Worth credibility issues (do now)

- [x] **Goal line axis scaling** — $750k goal pinned at top of a ~$395k axis looks nearly reached. Scale chart to data; show goal progress as a separate bar (the "52% there" text already exists).
- [x] **Rename "Retirement runway" → "Emergency cushion"** — current figure is cash ÷ spending, not a retirement projection. One-liner rename.
- [x] **Demo snapshot math** — Established profile claims ~47% savings rate / ~$4.5k/mo saved, but NW grows only ~$1k/mo. Verify whether the model is at fault or the snapshots need adjustment before touching either.

---

## 2. Verify offline / make privacy provable

- [ ] Load demo, turn off Wi-Fi, confirm charts render. Chart.js comes from CDN and is **not** in the SW PRECACHE list — if charts fail offline, cache the library first.
- [ ] Once confirmed working, add "Load the demo, turn off Wi-Fi, keep using it" to the landing page. Don't claim it until it's true.

---

## 3. Life Changes → "can we afford this?" (staged)

Stop after each stage and evaluate whether it justifies the next one.

- [ ] **Stage 1 (cheap):** Move result to top of the tab. Add one line showing how the change moves the net worth goal date. This tests whether anyone cares.
- [ ] **Stage 2:** Real per-preset inputs — car (price, rate, term); childcare (start/end dates); mortgage replacing rent (price, down payment, rate). Hide Rent→Mortgage preset when profile already has a mortgage.
- [ ] **Stage 3:** Before/after chart.

Notes: project NW using savings from cash flow + editable assumed return on invested assets (not cash flow alone). Keep copy as "preview," never "advice." Only lead the landing page with this after Stage 1 ships and shows traction.

---

## 4. Bank export guides (one page per bank)

- [ ] Write text-first guides: "How to download your [Bank] transactions as a CSV file." Start with Chase, BofA, Wells Fargo, Capital One, Ally.
- [ ] Stamp each with "last verified [month]" — bank UIs change, screenshots go stale.
- [ ] SEO latency is months, not weeks. Start early.

---

## 5. Monthly re-import habit — "Accounts to update" panel

- [ ] **First:** confirm whether overlapping imports already skip duplicates. If yes, surface "12 already imported, skipped" on screen. If no, fix duplicate detection before building the panel.
- [ ] Add panel showing each account's last import date, linking to that bank's guide (item 4).

---

## 6. Monthly recap (print / save as PDF)

- [ ] Plain-English summary, top movers, budget status, NW change — one page for a monthly money check-in with a partner.
- [ ] No sync or account required.
- [ ] Gets meaningfully stronger after Life Changes (item 3) can add "on track for [goal] by [date]."

---

## 7. Trim landing page feature list

- [ ] Cut from eleven cards to ~five. Let the demo show the rest.
- [ ] Do after items 1–3 settle so the kept cards reflect what actually matters.

---

## Bug to verify

- [ ] **Travel tile avg** — was seen once showing "Avg: $753/mo" where $7,232 ÷ 17–18 months ≈ $425. The old all-months avg formula could explain it; the recent `periodAvg` fix may have resolved it. Verify on current demo data after SW cache clears.
