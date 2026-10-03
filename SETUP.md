# Complete Setup & API Reference Guide

High-Concurrency Distributed Seat Reservation & Ticketing Service built with Node.js (ES Modules) and PostgreSQL 15.

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Setup & Running](#2-setup--running)
   - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
   - [Option B: Local Node.js & PostgreSQL](#option-b-local-nodejs--postgresql)
   - [Option C: Cloud Deployment (Railway / Render)](#option-c-cloud-deployment-railway--render)
3. [Running Automated Tests](#3-running-automated-tests)
4. [Executing the Load Runner (`burst.sh`)](#4-executing-the-load-runner-burstsh)
5. [Complete API Reference & cURL Commands](#5-complete-api-reference--curl-commands)
   - [Health & Observability Probes](#51-health--observability-probes)
   - [Show Management](#52-show-management)
   - [Direct Reservation & Idempotency](#53-direct-reservation--idempotency)
   - [Seat Hold & Payment Simulation](#54-seat-hold--payment-simulation)
   - [Cancellation & Release](#55-cancellation--release)
   - [Hold Sweeper Maintenance](#56-hold-sweeper-maintenance)
6. [Environment Variables Reference](#6-environment-variables-reference)

---

## 1. Prerequisites

- **Docker & Docker Compose** (Docker Desktop on macOS/Windows/Linux)
- **Node.js 20+ & npm** (only if running locally without Docker)
- **curl & bash** (for testing APIs and running `burst.sh`)

---

## 2. Setup & Running

### Option A: Docker Compose (Recommended)

Run the entire stack (PostgreSQL 15 + Node.js API with health checks and auto-migrations) with a single command:

```bash
# 1. Clone the repository and navigate into it
git clone https://github.com/vivekkumar9919/Tickets-Booking.git
cd Tickets-Booking

# 2. Build and start containers in the background
docker compose up -d --build

# 3. View live structured logs
docker compose logs -f backend
```

Once running:
- **API Base URL:** `http://localhost:4000`
- **PostgreSQL Database:** `localhost:5432` (`ticket_booking`, user: `postgres`, password: `postgrespassword`)

To stop:
```bash
docker compose down
```

---

### Option B: Local Node.js & PostgreSQL

If you prefer running Node.js directly on your host machine:

```bash
# 1. Ensure PostgreSQL is running locally on port 5432
# (e.g. created database ticket_booking)

# 2. Navigate to backend directory
cd backend

# 3. Install dependencies
npm install

# 4. Configure environment variables (or copy .env.example)
cat <<EOF > .env
PORT=4000
DATABASE_URL=postgres://postgres:postgrespassword@localhost:5432/ticket_booking
DB_POOL_MIN=5
DB_POOL_MAX=30
DB_LOCK_TIMEOUT_MS=2000
LOG_LEVEL=info
EOF

# 5. Run database migrations
npm run migrate

# 6. Start the service
npm start
```

---

### Option C: Cloud Deployment (Railway / Render)

The repository includes ready-to-deploy configuration manifests:
- [`Dockerfile`](./Dockerfile) (Multi-stage production build)
- [`railway.json`](./railway.json) (Railway build & healthcheck specification)
- [`render.yaml`](./render.yaml) (Render Infrastructure-as-Code with managed PostgreSQL)

#### Deploy to Railway (2 minutes):
1. Push code to your GitHub repo.
2. In Railway, click **New Project** $\rightarrow$ **Deploy from GitHub repo** $\rightarrow$ Select `Tickets-Booking`.
3. Add a PostgreSQL database service in Railway (**New Service $\rightarrow$ Database $\rightarrow$ Add PostgreSQL**).
4. Set the environment variable on the backend service:
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}`
   - `PORT`: `3000`
5. Railway detects [`railway.json`](./railway.json), boots the container, applies migrations on startup, verifies `/readyz`, and provisions a public HTTPS domain.

#### Deploy to Render (Blueprint / Manual):

**Method 1: Render Blueprint (One-Click via `render.yaml`)**
1. Push your repository to GitHub.
2. Log in to [dashboard.render.com](https://dashboard.render.com).
3. Click **New +** $\rightarrow$ **Blueprint**.
4. Connect your GitHub repository.
5. Render reads [`render.yaml`](./render.yaml), automatically provisions a **PostgreSQL database** and a **Web Service**, links their `DATABASE_URL`, and deploys both.

**Method 2: Manual Dashboard Setup**
1. **Create PostgreSQL Database:**
   - In Render Dashboard, click **New +** $\rightarrow$ **PostgreSQL**.
   - Name: `ticket-booking-db`, Database: `ticket_booking`.
   - Copy the **Internal Database URL** (or External URL if connecting externally).
2. **Create Web Service:**
   - Click **New +** $\rightarrow$ **Web Service** $\rightarrow$ connect repository.
   - **Environment:** `Node` (or `Docker` using the root Dockerfile).
   - **Build Command:** `npm --prefix backend ci`
   - **Start Command:** `npm --prefix backend start`
   - **Health Check Path:** `/readyz`
   - **Environment Variables:**
     - `DATABASE_URL`: *(paste the PostgreSQL connection string from step 1)*
     - `NODE_ENV`: `production`
     - `PORT`: `3000` (Render also automatically injects its port)
     - `DB_POOL_MIN`: `5`
     - `DB_POOL_MAX`: `30`
     - `DB_LOCK_TIMEOUT_MS`: `2000`
3. Click **Create Web Service**. On deployment, Render runs migrations automatically, verifies `/readyz`, and provides your public URL (e.g., `https://ticket-reservation-backend.onrender.com`).

---

## 3. Running Automated Tests

The repository contains 29 unit and integration tests covering the complete transactional lifecycle:

```bash
cd backend
npm test
```

### Test Coverage Breakdown:
- **Phase 1 (`phase1-migrations.test.js`):** Connection pool lifecycle, DDL migrations, table existence, and transaction rollback on error.
- **Phase 2 (`phase2-domain-repositories.test.js`):** `Money` integer paise validation, domain entities, seat repository row locking, idempotency cache storage.
- **Phase 3 (`phase3-concurrency-services.test.js`):** Row-level locking under high contention, reverse-order deadlock prevention, user quota serialization via advisory locks, hold expiry, and sweeper worker.
- **Phase 4 (`phase4-api-observability.test.js`):** Authentication middleware, body spoofing prevention (`400`), idempotency replay caching, temporary hold & confirmation, and Prometheus metric generation.

---

## 4. Executing the Load Runner (`burst.sh`)

Test the system against high-concurrency race conditions (hot-seat storm with 500 parallel contenders, user quota limits, and idempotency replays):

**Execution Path:** Run from the repository root directory (`ticketBooking/` or `Tickets-Booking/`):

```bash
cd /path/to/ticketBooking
chmod +x burst.sh

# Option A: Against Live Render Cloud (Public Production URL)
./burst.sh https://ticket-reservation-backend-bc2y.onrender.com

# Option B: Against Local Docker Deployment
./burst.sh http://localhost:4000

# Optional custom storm count (e.g. 500 or 1,000 contenders):
./burst.sh https://ticket-reservation-backend-bc2y.onrender.com 500
./burst.sh http://localhost:4000 500
```

### What `burst.sh` Validates:
1. **Health Verification:** Confirms `/livez` and `/readyz` report `200 OK`.
2. **Show Creation:** Creates a 50-seat inventory with a 4-seat user quota.
3. **Hot-Seat Storm:** Fires **500 concurrent requests competing for the exact same seat (`S12`)**. Asserts **exactly 1 winner (`201`)**, **499 clean declines (`409`)**, and **0 server errors (`500`)**.
4. **Quota Boundary:** 1 user fires 10 parallel requests. Asserts **exactly 4 allowed** and **6 declines**.
5. **Idempotency Replay:** Fires 50 parallel requests with an identical idempotency key. Asserts all receive `201` with the same booking ID and zero duplicate seats.
6. **Reconciliation Audit:** Verifies `available + held + confirmed == total_seats`.

---

## 5. Complete API Reference & cURL Commands

Set your base URL variable:

```bash
# Target Live Render Production URL:
BASE_URL="https://ticket-reservation-backend-bc2y.onrender.com"

# OR Target Local Docker URL:
# BASE_URL="http://localhost:4000"
```

---

### 5.1 Health & Observability Probes

#### Liveness Probe
Validates the HTTP web process is responsive.
```bash
curl -X GET "${BASE_URL}/livez"
```
**Response (`200 OK`):**
```json
{
  "status": "alive",
  "timestamp": "2026-10-03T06:39:27.708Z"
}
```

#### Readiness Probe
Deep dependency check executing `SELECT 1` on the PostgreSQL connection pool. Fails closed (`503`) if database is unreachable.
```bash
curl -X GET "${BASE_URL}/readyz"
```
**Response (`200 OK`):**
```json
{
  "status": "ready",
  "database": "connected",
  "latency_ms": 1,
  "timestamp": "2026-10-03T06:39:27.810Z"
}
```

#### Prometheus Metrics
Exposes scrapable metrics for Prometheus / Grafana.
```bash
curl -X GET "${BASE_URL}/metrics"
```
**Sample Output:**
```text
# HELP ticket_reservations_confirmed_total Total successfully confirmed seat reservations
# TYPE ticket_reservations_confirmed_total counter
ticket_reservations_confirmed_total{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8"} 26

# HELP ticket_reservations_declined_total Total declined seat reservation attempts partitioned by reason
# TYPE ticket_reservations_declined_total counter
ticket_reservations_declined_total{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8",reason="SEAT_UNAVAILABLE"} 499
ticket_reservations_declined_total{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8",reason="USER_LIMIT_EXCEEDED"} 6

# HELP ticket_seats_status Instantaneous count of seats in each state (available, held, confirmed)
# TYPE ticket_seats_status gauge
ticket_seats_status{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8",status="available"} 44
ticket_seats_status{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8",status="held"} 0
ticket_seats_status{show_id="e2ed5a28-bf4c-48d4-b833-b40330404db8",status="confirmed"} 6
```

---

### 5.2 Show Management

#### Create a Show
Creates a show and its seat inventory atomically. Supports both explicit seat labels (e.g. `["A1", "A2", "A3"]`) and total seat counts:

```bash
# Format A: Explicit seat labels (as in Paytm assignment spec)
curl -X POST "${BASE_URL}/shows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "friday-night",
    "seats": ["A1", "A2", "A3", "A4", "A12", "A13"],
    "price_paise": 25000,
    "per_user_limit": 4
  }'

# Format B: Auto-numbered total seat count (S1 to S50)
curl -X POST "${BASE_URL}/shows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Paytm Live Concert 2026",
    "total_seats": 50,
    "price_paise": 250000,
    "per_user_limit": 4
  }'
```
**Response (`201 Created`):**
```json
{
  "id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "name": "friday-night",
  "total_seats": 6,
  "price_paise": 25000,
  "per_user_limit": 4,
  "status": "active",
  "seats": [
    { "seat_number": "A1", "status": "available" },
    { "seat_number": "A2", "status": "available" }
  ]
}
```

#### Get Show State & Reconciliation Summary
Retrieves show details, seat breakdown, and asserts `available + held + confirmed == total`.
```bash
SHOW_ID="e2ed5a28-bf4c-48d4-b833-b40330404db8"

curl -X GET "${BASE_URL}/shows/${SHOW_ID}"
```
**Response (`200 OK`):**
```json
{
  "show": {
    "id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
    "name": "Paytm Live Concert 2026",
    "total_seats": 50,
    "price_paise": 250000,
    "per_user_limit": 4
  },
  "summary": {
    "available": 48,
    "held": 0,
    "confirmed": 2,
    "total": 50
  },
  "seats": [
    { "seat_number": "S1", "status": "confirmed" },
    { "seat_number": "S2", "status": "confirmed" },
    { "seat_number": "S3", "status": "available" }
  ]
}
```

---

### 5.3 Direct Reservation & Idempotency

#### Reserve Seats (Direct 1-Step Idempotent Booking)
Buyer identity is strictly extracted from `Authorization: Bearer <user_id>`. Body spoofing of `user_id` is strictly rejected (`400`).
```bash
SHOW_ID="e2ed5a28-bf4c-48d4-b833-b40330404db8"

curl -X POST "${BASE_URL}/shows/${SHOW_ID}/reserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer usr_buyer_alice" \
  -H "Idempotency-Key: idemp_demo_req_001" \
  -d '{
    "seats": ["S1", "S2"]
  }'
```
**Response (`201 Created`):**
```json
{
  "reservation_id": "9a12c84e-5f92-411a-8e2b-7c10b14ef901",
  "show_id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "user_id": "usr_buyer_alice",
  "seats": ["S1", "S2"],
  "amount_paise": 500000,
  "status": "confirmed"
}
```

#### Idempotency Replay (Identical Key + Identical Payload)
Replaying the exact same request returns the cached `201` response without executing duplicate database mutations:
```bash
curl -X POST "${BASE_URL}/shows/${SHOW_ID}/reserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer usr_buyer_alice" \
  -H "Idempotency-Key: idemp_demo_req_001" \
  -d '{
    "seats": ["S1", "S2"]
  }'
```
**Response (`201 Created` - Cached Replay):**
```json
{
  "reservation_id": "9a12c84e-5f92-411a-8e2b-7c10b14ef901",
  "show_id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "user_id": "usr_buyer_alice",
  "seats": ["S1", "S2"],
  "amount_paise": 500000,
  "status": "confirmed"
}
```

#### Idempotency Conflict (Same Key + Different Payload)
Using the same idempotency key with different parameters is rejected with `409 Conflict`:
```bash
curl -X POST "${BASE_URL}/shows/${SHOW_ID}/reserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer usr_buyer_alice" \
  -H "Idempotency-Key: idemp_demo_req_001" \
  -d '{
    "seats": ["S3", "S4"]
  }'
```
**Response (`409 Conflict`):**
```json
{
  "error": "IDEMPOTENCY_PAYLOAD_MISMATCH",
  "message": "Idempotency key already exists with different request parameters"
}
```

#### Contention Conflict (Seat Already Booked)
Attempting to book a seat that is already booked by another user returns a clean `409 Conflict`:
```bash
curl -X POST "${BASE_URL}/shows/${SHOW_ID}/reserve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer usr_buyer_bob" \
  -H "Idempotency-Key: idemp_bob_001" \
  -d '{
    "seats": ["S1"]
  }'
```
**Response (`409 Conflict`):**
```json
{
  "error": "SEAT_UNAVAILABLE",
  "message": "One or more requested seats are already reserved or held"
}
```

---

### 5.4 Seat Hold & Payment Simulation

Allows temporary seat holding while a payment gateway transaction takes place.

#### 1. Hold Seats (Temporary Lock with Expiry)
```bash
SHOW_ID="e2ed5a28-bf4c-48d4-b833-b40330404db8"

curl -X POST "${BASE_URL}/shows/${SHOW_ID}/hold" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer usr_buyer_charlie" \
  -d '{
    "seats": ["S5", "S6"],
    "hold_duration_seconds": 30
  }'
```
**Response (`201 Created`):**
```json
{
  "reservation_id": "4fc7a812-70b9-4a01-9011-85e39d7890a1",
  "show_id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "user_id": "usr_buyer_charlie",
  "seats": ["S5", "S6"],
  "amount_paise": 500000,
  "status": "held",
  "hold_expires_at": "2026-10-03T06:40:00.000Z",
  "expires_in_seconds": 30
}
```

#### 2. Confirm Held Reservation (Payment Gateway Success)
Call this when payment succeeds to atomically transition the reservation and seats to `confirmed`.
```bash
RESERVATION_ID="4fc7a812-70b9-4a01-9011-85e39d7890a1"

curl -X POST "${BASE_URL}/reservations/${RESERVATION_ID}/confirm" \
  -H "Authorization: Bearer usr_buyer_charlie"
```
**Response (`200 OK`):**
```json
{
  "reservation_id": "4fc7a812-70b9-4a01-9011-85e39d7890a1",
  "show_id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "user_id": "usr_buyer_charlie",
  "seats": ["S5", "S6"],
  "amount_paise": 500000,
  "status": "confirmed"
}
```

*(Note: If payment fails or is abandoned, the seats stay in `held` state until the 30s timer expires, after which the background `HoldSweeper` automatically releases them back to `available`)*.

---

### 5.5 Cancellation & Release

Only the original purchaser (verified from the Bearer token) can cancel a reservation and release seats.

```bash
RESERVATION_ID="4fc7a812-70b9-4a01-9011-85e39d7890a1"

curl -X POST "${BASE_URL}/reservations/${RESERVATION_ID}/cancel" \
  -H "Authorization: Bearer usr_buyer_charlie"
```
**Response (`200 OK`):**
```json
{
  "reservation_id": "4fc7a812-70b9-4a01-9011-85e39d7890a1",
  "show_id": "e2ed5a28-bf4c-48d4-b833-b40330404db8",
  "user_id": "usr_buyer_charlie",
  "status": "cancelled",
  "released_seats": ["S5", "S6"]
}
```

Attempting to cancel someone else's reservation returns `403 Forbidden`:
```bash
curl -X POST "${BASE_URL}/reservations/${RESERVATION_ID}/cancel" \
  -H "Authorization: Bearer usr_impostor_dave"
# {"error": "FORBIDDEN", "message": "Only the reservation owner or administrator can cancel this reservation"}
```

---

### 5.6 Hold Sweeper Maintenance

Triggers the background worker to immediately reclaim expired held seats back to `available`.
```bash
curl -X POST "${BASE_URL}/admin/sweep"
```
**Response (`200 OK`):**
```json
{
  "success": true,
  "reclaimed_count": 2
}
```

---

## 6. Environment Variables Reference

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port the Express server listens on. |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`). |
| `DATABASE_URL` | `postgres://...` | Full PostgreSQL connection string URI. |
| `DB_POOL_MIN` | `5` | Minimum number of pooled database connections. |
| `DB_POOL_MAX` | `30` | Maximum number of pooled database connections. |
| `DB_LOCK_TIMEOUT_MS`| `2000` | Session `lock_timeout` in milliseconds to fail fast rather than hang on locks. |
| `LOG_LEVEL` | `info` | Structured Winston logging level (`debug`, `info`, `warn`, `error`). |
