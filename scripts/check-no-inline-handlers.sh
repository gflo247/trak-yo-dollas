#!/usr/bin/env bash
# Fails if any inline event handler attributes remain in HTML files.
# Run before committing: bash scripts/check-no-inline-handlers.sh
#
# Uses -E (POSIX extended regex), not -P (PCRE) — macOS ships BSD grep as
# /usr/bin/grep, which doesn't support -P at all (exits 2, "invalid option").
# This script previously used -P and silently reported "OK" on every run on
# this machine regardless of actual content: the grep call errored out, the
# error was piped to /dev/null, and the `if` treated the nonzero exit as
# "pattern not found" rather than "grep itself failed." Caught July 6, 2026
# when a newly-added CSP on index.html/privacy.html broke real onclick=
# handlers this script should have been catching the whole time. -E covers
# every pattern below (plain alternation, a literal backslash, a character
# class) with no PCRE-only syntax, so it's portable to both BSD and GNU grep.

set -e

PATTERNS='onclick="|onchange="|oninput="|ondrop="|ondragover="|ondragleave="|onmouseover="|onmouseout="|onkeydown="'
FILES="trakyodollas.html index.html privacy.html"

FOUND=0
for f in $FILES; do
  # Check raw HTML attributes
  if grep -qE "$PATTERNS" "$f" 2>/dev/null; then
    echo "ERROR: inline event handlers found in $f:"
    grep -nE "$PATTERNS" "$f" | grep -v 'data-action\|data-change\|data-input\|data-drop\|data-drag\|\.onclick=\|\.onchange=\|\.oninput='
    FOUND=1
  fi
  # Also check JS template literals for onclick= patterns (these bypass HTML scanning)
  if grep -qE "onclick=\\\\?['\"]" "$f" 2>/dev/null; then
    echo "ERROR: onclick= inside JS template literal found in $f:"
    grep -nE "onclick=\\\\?['\"]" "$f"
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
