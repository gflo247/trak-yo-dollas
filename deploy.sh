#!/bin/bash
set -e
python3 scripts/update-csp-hashes.py
python3 scripts/update-sitemap-dates.py
firebase deploy --only hosting --project trak-yo-dollas
