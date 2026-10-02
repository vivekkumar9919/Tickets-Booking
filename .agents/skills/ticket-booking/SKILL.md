---
name: ticket-booking
description: Complete engineering playbook, concurrency patterns, SQL locking algorithms, idempotency mechanics, hold expiry, and observability standards for the Paytm seat reservation service.
---

# High-Scale Seat Reservation Engineering Playbook

This skill provides the domain algorithms, SQL locking clauses, and technical implementation playbooks for the ticket booking engine.

---

## 1. Concurrency Control & Database Locking Engine

### 1.1 Single-Seat Contention Protocol
- **Anti-Pattern (Read-Then-Write):** Never do `SELECT status FROM seats WHERE ...` followed by application-level checks and `UPDATE`. Under concurrent requests, this creates double-sell race conditions.
- **Atomic Database-Level Row Locking:**
  ```sql
  SELECT id, seat_number, status, hold_expires_at 
  FROM seats 
  WHERE show_id = $1 AND seat_number = ANY($2)
  ORDER BY seat_number ASC
  FOR UPDATE;
  ```
- **Seat Eligibility Evaluation:**
  - A seat is eligible if `status = 'available'` OR `(status = 'held' AND hold_expires_at < NOW())`.
  - If any requested seat is ineligible, immediately rollback and raise `SeatUnavailableError` (HTTP 409).
- **Lock Timeout:**
  - Execute `SET LOCAL lock_timeout = '2000ms';` inside the transaction.
  - If lock contention exceeds 2 seconds, catch PostgreSQL error code `55P03` and return clean `409 Conflict`. Zero 5xx errors.

### 1.2 Deterministic Deadlock Elimination
- When multiple seats are requested (e.g. `["B2", "A1", "C4"]`):
  ```javascript
  const sortedSeats = [...requestedSeats].sort();
  ```
- Lexicographical sorting guarantees all concurrent transactions request row locks in the exact same order, mathematically eliminating cyclic-wait deadlocks.

### 1.3 Per-User Quota Serialization
- To prevent a user from evading the booking limit (e.g., 4 seats) by firing parallel concurrent requests:
  - Serialize quota verification per user and show inside the locked transaction:
    ```sql
    SELECT COUNT(*) FROM reservation_seats rs
    JOIN reservations r ON r.id = rs.reservation_id
    WHERE r.show_id = $1 AND r.user_id = $2 AND r.status IN ('confirmed', 'held');
    ```
  - If `activeCount + requestedSeats.length > perUserLimit`, rollback and return `409 Conflict` (`USER_LIMIT_EXCEEDED`).

---

## 2. Idempotency Engine & Request Hashing

### 2.1 Canonical Payload Hashing
- Sort seat arrays before hashing so ordering differences produce identical hashes:
  ```javascript
  import crypto from 'node:crypto';

  export function computePayloadHash(showId, seats) {
    const sorted = [...seats].sort();
    const canonical = JSON.stringify({ showId, seats: sorted });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
  ```

### 2.2 Storage & Replay Evaluation
- Inside the transaction, query `idempotency_records WHERE idempotency_key = $1 FOR UPDATE`.
- **If key exists:**
  - If `request_hash === currentHash` and `status === 'COMPLETED'` $\rightarrow$ Return cached response immediately (`201` or `200`).
  - If `request_hash !== currentHash` $\rightarrow$ Rollback & return `409 Conflict` (`IDEMPOTENCY_MISMATCH`).
  - If `status === 'IN_PROGRESS'` $\rightarrow$ Return `409 Conflict` (`CONCURRENT_REQUEST_IN_PROGRESS`).
- **If key does not exist:**
  - Insert record with `status = 'IN_PROGRESS'`.
  - Process reservation.
  - Update record to `status = 'COMPLETED'` with response payload before committing.

---

## 3. Time-Boxed Hold Expiry & Cancellation

### 3.1 Hybrid Expiry Architecture
- **Lazy Atomic Reclaim:** Any reservation query dynamically reclaims expired holds on-the-spot:
  ```sql
  WHERE show_id = $1 
    AND seat_number = ANY($2)
    AND (status = 'available' OR (status = 'held' AND hold_expires_at < NOW()))
  FOR UPDATE;
  ```
  Real users are never blocked by cron delays.
- **Background Sweeper Worker:** Runs periodically (every 15–30 seconds) to clean abandoned holds in bulk for inventory reporting accuracy:
  ```sql
  UPDATE seats 
  SET status = 'available', current_reservation_id = NULL, hold_expires_at = NULL
  WHERE status = 'held' AND hold_expires_at < NOW();
  ```
- **Permanent Confirmation:** Confirmed seats never expire and can only be released via explicit user cancellation.
- **Explicit Cancellation (`POST /reservations/:id/cancel`):** Verifies token user matches reservation owner, sets reservation status to `cancelled`, and frees seats back to `available`.

---

## 4. Observability, Metrics & Health Probes

### 4.1 Prometheus Metrics (`/metrics`)
- `ticket_reservations_confirmed_total` (Counter, label: `show_id`)
- `ticket_reservations_declined_total` (Counter, labels: `show_id`, `reason`)
- `ticket_idempotent_replays_total` (Counter, label: `show_id`)
- `ticket_seats_status` (Gauge, labels: `show_id`, `status: available|held|confirmed`)
- `ticket_http_requests_total` & `ticket_http_request_duration_seconds` (Counter & Histogram)

### 4.2 Health & Readiness Probes
- `GET /livez`: Fast non-blocking check (`200 OK`).
- `GET /readyz`: Active PostgreSQL ping (`SELECT 1` with 500ms timeout). Fails closed (`503 Service Unavailable`) if the database is down or connection pool is exhausted.

---

## 5. One-Command Burst Runner (`burst.sh`)
- Automated script executing against local or public URL (`./burst.sh <BASE_URL>`).
- Test scenarios:
  1. Create show with 50 seats.
  2. Hot-seat storm: 500 parallel users storming seat `A12`.
  3. User limit test: 1 user firing 10 parallel requests (limit = 4).
  4. Idempotency test: 50 parallel identical requests.
- Output: Distribution table of `201` confirmations, `409` declines, and `0` 5xx errors, followed by reconciliation verification:
  $$\text{available} + \text{held} + \text{confirmed} == \text{total\_seats}$$
