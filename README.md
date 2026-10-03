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

## 2. Live Deployments & URLs

| Environment | Base URL | Health Probe (`/readyz`) | Observability (`/metrics`) |
| :--- | :--- | :--- | :--- |
| **Render (Public Cloud)** | `https://ticket-reservation-backend-bc2y.onrender.com` | [`/readyz`](https://ticket-reservation-backend-bc2y.onrender.com/readyz) | [`/metrics`](https://ticket-reservation-backend-bc2y.onrender.com/metrics) |
| **Local Docker** | `http://localhost:4000` | `http://localhost:4000/readyz` | `http://localhost:4000/metrics` |

---

## 3. Architecture & Repository Layout

```
ticketBooking/
├── burst.sh                               # One-command high-concurrency burst runner
├── docker-compose.yml                     # Multi-service container orchestration
├── render.yaml                            # Cloud deployment blueprint (Render)
├── railway.json                           # Cloud deployment configuration (Railway)
├── SETUP.md                               # [SSOT] Complete setup, deployment & cURL API guide
├── WRITEUP.md                             # [SSOT] Technical write-up for 6 mandatory questions
└── backend/
    ├── Dockerfile                         # Multi-stage production build (non-root)
    ├── migrations/                        # PostgreSQL DDL migrations
    │   └── 001_initial_schema.sql
    ├── src/
    │   ├── domain/                        # Pure OOP Entities & Value Objects (Money, Seat, Show)
    │   ├── repositories/                  # Repository Pattern (ShowRepo, SeatRepo, ReservationRepo)
    │   ├── infrastructure/                # UnitOfWork, DB Pool, Logger, MetricsCollector
    │   ├── services/                      # Application Business Logic (ReservationService, HoldSweeper)
    │   ├── api/                           # Middlewares, Controllers, Routes
    │   └── server.js                      # Application entry point with boot migrations & sweeper
    └── tests/                             # Automated test suites across all phases
```

---

## 4. Documentation Index (Single Source of Truth)

To maintain clarity and eliminate documentation duplication, comprehensive guides are maintained in dedicated reference documents:

* 📖 **[SETUP.md](./SETUP.md) — Complete Setup, Deployment & API Reference:**
  - Docker Compose & local native Node.js setup
  - Cloud deployment step-by-step (Render & Railway)
  - Automated test suite execution (`npm test`)
  - Running the high-concurrency burst load runner (`./burst.sh`)
  - Full cURL commands with request/response payloads for every API endpoint
  - Environment variables reference

* 📝 **[WRITEUP.md](./WRITEUP.md) — Technical Architecture Deep-Dive:**
  - Exact SQL row-level locking clause and race-free verification
  - Mathematical total-ordering deadlock elimination proof
  - Cryptographic idempotency engine & crash recovery semantics
  - CAP theorem trade-offs: Consistency ($C$) vs. Availability ($A$)
  - Production observability, metrics dashboard, and 2 AM PagerDuty alerting rules
  - Transparent AI tool usage disclosure (directed vs. decided)
