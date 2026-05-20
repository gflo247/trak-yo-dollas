# trak-yo-dolla$

**Private, local-first spending and net worth tracker.**

Import a CSV from your bank or credit card. Your browser does everything. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Five ways to see your spending** — category treemap, income flow chart, daily heatmap, vendor breakdown, and month-over-month trend. Click any tile to filter transactions instantly and find out that "miscellaneous" is mostly coffee shops.
- **"At a Glance" insights** — a curated card of monthly insights with a lead "Worth your attention" insight surfaced by urgency. Savings rate, budget health, top mover, largest charge, subscriptions, and weekend spending patterns.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory. Project when you'll hit your goal.
- **Budgets and year in review** — set monthly limits per category and track pace in real time. Pull up an annual summary and find out you spent $4,200 on restaurants last year.
- **Messy bank data, cleaned up** — transactions auto-categorize on import. Set keyword rules so "AMZN MKTP" always becomes Shopping. Merge duplicate vendor names. Rules run automatically on every future import.
- **Recurring charge detection** — surfaces subscriptions and regular charges automatically, including that $12.99 trial you forgot to cancel.
- **Two demo profiles** — "Early career, building up" and "Established, tracking it all." Explore every feature with realistic data before touching your own.

---

## Privacy

- **No bank connections** — no logins, no screen scraping, no third-party data brokers. You import a CSV — the same file your bank or credit card already gives you.
- **Runs entirely in your browser** — data saves to localStorage. Refresh the page, everything's still there. Close the tab, nobody else has it.
- **Nothing leaves your device. Ever — unless you want it to.**
- **Optional sync, never required** — sign in with Google to access your data across devices via Firebase. Your data is secured by your Google account, not ours.
- **No paywall** — free to use, all features included.

Full details: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Usually under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with exports from Chase, Ally, Fidelity, Vanguard, and most major banks and credit cards.

**3. Explore**
Transactions are auto-categorized and ready to explore. Switch between chart views, set budgets, add your accounts for net worth tracking.

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
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

---

## Feedback and contributions

Found a bug or have a feature request? [Open an issue](https://github.com/gflo247/trak-yo-dollas/issues).

The entire app is one HTML file (~6,900 lines) with clearly marked sections — search for `// ──` to navigate between them.

---

## Recent updates

- **Lead insight system** — "Worth your attention" card promotes the most urgent insight (low savings rate, over-budget category, unusual spending spike) with stronger visual treatment
- **Progressive disclosure** — At a Glance shows 3 pills by default with expand/collapse
- **Dynamic color system** — all category and vendor colors assigned by stride-based algorithm for maximum perceptual distance across whatever's in your data. No fixed color palette.
- **Tab reorder** — Spending is now the first and default tab (most immediately useful)
- **"At a Glance" moved to Spending tab** — where it belongs, above the category tiles
- **Interactive chart filtering** — click tiles in treemap, flow chart, and daily heatmap to filter transactions. Filters clear when switching chart modes or tabs.
- **Net Worth visual hierarchy** — three clear tiers: trend (primary), goal (secondary), breakdown + snapshots (tertiary)
- **Demo Profile 1 rebuilt** — realistic early-career profile: Ally checking/HYSA, Fidelity Roth IRA + 401k, student loan, 12 months of transaction history, $50k NW goal
- **Tips & shortcuts modal** — press `?` anywhere. One-time hint toast on first visit.
- **D3 net worth trend chart** — animated draw, goal line, snapshot dots, dynamic date range from snapshot history
- **Full security pass** — CSP, `rel="noopener noreferrer"`, `type="button"` on all buttons, `localStorage` try/catch, no native `prompt()`/`confirm()`
