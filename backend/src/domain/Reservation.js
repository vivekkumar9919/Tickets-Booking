import { Money } from './Money.js';

export const ReservationStatus = Object.freeze({
  PENDING: 'pending',
  HELD: 'held',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled'
});

/**
 * Domain Entity: Reservation
 */
export class Reservation {
  constructor({ id, showId, userId, amountPaise, seats = [], status = ReservationStatus.CONFIRMED, createdAt, updatedAt }) {
    if (!showId) throw new TypeError('showId is required');
    if (!userId) throw new TypeError('userId is required');

    this.id = id;
    this.showId = showId;
    this.userId = userId;
    this.amount = amountPaise instanceof Money ? amountPaise : new Money(amountPaise);
    this.seats = Array.isArray(seats) ? seats : [];
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  isConfirmed() {
    return this.status === ReservationStatus.CONFIRMED;
  }

  isHeld() {
    return this.status === ReservationStatus.HELD;
  }

  isCancelled() {
    return this.status === ReservationStatus.CANCELLED;
  }

  cancel() {
    if (this.status === ReservationStatus.CANCELLED) {
      throw new Error(`Reservation ${this.id} is already cancelled`);
    }
    this.status = ReservationStatus.CANCELLED;
  }

  isOwnedBy(userId) {
    return this.userId === userId;
  }

  toJSON() {
    return {
      reservation_id: this.id,
      show_id: this.showId,
      user_id: this.userId,
      seats: this.seats,
      amount_paise: this.amount.paise,
      status: this.status,
      created_at: this.createdAt
    };
  }
}
