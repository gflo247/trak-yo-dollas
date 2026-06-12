# trak-yo-dolla$

**Private, local-first money tracking.**

*Don't obsess over money. Understand it.*

Import a CSV from your bank, credit union, or credit card. Your browser translates it into spending data. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trak-yo-dollas.web.app/trakyodollas.html)**
→ **[Landing page](https://trak-yo-dollas.web.app/)**

---

## What it does

- **"This month" narrative** — a plain-English summary of your most recent month: lighter or heavier than usual, biggest category mover, savings rate vs your own average. Written conversationally, not like a data report.
- **Several ways to see your spending** — category bar charts, income flow chart, daily heatmap, vendor breakdown, trend view, and split treemap. Click any tile to filter transactions instantly. Switch grain to Monthly, Quarterly, or Yearly — category cards and sparklines update to match.
- **"At a Glance" insights** — curated monthly insights surfaced by urgency: savings rate, budget health, top mover, largest charge, subscriptions, weekend spending patterns. Each compares against your own history.
- **Budget tab** — set monthly limits, track pace mid-month, see AT RISK warnings before you go over. Every category row shows 12-month history. Sort by % used, amount, or A–Z.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory toward a goal. Annualized growth rate shown alongside dollar change.
- **Smart auto-categorization** — four-tier system: your keyword rules → community-contributed patterns → MCC codes from your bank → built-in merchant keywords. Vendor names display in proper case (Starbucks, not STARBUCKS) without changing your underlying data.
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
- **Optional Google sign-in** — opt-in only, never required; syncs to your own Google account via Firebase
- **Privacy-respecting analytics** — [Umami](https://umami.is) (no cookies, no personal data, page view counts only)
- **Self-hosted fonts** — DM Mono and DM Sans are served from this repo, not Google Fonts
- **Hash-based Content Security Policy** — inline scripts are allowlisted by SHA-256 hash; no `unsafe-inline`
- **No paywall** — free to use, all features included

Full details, data flow diagram, and FAQ: [privacy policy](https://trak-yo-dollas.web.app/privacy.html)

---

## How to use

**1. Download your CSV**
Under Statements or Download Activity in your bank, credit union, or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with Chase, Ally, Fidelity, Vanguard, NFCU, BECU, PenFed, Alliant, TD, RBC, Scotiabank, BMO, CIBC, Capital One, Discover, Amex, USAA, Bank of America, Wells Fargo, and most banks and credit unions.

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
| 2 | **Community patterns** | [`community-rules.json`](community-rules.json) — 900+ mappings, fetched once per session |
| 3 | **MCC codes** | Merchant Category Codes from your bank CSV, if present |
| 4 | **Built-in keywords** | Common merchant names covering major US, CA, UK, AU, NZ, and SG brands |

### Categories

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Personal Care, Entertainment, Gifts & Donations, Travel, Automotive, Education, Child Care, Pet(s), Checks, Taxes & Fees, Investment Contributions, Transfers, CC Payment, College Fund(s), Other.

Investment Contributions, Transfers, and CC Payment are excluded from spending totals by default (they're not spending — they're financial flows). Toggle any category's visibility from the spending tab.

### Community patterns

[`community-rules.json`](community-rules.json) contains community-contributed keyword→category mappings covering merchants across all categories in the US, UK, Australia, Canada, New Zealand, and Singapore: airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more.

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
  fonts/                  ← self-hosted DM Mono and DM Sans (no Google Fonts request)
  scripts/
    update-csp-hashes.py  ← recomputes inline script SHA-256 hashes for the CSP
    check-no-inline-handlers.sh ← lints for leftover onclick= attributes
  .github/
    FUNDING.yml           ← Ko-fi support link (shown on GitHub repo)
  README.md               ← this file
```

`firebase.json` is auto-generated by the deploy command and is not committed.

---

## Running locally

Download [`trakyodollas.html`](trakyodollas.html) and open it in a browser. That's it.

For the full site including the landing page, privacy policy, and self-hosted fonts, serve the directory with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

---

## Deployment

Deployed via [Firebase Hosting](https://firebase.google.com/docs/hosting).

The app uses a hash-based Content Security Policy — inline scripts are allowlisted by SHA-256 hash. **Run `update-csp-hashes.py` before every deploy** whenever any inline `<script>` block in `trakyodollas.html` changes; stale hashes silently block scripts in the browser.

```bash
python3 scripts/update-csp-hashes.py
echo '{"hosting":{"public":".","ignore":["firebase.json","deploy.sh","README.md","*.sh"],"releaseLimit":5}}' > firebase.json
npx firebase-tools deploy --only hosting --project trak-yo-dollas
```

`community-rules.json` and all files in `fonts/` deploy automatically.

---

## Security

- **Hash-based CSP** — `script-src` uses SHA-256 hashes for every inline script block; no `unsafe-inline`. `scripts/update-csp-hashes.py` recomputes hashes automatically.
- **Self-hosted fonts** — eliminates the Google Fonts request on every page load
- **Security headers on all responses** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- **`noindex` on the app page** — search traffic lands on the landing page, not the bare tool
- **All external links** use `rel="noopener noreferrer"`
- **Google auth via redirect flow** — `signInWithRedirect` used on all devices (avoids popup-blocking issues on mobile); `authDomain` set to `web.app` to prevent cross-origin storage issues
- **Community pattern submissions** are reviewed manually as plain text before any changes deploy
- The developer's GitHub and Google accounts use two-factor authentication

---

## Recent updates

- **Event delegation refactor** — replaced all `onclick=` inline handlers with `data-action` attribute system; single IIFE dispatcher; eliminates inline script surface area
- **Google sign-in** — working on all devices via redirect flow; hash-based CSP extended for Firebase auth; `authDomain` corrected to `web.app`
- **WCAG AA theme compliance** — all accent colors, text hierarchy, and backgrounds pass AA contrast in both light and dark themes across all three pages; `update-csp-hashes.py` script maintains hash integrity
- **Light mode readability** — darker borders, distinct card/page backgrounds, card shadows, nav active tab fixed; blue-cast reduction in dark mode for OLED displays
- **Categories** — Personal Care added (salons, barbershops, massage, waxing, etc.); Pet renamed to Pet(s) with keyword fix (CHEWY/PETCO/PETSMART were incorrectly routing to Shopping); Professional Services removed; APP_VERSION 1.3 migration runs automatically
- **`displayVendor()` proper casing** — bank ALL CAPS descriptions rendered as Proper Case (Starbucks, Best Buy, CVS Pharmacy) everywhere; never mutates underlying data; smart acronym detection keeps AT&T, CVS, NBC intact
- **Grain-aware spending view** — Monthly/Quarterly/Yearly toggle now updates category tiles, sparklines, and average labels — not just the chart
- **Footer unified** — consistent structure, typography, and spacing across app, privacy, and landing pages; mobile footer stacks and centers; landing page unclosed-div bug fixed
- **Ko-fi support link** — in all three page footers and the privacy page; `FUNDING.yml` configured
- **"At a Glance" net worth pill** — dollar change as headline; annualized %/yr in sub-line when ≥60 days of snapshot data; goal progress replaces rate when a goal is set
- **Search bar** — rebuilt as flex row (no absolute-positioning padding math); SVG icon; `× clear` near transaction count when active

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Nicholas Garofalo
