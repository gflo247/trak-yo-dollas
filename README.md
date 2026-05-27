# trak-yo-dolla$

**Private, local-first money tracking.**

*Don't obsess over money. Understand it.*

Import a CSV from your bank or credit card. Your browser translates it into spending data. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/traky)**

---

## What it does

- **Several ways to see your spending** — category bar charts, income flow chart, daily heatmap, vendor breakdown, trend view, and map. Click any tile to filter transactions instantly.
- **"At a Glance" insights** — a curated card of monthly insights with a lead "Worth your attention" insight surfaced by urgency. Savings rate, budget health, top mover, largest charge, subscriptions, and weekend spending patterns. Each insight compares against your own history and links to the relevant tab.
- **Budget tab** — set monthly limits, track pace in real time, see AT RISK warnings before you go over. Every category row shows 12-month pill history. Sort by % used, amount, or A–Z. Export budget history as CSV.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory toward a goal.
- **Smart auto-categorization** — four-tier system: your keyword rules → community patterns → MCC codes from your bank → 300+ built-in merchant keywords. Transactions land in the right category on first import.
- **Multi-source import** — import from multiple banks and credit cards. Each source gets a distinct color pill. Sources with different date ranges prompt an optional alignment to overlapping coverage.
- **Spending exclusions** — hide categories or individual transactions from spending totals. Reversible, per-category or per-transaction.
- **Export anytime** — one click to export transactions or budget history as a CSV.
- **Two demo profiles** — "Early career, building up" and "Established, tracking it all". Explore every feature before touching your own data.

---

## Privacy

The developer built this app with no servers — your financial data has nowhere to go but your own device. Your browser translates your CSV files into spending data locally. Nothing is uploaded.

- **No bank connections** — no logins, no screen scraping, no connections to your bank
- **Runs entirely in your browser** — data saves to your device's local storage
- **Nothing leaves your device unless you choose to sync**
- **Optional Google sync** — sign in with Google to access your data across devices via Firebase. Opt-in only, never required.
- **No paywall** — free to use, all features included

Full details, data flow diagram, and FAQ: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with Chase, Ally, Fidelity, Vanguard, Capital One, Discover, Amex, USAA, most credit unions, and most major banks and credit cards. Supports checking/savings, credit card, and debit/credit column formats.

**3. Import additional sources**
Import CSVs from other accounts — each gets its own color pill. If sources cover different date ranges, the app offers to align them to the overlapping period for fair comparisons (non-destructive, reversible anytime).

**4. Explore**
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

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Travel, Automotive, Education, Child Care, Pet, Checks, Tax & Gov, Investment Contributions, Transfers, CC Payment, Other.

### Community patterns

[`community-rules.json`](community-rules.json) contains 321 keyword→category mappings covering major merchants across all categories: airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more. Also covers common bank-specific transaction strings like mortgage managers, property tax processors, state government payments, and investment contribution descriptions.

**To suggest a pattern:** fill out the [suggestion form](https://forms.gle/6oV9UPtv8RKKUHM96) — no account required.

**To contribute via PR:** add entries to `community-rules.json`:
```json
{"keyword": "MERCHANT NAME", "cat": "Category"}
```
Keywords match case-insensitively against transaction descriptions. All submissions are reviewed as plain text before merging — never run or execute content from form responses.

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
  README.md               ← this file
  HANDOFF.md              ← Claude Code session handoff (dev reference)
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

- The developer's GitHub and Google accounts both use two-factor authentication (a password plus a second confirmation step like a phone prompt).
- Community pattern submissions arrive via Google Form and the developer reviews them manually as plain text before any changes deploy. Never copy-paste form submissions directly into `community-rules.json` without reviewing them.
- The app files, source code, and community rules are the only attack surfaces. None of them hold user financial data. See the [privacy policy](https://trak-yo-dollas.web.app/privacy.html) for full disclosure.

---

## Recent updates

- **Multi-source import** — import from multiple banks/cards, each with a distinct color pill; sources auto-activate on import; demo data clears on first real import
- **Source alignment** — when sources cover different date ranges, a prompt offers non-destructive alignment to the overlapping period; persistent indicator shows active alignment with one-click reset
- **Horizon & grain system** — 3mo/6mo/12mo/2yr/All horizons; quarterly and yearly chart grain available for multi-year data; All dynamically shows actual month count
- **Insights overhaul** — all 7 insights rewritten for emotional resonance: contextual, behavior-aware, actionable; savings rate compares to your own average; NW shows goal timeline; subscriptions shows annualized cost; budget health names worst offender; top mover leads with dollars and vendor
- **Budget health fix** — at-a-glance pill uses same AT RISK definition as budget tab; shows "X need attention" instead of "X on track"
- **Categorization expansion** — Investment Contribution → Investment Contributions; 40+ new keywords added including mortgage manager, property taxes, 529 contributions, trash service, local merchants; community-rules.json now 321 rules
- **CSV import flexibility** — UTF-8 BOM stripping; new Debit/Credit column format for USAA/credit unions; better field name synonym detection; improved auto-detection
- **Privacy page overhaul** — HTML/CSS data flow diagram with local-default and optional Google sync fork; 7-question FAQ with honest attack surface disclosure; active voice and plain English throughout
- **Net worth label** — always shows "↑$X since Mon 'YR" — never "this year"; shows nothing if no prior snapshot
- **Daily chart legend** — 14×14px tiles matching cal-day shape, wrapper tap target for mobile, scales with zoom
