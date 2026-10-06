#!/bin/bash
set -e

target="$1"
if [ "$target" != "dev" ] && [ "$target" != "prod" ]; then
  echo "Usage: ./deploy.sh <dev|prod>"
  exit 1
fi

# Hard gate, checked first (fail fast before anything else runs) — this app
# has no build step or bundler, so nothing else here parses the file as a
# whole. npm test only compiles the specific functions extracted for a given
# test, not the full <script> block, so a syntax error anywhere outside a
# currently-tested function slipped through silently. Nearly shipped once:
# the 72nd adversarial pass's first attempt at a fix introduced a duplicate
# const declaration in the same function scope, caught only by manually
# running `node --check` before it reached a browser.
echo "=== Checking JavaScript syntax (node --check on every <script> block) ==="
python3 scripts/check-syntax.py

# Gate the deploy on the test suite and the inline-handler lint — previously
# this script would ship straight to prod with no verification at all, the
# only safety net being a developer remembering to run both by hand first.
echo "=== Running tests ==="
npm test

echo "=== Checking for inline event handlers ==="
bash scripts/check-no-inline-handlers.sh

echo "=== Checking connect-src covers every network destination ==="
python3 scripts/check-connect-src.py

# Hard gate — added after an axe-core audit found 68 dark-theme and 243
# light-theme WCAG AA color-contrast violations despite this exact class of
# bug having been individually patched at least ten times before (see git
# log for "contrast"/"WCAG"). Every prior fix was reactive and per-instance;
# nothing ever stopped the next new component from hardcoding a raw hex
# value instead of the theme-aware --accent-*/--clr-*/--amber-text* CSS
# variable, so every one of those fixes was a matter of time from
# regressing again the moment a new component reused the same shortcut.
# This is a deterministic, mechanical check (unlike the heuristic advisory
# scanners below) — either a token clears 4.5:1 in the theme(s) it's
# actually rendered as text in, and every hardcoded hex in the file
# matches a var() reference instead of a raw literal, or it doesn't.
echo "=== Checking WCAG AA text contrast on theme-aware color tokens ==="
python3 scripts/check-contrast.py

# Hard gate — added after the pre-launch modal-accessibility initiative
# (focus trap, ARIA dialog semantics, return-focus-on-close) added
# role="dialog"/aria-modal="true"/aria-labelledby/tabindex="-1" to all 28
# .modal-overlay dialogs plus #demo-picker-overlay. Like check-contrast.py
# above (and unlike the heuristic advisory scanners below), this verifies a
# deterministic invariant — either the attributes are present and
# aria-labelledby resolves to a real id, or it doesn't — so a future modal
# added without them fails the deploy instead of just getting flagged.
echo "=== Checking modals for ARIA dialog attributes ==="
python3 scripts/check-modal-aria.py

echo "=== Scanning for unescaped user-data interpolations ==="
python3 scripts/check-escaping.py

echo "=== Scanning for spend loops missing the _bizFilter guard ==="
python3 scripts/check-bizfilter-coverage.py

echo "=== Scanning for spend loops missing the activeSources guard ==="
python3 scripts/check-activesources-coverage.py

echo "=== Scanning for state mutations missing a save trigger ==="
python3 scripts/check-persistence-coverage.py

echo "=== Scanning for demo-to-real 'first real save' entry points missing _replaceDemoDataWithReal() ==="
python3 scripts/check-demo-transition-coverage.py

echo "=== Scanning for transaction mutations missing rebuildMonthly() ==="
python3 scripts/check-rebuild-coverage.py

echo "=== Scanning for fields persisted locally but missing from cloud sync ==="
python3 scripts/check-cloudsync-coverage.py

python3 scripts/update-csp-hashes.py
# Git-based, not mtime-based (unlike update-sitemap-dates.py below) --
# update-csp-hashes.py just rewrote all 3 files unconditionally, which
# would make an mtime-based "last updated" show today's date on every
# single deploy regardless of whether privacy.html's actual content
# changed. git only advances when the file's tracked content really does.
python3 scripts/update-privacy-date.py
python3 scripts/update-sitemap-dates.py

# Build clean deploy directory — only files meant for public serving
rm -rf _cf_deploy
rsync -a \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='.wrangler' \
  --exclude='.firebase' \
  --exclude='_cf_deploy' \
  --exclude='wrangler.toml' \
  --exclude='deploy.sh' \
  --exclude='*.sh' \
  --exclude='README.md' \
  --exclude='.DS_Store' \
  --exclude='.Rhistory' \
  --exclude='screenshots' \
  --exclude='test-csvs' \
  --exclude='.github' \
  --exclude='_HANDOFF.md' \
  --exclude='_notes.md' \
  --exclude='*.archived' \
  --exclude='ENTIRE-SITE-ARCHITECTURE-deep-dive.html' \
  --exclude='scripts' \
  --exclude='test' \
  --exclude='node_modules' \
  --exclude='.claude' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  . _cf_deploy/

