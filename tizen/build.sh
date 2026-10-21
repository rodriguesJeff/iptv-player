#!/usr/bin/env bash
# Package (and optionally install) the Samsung Tizen .wgt.
# Needs Tizen Studio CLI on PATH (tizen, sdb) and a Samsung certificate profile.
#   ./tizen/build.sh                 → build/IPTVPlayer.wgt
#   ./tizen/build.sh 192.168.0.50    → also connect to the TV and install
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
OUT="$ROOT/build/tizen"
PROFILE="${TIZEN_PROFILE:-iptv}"

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$ROOT/www/." "$OUT/"
cp "$HERE/config.xml" "$HERE/icon.png" "$OUT/"

tizen package -t wgt -s "$PROFILE" -- "$OUT"
WGT="$(ls "$OUT"/*.wgt | head -1)"
mv "$WGT" "$ROOT/build/IPTVPlayer.wgt"
echo "built $ROOT/build/IPTVPlayer.wgt"

if [ "${1:-}" != "" ]; then
  sdb connect "$1"
  TARGET="$(sdb devices | awk 'NR>1 && $1 ~ /:/ {print $3; exit}')"
  tizen install -n "$ROOT/build/IPTVPlayer.wgt" -t "$TARGET"
  tizen run -p IptvPlayr1.IptvPlayer -t "$TARGET"
fi
