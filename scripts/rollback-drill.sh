#!/usr/bin/env bash
# Proves recovery works, rather than asserting that it would.
#
#   1. record the healthy revision
#   2. deploy a deliberately broken image reference
#   3. confirm the rollout fails and --atomic/--wait catches it
#   4. roll back
#   5. confirm the healthy revision is serving again
#
# Usage: scripts/rollback-drill.sh <release> [namespace]
set -euo pipefail

RELEASE="${1:?release name required}"
NS="${2:-triplemind}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"
CHART="$ROOT/deploy/helm/triplemind"
VALUES="$CHART/values-dev.yaml"

good_rev=$(helm history "$RELEASE" -n "$NS" -o json | python3 -c \
  'import json,sys; print(max(r["revision"] for r in json.load(sys.stdin) if r["status"]=="deployed"))')
echo "healthy revision: $good_rev"

echo
echo "--- step 1: deploy a broken release (expected to fail) ---"
set +e
helm upgrade "$RELEASE" "$CHART" -n "$NS" -f "$VALUES" \
  --set backend.image.tag=this-tag-does-not-exist \
  --set monitoring.serviceMonitor.enabled=false \
  --set monitoring.prometheusRule.enabled=false \
  --wait --timeout 90s
upgrade_rc=$?
set -e

if [[ $upgrade_rc -eq 0 ]]; then
  echo "UNEXPECTED: the broken release reported success"
  exit 1
fi
echo "broken release correctly failed (exit $upgrade_rc)"

# maxUnavailable:0 means the old pods were never torn down, so the service
# kept answering throughout the failed rollout. Verify that claim.
echo
echo "--- step 2: service stayed up during the failed rollout ---"
run_in_cluster "$NS" "$CURL_IMAGE" curl -sf "http://${RELEASE}-backend:8000/healthz" | grep -q ok
echo "backend still serving"

echo
echo "--- step 3: roll back to revision $good_rev ---"
helm rollback "$RELEASE" "$good_rev" -n "$NS" --wait --timeout 180s
kubectl rollout status "deploy/${RELEASE}-backend" -n "$NS" --timeout=120s

echo
echo "--- step 4: verify recovery ---"
helm test "$RELEASE" -n "$NS" >/dev/null
helm history "$RELEASE" -n "$NS"
echo "rollback drill passed"
