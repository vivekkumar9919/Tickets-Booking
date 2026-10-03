/**
 * Domain Entity: Seat
 * Encapsulates seat lifecycle state machine and invariants.
 */
export const SeatStatus = Object.freeze({
  AVAILABLE: 'available',
  HELD: 'held',
  CONFIRMED: 'confirmed'
});

export class Seat {
  constructor({ id, showId, seatNumber, status = SeatStatus.AVAILABLE, currentReservationId = null, lockedUntil = null }) {
    if (!seatNumber || typeof seatNumber !== 'string') {
      throw new TypeError(`Valid seatNumber string required, received: ${seatNumber}`);
    }
    this.id = id;
    this.showId = showId;
    this.seatNumber = seatNumber.trim().toUpperCase();
    this.status = status;
    this.currentReservationId = currentReservationId;
    this.lockedUntil = lockedUntil;
  }

  isAvailable() {
    if (this.status === SeatStatus.AVAILABLE) return true;
    if (this.status === SeatStatus.HELD && this.lockedUntil && new Date(this.lockedUntil) <= new Date()) {
      return true;
    }
    return false;
  }

  isHeld() {
    return this.status === SeatStatus.HELD;
  }

  isConfirmed() {
    return this.status === SeatStatus.CONFIRMED;
  }

  confirm(reservationId) {
    if (this.status === SeatStatus.CONFIRMED && this.currentReservationId !== reservationId) {
      throw new Error(`Seat ${this.seatNumber} is already confirmed for another reservation`);
    }
    this.status = SeatStatus.CONFIRMED;
    this.currentReservationId = reservationId;
    this.lockedUntil = null;
  }

  hold(reservationId, lockedUntil) {
    if (this.status !== SeatStatus.AVAILABLE) {
      throw new Error(`Cannot hold seat ${this.seatNumber} in state ${this.status}`);
    }
    this.status = SeatStatus.HELD;
    this.currentReservationId = reservationId;
    this.lockedUntil = lockedUntil;
  }

  release() {
    this.status = SeatStatus.AVAILABLE;
    this.currentReservationId = null;
    this.lockedUntil = null;
  }

  toJSON() {
    return {
      id: this.id,
      show_id: this.showId,
      seat_number: this.seatNumber,
      status: this.status,
      current_reservation_id: this.currentReservationId
    };
  }
}
