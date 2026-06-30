#!/bin/sh
set -e

# data/ kalıcı bir volume; boşsa ilk açılışta seed'den tohumla (skills vb.)
if [ -d /app/seed ] && [ -z "$(ls -A /app/data 2>/dev/null)" ]; then
  mkdir -p /app/data
  cp -r /app/seed/. /app/data/ 2>/dev/null || true
fi

exec "$@"
