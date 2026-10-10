#!/bin/bash
# scripts/dev-serve.sh
#
# Serves trakyodollas.html locally with the CSP meta tag stripped.
#
# The production HTML embeds a SHA-256 Content-Security-Policy that locks the
# inline <script> block to a specific hash. Every source edit invalidates that
# hash, so the browser blocks the script until deploy.sh recomputes it. That
# makes local testing impossible without committing and deploying first.
#
# This script runs a tiny Python HTTP server that strips the CSP <meta> line
# on the fly for trakyodollas.html requests. All other assets (sw.js, icons,
# etc.) are served normally from the repo root, so relative paths work.
#
# Usage:
#   bash scripts/dev-serve.sh [port]   # port defaults to 3005
#   npm run dev
#   npm run dev -- 8080
#
# Then open: http://localhost:PORT/trakyodollas.html

set -e

PORT="${1:-3005}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Local dev server ==="
echo "Open:  http://localhost:$PORT/trakyodollas.html"
echo "Ctrl-C to stop."
echo ""

cd "$REPO_ROOT"

python3 - "$PORT" <<'PYEOF'
import http.server, re, sys, os

port = int(sys.argv[1]) if len(sys.argv) > 1 else 3005

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Strip the CSP meta tag for trakyodollas.html only; serve everything
        # else (sw.js, icons, manifest, etc.) straight from the repo root.
        if self.path in ('/', '/trakyodollas.html', '/trakyodollas.html?'):
            target = 'trakyodollas.html'
            if not os.path.exists(target):
                self.send_error(404, f'{target} not found')
                return
            with open(target, 'rb') as f:
                content = f.read()
            content = re.sub(
                rb'[ \t]*<meta http-equiv="Content-Security-Policy[^\n]*\n?',
                b'',
                content,
            )
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        # Suppress per-request noise; only show errors
        if args and str(args[1]) not in ('200', '304'):
            super().log_message(fmt, *args)

server = http.server.HTTPServer(('', port), DevHandler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
PYEOF
