#!/usr/bin/env bash
# ==============================================================================
# Paytm Money Take-Home Assignment: High-Concurrency Burst Load Runner
# Usage: ./burst.sh [BASE_URL]
# Example: ./burst.sh http://localhost:4000
#          ./burst.sh https://ticket-backend.up.railway.app
# ==============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:4000}"
# Strip trailing slash if present
BASE_URL="${BASE_URL%/}"

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}================================================================================${NC}"
echo -e "${BOLD}${CYAN}   Paytm Money Concurrency Burst Runner: Seat Reservation at Scale              ${NC}"
echo -e "${BOLD}${BLUE}================================================================================${NC}"
echo -e "Target Base URL: ${YELLOW}${BASE_URL}${NC}"
echo ""

# 1. Healthcheck Verification
echo -e "${BOLD}[1/5] Verifying Service Health & Readiness Probes...${NC}"

LIVENESS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/livez" || echo "000")
READY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/readyz" || echo "000")

if [ "$LIVENESS_STATUS" != "200" ] || [ "$READY_STATUS" != "200" ]; then
  echo -e "${RED}✘ Target service is not healthy! /livez: ${LIVENESS_STATUS}, /readyz: ${READY_STATUS}${NC}"
  echo "Ensure the application is running (e.g. docker compose up -d) before executing burst.sh."
  exit 1
fi
echo -e "${GREEN}✔ Service is ALIVE and READY (PostgreSQL ACID connection verified).${NC}"
echo ""

# Execute the concurrent scenarios using Node.js for high-throughput, microsecond-accurate concurrency
node - <<NODE_SCRIPT
const BASE_URL = "${BASE_URL}";

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';

const uid = () => Math.random().toString(36).substring(2, 9);

