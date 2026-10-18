#!/usr/bin/env bash
# End-to-end evidence: drives the three calls the browser makes during a real
# session -- transcribe, suggest, chat (streamed) -- against the deployed
# release, with a stand-in provider so no real API key is involved.
#
# Usage: scripts/demo-journey.sh [namespace]
set -euo pipefail

NS="${1:-triplemind}"
RELEASE="${RELEASE:-triplemind}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib.sh
source "$ROOT/scripts/lib.sh"

# Not a credential: the stand-in provider only checks that the backend
# forwarded *a* bearer token, which is itself part of what is being proven.
KEY="gsk_demo_key_not_a_real_credential"

echo "==> deploying the stand-in provider"
kubectl create configmap mock-groq-src -n "$NS" \
  --from-file="$ROOT/scripts/mock-groq.py" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n "$NS" -f "$ROOT/deploy/kind/mock-groq.yaml"
kubectl rollout status deploy/mock-groq -n "$NS" --timeout=180s

echo "==> pointing the backend at it"
helm upgrade "$RELEASE" "$ROOT/deploy/helm/triplemind" -n "$NS" \
  -f "$ROOT/deploy/helm/triplemind/values-dev.yaml" --reuse-values \
  --set backend.config.groqBaseUrl="http://mock-groq.${NS}.svc.cluster.local:8081/openai/v1" \
  --wait --timeout 5m

echo
echo "==> driving the user journey through the frontend's /api proxy"
run_in_cluster "$NS" "$CURL_IMAGE" sh -ec "
    FE=http://${RELEASE}-frontend

    echo '--- 1. transcribe a 30s audio chunk ---'
    printf 'fake-webm-audio' > /tmp/chunk.webm
    curl -sf -X POST \"\$FE/api/transcribe\" \
      -H 'X-Groq-API-Key: ${KEY}' \
      -F 'file=@/tmp/chunk.webm;type=audio/webm' \
      -F 'model=whisper-large-v3'
    echo

    echo '--- 2. generate a suggestion batch ---'
    curl -sf -X POST \"\$FE/api/suggestions\" \
      -H 'X-Groq-API-Key: ${KEY}' -H 'Content-Type: application/json' \
      -d '{\"prompt\":\"transcript so far...\",\"model\":\"llama-3.3-70b-versatile\"}'
    echo

    echo '--- 3. stream a detailed answer (SSE) ---'
    curl -sfN -X POST \"\$FE/api/chat\" \
      -H 'X-Groq-API-Key: ${KEY}' -H 'Content-Type: application/json' \
      -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Tell me more about the enterprise shortfall\"}],\"model\":\"llama-3.3-70b-versatile\"}' \
      | head -20
    echo
    echo 'journey complete'
  "

echo
echo "==> metrics recorded for that journey"
run_in_cluster "$NS" "$CURL_IMAGE" curl -sf "http://${RELEASE}-backend:8000/metrics" \
  | grep -E '^triplemind_(upstream_requests_total|http_requests_total\{.*api)' | head -15
