# Paytm Money: High-Concurrency Seat Reservation Service

[![Tests](https://img.shields.io/badge/tests-29%20passed-brightgreen.svg)]()
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)]()
[![PostgreSQL](https://img.shields.io/badge/postgresql-15--alpine-blue.svg)]()
[![Zero%20Double--Sell](https://img.shields.io/badge/invariant-zero--double--sell-success.svg)]()

Production-grade, high-concurrency Seat Reservation Service built for the Paytm Money Take-Home assignment ("Deploy & Observe" round). Engineered to handle high-demand ticket sales (such as concert and IPL flash sales) with **mathematically zero double-sell**, strict reconciliation integrity, deterministic deadlock avoidance, and sub-millisecond idempotency.

---

## 1. System Invariants & Guarantees

1. **Zero Double-Sell:**  
   Under a 500-request storm competing for the exact same seat, **exactly 1 request wins (`201 Created`)**, while the other 499 receive clean domain declines (`409 Conflict`). **Zero 500 Internal Server Errors**.
2. **Strict Reconciliation Invariant:**  
   At all times:
   $$\text{available} + \text{held} + \text{confirmed} \equiv \text{total\_seats}$$
3. **Deterministic Deadlock Elimination:**  
   Multi-seat lock requests are naturally sorted (`ORDER BY seat_number ASC`) prior to lock acquisition, eliminating Coffman cyclic-wait deadlocks.
4. **Per-User Quota Serialization:**  
   Per-user booking limits (default: 4 seats) are serialized using PostgreSQL transaction-scoped advisory locks, preventing parallel request bypass.
5. **Strict Integer Paise (Zero Floating Point):**  
   Money is encapsulated in the `Money` Value Object. Floating-point arithmetic is banned across domain and persistence layers.
6. **Token-Derived Identity Only:**  
   User identity is extracted strictly from the Bearer authentication token. Attempts to spoof `user_id` in the request body are blocked with `400 Bad Request`.
7. **Strict Cryptographic Idempotency:**  
   Same `Idempotency-Key` + same payload $\to$ Cached response (`201`/`200`).  
   Same `Idempotency-Key` + different payload $\to$ Rejected with `409 Conflict`.
8. **Structured Zero-PII Observability:**  
   Winston structured JSON logging with correlation IDs and native Prometheus metrics (`/metrics`). Customer PII is strictly prohibited in logs.

---

## 2. Architecture & Design Patterns

```
ticketBooking/
├── burst.sh                               # One-command high-concurrency burst runner
├── docker-compose.yml                     # Multi-service container orchestration
├── render.yaml                            # Cloud deployment blueprint (Render)
├── railway.json                           # Cloud deployment configuration (Railway)
├── SETUP.md                               # Complete step-by-step setup and cURL API guide
├── WRITEUP.md                             # Technical write-up for the 6 mandatory questions
└── backend/
    ├── Dockerfile                         # Multi-stage production build (non-root)
    ├── migrations/                        # PostgreSQL DDL migrations
    │   └── 001_initial_schema.sql
    ├── src/
    │   ├── domain/                        # Pure OOP Entities & Value Objects (Money, Seat, Show, etc.)
    │   ├── repositories/                  # Repository Pattern (ShowRepo, SeatRepo, ReservationRepo)
    │   ├── infrastructure/                # UnitOfWork, DB Pool, Logger, MetricsCollector
    │   ├── services/                      # Application Business Logic (ReservationService, HoldSweeper)
    │   ├── api/                           # Middlewares, Controllers, Routes
    │   └── server.js                      # Application entry point with boot migrations & sweeper
    └── tests/                             # Automated test suites across all phases
```

---

## 3. Deployments & Live Service URLs

| Environment | Base URL | Health Probe (`/readyz`) | Metrics (`/metrics`) |
| :--- | :--- | :--- | :--- |
| **Render (Public Cloud)** | `https://ticket-reservation-backend-bc2y.onrender.com` | [`/readyz`](https://ticket-reservation-backend-bc2y.onrender.com/readyz) | [`/metrics`](https://ticket-reservation-backend-bc2y.onrender.com/metrics) |
| **Local Docker** | `http://localhost:4000` | `http://localhost:4000/readyz` | `http://localhost:4000/metrics` |

### 3.1 Start Local Docker Services

Clone the repository and run:

```bash
docker compose up -d --build
```

This launches the containerized services:
- **`ticket_postgres`**: PostgreSQL 15 on port `5432` with healthcheck (`pg_isready`).
- **`ticket_backend`**: Node.js Express service on host port `4000` (container port `3000`).

### 3.2 Verify Service Health

```bash
# Against Live Cloud (Render):
curl -s https://ticket-reservation-backend-bc2y.onrender.com/readyz
# {"status":"ready","database":"connected","latency_ms":1,"timestamp":"..."}

# Against Local Docker:
curl -s http://localhost:4000/readyz
# {"status":"ready","database":"connected","latency_ms":1,"timestamp":"..."}
```

---

## 4. Running the Concurrency Burst Runner (`burst.sh`)

**Execution Path:** Run from the project root directory (`ticketBooking/` or `Tickets-Booking/`):

```bash
cd /path/to/ticketBooking
chmod +x burst.sh

# Option A: Run against Live Render Cloud (Public Production Deployment)
./burst.sh https://ticket-reservation-backend-bc2y.onrender.com

# Option B: Run against Local Docker Deployment
./burst.sh http://localhost:4000

# Custom storm count (e.g. 500, 1000 contenders):
./burst.sh https://ticket-reservation-backend-bc2y.onrender.com 500
./burst.sh http://localhost:4000 500
```

### What `burst.sh` Executes:
1. **Health Verification:** Confirms `/livez` and `/readyz` report healthy.
2. **Show Creation:** Creates a show with 50 seats and limit = 4 seats/user.
3. **Hot-Seat Storm:** Fires **500 concurrent requests competing for the exact same seat (`S12`)**. Asserts exactly 1 winner, 499 clean `409` declines, and zero `500` errors.
4. **Quota Boundary Test:** Fires **10 parallel requests by 1 user (limit = 4)**. Asserts exactly 4 succeed and 6 receive clean `409` limit declines.
5. **Idempotency Replay Test:** Fires **50 parallel identical requests** with the same key. Asserts all receive `201` with identical booking IDs.
6. **Reconciliation Audit:** Verifies the formula $\text{available} + \text{held} + \text{confirmed} \equiv \text{total\_seats}$.

---

## 5. Running the Automated Test Suites

The backend includes 29 automated test cases covering migrations, domain models, repositories, concurrency services, deadlocks, and API endpoints:

```bash
cd backend
npm test
```

### Test Suite Breakdown:
- **Phase 1:** PostgreSQL connectivity, initial schema, table existence, and UnitOfWork rollback cleanliness.
- **Phase 2:** `Money` float rejection, domain state machines, and repository CRUD within transactional boundaries.
- **Phase 3:** Concurrency engine, hot-seat storm (20 contenders), reverse-order deadlock avoidance, cancellation ownership, and background hold sweeper.
- **Phase 4:** REST endpoints, Bearer authentication, body spoofing prevention (`400`), idempotency replay caching, and Prometheus metric emission.

---

## 6. API Reference

### Probes & Observability
- `GET /livez`: Fast non-blocking process liveness probe (`200 OK`).
- `GET /readyz`: Deep PostgreSQL dependency ping (`SELECT 1`). Fails closed (`503`) if database is down.
- `GET /metrics`: Native Prometheus scrapable format exposing seat status gauges and reservation counters.

### Core Inventory & Reservation Endpoints
- `POST /shows`: Create show with atomic seat inventory.
  ```json
  {
    "name": "Coldplay Ahmedabad 2026",
    "total_seats": 50,
    "price_paise": 500000,
    "per_user_limit": 4
  }
  ```
- `GET /shows/:id`: Retrieve show details and real-time seat breakdown with reconciliation verification.
- `POST /shows/:id/reserve`: Reserve seats with deterministic locking and idempotency.
  - **Headers:** `Authorization: Bearer <user_id>`, `Idempotency-Key: <unique_key>`
  - **Body:** `{"seats": ["S1", "S2"]}`
- `POST /reservations/:id/cancel`: Cancel an active reservation and release seats back to `available`.
  - **Headers:** `Authorization: Bearer <user_id>` (enforces owner-only cancellation).

---

## 7. Technical Write-Up

For deep architectural explanations addressing the 6 mandatory questions:
- Exact SQL row-level locking clause and why it is race-free
- Mathematical deadlock avoidance via total ordering
- Idempotency lifecycle and crash recovery
- Consistency vs. Availability trade-offs (CP vs AP)
- Production observability and 2 AM PagerDuty alerting rules
- Honest AI usage disclosure (directed vs decided)

👉 Please see **[`WRITEUP.md`](./WRITEUP.md)**.
