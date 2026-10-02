import crypto from 'crypto';
import dbPoolInstance from '../infrastructure/database/DatabasePool.js';
import { UnitOfWork } from '../infrastructure/database/UnitOfWork.js';
import { ShowRepository } from '../repositories/ShowRepository.js';
import { SeatRepository } from '../repositories/SeatRepository.js';
import { ReservationRepository } from '../repositories/ReservationRepository.js';
import { IdempotencyRepository } from '../repositories/IdempotencyRepository.js';
import { Reservation } from '../domain/Reservation.js';
import { IdempotencyRecord } from '../domain/IdempotencyRecord.js';
import {
  SeatUnavailableError,
  UserLimitExceededError,
  IdempotencyMismatchError,
  ConcurrentRequestError,
  ShowNotFoundError,
  DomainError,
} from '../domain/errors.js';
import logger from '../infrastructure/logger/Logger.js';

export class ReservationService {
  constructor(pool = dbPoolInstance) {
    this.pool = pool;
    this.showRepo = new ShowRepository(pool);
    this.seatRepo = new SeatRepository(pool);
    this.resRepo = new ReservationRepository(pool);
    this.idempRepo = new IdempotencyRepository(pool);
  }

  async reserveSeats({ showId, seatNumbers, userId, idempotencyKey = null, correlationId = null }) {
    this._validateReserveInput({ showId, seatNumbers, userId });
    const sortedSeats = [...seatNumbers].sort();
    const payloadHash = this._computePayloadHash({ showId, seatNumbers: sortedSeats, userId });

    const uow = new UnitOfWork(this.pool);
    try {
      return await uow.execute(async (unit) => {
        const client = unit.getClient();
        await this._handleIdempotencyCheck(idempotencyKey, payloadHash, showId, userId, client);

        const show = await this.showRepo.findById(showId, client);
        if (!show) throw new ShowNotFoundError(showId);

        await this._assertUserQuota(showId, userId, sortedSeats.length, show.perUserLimit, client);

        const lockedSeats = await this.seatRepo.findSeatsForUpdate(showId, sortedSeats, client);
        this._assertSeatsAvailable(lockedSeats, sortedSeats);

        const totalAmount = show.calculateTotalAmount(sortedSeats.length);
        const reservationEntity = new Reservation({
          showId,
          userId,
          amountPaise: totalAmount,
          seats: sortedSeats,
          status: 'confirmed',
        });

        const createdReservation = await this.resRepo.create(reservationEntity, lockedSeats, client);
        await this.seatRepo.updateSeatsStatus(showId, sortedSeats, 'confirmed', createdReservation.id, null, userId, client);

        const responsePayload = createdReservation.toJSON();
        if (idempotencyKey) {
          await this.idempRepo.markCompleted(idempotencyKey, 201, responsePayload, client);
        }

        logger.info('Seats successfully confirmed', {
          correlation_id: correlationId,
          reservation_id: createdReservation.id,
          show_id: showId,
          user_id: userId,
          seats: sortedSeats,
        });

        return responsePayload;
      });
    } catch (err) {
      if (err.isCached) return err.cachedPayload;
      this._handleDatabaseError(err, correlationId);
    }
  }

  _validateReserveInput({ showId, seatNumbers, userId }) {
    if (!showId || !userId || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
      throw new DomainError('Invalid reservation parameters: showId, userId, and seats array are required', 'INVALID_INPUT', 400);
    }
  }

  _computePayloadHash(data) {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  async _handleIdempotencyCheck(idempotencyKey, payloadHash, showId, userId, client) {
    if (!idempotencyKey) return;

    const existingRecord = await this.idempRepo.findForUpdate(idempotencyKey, client);
    if (existingRecord) {
      if (!existingRecord.matchesPayload(payloadHash)) {
        throw new IdempotencyMismatchError();
      }
      if (!existingRecord.isCompleted()) {
        throw new ConcurrentRequestError();
      }
      const earlyReturn = new Error('IDEMPOTENT_REPLAY');
      earlyReturn.isCached = true;
      earlyReturn.cachedPayload = existingRecord.responseBody;
      throw earlyReturn;
    }

    const newRecord = new IdempotencyRecord({
      idempotencyKey,
      showId,
      userId,
      requestHash: payloadHash,
    });
    await this.idempRepo.insert(newRecord, client);
  }

  async _assertUserQuota(showId, userId, requestedCount, limit, client) {
    // Acquire transaction-scoped advisory lock for (showId, userId) to serialize quota evaluation
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [showId, userId]);

    const activeCount = await this.resRepo.countActiveSeatsByUser(showId, userId, client);
    if (activeCount + requestedCount > limit) {
      throw new UserLimitExceededError(activeCount, requestedCount, limit);
    }
  }

  _assertSeatsAvailable(lockedSeats, requestedSeats) {
    if (lockedSeats.length !== requestedSeats.length) {
      const foundNumbers = new Set(lockedSeats.map((s) => s.seatNumber));
      const missing = requestedSeats.filter((n) => !foundNumbers.has(n));
      throw new SeatUnavailableError(missing);
    }

    const unavailable = lockedSeats.filter((s) => !s.isAvailable());
    if (unavailable.length > 0) {
      throw new SeatUnavailableError(unavailable.map((s) => s.seatNumber));
    }
  }

  _handleDatabaseError(err, correlationId) {
    logger.error('Reservation error occurred', {
      correlation_id: correlationId,
      pg_code: err.code,
      error_message: err.message,
    });

    if (err.code === '55P03') {
      throw new DomainError('Seat lock timeout under high contention', 'SEAT_LOCK_TIMEOUT', 409);
    }
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('idempotency')) {
        throw new ConcurrentRequestError();
      }
      throw new SeatUnavailableError();
    }
    if (err.code === '40001') {
      throw new DomainError('Concurrent serialization conflict, please retry', 'CONCURRENCY_CONFLICT', 409);
    }
    throw err;
  }
}

export const reservationService = new ReservationService();
export default reservationService;
