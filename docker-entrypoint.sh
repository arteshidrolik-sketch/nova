#!/bin/sh
set -e

# data/ kalıcı bir volume; boşsa ilk açılışta seed'den tohumla (skills vb.)
if [ -d /app/seed ] && [ -z "$(ls -A /app/data 2>/dev/null)" ]; then
  mkdir -p /app/data
  cp -r /app/seed/. /app/data/ 2>/dev/null || true
fi

# Nova beyni: kendi kaynağında (/srv/nova-src) "npm run build" ile doğrulama
# yapabilsin diye node_modules'u imajdakiyle paylaş (dev bağımlılıkları dahil).
if [ -d /srv/nova-src ] && [ ! -e /srv/nova-src/node_modules ]; then
  ln -s /app/node_modules /srv/nova-src/node_modules 2>/dev/null || true
fi

exec "$@"
