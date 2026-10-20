#!/usr/bin/env bash
# Installs Prometheus, Alertmanager, Grafana and Tempo into the observability
# namespace, then rolls the app release so its ServiceMonitor and alert rules
# are picked up.
#
# Usage: scripts/install-monitoring.sh [namespace]
set -euo pipefail

NS="${1:-observability}"
APP_NS="${APP_NS:-triplemind}"
RELEASE="${RELEASE:-triplemind}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> namespace"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
# The backend NetworkPolicy allows scraping from a namespace carrying this
# label, so the label is part of the install rather than an afterthought.
kubectl label namespace "$NS" kubernetes.io/metadata.name="$NS" --overwrite >/dev/null

echo "==> grafana admin credential"
if kubectl get secret grafana-admin -n "$NS" >/dev/null 2>&1; then
  echo "    secret already exists, leaving it alone"
else
  # Generated at install time and never written to disk or to git. Retrieve
  # it with the kubectl command printed at the end.
  # Reads a fixed number of bytes rather than piping an endless stream into
  # `head`, which would SIGPIPE the producer and trip `set -o pipefail`.
  PASSWORD="${GRAFANA_PASSWORD:-$(head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24)}"
  kubectl create secret generic grafana-admin -n "$NS" \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$PASSWORD"
  echo "    created"
fi

echo "==> helm repos"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
helm repo update >/dev/null

echo "==> kube-prometheus-stack"
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n "$NS" \
  -f "$ROOT/deploy/observability/kube-prometheus-stack.values.yaml" \
  --wait --timeout 10m

echo "==> tempo"
helm upgrade --install tempo grafana/tempo \
  -n "$NS" \
  -f "$ROOT/deploy/observability/tempo.values.yaml" \
  --wait --timeout 5m

echo "==> dashboard"
# Shipped as a labelled ConfigMap so Grafana's sidecar imports it. The
# dashboard lives in git; Grafana is just where it is rendered.
kubectl create configmap triplemind-dashboard -n "$NS" \
  --from-file="$ROOT/deploy/observability/grafana/dashboards/triplemind-service.json" \
  --dry-run=client -o yaml \
  | kubectl label --local -f - grafana_dashboard=1 -o yaml \
  | kubectl apply -f -

echo "==> enabling ServiceMonitor and alert rules on the app release"
helm upgrade "$RELEASE" "$ROOT/deploy/helm/triplemind" \
  -n "$APP_NS" \
  -f "$ROOT/deploy/helm/triplemind/values-dev.yaml" \
  --reuse-values \
  --set monitoring.serviceMonitor.enabled=true \
  --set monitoring.prometheusRule.enabled=true \
  --set backend.tracing.enabled=true \
  --wait --timeout 5m

echo "==> confirming the ServiceMonitor and rules were actually created"
# The chart skips these templates when the CRDs are absent, so assert rather
# than assume -- a silently missing ServiceMonitor is a monitoring outage.
kubectl get servicemonitor "$RELEASE-backend" -n "$APP_NS" >/dev/null
kubectl get prometheusrule "$RELEASE" -n "$APP_NS" >/dev/null
echo "    present"

cat <<EOF

Done.

  Grafana:     kubectl port-forward -n $NS svc/monitoring-grafana 3000:80
               user: admin
               pass: kubectl get secret grafana-admin -n $NS -o jsonpath='{.data.admin-password}' | base64 -d
  Prometheus:  kubectl port-forward -n $NS svc/monitoring-prometheus 9090:9090
  Alertmanager:kubectl port-forward -n $NS svc/monitoring-alertmanager 9093:9093

Check the app is being scraped:
  open http://localhost:9090/targets  (look for serviceMonitor/$APP_NS/$RELEASE-backend)
EOF