# Minify the app shell — strips comments (including internal dev notes) and
# whitespace, and runs Terser on the inline JS/CSS. mangle:false is required:
# the dispatch layer calls functions by name via window[fn], so renaming them
# would silently break every data-action handler. CSP hashes are recomputed
# on the minified output below — this must come BEFORE the hash step, not after.
echo "=== Minifying trakyodollas.html ==="
node_modules/.bin/html-minifier-terser _cf_deploy/trakyodollas.html \
  --collapse-whitespace \
  --remove-comments \
  --minify-css true \
  --minify-js '{"mangle":false,"compress":true,"format":{"comments":false}}' \
  -o _cf_deploy/trakyodollas.html

# Verify the minified output parses — Terser can theoretically emit broken JS
# for edge-case inputs (nested template literals, unusual regex), so check
# before it reaches prod rather than finding out in the browser.
echo "=== Checking minified output syntax ==="
python3 scripts/check-syntax.py _cf_deploy/trakyodollas.html

# Recompute CSP hashes on the minified file — the hashes computed above on the
# source no longer match after minification, so the deployed file needs its own
# hash set. index.html and privacy.html are not minified, so their hashes
# (already updated in the source above) survive rsync unchanged.
echo "=== Recomputing CSP hashes on minified trakyodollas.html ==="
python3 scripts/update-csp-hashes.py _cf_deploy/trakyodollas.html

# Stamp sw.js with a version string so every deploy busts the cache.
# CRITICAL regression found in the 14th adversarial pass: the portability
# fix below (temp-file form instead of BSD-only `sed -i ''`) was made in the
# same commit that accidentally deleted the DEPLOY_TS assignment that used
# to live right above it -- so every deploy since has substituted an empty
# string, making CACHE_NAME the literal constant "trakyo-" forever. Browsers
# detect service-worker updates via a byte diff of sw.js; with CACHE_NAME
# never changing, install/activate never re-fire for a returning user, so
# the cache-first fetch handler could keep serving the app-shell snapshot
# from whenever a user first got the service worker, indefinitely, across
# every deploy since -- almost certainly the real cause of the "stale
# service worker" false leads that cost debugging time earlier this cycle.
#
# Version format: YYYY-MM-DDa, YYYY-MM-DDb, … — date plus a lowercase letter
# that increments with each deploy on the same day. State is kept in
# .deploy-version at the repo root (committed, not gitignored) so the counter
# stays consistent across machines.
_TODAY=$(date -u +%Y-%m-%d)
_VER_FILE=".deploy-version"
if [ -f "$_VER_FILE" ]; then
  _LAST=$(cat "$_VER_FILE")
  _LAST_DATE="${_LAST:0:10}"
  _LAST_LETTER="${_LAST:10:1}"
  if [ "$_LAST_DATE" = "$_TODAY" ]; then
    if [ "$_LAST_LETTER" = "z" ]; then
      echo "ERROR: exhausted all 26 version letters for $_TODAY — set $_VER_FILE manually to continue." >&2
      exit 1
    fi
    _NEXT_LETTER=$(printf '%s' "$_LAST_LETTER" | tr 'a-y' 'b-z')
    DEPLOY_TS="${_TODAY}${_NEXT_LETTER}"
  else
    DEPLOY_TS="${_TODAY}a"
  fi
else
  DEPLOY_TS="${_TODAY}a"
fi
printf '%s' "$DEPLOY_TS" > "$_VER_FILE"
# Portable temp-file form, not `sed -i ''` — that's BSD-only syntax (works on
# this Mac) that GNU sed on Linux interprets differently (would silently
# treat '' as the sed script, not an empty in-place backup suffix). Same
# root cause as the grep -P / BSD-grep incident earlier tonight, just the
# opposite direction — an untested assumption about which sed this machine
# has, not proof either one is actually portable.
sed "s/__CACHE_VERSION__/$DEPLOY_TS/" _cf_deploy/sw.js > _cf_deploy/sw.js.tmp && mv _cf_deploy/sw.js.tmp _cf_deploy/sw.js

if [ "$target" = "prod" ]; then
  echo "=== Deploying to Cloudflare (prod) ==="
  wrangler deploy
  echo "✔  https://trak-yo-dollas.nicholas-m-garofalo.workers.dev"
else
  # Dev: deploy to a separate trak-yo-dollas-dev worker
  echo "=== Deploying to Cloudflare (dev) ==="
  wrangler deploy --name trak-yo-dollas-dev
  echo "✔  https://trak-yo-dollas-dev.nicholas-m-garofalo.workers.dev"
fi

rm -rf _cf_deploy
