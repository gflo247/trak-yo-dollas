# trak-yo-dolla$ — improvement backlog

Roughly in priority order. Stop and re-evaluate after each item ships.

---

## Fix first

### ~~2. Phone transaction list hides merchant~~ ✓ fixed
~~At <=480px: hide tx-pct and non-category pills, narrow date, short YY Mon DD date
format — keeps single-line rows with merchant + color-coded category + amount.~~

### ~~3. Header clips "Sign in" at phone widths~~ ✓ fixed
~~Clipped by 14px at 360px; Demo data badge pushes it 19px off-screen at 430px.~~

### ~~4. Service worker: partial precache install leaves users stuck~~ ✓ fixed
~~One failed download during an update causes the install to silently succeed (`.catch(()=>{})`)
and activate to copy the old cache forward, serving the old build indefinitely even
after the network recovers.~~

### ~~5. Sitemap + guide 404s~~ ✓ fixed
~~Dead entries removed, investment-accounts added, Update → links corrected, dates use git log.~~

---

## Accessibility

### ~~6. Expand axe gate to phone widths + static pages~~ ✓ fixed
~~Currently covers 4 app tabs at desktop width only. Add 360px and 430px viewport
passes, plus the landing page, privacy page, and guide pages.~~

### ~~7. Smaller a11y items~~ ✓ fixed
~~- Source chip remove buttons are ~12×10px (touch target too small)~~
~~- App has no `<main>` landmark or top-level heading~~
~~- Privacy page: GitHub link is browser-default blue on dark (1.9:1 contrast); 3 spots
  faint in light theme~~
~~- Import file input and Year in Review month dropdown have no labels~~
~~- Recurring list can't be scrolled with the keyboard~~

---

## Hardening

### ~~8. Dev files live on prod~~ ✓ fixed
~~`/TODO.md`, `/e2e/app.spec.js`, `/e2e/fixtures/sample.csv`, `/playwright.config.js`,
and `/.deploy-version` all load on the live site. deploy.sh uses an exclusion list;
switch to an allowlist of what to publish.~~

### ~~9. Self-host Supabase client~~ ✓ fixed
~~Supabase removed entirely — migrated to Cloudflare Workers + D1. No third-party
scripts load for signed-out users. jsDelivr dropped from CSP.~~

### ~~10. E2E tests in deploy + CI~~ ✓ fixed
~~4 Playwright tests pass but nothing runs them automatically. Add to deploy.sh and CI.~~

### ~~11. iPad data-loss banner~~ ✓ fixed
~~iPad Safari identifies as a Mac by default, so the iPhone check fails and the generic
notice shows. Fix: add a touch check alongside the UA check.~~

### ~~12. schemaVersion never read~~ ✓ fixed
~~Written on save but never checked on load or sync. Without it, an older app version on
another device could silently overwrite newer-schema data.~~

---

## Performance

### ~~13. renderAll renders all tabs on every state change~~ ✓ fixed
~~506ms at 4× CPU slowdown with 720 transactions; page blocked ~1.3s at load. Tab
switches already render on demand — render only the visible tab on state changes too.~~

---

## Polish

### ~~14. Theme key inconsistency~~ ✓ fixed
~~Guides store the theme under a different localStorage key than the app. Landing and
privacy pages also ignore the device's color-scheme preference, so a light-mode visitor
sees a dark home page then a light app.~~

### ~~15. Demo dates hardcoded~~ ✓ fixed
~~Demo ends in September and falls further behind each month. Separately, At a Glance
calls the latest data month "This month · September" on October 10 — real users see
this after every month rollover.~~

### ~~16. Landing page polish~~ ✓ fixed
~~- "Filter your whole view by either" overstates what the business filter does~~
~~- Both hero screenshots download regardless of active theme~~
~~- Budget health card title truncates to "Bu…" on phones~~

---

## Post-launch, no rush

### ~~19. Dev database isolation~~ ✓ fixed
~~Dev worker (`trak-yo-dollas-dev`) shared the production D1 database, so any
test that touched sync hit real user accounts. Fixed: `trak-yo-dollas-db-dev`
created and schema applied; `[env.dev]` block added to wrangler.toml; deploy.sh
now uses `wrangler deploy --env dev` instead of `--name`.~~

### ~~20. Accessibility + contrast batch~~ ✓ fixed
~~WCAG AA contrast failures across light/dark themes (hardcoded hex replaced with
CSS vars); WCAG 2.5.3 label-in-name mismatches on budget cards, tx rows, NW items;
WCAG 2.5.8 tap-target violations on import buttons, at-a-glance pill CTAs, budget
badges; privacy FAQ copy bugs (cookies answer, sign-in method description).~~

### 17. Playwright test 5 — D1 sync round-trip
Encrypt → upload to Cloudflare Workers D1 → wipe localStorage → decrypt → verify transaction count.
Deferred until after user testing confirms the sync flow is stable end-to-end.

### 18. Module split
Function/global count (497 fns, 127 globals) — split into modules and clean up
rendering, after launch.

---

## Launch

HN and r/SideProject posts are drafted. PH account warmed. Pending: screenshot assets
and a short screen-recording.
