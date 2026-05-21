# trak-yo-dolla$

**Private, local-first spending and net worth tracker.**

Import a CSV from your bank or credit card. Your browser does everything. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Five ways to see your spending** — category treemap, income flow chart, daily heatmap, vendor breakdown, and month-over-month trend. Click any tile to filter transactions instantly.
- **"At a Glance" insights** — a curated card of monthly insights with a lead "Worth your attention" insight surfaced by urgency. Savings rate, budget health, top mover, largest charge, subscriptions, and weekend spending patterns. Each insight links to the relevant tab or action.
- **Budget tab** — set monthly limits, track pace in real time, see AT RISK warnings before you go over. Every category row shows 12-month history dots (tap to expand to percentages). Sort by % used, amount, or A–Z.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory. Project when you'll hit your goal.
- **Messy bank data, cleaned up** — transactions auto-categorize on import. Set keyword rules so "AMZN MKTP" always becomes Shopping. Rules run automatically on every future import.
- **Two demo profiles** — "Early career, building up" (renting, student loan, Roth IRA started, $50k goal) and "Established, tracking it all" (home, investments, multiple accounts). Explore every feature before touching your own data.

---

## Privacy

- **No bank connections** — no logins, no screen scraping, no third-party data brokers. You import a CSV — the same file your bank already gives you.
- **Runs entirely in your browser** — data saves to localStorage. Refresh the page, everything's still there.
- **Nothing leaves your device. Ever — unless you want it to.**
- **Optional sync, never required** — sign in with Google to access your data across devices via Firebase.
- **No paywall** — free to use, all features included.

Full details: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Usually under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with exports from Chase, Ally, Fidelity, Vanguard, and most major banks and credit cards.

**3. Explore**
Transactions are auto-categorized. Switch between chart views, set budgets, add your accounts for net worth tracking.

---

## Tech stack

Single HTML file — no build step, no dependencies to install, no server required.

| Library | Used for |
|---|---|
| [D3.js](https://d3js.org/) v7 | NW trend chart, treemap, daily heatmap |
| [d3-sankey](https://github.com/d3/d3-sankey) | Flow (income/spending) chart |
| [Chart.js](https://www.chartjs.org/) v4 | Spending bar charts |
| [Firebase](https://firebase.google.com/) | Optional Google sign-in and cross-device sync |
| Vanilla JS / CSS | Everything else |

---

## Running locally

Download [`trakyodollas.html`](trakyodollas.html) and open it in a browser. That's it.

For the full site (landing page + app + privacy policy):

```
trak-yo-dollas/
  index.html          ← landing page
  trakyodollas.html   ← the app
  privacy.html        ← privacy policy
```

---

## Deployment

Deployed via [Firebase Hosting](https://firebase.google.com/docs/hosting):

```bash
echo '{"hosting":{"public":".","ignore":["firebase.json","deploy.sh","README.md","*.sh"],"releaseLimit":5}}' > firebase.json
npx firebase-tools deploy --only hosting --project trak-yo-dollas
```

---

## Recent updates

- **Budget tab overhaul** — status grouping (Needs attention / On track), 12-month history dots with tap-to-expand, AT RISK badge, inline projection, sort toggle, dot legend with thresholds, entire card clickable
- **Lead insight system** — "Worth your attention" card promotes the most urgent At a Glance insight with stronger visual treatment and direct action links
- **Dynamic color system** — all category and vendor colors assigned from one canonical map built from lifetime spend data; no fixed palette
- **Daily chart zoom** — +/− controls scale day cells from 12px to 22px for easier mobile tapping
- **Clear all data** — in ··· menu with type-to-confirm safety step; documented in Tips & shortcuts (press ?)
- **Demo Profile 1 rebuilt** — realistic early-career profile with 12 months of history and consistent net worth trajectory
- **localStorage split** — transactions saved separately from settings, only re-serialized when dirty
- **Profile switch** — now fully refreshes Budget tab, source chips, and all rendered state
