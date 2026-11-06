#!/bin/sh
# Runs the standalone production build locally, the same way the Docker image does.
set -e
cp -r public .next/standalone/ 2>/dev/null || true
cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
cd .next/standalone
PORT=3000 HOSTNAME=:: INTERNAL_API_URL=${INTERNAL_API_URL:-http://localhost:8000} exec node server.js
