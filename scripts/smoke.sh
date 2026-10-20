#!/usr/bin/env bash
# Exercises the request path from outside the cluster, the way a browser does.
#
# Usage: scripts/smoke.sh [base-url]
#        HOST_HEADER=triplemind.localtest.me scripts/smoke.sh http://localhost:8081
set -uo pipefail

BASE="${1:-http://triplemind.localtest.me:8081}"
HOST_HEADER="${HOST_HEADER:-}"

CURL=(curl --silent --show-error --max-time 15)
[[ -n "$HOST_HEADER" ]] && CURL+=(-H "Host: $HOST_HEADER")

passed=0
failed=0

report() {
  if [[ "$1" == "ok" ]]; then
    printf '  ok    %s\n' "$2"; passed=$((passed + 1))
  else
    printf '  FAIL  %s%s\n' "$2" "${3:+  ($3)}"; failed=$((failed + 1))
  fi
}

# Asserts an HTTP status for a request.
expect_status() {
  local want="$1" name="$2"; shift 2
  local got
  got=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$@")
  [[ "$got" == "$want" ]] && report ok "$name" || report fail "$name" "want $want, got $got"
}

# Asserts a pattern appears (or, with -v, does not appear) in the response.
expect_body() {
  local pattern="$1" name="$2"; shift 2
  "${CURL[@]}" "$@" | grep -q -- "$pattern" \
    && report ok "$name" || report fail "$name" "missing: $pattern"
}

expect_header() {
  local pattern="$1" name="$2"; shift 2
  "${CURL[@]}" -o /dev/null -D - "$@" | grep -qi -- "$pattern" \
    && report ok "$name" || report fail "$name" "missing header: $pattern"
}

refute_header() {
  local pattern="$1" name="$2"; shift 2
  "${CURL[@]}" -o /dev/null -D - "$@" | grep -qi -- "$pattern" \
    && report fail "$name" "present: $pattern" || report ok "$name"
}

echo "smoke: $BASE"

expect_status 200 "index.html is served"                "$BASE/"
expect_body   ok   "frontend health endpoint"           "$BASE/healthz"
expect_status 200 "SPA deep links fall back to index"   "$BASE/does/not/exist"
expect_body   gitSha "build metadata is published"      "$BASE/version.json"
expect_header "content-security-policy" "CSP header is set" "$BASE/"
expect_header "x-frame-options: DENY"   "clickjacking header is set" "$BASE/"
refute_header "^server: nginx/"         "no server version disclosed" "$BASE/"

# 422 proves the request reached the backend's validation layer rather than
# being answered by nginx with a 404 -- i.e. the /api proxy is wired up.
expect_status 422 "api proxy reaches the backend" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"prompt":"x","model":"m"}' "$BASE/api/suggestions"

expect_header "x-request-id: smoke-probe" "correlation id survives the hop" \
  -X POST -H 'Content-Type: application/json' -H 'X-Request-ID: smoke-probe' \
  -d '{"prompt":"x","model":"m"}' "$BASE/api/suggestions"

echo "smoke: $passed passed, $failed failed"
[[ $failed -eq 0 ]]
