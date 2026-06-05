#!/usr/bin/env bash
# Fails if any inline event handler attributes remain in HTML files.
# Run before committing: bash scripts/check-no-inline-handlers.sh

set -e

PATTERNS='onclick="|onchange="|oninput="|ondrop="|ondragover="|ondragleave="|onmouseover="|onmouseout="|onkeydown="'
FILES="trakyodollas.html index.html privacy.html"

FOUND=0
for f in $FILES; do
  # Check raw HTML attributes
  if grep -qP "$PATTERNS" "$f" 2>/dev/null; then
    echo "ERROR: inline event handlers found in $f:"
    grep -nP "$PATTERNS" "$f" | grep -v 'data-action\|data-change\|data-input\|data-drop\|data-drag\|\.onclick=\|\.onchange=\|\.oninput='
    FOUND=1
  fi
  # Also check JS template literals for onclick= patterns (these bypass HTML scanning)
  if grep -qP "onclick=\\\\?['\"]" "$f" 2>/dev/null; then
    echo "ERROR: onclick= inside JS template literal found in $f:"
    grep -nP "onclick=\\\\?['\"]" "$f"
    FOUND=1
  fi
done

if [ $FOUND -eq 1 ]; then
  echo ""
  echo "Use data-action/data-change/data-input attributes instead."
  echo "See the event delegation system in trakyodollas.html."
  exit 1
fi

echo "OK: no inline event handlers found"
