#!/usr/bin/env bash
# ============================================================
# Phase 1C — Post Management API Test Suite
#
# Usage:
#   TOKEN=<clerk_jwt> bash scripts/test-posts.sh
#
# Get a fresh token (valid 60 seconds) from the browser console:
#   const token = await window.Clerk.session.getToken(); console.log(token)
# ============================================================

set -euo pipefail

BASE="http://localhost:3000"
AUTH="Authorization: Bearer $TOKEN"

PASS=0
FAIL=0

check() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if echo "$actual" | grep -q "\"$expected\"" 2>/dev/null || [ "$actual" = "$expected" ]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label"
    echo "    expected to contain: \"$expected\""
    echo "    got: $actual"
    FAIL=$((FAIL + 1))
  fi
}

check_status() {
  local label="$1"
  local expected_status="$2"
  local url="$3"
  local method="${4:-GET}"
  local data="${5:-}"
  local extra_headers="${6:-}"

  local curl_cmd="curl -s -o /tmp/test_body -w \"%{http_code}\" -X $method $url -H \"$AUTH\""
  [ -n "$data" ] && curl_cmd="$curl_cmd -H \"Content-Type: application/json\" -d '$data'"

  local actual_status
  actual_status=$(eval "$curl_cmd")
  local body
  body=$(cat /tmp/test_body)

  if [ "$actual_status" = "$expected_status" ]; then
    echo "  ✓ $label → $actual_status"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label"
    echo "    expected: $expected_status"
    echo "    got:      $actual_status"
    echo "    body:     $body"
    FAIL=$((FAIL + 1))
  fi

  echo "$body"
}

VALID_VARIANTS='{"twitter":"Tweet text here","linkedin":"LinkedIn post here","instagram":"Insta post here","facebook":"Facebook post here"}'

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 1. AUTH GUARD (no token)"
echo "════════════════════════════════════"

for route in "POST /api/posts" "GET /api/posts" "PATCH /api/posts/fake-id" "DELETE /api/posts/fake-id"; do
  method=$(echo $route | cut -d' ' -f1)
  path=$(echo $route | cut -d' ' -f2)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE$path" -H "Content-Type: application/json" -d '{}')
  if [ "$status" = "401" ]; then
    echo "  ✓ $method $path (no token) → 401"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $method $path (no token) → expected 401, got $status"
    FAIL=$((FAIL + 1))
  fi
done

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 2. POST /api/posts — validation"
echo "════════════════════════════════════"

check_status "missing original_draft → 400" "400" "$BASE/api/posts" "POST" \
  "{\"platform_variants\":$VALID_VARIANTS}"

check_status "empty original_draft → 400" "400" "$BASE/api/posts" "POST" \
  "{\"original_draft\":\"\",\"platform_variants\":$VALID_VARIANTS}"

LONG_DRAFT=$(python3 -c "print('a'*2001)")
check_status "original_draft > 2000 chars → 400" "400" "$BASE/api/posts" "POST" \
  "{\"original_draft\":\"$LONG_DRAFT\",\"platform_variants\":$VALID_VARIANTS}"

check_status "missing platform_variants → 400" "400" "$BASE/api/posts" "POST" \
  '{"original_draft":"hello"}'

check_status "platform_variants missing facebook → 400" "400" "$BASE/api/posts" "POST" \
  '{"original_draft":"hello","platform_variants":{"twitter":"t","linkedin":"l","instagram":"i"}}'

check_status "platform_variants empty instagram → 400" "400" "$BASE/api/posts" "POST" \
  "{\"original_draft\":\"hello\",\"platform_variants\":{\"twitter\":\"t\",\"linkedin\":\"l\",\"instagram\":\"\",\"facebook\":\"f\"}}"

check_status "malformed JSON → 400" "400" "$BASE/api/posts" "POST" \
  "not-json"

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 3. POST /api/posts — success"
echo "════════════════════════════════════"

