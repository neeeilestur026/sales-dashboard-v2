#!/usr/bin/env bash
# tests/audit/headers.sh — A300 · the response headers a deployment must carry.
#
#   bash tests/audit/headers.sh                     against http://localhost:5066
#   BASE=https://hi-escorp-portal-wufz.onrender.com bash tests/audit/headers.sh
#
# Checks: HSTS, the CSP (report-only until A304, enforcing after), nosniff, the cache policy per
# type, compression when the client offers it, and a 304 on If-None-Match for a script.
set -u
BASE="${BASE:-http://localhost:5066}"
fail=0; n=0
ok() { n=$((n+1)); if [ "$2" = 1 ]; then echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1  ${3:-}"; fi; }
hdr() { curl -s -D - -o /dev/null --max-time 90 -H "Accept-Encoding: ${ENC:-identity}" "$BASE/$1" | tr -d '\r'; }

H=$(hdr index.html)
ok "index.html answers 200" "$(echo "$H" | head -1 | grep -c ' 200')" "$(echo "$H" | head -1)"
ok "  Strict-Transport-Security" "$(echo "$H" | grep -ic '^strict-transport-security: max-age=')"
ok "  a Content-Security-Policy (report-only or enforcing)" "$(echo "$H" | grep -ic '^content-security-policy')"
ok "  X-Content-Type-Options: nosniff" "$(echo "$H" | grep -ic '^x-content-type-options: nosniff')"
ok "  html: public, max-age=0, must-revalidate" "$(echo "$H" | grep -ic '^cache-control: public, max-age=0, must-revalidate')" "$(echo "$H" | grep -i '^cache-control')"

J=$(ENC="br, gzip" hdr js/api.js)
ok "js/api.js is compressed when the client accepts it" "$(echo "$J" | grep -ic '^content-encoding: \(br\|gzip\)')" "$(echo "$J" | grep -i '^content-encoding')"
ok "  js: public, max-age=0, must-revalidate" "$(echo "$J" | grep -ic '^cache-control: public, max-age=0, must-revalidate')"
ETAG=$(echo "$J" | grep -i '^etag:' | sed 's/^[Ee][Tt][Aa][Gg]: //')
ok "  it carries an ETag" "$([ -n "$ETAG" ] && echo 1 || echo 0)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 -H "Accept-Encoding: br, gzip" -H "If-None-Match: $ETAG" "$BASE/js/api.js")
ok "  and If-None-Match yields 304" "$([ "$CODE" = 304 ] && echo 1 || echo 0)" "$CODE"

I=$(hdr images/logo-nav.png)
ok "images: public, max-age=2592000" "$(echo "$I" | grep -ic '^cache-control: public, max-age=2592000')" "$(echo "$I" | grep -i '^cache-control')"

echo; echo "$n checks, $fail failed"; exit $((fail > 0))
