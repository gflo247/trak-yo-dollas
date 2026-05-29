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
Open the app, click ⬆ Import CSV. Works with Chase, Ally, Fidelity, Vanguard, Capital One, Discover, Amex, USAA, Bank of America, Wells Fargo, most credit unions, and most major banks and credit cards. Supports checking/savings, credit card, and debit/credit column formats.

**Migrating from another app?** The import modal has a dedicated section for Mint, YNAB, and Monarch Money. Select the matching format button and your category names will be mapped to ours automatically.

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

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Gifts & Donations, Travel, Automotive, Education, Child Care, Pet, Checks, Taxes & Fees, Investment Contributions, Transfers, CC Payment, Other.

### Community patterns

[`community-rules.json`](community-rules.json) contains 336 keyword→category mappings covering major merchants across all categories: airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more. Also covers bank-specific strings like mortgage managers, property tax processors, state government payments, investment contributions, tax prep services, and charitable organizations.

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

- **Migration imports** — dedicated "Migrating from another app?" section in the import modal with format buttons for Mint, YNAB, and Monarch Money; ~60 category mappings translate foreign category names to ours on import
- **Flow chart: declared income** — click the income bar to set your monthly take-home pay; overrides deposit detection; ✏ indicator shows when a declared value is active; clears back to auto-detect on demand
- **Flow chart: overspend warning** — when total spend exceeds income over the selected period, the income bar turns red and the footnote shows the overage; the savings rate insight scores 100, leads the At a Glance card, and reads "Spent $Xk over income (Nmo)"
- **Overspend detection shared** — `computePeriodSpendVsIncome()` is the single source of truth for both the Flow chart warning and the savings rate insight; they always stay in sync
- **Year in Review: exclude transfers toggle** — "Exclude transfers & investments" chip filters Checks, CC Payment, Transfers, and Investment Contributions out of top categories and top vendors (hero total unaffected); state persists to localStorage
- **Year in Review: copy to clipboard** — rebuilt as a zero-arg function; now includes date range, avg/month, top 5 categories, top 5 vendors, biggest/quietest month, savings rate, and NW change; respects the toggle state
- **Budget Health insight: dismissible** — × button on the Budget Health pill when budgets are set; dismissal fingerprinted against current budgets so it auto-reappears when any budget changes; persisted to localStorage
- **Budget tab empty state** — "No budgets set yet" card with navigation CTA when `state.budgets` is empty
- **Demo budget bleed fix** — demo budgets (`state.budgets`) are cleared alongside demo transactions on first real import; budget nudge toast suppressed for the same transition
- **Source pill × removal** — each source chip has a × that opens a confirmation popover showing transaction count; confirmed removal deletes all transactions from that source and updates the chart immediately
- **Zero state on last source removal** — removing the final source shows $0 spend, empty category grid, and an import prompt instead of stale data
- **Empty state when no data** — if `state.transactions` is empty, the bucket grid shows a welcoming "No spending data yet — Import CSV" card
- **By source chart labels fixed** — legend labels now use the exact source name from `tx.card`, matching the source pills; the old `.replace('Chase ','')` stripping is removed
- **PROTECTIVE COSTCO pre-check** — added before the CAT_KEYWORDS loop so it routes to Insurance before COSTCO can match Groceries/Shopping; same pre-check added for HOMEOWNERS INSURANCE
- **community-rules.json** — 336 rules; PROTECTIVE COSTCO and HOMEOWNERS INSURANCE added to Insurance
- **Gifts & Donations category** — new category after Entertainment; catches GoFundMe, Red Cross, United Way, Goodwill, Habitat for Humanity, Planned Parenthood, church/tithe/offering, and more; DONATION/DONATE always route here; museum transactions flip to Gifts & Donations on gift/contribution/giving signals
- **Taxes & Fees** — renamed from "Tax & Gov"; TurboTax, H&R Block, FreeTaxUSA keywords added
- **Expanded bank import support** — Bank of America (negative = spending, deposits skipped); Wells Fargo auto-detected via Debit/Credit columns; "What format does my bank use?" guide in the import modal
- **Date range selector** — From/To month dropdowns + quick chips (3mo, 6mo, 12mo, YTD, All) + grain toggle (Monthly/Quarterly/Yearly); source alignment sets the From dropdown automatically
- **Insights overhaul** — all 7 insights rewritten for emotional resonance; savings rate compares to your own average; NW shows goal timeline; subscriptions shows annualized cost; budget health names worst offender; insights empty state shows green "Everything looks on track" card
- **Multi-source import** — multiple banks/cards each get a distinct color pill; sources auto-activate on import; demo data and budgets clear on first real import; source alignment prompt for overlapping date ranges
