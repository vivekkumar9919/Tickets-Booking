# Agent Guidelines: Ticket Booking at Scale 



---

## 1. Non-Negotiable Invariants & Rules

1. **Zero Double-Sell:**
   - Under no circumstances can a single seat be sold or held for two distinct users.
   - If 500 requests storm the exact same seat, exactly 1 request wins (`201 Created`), while the other 499 receive clean domain declines (`409 Conflict`). Never return a `500 Internal Server Error`.

2. **Reconciliation Invariant:**
   - At all times:
     $$\text{available} + \text{held} + \text{confirmed} \equiv \text{total\_seats}$$
   - Any state change is a strict finite-state machine (FSM) transition.

3. **Deterministic Deadlock Prevention:**
   - When locking multiple seats, the requested seat IDs must ALWAYS be sorted naturally (`ORDER BY seat_number ASC` or JavaScript array `.sort()`) before acquiring database locks.
   - This eliminates cyclic-wait deadlocks between concurrent requests.

4. **Time-Boxed Hold Expiry & Cancellation:**
   - Holds expire after `HOLD_DURATION_SECONDS` (default: 600s / 10 minutes).
   - Expired holds are lazily reclaimed during reservation attempts and reconciled via a background sweeper worker.
   - Confirmed seats are permanent unless explicitly cancelled by the owner.

5. **Strict Integer Paise (Zero Floating Point):**
   - Money must strictly be handled as integer minor units (`paise`).
   - Floats are banned at the domain layer via the `Money` Value Object.

6. **Identity from Token Only:**
   - `user_id` is extracted strictly from the Bearer authentication token.
   - Body fields attempting to provide or spoof `user_id` are strictly forbidden.

7. **Strict Idempotency:**
   - Same `idempotency_key` + same payload $\rightarrow$ Return identical cached response (`201`/`200`).
   - Same `idempotency_key` + different payload $\rightarrow$ Reject with `409 Conflict`.

8. **Winston Structured Logging:**
   - Every log message must be a structured JSON object containing `timestamp`, `level`, `correlation_id`, `method`, `path`, and contextual domain metadata.

9. **Phase-Gated Development:**
   - Do NOT jump ahead to future phases. Only develop the phase explicitly instructed by the user.
   - Follow OOP class design and design patterns with explicit rationale.

---

## 2. Directory & Architectural Conventions

```
ticketBooking/
├── .agents/
│   ├── AGENTS.md                          # Global agent instructions (this file)
│   └── skills/
│       ├── concurrency-correctness/       # Row locking, deadlock avoidance, hold expiry
│       ├── idempotency-engine/            # Cryptographic request hashing, replay cache
│       ├── observability-and-burst/       # Prometheus metrics, Winston logs, burst.sh
│       └── oop-clean-architecture/        # Domain entities, Value Objects, Repositories, UoW
├── backend/
│   ├── migrations/                        # PostgreSQL DDL
│   └── src/
│       ├── domain/                        # Pure OOP Entities & Value Objects
│       ├── repositories/                  # Repository Pattern
│       ├── infrastructure/                # UnitOfWork, DB Pool, Logger, Metrics
│       ├── services/                      # Application Business Logic
│       └── api/                           # Controllers, Middlewares, Routes
├── doc/
│   ├── PRD.md                             # Product Requirement Document
│   └── TRD.md                             # Technical Requirement Document
├── docker-compose.yml                     # PostgreSQL & App orchestration
└── .gitignore
```

---

## 3. Mandatory Code Quality, Security & Engineering Rules

### 3.1 Zero PII / Customer Data in Logs (Data Privacy)
- **STRICT PROHIBITION:** Never log customer Personally Identifiable Information (PII) — no passwords, authentication tokens, secret keys, email addresses, phone numbers, or credit card/financial details.
- **Allowed in Logs:** Only non-sensitive operational identifiers: `correlation_id`, `show_id`, `seat_numbers`, `user_id` (system identifier), HTTP status codes, latency `duration_ms`, and domain error codes.
- Sanitize and redact headers (e.g., mask `Authorization` header) before passing request contexts to Winston loggers.

### 3.2 Function Size & Modularity (KISS & Clean Code)
- **Small, Focused Functions:** Functions must not exceed 40–50 lines of executable logic. Follow the Single Responsibility Principle (SRP).
- **Decomposition:** Break complex orchestration into descriptive, private/helper methods with clear intent (e.g., `_validateSeatAvailability()`, `_computePayloadHash()`, `_acquireDeterministicLocks()`).
- **Simplicity Over Cleverness:** Prefer straightforward, readable JavaScript (ES Modules) over deeply nested callbacks, cryptic one-liners, or over-engineered abstractions.

### 3.3 Database Error Handling & `try...catch` Hygiene
- **Mandatory `try...catch`:** Every database query, transaction, and asynchronous operation must be wrapped in explicit `try...catch...finally` blocks.
- **Structured Error Logging:** When a database error occurs:
  - Log the internal error details (PostgreSQL error code `err.code`, `err.message`, query parameters without PII) via Winston at `error` level with the request's `correlation_id`.
- **Domain Mapping (Zero Raw SQL Leaks):**
  - Never return raw database stack traces or SQL error messages to the HTTP client.
  - Map PostgreSQL error codes to domain exceptions:
    - Code `55P03` (`lock_not_available` / timeout) $\rightarrow$ Clean `409 Conflict` (`SEAT_LOCK_TIMEOUT`).
    - Code `23505` (`unique_violation`) $\rightarrow$ Clean `409 Conflict` (`SEAT_ALREADY_RESERVED` or `IDEMPOTENCY_KEY_EXISTS`).
    - Code `40001` (`serialization_failure`) $\rightarrow$ Clean `409 Conflict` (`CONCURRENCY_CONFLICT`).
- **Resource Cleanup in `finally`:** Always ensure the database client is released back to the pool in the `finally` block or handled cleanly by the `UnitOfWork` lifecycle.

### 3.4 Strict Object-Oriented Design & Patterns
- **Repository Pattern:** Persistence logic must strictly live inside repository classes. Services never write raw SQL queries.
- **Unit of Work Pattern:** Multi-table mutations must be orchestrated through `UnitOfWork` to ensure atomic transactions (`BEGIN`, `COMMIT`, `ROLLBACK`).
- **Value Objects:** Always wrap domain primitives that have business rules (e.g., `Money` for integer paise).
- **State Machine Integrity:** Entity state transitions must be guarded by domain entity methods (`confirm()`, `cancel()`, `release()`), not by arbitrary external property assignments.

### 3.5 API Boundary Validation
- Validate all incoming parameters (data types, array lengths, string formats) at the controller layer before hitting domain services.
- Explicitly reject or strip unexpected body fields, especially any attempts to pass `user_id` in the body.

