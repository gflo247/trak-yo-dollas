#!/bin/bash
set -e

target="$1"
if [ "$target" != "dev" ] && [ "$target" != "prod" ]; then
  echo "Usage: ./deploy.sh <dev|prod>"
  exit 1
fi

# Gate the deploy on the test suite and the inline-handler lint — previously
# this script would ship straight to prod with no verification at all, the
# only safety net being a developer remembering to run both by hand first.
echo "=== Running tests ==="
npm test

echo "=== Checking for inline event handlers ==="
bash scripts/check-no-inline-handlers.sh

echo "=== Checking connect-src covers every network destination ==="
python3 scripts/check-connect-src.py

# Advisory only (not a hard gate — has known false positives, e.g. a
# risky-named field used in a hardcoded/internal object rather than
# rendered user data). Review the output; don't just wait for it to fail.
echo "=== Scanning for unescaped user-data interpolations (advisory) ==="
python3 scripts/check-escaping.py || true

python3 scripts/update-csp-hashes.py
python3 scripts/update-sitemap-dates.py

# Build clean deploy directory — only files meant for public serving
rm -rf _cf_deploy
rsync -a \
  --exclude='.git' \
  --exclude='.wrangler' \
  --exclude='_cf_deploy' \
  --exclude='firebase.json' \
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
  --exclude='ENTIRE-SITE-ARCHITECTURE.md' \
  --exclude='ENTIRE-SITE-ARCHITECTURE.html' \
  --exclude='ENTIRE-SITE-ARCHITECTURE-deep-dive.html' \
  --exclude='scripts' \
  --exclude='test' \
  --exclude='node_modules' \
  --exclude='.claude' \
  --exclude='package.json' \
  --exclude='package-lock.json' \
  . _cf_deploy/

# Stamp sw.js with a deploy timestamp so every deploy busts the cache.
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
DEPLOY_TS=$(date -u +%Y%m%d%H%M%S)
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
