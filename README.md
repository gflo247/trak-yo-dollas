# trak-yo-dolla$

**Private, local-first spending and net worth tracker.**

Import a CSV from your bank or credit card. Your browser does everything. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Five ways to see your spending** — category treemap, income flow chart, daily heatmap, vendor breakdown, and month-over-month trend. Click any tile to filter transactions instantly and find out that "miscellaneous" is mostly coffee shops.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory. Project when you'll hit your goal.
- **Budgets and year in review** — set monthly limits per category. Pull up an annual summary and find out you spent $4,200 on restaurants last year — then decide if that's fine or not.
- **Messy bank data, cleaned up** — transactions auto-categorize on import. Set keyword rules so "AMZN MKTP" always becomes Shopping. Merge duplicate vendor names. Rules run automatically on every future import.
- **Recurring charge detection** — surfaces subscriptions and regular charges automatically, including that $12.99 trial you forgot to cancel.
- **Two demo profiles** — explore every feature with realistic data before touching your own.

---

## Privacy

- **No bank connections** — no logins, no screen scraping, no third-party data brokers. You import a CSV — the same file your bank already gives you.
- **Runs entirely in your browser** — data saves to localStorage. Refresh the page, everything's still there. Close the tab, nobody else has it.
- **Optional sync, never required** — sign in with Google to access your data across devices via Firebase. Your data is secured by your Google account, not ours. Everything works without signing in.
- **No screen scraping** — we never log into your bank on your behalf.
- **No paywall** — free to use, all features included.

Full details: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Usually under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, go to Spending, click ⬆ Import CSV. Works with exports from Chase, Ally, Fidelity, Vanguard, and most major banks and credit cards.

**3. Explore**
Your transactions are auto-categorized and ready to explore. Switch between chart views, set budgets, add your accounts for net worth tracking.

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

The app is deployed via [Firebase Hosting](https://firebase.google.com/docs/hosting). To deploy your own instance:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

---

## Feedback and contributions

Found a bug or have a feature request? [Open an issue](https://github.com/gflo247/trak-yo-dollas/issues).

Pull requests welcome. The entire app is one HTML file (~6,700 lines) with clearly marked sections — search for `// ──` to navigate between them.

---

## Recent updates

- Interactive chart filtering — click tiles in the treemap, flow chart, and daily heatmap to filter transactions
- D3 net worth trend chart with animated draw, goal line, and snapshot dots  
- Net worth goal widget with progress bar and ETA projection
- Custom goal and delete snapshot modals (replaced native browser dialogs)
- Spending toolbar overflow menu — primary actions promoted, config in `···`
- App footer with Privacy, GitHub, and Feedback links
- Full security pass — CSP meta tag, `rel="noopener noreferrer"`, `type="button"` on all buttons, `lang="en"`, `<main>` landmark
- `activeSources` and `activeHorizon` persisted to localStorage (fixes blank Spending tab on return visit)
- Search debounced, `Escape` clears all active filters
- NW trend chart range based on full snapshot history regardless of transaction data range
