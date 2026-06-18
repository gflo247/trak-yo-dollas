#!/bin/bash
set -e

target="$1"
if [ "$target" != "dev" ] && [ "$target" != "prod" ]; then
  echo "Usage: ./deploy.sh <dev|prod>"
  exit 1
fi

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
  --exclude='scripts' \
  --exclude='node_modules' \
  --exclude='.claude' \
  . _cf_deploy/

# Stamp sw.js with a deploy timestamp so every deploy busts the cache
DEPLOY_TS=$(date -u +%Y%m%d%H%M%S)
sed -i '' "s/__CACHE_VERSION__/$DEPLOY_TS/" _cf_deploy/sw.js

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
