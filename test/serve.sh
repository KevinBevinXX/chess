#!/usr/bin/env bash
# Serve the site locally for the tests. Any static server would do.
cd "$(dirname "$0")/.."
exec python3 -m http.server "${PORT:-8777}" --bind 127.0.0.1
