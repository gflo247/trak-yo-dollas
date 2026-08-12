# trak-yo-dolla$

**Private, local-first money tracking.**

*Don't obsess over money. Understand it.*

Import a CSV from your bank, credit union, or credit card. Your browser translates it into spending data. Nothing leaves your device unless you choose to sync.

→ **[Try the live app](https://trakyodollas.com/trakyodollas)**
→ **[Landing page](https://trakyodollas.com)**

---

## What it does

- **"This month" narrative** — a plain-English summary of your most recent month: lighter or heavier than usual, biggest category mover, savings rate vs your own average. Reads conversationally, not like a data report.
- **Several ways to see your spending** — category bar charts, income flow chart, daily heatmap, vendor breakdown, trend view, and split treemap. Click any tile to filter transactions instantly. Switch grain to Monthly, Quarterly, or Yearly — category cards and sparklines update to match.
- **"At a Glance" insights** — curated monthly insights surfaced by urgency: savings rate, budget health, top mover, largest charge, subscriptions, possible duplicate charges, weekend spending patterns. Each compares against your own history.
- **Budget tab** — set monthly limits and see them alongside your 12-month average and year-to-date pace in one view, with AT RISK warnings before you go over. Every category row shows 12-month history. Sort by % used, amount, how unusual vs. your average, or A–Z — each ascending or descending.
- **Full picture net worth** — checking, savings, investments, loans, real estate, and vehicles in one place. Save monthly snapshots and track your trajectory toward a goal. Shows annualized growth rate alongside dollar change.
- **Smart auto-categorization** — four-tier system: your keyword rules → community-contributed patterns → MCC codes from your bank → built-in merchant keywords. Vendor names display in proper case (Starbucks, not STARBUCKS) without changing your underlying data. You can rename categories (including your own custom ones) in-place anytime — updates every transaction, budget, rule, and exclusion that referenced the old name.
- **Multi-source import** — import from multiple banks and credit cards. Sources with different date ranges prompt optional alignment to overlapping coverage.
- **Spending exclusions** — hide categories like transfers and CC payments from spending totals. Reversible, per-category or per-transaction.
- **Export anytime** — one click to export transactions or budget history as CSV, or export a full JSON backup of everything in the app: transactions, accounts, net worth snapshots, budgets, categories, and settings, all in one file.
- **Works offline, installs as an app** — service worker caches the full app; install to your home screen on Android or iPhone, or via Chrome on desktop.
- **Freelancer-friendly** — opt-in income tracking alongside spending; tag transactions as business or personal and filter your whole view by either, all without a separate bookkeeping app.
- **Two demo profiles** — explore every feature before touching your own data.

---

## Privacy

Local-first by design. I cannot see your financial data — not by policy, but by architecture.

- **No bank connections** — no logins, no screen scraping
- **Runs entirely in your browser** — data saves to your device's local storage
- **Nothing leaves your device unless you choose to sync** — and when you do, it's encrypted on your device first
- **Optional sign-in** — opt-in only, never required; sign in with Google or a passwordless email link to sync across devices via Supabase (open source)
- **Privacy-respecting analytics** — [Umami](https://umami.is) (page views, referrer, browser/OS, and country; no cookies, no personal data, never identifies you across sessions)
- **Self-hosted fonts** — DM Mono and DM Sans come from this repo, not Google Fonts
- **Hash-based Content Security Policy** — SHA-256 hashes allowlist every inline `<script>` block; no `unsafe-inline` in `script-src`
- **No paywall** — free to use, all features included

Full details, data flow diagram, and FAQ: [privacy policy](https://trakyodollas.com/privacy)

---

## How to use

**1. Download your CSV**
Under Statements or Download Activity in your bank, credit union, or credit card portal.

**2. Import it**
Open the app, click ⬆ Import CSV. Works with Chase, Ally, Fidelity, Vanguard, NFCU, BECU, PenFed, Alliant, TD, Scotiabank, BMO, CIBC, Capital One, Discover, Amex, USAA, Bank of America, Wells Fargo, and most banks and credit unions.

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
| 2 | **Community patterns** | [`community-rules.json`](community-rules.json) — 1,800+ mappings, fetched once per session |
| 3 | **MCC codes** | Merchant Category Codes from your bank CSV, if present |
| 4 | **Built-in keywords** | Common merchant names covering major US, CA, UK, AU, NZ, and SG brands |

### Categories

Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Personal Care, Entertainment, Gifts & Donations, Travel, Automotive, Education, Child Care, Pet(s), Checks, Taxes & Fees, Investment Contributions, Transfers, Internal Transfer, CC Payment, College Fund(s), Other.

The app excludes Investment Contributions, Transfers, Internal Transfer, and CC Payment from spending totals by default (they're not spending — they're financial flows). Toggle any category's visibility from the spending tab.

### Community patterns

[`community-rules.json`](community-rules.json) contains community-contributed keyword→category mappings covering merchants across all categories in the US, UK, Australia, Canada, New Zealand, and Singapore: airlines, hotel chains, streaming services, restaurant chains, gas stations, grocery chains, and more.

The count in the app and on the landing page updates automatically when the file changes — no hardcoded numbers to maintain.

**To suggest a pattern:** fill out the [suggestion form](https://forms.gle/6oV9UPtv8RKKUHM96) — no account required.

**To contribute via PR:** add entries to `community-rules.json`:
```json
{"keyword": "MERCHANT NAME", "cat": "Category"}
```
Keywords match case-insensitively against transaction descriptions. I review all submissions as plain text before merging.

---

## Tech stack

Single HTML file app — no build step, no dependencies to install, no server required.

| Library | Used for |
|---|---|
| [D3.js](https://d3js.org/) v7 | NW trend chart, treemap, daily heatmap |
| [d3-sankey](https://github.com/d3/d3-sankey) | Flow (income/spending) chart |
| [Chart.js](https://www.chartjs.org/) v4 | Spending bar charts |
| [Supabase](https://supabase.com/) | Optional sign-in (Google or email link) and encrypted cross-device sync |
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
  sw.js                   ← service worker (offline support, PWA caching)
  manifest.json           ← PWA manifest (name, icons, start URL, display mode)
  wrangler.toml           ← Cloudflare Workers deploy config
  community-rules.json    ← community-contributed categorization rules
  sitemap.xml             ← sitemap for search engines
  robots.txt              ← crawler directives
  app-screenshot.png      ← landing page app screenshot (with lightbox)
  app-screenshot-light.png← light-theme variant
  og.png                  ← Open Graph / social share image
  _headers                ← Cloudflare static-asset response headers (X-Frame-Options, etc.)
  icons/
    icon-192.png          ← PWA icon (192×192)
    icon-512.png          ← PWA icon (512×512, maskable)
  fonts/                  ← self-hosted DM Mono and DM Sans (no Google Fonts request)
  scripts/
    update-csp-hashes.py            ← recomputes inline script SHA-256 hashes for the CSP
    update-privacy-date.py          ← sets privacy.html's "Last updated" date from its last real
                                       git commit, not file mtime (mtime changes on every deploy
                                       even with no content change, since the hash-recompute step
                                       above rewrites the file unconditionally)
    update-sitemap-dates.py         ← patches sitemap <lastmod> from file mtimes before deploy
    check-syntax.py                 ← parses all 3 HTML files, catches syntax errors before deploy
    check-no-inline-handlers.sh     ← lints for leftover onclick= attributes
    check-connect-src.py            ← the CSP's connect-src must cover every fetch()/client call
    check-contrast.py               ← every --accent-*/--clr-*/--amber-text* token clears 4.5:1 in the
                                       theme(s) it's actually used as text in, and no hardcoded hex bypasses
                                       one of them
    extract-testable-fns.js         ← pulls named functions out of trakyodollas.html for the test suite
    check-escaping.py               ← advisory: flags ${...} interpolations of risky fields missing esc()
    check-*-coverage.py (6 files)   ← advisory: app-specific data-integrity scanners (state fields that
                                       should but don't sync to the cloud, source/business filters missing
                                       from a spend loop, and similar cross-cutting invariants specific to
                                       this app's state model)
    check-modal-aria.py             ← advisory: flags modals missing required ARIA attributes
  test/
    pure.test.js           ← node --test suite (see "Tests" below)
  .github/
    FUNDING.yml            ← Ko-fi support link (shown on GitHub repo)
  package.json             ← exists solely to run `npm test`; the app itself has no build step
  README.md                ← this file
```

---

## Running locally

Download [`trakyodollas.html`](trakyodollas.html) and open it in a browser. That's it.

For the full site including the landing page, privacy policy, and self-hosted fonts, serve the directory with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

### Tests

`trakyodollas.html` is a single classic `<script>` with no module system, so the test suite extracts named functions directly out of the shipped HTML (by brace-matching, not a hand-copied duplicate) and runs them under `node --test`. `package.json` exists solely for this — the app itself still has no build step.

```bash
npm test
```

---

## Deployment

[Cloudflare Workers](https://workers.cloudflare.com/) hosts the app via static asset serving. [Supabase](https://supabase.com/) (open source) handles optional sign-in and cross-device sync.

```bash
./deploy.sh prod
```

`deploy.sh` is a hard gate, not just a build script. It runs, in order: a syntax check, the full `node --test` suite (`npm test`), an inline-event-handler lint, a CSP `connect-src` completeness check, and a WCAG AA text-contrast check — any failure aborts before anything is touched. Only then does it recompute CSP hashes (`update-csp-hashes.py`) and sitemap dates (`update-sitemap-dates.py`), build a clean deploy directory via rsync (excluding dev-only files), and run `wrangler deploy`. A further set of advisory scanners (data-integrity/coverage checks specific to this app's state model — see `scripts/`) run after and report but don't block. Never run `wrangler deploy` directly — skipping straight to it bypasses every one of these gates, which is exactly how it's caught real bugs before they shipped.

The app uses a hash-based Content Security Policy — SHA-256 hashes allowlist inline scripts. `update-csp-hashes.py` recomputes all hashes automatically before every deploy.

---

## Security

- **Hash-based CSP** — `script-src` uses SHA-256 hashes for every inline script block; no `unsafe-inline`. `scripts/update-csp-hashes.py` recomputes hashes automatically.
- **Security headers on all responses** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- **`noindex` on the app page** — search traffic lands on the landing page, not the bare tool
- **All external links** use `rel="noopener noreferrer"`
- **Sign-in security** — the passwordless email link stores no password anywhere; Google OAuth always uses the redirect flow (no popups), reliable across all browsers and mobile
- **Community pattern submissions** — I review them manually as plain text before any changes deploy
- **GitHub 2FA** — my GitHub account, the source of this code, uses two-factor authentication
- **WCAG AA accessible** — text contrast, focus states, and keyboard navigation meet AA standards in both light and dark themes, across all three pages

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Nicholas Garofalo
