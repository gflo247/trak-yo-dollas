#!/bin/bash
set -e

target="$1"
if [ "$target" != "dev" ] && [ "$target" != "prod" ]; then
  echo "Usage: ./deploy.sh <dev|prod>"
  exit 1
fi

python3 scripts/update-csp-hashes.py
python3 scripts/update-sitemap-dates.py

if [ "$target" = "prod" ]; then
  firebase deploy --only hosting --project trak-yo-dollas
else
  firebase hosting:channel:deploy dev --project trak-yo-dollas --expires 30d
fi
