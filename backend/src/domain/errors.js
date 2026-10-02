/**
 * Domain Exception Classes
 * Mapped to clean HTTP status codes at the API boundary (Zero 5xx errors).
 */

export class DomainError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SeatUnavailableError extends DomainError {
  constructor(unavailableSeats = []) {
    super('One or more requested seats are already reserved or held', 'SEAT_UNAVAILABLE', 409);
    this.unavailableSeats = unavailableSeats;
  }
}

export class UserLimitExceededError extends DomainError {
  constructor(currentBooked, requested, limit) {
    super(
      `Reservation would exceed the allowed limit of ${limit} seats per user for this show`,
      'USER_LIMIT_EXCEEDED',
      409
    );
    this.currentBooked = currentBooked;
    this.requested = requested;
    this.limit = limit;
  }
}

export class IdempotencyMismatchError extends DomainError {
  constructor() {
    super('Idempotency key was previously used with a different request payload', 'IDEMPOTENCY_MISMATCH', 409);
  }
}

export class ConcurrentRequestError extends DomainError {
  constructor() {
    super('A concurrent request with the same idempotency key is currently in progress', 'CONCURRENT_REQUEST', 409);
  }
}

export class ShowNotFoundError extends DomainError {
  constructor(showId) {
    super(`Show with id ${showId} was not found`, 'SHOW_NOT_FOUND', 404);
  }
}

export class ReservationNotFoundError extends DomainError {
  constructor(reservationId) {
    super(`Reservation with id ${reservationId} was not found`, 'RESERVATION_NOT_FOUND', 404);
  }
}

export class UnauthorizedCancellationError extends DomainError {
  constructor() {
    super('Only the reservation owner or administrator can cancel this reservation', 'FORBIDDEN', 403);
  }
}

export class ConflictError extends DomainError {
  constructor(message) {
    super(message, 'CONFLICT', 409);
  }
}
