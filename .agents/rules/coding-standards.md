# Engineering & Coding Pattern Rules

## 1. Architectural Patterns & Clean OOP
1. **Repository Pattern:**
   - All persistence logic must live inside repository classes (`src/repositories/`).
   - Business services must NEVER execute raw SQL queries directly.
   - Every repository method must accept an optional `client` parameter to participate in `UnitOfWork` transactions.
2. **Unit of Work Pattern (`UnitOfWork.js`):**
   - Multi-table mutations must be orchestrated through `UnitOfWork` to guarantee atomic transactional boundaries (`BEGIN`, `COMMIT`, `ROLLBACK`).
   - Transactions must explicitly set `SET LOCAL lock_timeout = '2000ms';`.
3. **Value Object Pattern (`Money.js`):**
   - Currency must strictly be encapsulated in the `Money` Value Object.
   - Money is stored and manipulated strictly as integer minor units (`paise`).
   - Floating-point representations and negative values are strictly prohibited at instantiation.
4. **Finite State Machine & State Pattern:**
   - Entity state transitions (e.g. `Seat.status`, `Reservation.status`) must be guarded by entity domain methods (`confirm()`, `cancel()`, `release()`).
   - Disallow direct mutation of state properties from outside the entity.

---

## 2. Security & Zero Customer PII in Logs
1. **Strict PII Prohibition:**
   - Never log customer Personally Identifiable Information (PII): no passwords, authentication tokens, secret keys, email addresses, phone numbers, or credit card / financial details.
2. **Allowed Log Metadata:**
   - Only operational, non-sensitive identifiers are permitted in logs: `correlation_id`, `show_id`, `seat_numbers`, `user_id` (system UUID/identifier), HTTP status codes, latency `duration_ms`, and domain error codes.
3. **Header Sanitization:**
   - Always sanitize and redact sensitive headers (e.g., mask `Authorization` and `Cookie`) before passing request context to loggers.

---

## 3. Function Size, Modularity & KISS Principles
1. **Function Size Limit:**
   - Functions must not exceed **40–50 lines of executable logic**.
   - Adhere strictly to the Single Responsibility Principle (SRP).
2. **Decomposition into Private Helpers:**
   - Break complex orchestration flows into descriptive helper functions (e.g., `_validateSeatAvailability()`, `_computePayloadHash()`, `_acquireDeterministicLocks()`).
3. **Readability Over Cleverness:**
   - Write simple, clean, and explicit JavaScript (ES Modules).
   - Avoid deep nesting, cryptic one-liners, or unnecessary abstractions.

---

## 4. Database Error Handling & `try...catch` Hygiene
1. **Mandatory `try...catch...finally`:**
   - Every database query, transaction, and asynchronous operation must be wrapped in explicit `try...catch...finally` blocks.
2. **Structured Error Logging via Winston:**
   - When a database error occurs, log internal error details (PostgreSQL error code `err.code`, `err.message`, query parameters without PII) via Winston at `error` level with the request's `correlation_id`.
3. **Zero Raw SQL Error Leaks:**
   - Never return raw database stack traces or SQL error messages to the HTTP client.
   - Standardize error mapping:
     - PostgreSQL code `55P03` (`lock_not_available` / timeout) $\rightarrow$ Clean `409 Conflict` (`SEAT_LOCK_TIMEOUT`).
     - PostgreSQL code `23505` (`unique_violation`) $\rightarrow$ Clean `409 Conflict` (`SEAT_ALREADY_RESERVED` or `IDEMPOTENCY_KEY_EXISTS`).
     - PostgreSQL code `40001` (`serialization_failure`) $\rightarrow$ Clean `409 Conflict` (`CONCURRENCY_CONFLICT`).
4. **Guaranteed Resource Cleanup:**
   - Always release the database connection back to the pool in the `finally` block or let the `UnitOfWork` teardown lifecycle handle it safely.

---

## 5. API Boundary Validation & Token Identity
1. **Request Schema Validation:**
   - Validate all parameters (types, array lengths, string formats, UUIDs) at the controller layer before passing them to the domain/service layer.
2. **Identity Exclusively from Auth Token:**
   - `user_id` must be extracted strictly from verified token claims.
   - Any request body attempting to provide or spoof `user_id` must be explicitly rejected or stripped.
