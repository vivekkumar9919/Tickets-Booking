/**
 * Domain & Application Constants (Single Source of Constants)
 * Centralizes all status enums, default limits, and system thresholds.
 */

// Booking & Inventory Rules
export const DEFAULT_PER_USER_LIMIT = 4;
export const DEFAULT_HOLD_DURATION_SECONDS = 600; // 10 minutes
export const DEFAULT_SHOW_SEAT_COUNT = 50;

// Seat Status FSM (Finite State Machine)
export const SEAT_STATUS = Object.freeze({
  AVAILABLE: 'available',
  HELD: 'held',
  CONFIRMED: 'confirmed',
});

// Reservation Status FSM
export const RESERVATION_STATUS = Object.freeze({
  HELD: 'held',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
});

// Idempotency Record States
export const IDEMPOTENCY_STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
});

// Show Status
export const SHOW_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
});

// Database Timeouts (Milliseconds)
export const DB_TIMEOUTS = Object.freeze({
  LOCK_TIMEOUT_MS: 2000,
  CONNECTION_TIMEOUT_MS: 10000,
  IDLE_TIMEOUT_MS: 30000,
});
