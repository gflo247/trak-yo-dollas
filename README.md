# trak-yo-dolla$

**Private, local-first money tracking.**

*Don't obsess over money. Understand it.*

Import a CSV from your bank or credit card. Your browser translates it into spending data. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/trakyodollas.html)**
→ **[Landing page](https://trak-yo-dollas.web.app/)**

---

## What it does

- **"This month" narrative** — a plain-English summary of your most recent month: lighter or heavier than usual, biggest category mover, savings rate vs your own average. Written conversationally, not like a data report.
- **Several ways to see your spending** — category bar charts, income flow chart, daily heatmap, vendor breakdown, trend view, and split treemap. Click any tile to filter transactions instantly.
- **"At a Glance" insights** — curated monthly insights surfaced by urgency: savings rate, budget health, top mover, largest charge, subscriptions, weekend spending patterns. Each compares against your own history.
- **Budget tab** — set monthly limits, track pace mid-month, see AT RISK warnings before you go over. Every category row shows 12-month history. Sort by % used, amount, or A–Z.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory toward a goal.
- **Smart auto-categorization** — four-tier system: your keyword rules → 336 community-contributed patterns → MCC codes from your bank → 300+ built-in merchant keywords.
- **Multi-source import** — import from multiple banks and credit cards. Sources with different date ranges prompt optional alignment to overlapping coverage.
- **Spending exclusions** — hide categories like transfers and CC payments from spending totals. Reversible, per-category or per-transaction.
- **Export anytime** — one click to export transactions or budget history as CSV.
- **Two demo profiles** — explore every feature before touching your own data.

---

## Privacy

Local-first by design. The developer cannot see your financial data — not by policy, but by architecture.

- **No bank connections** — no logins, no screen scraping
- **Runs entirely in your browser** — data saves to your device's local storage
- **Nothing leaves your device unless you choose to sync**
- **Optional Google sync** — opt-in only, never required
- **Privacy-respecting analytics** — [Umami](https://umami.is) (no cookies, no personal data, page view counts only). Firebase Analytics has been removed entirely.
- **Self-hosted fonts** — DM Mono and DM Sans are served from this repo, not Google Fonts
- **No paywall** — free to use, all features included

Full details, data flow diagram, and FAQ: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Under Statements or Download Activity in your bank or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with Chase, Ally, Fidelity, Vanguard, Capital One, Discover, Amex, USAA, Bank of America, Wells Fargo, most credit unions, and most major banks and credit cards.

**Migrating from another app?** The import modal has a dedicated section for Mint, YNAB, and Monarch Money — category names map across automatically.

**3. Import additional sources**
Import CSVs from other accounts — each gets its own color pill. If sources cover different date ranges, the app offers to align them to the overlapping period.

**4. Explore**
Transactions auto-categorize on import. Switch between chart views, set budgets, add your accounts for net worth tracking.

---

## Auto-categorization

| Priority | Source | Notes |
|---|---|---|
| 1 | **Your rules** | Keyword rules you've saved — always win |
| 2 | **Community patterns** | [`community-rules.json`](community-rules.json) — 336 mappings, fetched once per session |
| 3 | **MCC codes** | Merchant Category Codes from your bank CSV, if present |
| 4 | **Built-in keywords** | ~300 common merchant names as a fallback |

### Categories

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Gifts & Donations, Travel, Automotive, Education, Child Care, Pet, Checks, Taxes & Fees, Investment Contributions, Transfers, CC Payment, Other.

### Community patterns

[`community-rules.json`](community-rules.json) contains 336 community-contributed keyword→category mappings covering major merchants across all categories: airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more.

The count in the app and on the landing page updates automatically when the file changes — no hardcoded numbers to maintain.

**To suggest a pattern:** fill out the [suggestion form](https://forms.gle/6oV9UPtv8RKKUHM96) — no account required.

**To contribute via PR:** add entries to `community-rules.json`:
```json
{"keyword": "MERCHANT NAME", "cat": "Category"}
```
Keywords match case-insensitively against transaction descriptions. All submissions are reviewed as plain text before merging.

---

## Tech stack

Single HTML file app — no build step, no dependencies to install, no server required.

| Library | Used for |
|---|---|
| [D3.js](https://d3js.org/) v7 | NW trend chart, treemap, daily heatmap |
| [d3-sankey](https://github.com/d3/d3-sankey) | Flow (income/spending) chart |
| [Chart.js](https://www.chartjs.org/) v4 | Spending bar charts |
| [Firebase](https://firebase.google.com/) | Optional Google sign-in and cross-device sync; static file hosting |
| [Umami](https://umami.is) | Privacy-respecting page view analytics (no cookies, no personal data) |
| Vanilla JS / CSS | Everything else |

---

## File structure

```
trak-yo-dollas/
  index.html              ← landing page with interactive preview
  trakyodollas.html       ← the app
  privacy.html            ← privacy policy
  404.html                ← custom 404 page
  community-rules.json    ← community-contributed categorization rules
  sitemap.xml             ← sitemap for search engines
  robots.txt              ← crawler directives
  firebase.json           ← Firebase Hosting config (security headers, 404, ignore list)
  fonts/                  ← self-hosted DM Mono and DM Sans (no Google Fonts request)
  README.md               ← this file
```

---

## Running locally

Download [`trakyodollas.html`](trakyodollas.html) and open it in a browser. That's it.

For the full site including the landing page, privacy policy, and self-hosted fonts, serve the directory with any static file server.

---

## Deployment

Deployed via [Firebase Hosting](https://firebase.google.com/docs/hosting). `firebase.json` is committed and contains the hosting config including security headers — no need to regenerate it on each deploy.

```bash
npx firebase-tools deploy --only hosting --project trak-yo-dollas
```

`community-rules.json` and all files in `fonts/` deploy automatically.

---

## Security

- Firebase Analytics removed — replaced with [Umami](https://umami.is) (no cookies, GDPR-compliant by design)
- Self-hosted fonts — eliminates the Google Fonts request on every page load
- Security headers on all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- `noindex` on the app page — search traffic lands on the landing page, not the bare tool
- All external links use `rel="noopener noreferrer"`
- The developer's GitHub and Google accounts use two-factor authentication
- Community pattern submissions are reviewed manually as plain text before any changes deploy

---

## Recent updates

- **"This month" narrative card** — plain-English monthly summary in the At a Glance row; compares spending to 18-month average, calls out biggest category movers, references savings rate; expanded by default
- **Privacy hardening** — Firebase Analytics removed and replaced with Umami (no cookies, no personal data); Google Fonts replaced with self-hosted fonts (no third-party requests on load); all external links get `rel="noopener noreferrer"`
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` added via Firebase Hosting config
- **State migration system** — `APP_VERSION = '1.1'`; version check runs on load; migrations handle `activeHorizon → rangeFrom/rangeTo` and `Tax & Gov → Taxes & Fees` renames in budgets, rules, and excluded categories
- **Defensive state loading** — all fields use nullish coalescing (`??`) so missing keys in old localStorage silently fall back to defaults rather than producing `undefined` behavior
- **Error boundary on load** — if localStorage parsing fails, the app clears only the corrupted state blob (preserving transactions), shows a non-alarming toast, and continues with defaults
- **Dynamic community rules count** — the "336" in both the app and landing page updates automatically from the live JSON; no manual number to maintain
- **Landing page overhaul** — interactive preview rebuilt: 12-month trend chart, 12-month flow chart with Remaining node, full daily heatmap with weekends and month labels, improved budget tab with pace bars and history strip, fixed net worth tab with correct account math
- **Split chart on landing page** — proportional horizontal bar where each tile's width equals its percentage (adds up to 100%)
- **Custom 404 page** — on-brand, links back to homepage and app
- **sitemap.xml and robots.txt** — added for search engine discoverability
- **Open Graph tags** — `og:title`, `og:description`, `og:url` on landing page and privacy page
- **`noindex` on app** — search traffic routes to landing page instead of the bare app
- **Privacy page** — updated to describe Umami accurately; active voice throughout; GDPR rights section; contact section with email and GitHub Issues
- **Footer consistency** — unified link order across all three pages; "Report a bug" and "Email me" replace generic "Feedback" / "Contact"
- **Migration imports** — Mint, YNAB, and Monarch Money export support in the import modal
- **Gifts & Donations category** — new category; catches charitable giving, GoFundMe, Red Cross, church/tithe, and more
- **Taxes & Fees** — renamed from "Tax & Gov"
