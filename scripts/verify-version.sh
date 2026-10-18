#!/usr/bin/env bash
# Answers "is the thing I just built the thing that is running?" from two
# independent sources: the Kubernetes object labels, and the process itself.
#
# Usage: scripts/verify-version.sh <release> <expected-version> [namespace]
set -euo pipefail

RELEASE="${1:?release name required}"
EXPECTED="${2:?expected version required}"
NS="${3:-triplemind}"

# shellcheck source=scripts/lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

echo "expecting version: $EXPECTED"

for component in backend frontend; do
  labelled=$(kubectl get deploy "${RELEASE}-${component}" -n "$NS" \
    -o jsonpath='{.metadata.labels.app\.kubernetes\.io/version}')
  echo "  $component deployment label: $labelled"
  if [[ "$labelled" != "$EXPECTED" ]]; then
    echo "  MISMATCH: $component is labelled '$labelled'" >&2
    exit 1
  fi
done

# Labels are metadata and can be set by anyone. This asks the process.
reported=$(run_in_cluster "$NS" "$CURL_IMAGE" curl -sf --max-time 10 "http://${RELEASE}-backend:8000/version")
echo "  backend /version: $reported"

if ! grep -q "\"version\":\"${EXPECTED}\"" <<<"$reported"; then
  echo "  MISMATCH: the running process reports a different version" >&2
  exit 1
fi

echo "verified: deployed version matches $EXPECTED"
