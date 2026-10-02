import { Money } from './Money.js';

/**
 * Domain Aggregate Root: Show
 * Manages event inventory, seat limits, pricing, and quota rules.
 */
export class Show {
  constructor({ id, name, totalSeats, pricePaise, perUserLimit = 4, status = 'active', createdAt, updatedAt }) {
    if (!name || typeof name !== 'string') {
      throw new TypeError(`Show name must be a non-empty string, received: ${name}`);
    }
    if (!Number.isInteger(totalSeats) || totalSeats <= 0) {
      throw new TypeError(`Total seats must be a positive integer, received: ${totalSeats}`);
    }
    if (!Number.isInteger(perUserLimit) || perUserLimit <= 0) {
      throw new TypeError(`Per user limit must be a positive integer, received: ${perUserLimit}`);
    }

    this.id = id;
    this.name = name.trim();
    this.totalSeats = totalSeats;
    this.price = pricePaise instanceof Money ? pricePaise : new Money(pricePaise);
    this.perUserLimit = perUserLimit;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  calculateTotalAmount(seatCount) {
    if (!Number.isInteger(seatCount) || seatCount <= 0) {
      throw new TypeError(`Seat count must be a positive integer, received: ${seatCount}`);
    }
    return this.price.multiply(seatCount);
  }

  canUserBook(currentBookedCount, requestedSeatCount) {
    return (currentBookedCount + requestedSeatCount) <= this.perUserLimit;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      total_seats: this.totalSeats,
      price_paise: this.price.paise,
      per_user_limit: this.perUserLimit,
      status: this.status,
      created_at: this.createdAt
    };
  }
}
