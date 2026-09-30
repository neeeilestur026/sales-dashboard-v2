#!/usr/bin/env bash
# tests/audit/render-check.sh — A307 · wait for the Render deployment of HEAD, then audit its headers.
#
#   bash tests/audit/render-check.sh            (uses gh; needs the repo's deployments to be readable)
set -u
REPO="${REPO:-neeeilestur026/sales-dashboard-v2}"
BASE="${BASE:-https://hi-escorp-portal-wufz.onrender.com}"
want=$(git rev-parse --short=7 HEAD)
for i in $(seq 1 40); do
  s=$(gh api "repos/$REPO/deployments?per_page=1" --jq '.[0] | "\(.id) \(.sha[0:7])"' 2>/dev/null) || { echo "gh api failed"; exit 2; }
  id=${s%% *}; sha=${s##* }
  st=$(gh api "repos/$REPO/deployments/$id/statuses" --jq '.[0].state' 2>/dev/null)
  echo "t=$((i*15))s sha=$sha state=$st"
  if [ "$sha" = "$want" ]; then
    case "$st" in
      success) break;;
      failure|error) echo "deployment of $want failed"; exit 1;;
    esac
  fi
  sleep 15
done
[ "$sha" = "$want" ] && [ "$st" = success ] || { echo "no successful deployment of $want seen"; exit 1; }
BASE="$BASE" bash "$(dirname "$0")/headers.sh"