BODY=$(curl -s -X POST "$BASE/api/posts" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"original_draft\":\"First test post\",\"platform_variants\":$VALID_VARIANTS}")

POST1_ID=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
POST1_STATUS=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")

if [ -n "$POST1_ID" ]; then
  echo "  ✓ created post, id=$POST1_ID"
  PASS=$((PASS + 1))
else
  echo "  ✗ create post failed — body: $BODY"
  FAIL=$((FAIL + 1))
fi

if [ "$POST1_STATUS" = "draft" ]; then
  echo "  ✓ status defaults to draft"
  PASS=$((PASS + 1))
else
  echo "  ✗ expected status=draft, got: $POST1_STATUS"
  FAIL=$((FAIL + 1))
fi

# Create a second post to test ordering
sleep 1
BODY2=$(curl -s -X POST "$BASE/api/posts" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"original_draft\":\"Second test post\",\"platform_variants\":$VALID_VARIANTS}")
POST2_ID=$(echo "$BODY2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
echo "  ✓ created second post, id=$POST2_ID"

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 4. GET /api/posts"
echo "════════════════════════════════════"

LIST=$(curl -s "$BASE/api/posts" -H "$AUTH")
FIRST_ID=$(echo "$LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['posts'][0]['id'] if d['posts'] else '')" 2>/dev/null || echo "")

if echo "$LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'posts' in d and 'total' in d" 2>/dev/null; then
  echo "  ✓ returns posts array and total"
  PASS=$((PASS + 1))
else
  echo "  ✗ missing posts/total fields — $LIST"
  FAIL=$((FAIL + 1))
fi

if [ "$FIRST_ID" = "$POST2_ID" ]; then
  echo "  ✓ posts ordered newest-first"
  PASS=$((PASS + 1))
else
  echo "  ✗ order wrong — first post id: $FIRST_ID, expected: $POST2_ID"
  FAIL=$((FAIL + 1))
fi

# Pagination params
P=$(curl -s "$BASE/api/posts?page=2&limit=5" -H "$AUTH")
PAGE=$(echo "$P" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('page',''))" 2>/dev/null)
LIMIT=$(echo "$P" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('limit',''))" 2>/dev/null)
[ "$PAGE" = "2" ] && { echo "  ✓ page=2 echoed back"; PASS=$((PASS+1)); } || { echo "  ✗ page not echoed, got: $PAGE | response: $P"; FAIL=$((FAIL+1)); }
[ "$LIMIT" = "5" ] && { echo "  ✓ limit=5 echoed back"; PASS=$((PASS+1)); } || { echo "  ✗ limit not echoed, got: $LIMIT | response: $P"; FAIL=$((FAIL+1)); }

# Limit clamped to 50
L=$(curl -s "$BASE/api/posts?limit=999" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('limit',''))" 2>/dev/null)
[ "$L" = "50" ] && { echo "  ✓ limit clamped to 50"; PASS=$((PASS+1)); } || { echo "  ✗ limit not clamped, got $L"; FAIL=$((FAIL+1)); }

# Invalid limit defaults to 10
L2=$(curl -s "$BASE/api/posts?limit=abc" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('limit',''))" 2>/dev/null)
[ "$L2" = "10" ] && { echo "  ✓ invalid limit defaults to 10"; PASS=$((PASS+1)); } || { echo "  ✗ invalid limit, got $L2"; FAIL=$((FAIL+1)); }

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 5. PATCH /api/posts/:id"
echo "════════════════════════════════════"

if [ -z "$POST1_ID" ]; then
  echo "  SKIP — no post ID available from step 3"
else
  # Update original_draft
  UP=$(curl -s -X PATCH "$BASE/api/posts/$POST1_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"original_draft":"Updated draft"}')
  NEW_DRAFT=$(echo "$UP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('original_draft',''))" 2>/dev/null)
  [ "$NEW_DRAFT" = "Updated draft" ] && { echo "  ✓ updated original_draft"; PASS=$((PASS+1)); } || { echo "  ✗ update failed: $UP"; FAIL=$((FAIL+1)); }

  # Update status to queued
  UP2=$(curl -s -X PATCH "$BASE/api/posts/$POST1_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"status":"queued"}')
  NEW_STATUS=$(echo "$UP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  [ "$NEW_STATUS" = "queued" ] && { echo "  ✓ status updated to queued"; PASS=$((PASS+1)); } || { echo "  ✗ status update failed: $UP2"; FAIL=$((FAIL+1)); }

  # Try to set status=published → 400
  check_status "status=published → 400" "400" "$BASE/api/posts/$POST1_ID" "PATCH" \
    '{"status":"published"}'

  # Try to set status=failed → 400
  check_status "status=failed → 400" "400" "$BASE/api/posts/$POST1_ID" "PATCH" \
    '{"status":"failed"}'

  # Update scheduled_at with valid ISO
  UP3=$(curl -s -X PATCH "$BASE/api/posts/$POST1_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"scheduled_at":"2026-05-01T10:00:00Z"}')
  SAT=$(echo "$UP3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('scheduled_at',''))" 2>/dev/null)
  [ -n "$SAT" ] && { echo "  ✓ scheduled_at set"; PASS=$((PASS+1)); } || { echo "  ✗ scheduled_at failed: $UP3"; FAIL=$((FAIL+1)); }

  # Set scheduled_at to null
  UP4=$(curl -s -X PATCH "$BASE/api/posts/$POST1_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"scheduled_at":null}')
  SAT2=$(echo "$UP4" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('scheduled_at') is None)" 2>/dev/null)
  [ "$SAT2" = "True" ] && { echo "  ✓ scheduled_at set to null"; PASS=$((PASS+1)); } || { echo "  ✗ scheduled_at null failed: $UP4"; FAIL=$((FAIL+1)); }

  # Invalid scheduled_at
  check_status "invalid scheduled_at → 400" "400" "$BASE/api/posts/$POST1_ID" "PATCH" \
    '{"scheduled_at":"not-a-date"}'

  # Unknown field only → 400 (no valid fields)
  check_status "only unknown fields → 400" "400" "$BASE/api/posts/$POST1_ID" "PATCH" \
    '{"foo":"bar"}'

  # Non-existent post ID → 404
  check_status "non-existent ID → 404" "404" "$BASE/api/posts/00000000-0000-0000-0000-000000000000" "PATCH" \
    '{"original_draft":"x"}'
fi

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " 6. DELETE /api/posts/:id"
echo "════════════════════════════════════"

if [ -z "$POST2_ID" ]; then
  echo "  SKIP — no second post ID"
else
  # Delete a draft post → 204
  DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/posts/$POST2_ID" -H "$AUTH")
  [ "$DEL" = "204" ] && { echo "  ✓ delete draft post → 204"; PASS=$((PASS+1)); } || { echo "  ✗ delete failed, got $DEL"; FAIL=$((FAIL+1)); }

  # Delete same post again → 404
  DEL2=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/posts/$POST2_ID" -H "$AUTH")
  [ "$DEL2" = "404" ] && { echo "  ✓ second delete → 404"; PASS=$((PASS+1)); } || { echo "  ✗ expected 404, got $DEL2"; FAIL=$((FAIL+1)); }

  # Non-existent post → 404
  check_status "non-existent ID → 404" "404" "$BASE/api/posts/00000000-0000-0000-0000-000000000000" "DELETE"
fi

# ============================================================
echo ""
echo "════════════════════════════════════"
echo " RESULTS"
echo "════════════════════════════════════"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Total:  $((PASS + FAIL))"
echo ""
[ $FAIL -eq 0 ] && echo "  ALL TESTS PASSED" || echo "  SOME TESTS FAILED"
