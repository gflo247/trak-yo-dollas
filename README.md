# trak-yo-dolla$

**Private, local-first personal finance tracking.**

Track your spending, net worth, and budgets — without handing your bank login to anyone. No Plaid. No subscriptions. No account required. Your data never leaves your browser.

🌐 **[trak-yo-dollas.web.app](https://trak-yo-dollas.web.app)**

---

## What it does

- **Spending breakdown** — import a bank or credit card CSV and get auto-categorized transactions, month-over-month comparisons, and vendor-level breakdowns
- **Net worth tracking** — add accounts, investments, loans, and real estate. Save snapshots over time to track your trajectory
- **Budgets** — set monthly limits per category, see what's left in real time
- **Net worth goal projection** — set a target and see a realistic timeline based on your actual savings rate
- **Recurring charge detection** — surfaces subscriptions and regular charges automatically
- **Year in review** — annual and trailing 12-month spending summaries

## How it works

1. Download a transaction CSV from your bank (Chase, Ally, Fidelity, Vanguard, and most major banks are supported)
2. Drop it into the app — the format is auto-detected
3. That's it. Everything is parsed and stored locally in your browser

Optionally, sign in with Google to back up your data and sync across devices. Your data saves locally without this step.

## Privacy

Everything runs in your browser. CSV files are parsed locally. Accounts, transactions, budgets, and snapshots are stored in your browser's local storage.

When you sign in, your data is backed up to a private Firebase (Google) account readable only by you, enforced at the database level.

Firebase Analytics collects three standard events — `first_visit`, `session_start`, and `page_view` — along with browser language, page URL, screen resolution, and an anonymous client ID. No financial data is ever included. All of this is blockable with any ad blocker.

We don't sell your data or share it with advertisers.

Full details: [trak-yo-dollas.web.app/privacy.html](https://trak-yo-dollas.web.app/privacy.html)

## Self-hosting

The entire app is a few HTML files with no build step, no dependencies to install, and no server required.

```bash
git clone https://github.com/gflo247/trak-yo-dollas.git
cd trak-yo-dollas
open trakyodollas.html   # or just open the file in any browser
```

To deploy your own instance, drop the three files onto any static host (GitHub Pages, Netlify, Vercel, Firebase Hosting, etc.).

If you want Firebase sync to work in your own instance, you'll need to create a Firebase project and replace the config in `trakyodollas.html` with your own credentials.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Landing page |
| `trakyodollas.html` | The app |
| `privacy.html` | Privacy details |

## Tech

- Vanilla HTML, CSS, JavaScript — no framework, no build step
- [Chart.js](https://www.chartjs.org/) for charts
- [Firebase](https://firebase.google.com/) for optional auth and sync (Firestore + Analytics)
- Hosted on Firebase Hosting

## Contributing

Issues and pull requests are welcome. If something doesn't work with your bank's CSV format, open an issue with an anonymized sample and I'll add support for it.

## License

MIT — see [LICENSE](LICENSE)
