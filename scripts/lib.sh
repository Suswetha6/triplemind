# Shared helpers. Source, do not execute.

# Runs a command in a throwaway pod and prints only its output.
#
# `kubectl run -i` both attaches and tails the logs, so a container that exits
# quickly has its output printed twice -- and when the attach loses the race
# it is printed with a warning and sometimes truncated. Creating the pod
# detached and reading the logs afterwards is deterministic.
#
# Usage: run_in_cluster <namespace> <image> <command...>
run_in_cluster() {
  local ns="$1" image="$2"; shift 2
  local pod="job-$$-$RANDOM" phase rc=0

  kubectl run "$pod" -n "$ns" --restart=Never --quiet --image="$image" \
    --command -- "$@" >/dev/null

  # Waits for either terminal phase; `kubectl wait` cannot express "or".
  for _ in $(seq 1 120); do
    phase=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.status.phase}' 2>/dev/null || true)
    [[ "$phase" == "Succeeded" || "$phase" == "Failed" ]] && break
    sleep 1
  done

  kubectl logs "$pod" -n "$ns" 2>/dev/null || true
  [[ "$phase" == "Succeeded" ]] || rc=1
  kubectl delete pod "$pod" -n "$ns" --wait=false >/dev/null 2>&1 || true
  return $rc
}

CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"
