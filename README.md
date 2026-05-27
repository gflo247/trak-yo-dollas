# trak-yo-dolla$

**Private, local-first spending, budget, and net worth tracker.**

Import a CSV from your bank or credit card. Your browser translates it into spending data. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Several ways to see your spending** — category bar charts, income flow chart, daily heatmap, vendor breakdown, trend view, and map. Click any tile to filter transactions instantly.
- **"At a Glance" insights** — a curated card of monthly insights with a lead "Worth your attention" insight surfaced by urgency. Savings rate, budget health, top mover, largest charge, subscriptions, and weekend spending patterns. Each insight links to the relevant tab or action.
- **Budget tab** — set monthly limits, track pace in real time, see AT RISK warnings before you go over. Every category row shows 12-month pill history (tap to expand to percentages). Sort by % used, amount, or A–Z. Export budget history as CSV.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory toward a goal.
- **Smart auto-categorization** — four-tier system: your keyword rules → community patterns → MCC codes from your bank → 300+ built-in merchant keywords. Transactions land in the right category on first import, not after manual cleanup.
- **Spending exclusions** — hide categories or individual transactions from spending totals. Investment contributions, transfers, and credit card payments are excluded by default. Everything is reversible.
- **Export anytime** — one click to export transactions or budget history as a CSV. Your data, portable, always.
- **Two demo profiles** — "Early career, building up" and "Established, tracking it all". Explore every feature before touching your own data.

---

## Privacy

The developer built this app with no servers — your financial data has nowhere to go but your own device. Your browser translates your CSV files into spending data locally. Nothing is uploaded.

- **No bank connections** — no logins, no screen scraping, no connections to your bank.
- **Runs entirely in your browser** — data saves to your device's local storage. Refresh the page, everything's still there.
- **Nothing leaves your device unless you choose to sync.**
- **Optional Google sync** — sign in with Google to access your data across devices via Firebase. Opt-in only, never required.
- **No paywall** — free to use, all features included.

Full details, data flow diagram, and FAQ: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with exports from Chase, Ally, Fidelity, Vanguard, and most major banks and credit cards.

**3. Explore**
Transactions auto-categorize on import. Switch between chart views, set budgets, add your accounts for net worth tracking.

---

## Auto-categorization

Transactions categorize using a four-tier priority system on every import:

| Priority | Source | Notes |
|---|---|---|
| 1 | **Your rules** | Keyword rules you've saved — always win |
| 2 | **Community patterns** | [`community-rules.json`](community-rules.json) — downloaded once per session |
| 3 | **MCC codes** | Merchant Category Codes from your bank CSV, if present |
| 4 | **Built-in keywords** | ~300 common merchant names as a fallback |

### Categories

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Travel, Automotive, Education, Child Care, Pet, Checks, Tax & Gov, Investment Contribution, Transfers, CC Payment, Other.

### Community patterns

[`community-rules.json`](community-rules.json) is a curated list of 280+ keyword→category mappings maintained in this repo. It covers major merchants across all categories including airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more.

**To suggest a pattern:** fill out the [suggestion form](https://forms.gle/6oV9UPtv8RKKUHM96) — no account required. Just the merchant name as it appears in your bank statement and the category it should map to.

**To contribute via PR:** add entries to `community-rules.json`:
```json
{"keyword": "MERCHANT NAME", "cat": "Category"}
```
Keywords match case-insensitively against transaction descriptions. More specific keywords (e.g. `DELTA AIR`) take priority over shorter ones. All submissions are reviewed as plain text before merging — never run or execute content from form responses.

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

`community-rules.json` deploys automatically — the ignore list does not block `.json` files.

---

## Security notes

- The developer's GitHub and Google accounts both use two-factor authentication (a password plus a second confirmation step).
- Community pattern submissions arrive via Google Form and are reviewed manually as plain text before any changes deploy. Never copy-paste form submissions directly into `community-rules.json` without reviewing them.
- The app files, source code, and community rules are the only attack surfaces. None of them hold user financial data.

---

## Recent updates

- **Privacy page overhaul** — HTML/CSS data flow diagram showing local-first architecture and optional Google sync fork; 7-question FAQ with honest disclosure of attack surfaces, shutdown scenarios, Firebase sync, cookies, and spyware; active voice and plain English throughout; clear distinction between what the app does vs what the developer controls vs what Google handles
- **Budget pills** — 12-month history dots replaced with pills throughout (condensed, expanded, legend); uniform height with % labels on every pill; Mon 'YR labels float above first and January pills
- **Landing page overhaul** — 5-tab interactive preview (Spending, Daily, Flow, Budget, Net Worth); video removed; features section tightened; "Several ways to see your spending" with view chips; export CSV feature added
- **Auto-categorization overhaul** — four-tier priority system (user rules → community patterns → MCC codes → built-in keywords); 300+ merchant keywords; MCC lookup covers ~200 ISO 18245 codes; community-rules.json with 280+ seed rules downloaded once per session
- **New categories** — Pet and Insurance broken out as first-class categories
- **Spending exclusions** — per-category and per-transaction hide; unified popover; hidden transactions visible dimmed at bottom of list
- **Import flow** — simplified success screen, "Import another CSV" CTA, categorization disclosure with priority chain
- **Community patterns modal** — searchable table of all patterns, suggest form link, opens from import modal
- **Tagline** — "Don't obsess over money. Understand it." on landing page, footer, and import success screen
