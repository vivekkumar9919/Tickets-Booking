/**
 * Value Object: Money
 * Guarantees strict integer minor units (paise). Floating point math is strictly forbidden.
 */
export class Money {
  constructor(paise) {
    if (!Number.isInteger(paise) || paise < 0) {
      throw new TypeError(`Money amount must be a non-negative integer representing paise, received: ${paise}`);
    }
    this._paise = paise;
    Object.freeze(this);
  }

  static fromPaise(paise) {
    return new Money(paise);
  }

  get paise() {
    return this._paise;
  }

  add(other) {
    if (!(other instanceof Money)) {
      throw new TypeError('Can only add Money to Money');
    }
    return new Money(this._paise + other.paise);
  }

  multiply(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(`Multiplication factor must be a non-negative integer, received: ${count}`);
    }
    return new Money(this._paise * count);
  }

  equals(other) {
    return other instanceof Money && this._paise === other.paise;
  }

  toJSON() {
    return this._paise;
  }

  toString() {
    return `${this._paise} paise`;
  }
}
