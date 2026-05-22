# trak-yo-dolla$

**Private, local-first spending and net worth tracker.**

Import a CSV from your bank or credit card. Your browser does everything. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Five ways to see your spending** — category treemap, income flow chart, daily heatmap, vendor breakdown, and month-over-month trend. Click any tile to filter transactions instantly.
- **"At a Glance" insights** — a curated card of monthly insights with a lead "Worth your attention" insight surfaced by urgency. Savings rate, budget health, top mover, largest charge, subscriptions, and weekend spending patterns. Each insight links to the relevant tab or action.
- **Budget tab** — set monthly limits, track pace in real time, see AT RISK warnings before you go over. Every category row shows 12-month history dots (tap to expand to percentages). Sort by % used, amount, or A–Z. Export budget history as CSV.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory. Project when you'll hit your goal.
- **Smart auto-categorization** — four-tier system: your keyword rules → community rules → MCC codes from your bank → 300+ built-in merchant keywords. Transactions land in the right category on first import, not after manual cleanup.
- **Spending exclusions** — hide categories or individual transactions from spending totals. Investment contributions, transfers, and credit card payments are excluded by default. Everything is reversible via the spending exclusions button.
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

## Auto-categorization

Transactions are categorized using a four-tier priority system on every import:

| Priority | Source | Notes |
|---|---|---|
| 1 | **Your rules** | Keyword rules you've saved — always win |
| 2 | **Community rules** | [`community-rules.json`](community-rules.json) — fetched once per session |
| 3 | **MCC codes** | Merchant category codes from your bank CSV, if present |
| 4 | **Built-in keywords** | ~300 common merchant names as a fallback |

### Categories

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Travel, Automotive, Education, Child Care, Pet, Checks, Tax & Gov, Investment Contribution, Transfers, CC Payment, Other.

### Community rules

[`community-rules.json`](community-rules.json) is a curated list of 280+ keyword→category mappings maintained in this repo. It covers major merchants across all categories including airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more.

**To contribute:** open a PR adding entries to `community-rules.json`. Format:
```json
{"keyword": "MERCHANT NAME", "cat": "Category"}
```
Keywords are matched case-insensitively against transaction descriptions. More specific keywords (e.g. `DELTA AIR`) take priority over shorter ones. All submissions are reviewed before merging.

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
  index.html              ← landing page
  trakyodollas.html       ← the app
  privacy.html            ← privacy policy
  community-rules.json    ← crowdsourced categorization rules
```

---

## Deployment

Deployed via [Firebase Hosting](https://firebase.google.com/docs/hosting):

```bash
echo '{"hosting":{"public":".","ignore":["firebase.json","deploy.sh","README.md","*.sh"],"releaseLimit":5}}' > firebase.json
npx firebase-tools deploy --only hosting --project trak-yo-dollas
```

Note: `community-rules.json` must be included in the deploy. The ignore list above does not block `.json` files so it deploys automatically.

---

## Recent updates

- **Auto-categorization overhaul** — four-tier priority system (user rules → community rules → MCC codes → built-in keywords); 300+ merchant keywords across all categories; MCC lookup covers ~200 ISO 18245 codes
- **Community rules** — `community-rules.json` with 280+ seed rules, fetched once per session; fully auditable and open for contributions via PR
- **New categories** — Pet (Chewy, Petco, vets) and Insurance (GEICO, State Farm, Aetna, Blue Cross, etc.) broken out as first-class categories
- **Spending exclusions** — per-category hide with confirm popover; per-transaction hide from edit modal; unified "X spending exclusions" chip with full popover showing everything hidden and why; hidden transactions always visible dimmed at bottom of list
- **Import flow** — fixed drop zone, simplified success screen, "Import another CSV" CTA
- **Daily chart** — zoom bar height fix, grey border fix on mode switch, `MMM 'YY` mobile month labels
- **Budget CSV export** — download budget history with monthly spend, budget, %, and status per category
- **Demo notices** — per-tab badges on Accounts and Net Worth that clear independently when real data is added
- **Time-to-import nudge** — landing page shows "Last import X days ago" when it's been 25+ days
- **Landing page** — 4-tab interactive preview (Spending, Budget, Net Worth, Daily Chart)
