#!/usr/bin/env bash
# Drives enough traffic to make the HPA scale, for autoscaling evidence.
# Runs the load from inside the cluster so it is not limited by the host's
# connection to the ingress.
#
# Usage: scripts/load.sh [duration-seconds] [concurrency] [namespace]
set -euo pipefail

DURATION="${1:-120}"
CONCURRENCY="${2:-20}"
NS="${3:-triplemind}"
RELEASE="${RELEASE:-triplemind}"
# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

echo "load: ${CONCURRENCY} workers for ${DURATION}s against ${RELEASE}-backend"
echo "watch it scale in another terminal:"
echo "  kubectl get hpa,pods -n $NS -w"
echo

run_in_cluster "$NS" "$CURL_IMAGE" sh -ec "
    END=\$(( \$(date +%s) + $DURATION ))
    i=0
    while [ \$i -lt $CONCURRENCY ]; do
      (
        while [ \$(date +%s) -lt \$END ]; do
          # /version is cheap but real: it exercises the full ASGI stack,
          # middleware chain and metrics recording without calling Groq.
          curl -s -o /dev/null http://${RELEASE}-backend:8000/version
        done
      ) &
      i=\$(( i + 1 ))
    done
    wait
    echo 'load finished'
  "

echo
kubectl get hpa -n "$NS"
kubectl top pods -n "$NS" 2>/dev/null || echo "(metrics-server not installed -- HPA will show <unknown>)"
