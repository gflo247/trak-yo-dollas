# trak-yo-dolla$ — Claude Code Handoff

## Project
Single-file personal finance app. No build step, no server.

**Live:** https://trak-yo-dollas.web.app/traky  
**Repo:** `/Users/gflo247/Desktop/programming/trak-yo-dollas/`

**Stack:** Vanilla JS, D3.js v7, Chart.js v4, Firebase (optional sync + hosting)

**Files:**
- `trakyodollas.html` — the entire app (~7,500 lines)
- `index.html` — landing page
- `privacy.html` — privacy policy with data flow viz and FAQ
- `community-rules.json` — 321 keyword→category rules
- `README.md` — documentation

---

## Deploy command
```bash
echo '{"hosting":{"public":".","ignore":["firebase.json","deploy.sh","README.md","*.sh"],"releaseLimit":5}}' > firebase.json
npx firebase-tools deploy --only hosting --project trak-yo-dollas
```

---

## What was just completed (session May 27 2026)

### Source alignment feature
- On import, if sources have different date ranges, a prompt appears after closing the success modal
- "Align to Nov '24" stores `state.sourceAlignDate` and filters `getFilteredMonths()` to only return months >= that date
- Non-destructive — no data deleted
- Persistent indicator shows near source chips: "✓ Aligned to Nov '24 · show all"
- "show all" clears `state.sourceAlignDate` instantly
- "Don't ask again" sets `state.sourceAlignSkipped=true` (persisted in localStorage)
- "↔ Align sources" link appears near chips when skipped and misalignment exists

### Horizon buttons (NEEDS REWORK — next task)
Current: `3 mo · 6 mo · 12 mo · 2 yr · All (N mo)`  
Problem: Fixed presets don't adapt to actual data, conflict with alignment feature  
**Next task:** Replace with a date range selector (From/To month dropdowns populated from actual data) + quick-set chips (3mo, 6mo, 12mo, YTD, All) + grain toggle (Monthly/Quarterly/Yearly) always visible

### Chart grain system
- `state.chartGrain` = 'month' | 'quarter' | 'year'
- `getAggregatedPeriods()` and `getAggregatedData()` aggregate monthly data
- Grain toggle appears below horizon buttons when 2yr+ selected (needs to move to new range UI)
- `renderSpendChart()` uses aggregated data when grain !== 'month'

### Dynamic source pill colors
- `CHIP_COLORS` array of 7 color classes assigned in order as new sources appear
- `getSrcChipClass(src)` caches assignments
- New sources auto-activate on import

### Demo data wipe
- First real import clears all demo transactions (`state.hasRealData` check)

### Categorization updates
- `Investment Contribution` → `Investment Contributions` (plural) throughout
- New keywords added to `CAT_KEYWORDS` and `community-rules.json`:
  - `MTGMANAGER`, `OLD NATIONAL BAN MTG` → Home
  - `NEIGHBORHOOD0467` → Child Care  
  - `PRIORITY WASTE` → Bills & Utilities
  - `PNP BILLPAYMENT` → Tax & Gov (property taxes)
  - `STATE OF MICH SOS`, `STATE OF MI SOMIIT` → Tax & Gov
  - `MI DIR ACH CONTRIB` → Investment Contributions (529)
  - `PMUSA` → Gas
  - `SP COUNTER CULTURE` → Food & Drink
  - `PRIME VIDEO CHANNELS`, `GOOGLE *YOUTUBE` → Entertainment
  - `PROTECTIVE COSTCO` → Insurance
  - `TD BANK PAYMENT` → CC Payment
  - Plus 20+ local/regional merchants

### CSV import improvements
- UTF-8 BOM stripping
- New "Debit/Credit cols" format for USAA/credit unions
- Better field name synonyms in Generic format
- Better auto-detection

### Insights rewrite
All 7 insights rewritten for emotional resonance — contextual, behavior-aware, actionable:
- Savings rate compares to user's own monthly average
- Net worth shows pace + goal timeline ("on pace to reach goal in ~10 years")
- Subscriptions shows annualized cost
- Budget health shows "X/10 need attention" + names worst offender
- Top mover leads with dollars + vendor
- Largest charge scores low when normal, high when unusual
- Weekend spending estimates dollar impact