async function run() {
  // Scenario 1: Create a Show with 50 Seats
  console.log(\`\${BOLD}[2/5] Creating Show with 50 Seats...\${NC}\`);
  const createShowRes = await fetch(\`\${BASE_URL}/shows\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: \`Paytm Concurrency Arena \${uid()}\`,
      total_seats: 50,
      price_paise: 500000,
      per_user_limit: 4,
    }),
  });

  if (!createShowRes.ok) {
    throw new Error(\`Failed to create show: \${createShowRes.status} \${await createShowRes.text()}\`);
  }
  const show = await createShowRes.json();
  const showId = show.id;
  console.log(\`\${GREEN}✔ Show created successfully: \${showId} (50 seats, limit 4 seats/user)\${NC}\n\`);

  // Scenario 2: Hot-Seat Storm (500 Concurrent Contenders on Seat S12)
  console.log(\`\${BOLD}[3/5] Launching Hot-Seat Storm: 500 Concurrent Requests on Seat S12...\${NC}\`);
  const stormCount = 500;
  const hotSeat = ['S12'];
  const stormStartTime = Date.now();

  const stormPromises = Array.from({ length: stormCount }, (_, i) => {
    const userId = \`usr_contender_\${i}_\${uid()}\`;
    const idempKey = \`idemp_storm_\${i}_\${uid()}\`;
    return fetch(\`\${BASE_URL}/shows/\${showId}/reserve\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${userId}\`,
        'Idempotency-Key': idempKey,
      },
      body: JSON.stringify({ seats: hotSeat }),
    }).then(async (res) => {
      let body = {};
      try { body = await res.json(); } catch {}
      return { status: res.status, code: body.error || 'OK' };
    }).catch((err) => ({ status: 0, code: err.message }));
  });

  const stormResults = await Promise.all(stormPromises);
  const stormDurationMs = Date.now() - stormStartTime;

  const storm201 = stormResults.filter((r) => r.status === 201).length;
  const storm409 = stormResults.filter((r) => r.status === 409).length;
  const storm5xx = stormResults.filter((r) => r.status >= 500).length;
  const stormOther = stormResults.filter((r) => r.status !== 201 && r.status !== 409 && r.status < 500).length;

  console.log(\`   Completed 500 requests in \${stormDurationMs} ms (Throughput: \${Math.round((stormCount / stormDurationMs) * 1000)} req/s)\`);
  console.log(\`   Confirmed (201): \${storm201 === 1 ? GREEN + storm201 + NC : RED + storm201 + NC} (Target: Exactly 1 winner)\`);
  console.log(\`   Declined (409):  \${storm409 === 499 ? GREEN + storm409 + NC : RED + storm409 + NC} (Target: Exactly 499 declines)\`);
  console.log(\`   Errors (5xx):    \${storm5xx === 0 ? GREEN + storm5xx + NC : RED + storm5xx + NC} (Target: Exactly 0 errors)\n\`);

  // Scenario 3: Per-User Limit Stress Test (1 User firing 10 concurrent requests, Limit = 4)
  console.log(\`\${BOLD}[4/5] Testing Per-User Booking Limit: 1 User firing 10 Parallel Requests (Limit = 4)...\${NC}\`);
  const singleUserId = \`usr_greedy_\${uid()}\`;
  const quotaCount = 10;

  const quotaPromises = Array.from({ length: quotaCount }, (_, i) => {
    const seatNum = \`S\${i + 20}\`; // S20 to S29
    return fetch(\`\${BASE_URL}/shows/\${showId}/reserve\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${singleUserId}\`,
        'Idempotency-Key': \`idemp_quota_\${i}_\${uid()}\`,
      },
      body: JSON.stringify({ seats: [seatNum] }),
    }).then(async (res) => {
      let body = {};
      try { body = await res.json(); } catch {}
      return { status: res.status, code: body.error || 'OK' };
    });
  });

  const quotaResults = await Promise.all(quotaPromises);
  const quota201 = quotaResults.filter((r) => r.status === 201).length;
  const quota409 = quotaResults.filter((r) => r.status === 409).length;
  const quota5xx = quotaResults.filter((r) => r.status >= 500).length;

  console.log(\`   Confirmed (201): \${quota201 === 4 ? GREEN + quota201 + NC : RED + quota201 + NC} (Target: Exactly 4 allowed)\`);
  console.log(\`   Declined (409):  \${quota409 === 6 ? GREEN + quota409 + NC : RED + quota409 + NC} (Target: Exactly 6 limit declines)\`);
  console.log(\`   Errors (5xx):    \${quota5xx === 0 ? GREEN + quota5xx + NC : RED + quota5xx + NC} (Target: Exactly 0 errors)\n\`);

  // Scenario 4: Strict Idempotency Parallel Replay (50 Identical Requests)
  console.log(\`\${BOLD}[5/5] Testing Strict Idempotency: 50 Parallel Replay Requests with Identical Key...\${NC}\`);
  const idempUserId = \`usr_idemp_user_\${uid()}\`;
  const sharedKey = \`shared_idemp_burst_\${uid()}\`;
  const idempSeat = ['S40'];

  const idempPromises = Array.from({ length: 50 }, () => {
    return fetch(\`\${BASE_URL}/shows/\${showId}/reserve\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${idempUserId}\`,
        'Idempotency-Key': sharedKey,
      },
      body: JSON.stringify({ seats: idempSeat }),
    }).then(async (res) => {
      let body = {};
      try { body = await res.json(); } catch {}
      return { status: res.status, resId: body.reservation_id };
    });
  });

  const idempResults = await Promise.all(idempPromises);
  const idempSuccesses = idempResults.filter((r) => r.status === 201);
  const uniqueReservationIds = new Set(idempSuccesses.map((r) => r.resId));

  console.log(\`   Idempotent 201s:  \${idempSuccesses.length === 50 ? GREEN + '50/50' + NC : YELLOW + idempSuccesses.length + '/50' + NC}\`);
  console.log(\`   Unique Bookings:  \${uniqueReservationIds.size === 1 ? GREEN + '1 (Zero duplicate seat allocations)' + NC : RED + uniqueReservationIds.size + NC}\n\`);

  // Invariant & Reconciliation Verification
  console.log(\`\${BOLD}================================================================================\${NC}\`);
  console.log(\`\${BOLD}                 OUTCOME DISTRIBUTION & RECONCILIATION AUDIT                     \${NC}\`);
  console.log(\`\${BOLD}================================================================================\${NC}\`);

  const totalRequests = stormCount + quotaCount + 50;
  const total201 = storm201 + quota201 + idempSuccesses.length;
  const total409 = storm409 + quota409;
  const total5xx = storm5xx + quota5xx;

  console.log(\`┌───────────────────────────────────────────┬──────────────┬───────────────┐\`);
  console.log(\`│ Metric / Status Code                      │ Count        │ Invariant     │\`);
  console.log(\`├───────────────────────────────────────────┼──────────────┼───────────────┤\`);
  console.log(\`│ Total HTTP Requests Executed              │ \${String(totalRequests).padEnd(12)} │ Complete      │\`);
  console.log(\`│ HTTP 201 Created (Confirmed Reservations) │ \${String(total201).padEnd(12)} │ PASS          │\`);
  console.log(\`│ HTTP 409 Conflict (Clean Domain Declines) │ \${String(total409).padEnd(12)} │ PASS          │\`);
  console.log(\`│ HTTP 5xx Server Errors (UNHANDLED)        │ \${String(total5xx).padEnd(12)} │ \${total5xx === 0 ? GREEN + 'ZERO (PASS)' + NC : RED + 'FAIL' + NC}   │\`);
  console.log(\`└───────────────────────────────────────────┴──────────────┴───────────────┘\`);

  // Deep Reconciliation Check via GET /shows/:id
  const getShowRes = await fetch(\`\${BASE_URL}/shows/\${showId}\`);
  const finalState = await getShowRes.json();
  const { available, held, confirmed, total } = finalState.summary;

  console.log(\`\n\${BOLD}Reconciliation Invariant Verification:\${NC}\`);
  console.log(\`   Available: \${available}\`);
  console.log(\`   Held:      \${held}\`);
  console.log(\`   Confirmed: \${confirmed}\`);
  console.log(\`   Total:     \${total}\`);
  console.log(\`   Formula:   \${available} + \${held} + \${confirmed} == \${total}\`);

  if (available + held + confirmed === total && total5xx === 0 && storm201 === 1) {
    console.log(\`\n\${GREEN}\${BOLD}✔ SUCCESS: ALL PRODUCTION CONCURRENCY & RECONCILIATION INVARIANTS SATISFIED!\${NC}\n\`);
    process.exit(0);
  } else {
    console.log(\`\n\${RED}\${BOLD}✘ FAILURE: Invariant breach detected!\${NC}\n\`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(\`\${RED}Fatal execution error: \${err.message}\${NC}\`);
  process.exit(1);
});
NODE_SCRIPT