### Budget counting fix
At-a-glance pill uses same AT RISK definition as budget tab (`pct>=80 && daysPct<=0.6`)

### Net worth label
Always shows "↑$X since Nov '24" — "this year" logic removed entirely. Shows nothing if no prior snapshot.

### Daily chart legend tiles
14×14px, border-radius:3px matching cal-day tiles, wrapper div for tap target, scales with zoom

### Privacy page
Full overhaul — see privacy.html. Key: HTML/CSS data flow viz, 7-question FAQ, active voice throughout, honest disclosure of attack surfaces.

---

## Pending tasks

### HIGH PRIORITY
1. **Date range selector** — replace horizon buttons with From/To month dropdowns + quick chips + grain toggle always visible. `state.sourceAlignDate` should set the From dropdown when active.

2. **Category renames/additions:**
   - `Tax & Gov` → consider "Taxes & Fees"  
   - Add TurboTax, H&R Block, FREETAXUSA to Tax & Gov keywords
   - Museum → Entertainment by default (unless "DONATION"/"GIFT" in description)
   - Keep Gas and Automotive separate (discussed, agreed)

3. **GitHub push** — everything is local. Commit message: `Source alignment, horizon rework, categorization updates, CSV flexibility`

### MEDIUM PRIORITY
4. **Other transactions** — user shared full CSV. Most "Other" transactions now handled. Re-import and check what's still landing in Other.

5. **Year in review** — feature exists but untouched this session.

6. **Insight scoring** — budget health over budget scores 90, savings rate <10% scores 100. If both exist simultaneously, savings rate wins lead — consider whether budget health should win when categories are over.

### LOW PRIORITY
7. **Mobile pacing** — ChatGPT flagged scroll fatigue, repeated card framing on mobile. Worth a pass.

---

## Key architecture notes

### State object (important fields)
```javascript
state = {
  transactions: [],          // {date, desc, cat, card, amount, excluded, is_offset, id}
  activeSources: Set,        // which source pills are active
  activeHorizon: 9999,       // months to show (9999 = all)
  sourceAlignDate: null,     // 'YYYY-MM' — filters getFilteredMonths() when set
  sourceAlignSkipped: false, // persisted
  chartGrain: 'month',       // 'month'|'quarter'|'year'
  chartMode: 'category',     // 'category'|'vendor'|'source'|'trend'|'daily'|'map'|'flow'
  hasRealData: false,
  budgets: {},               // {category: monthlyLimit}
  catRules: [],              // user keyword rules
  excludedCats: Set,
  accounts: [],
  snapshots: [],
  nwGoal: null,
}
```

### Key functions
- `getFilteredMonths()` — respects `activeHorizon` AND `sourceAlignDate`
- `getAggregatedPeriods()` / `getAggregatedData()` — aggregate by quarter/year
- `normalizeTxRow(row, source)` — format detection + categorization
- `renderHorizonTabs()` — builds horizon buttons (REPLACE THIS)
- `setHorizon(m)` — sets activeHorizon, clears sourceAlignDate
- `setGrain(g)` — sets chartGrain
- `checkSourceAlignment()` — fires after import success modal closes
- `applySourceAlign(fromDate)` — sets sourceAlignDate, rerenders
- `getSrcChipClass(src)` — dynamic source pill color assignment

### HORIZONS constant (currently)
```javascript
const HORIZONS=[{label:'3 mo',months:3},{label:'6 mo',months:6},{label:'12 mo',months:12},{label:'2 yr',months:24},{label:'All',months:9999}];
```
This will be replaced by the date range selector.

### Category list
Groceries, Food & Drink, Shopping, Home, Gas, Bills & Utilities, Insurance, Health & Wellness, Entertainment, Travel, Automotive, Education, Child Care, Pet, Checks, Tax & Gov, Investment Contributions, Transfers, CC Payment, Other

### Deploy
Two terminal commands from repo root (see Deploy section above).

---

## Tone & language conventions
- Active voice throughout (enforced — see privacy page as example)
- No jargon for user-facing text ("translates your CSV" not "parses", "privacy extension" not "ad blocker")
- Emotionally resonant insights — answer "why would a normal person care immediately?"
- Plain English — assume non-technical audience for all UI copy
