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
    if (err instanceof DomainError) {
      throw err;
    }

    logger.error('Reservation error occurred', {
      correlation_id: correlationId,
      pg_code: err.code,
      error_message: err.message,
    });

    if (
      err.code === '55P03' ||
      err.code === '57014' ||
      err.code === '53300' ||
      (err.message && (
        err.message.includes('timeout exceeded') ||
        err.message.includes('Connection terminated') ||
        err.message.includes('Connection timeout') ||
        err.message.includes('canceling statement')
      ))
    ) {
      throw new DomainError('Seat lock or pool timeout under high contention, please retry', 'SEAT_LOCK_TIMEOUT', 409);
    }
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('idempotency')) {
        throw new ConcurrentRequestError();
      }
      throw new SeatUnavailableError();
    }
    if (err.code === '40001' || err.code === '40P01') {
      throw new DomainError('Concurrent serialization conflict, please retry', 'CONCURRENCY_CONFLICT', 409);
    }
    throw err;
  }

  async holdSeats({ showId, seatNumbers, userId, holdDurationSeconds = 30, correlationId = null }) {
    this._validateReserveInput({ showId, seatNumbers, userId });
    const sortedSeats = [...seatNumbers].sort();

    const uow = new UnitOfWork(this.pool);
    try {
      return await uow.execute(async (unit) => {
        const client = unit.getClient();
        const show = await this.showRepo.findById(showId, client);
        if (!show) throw new ShowNotFoundError(showId);

        await this._assertUserQuota(showId, userId, sortedSeats.length, show.perUserLimit, client);
        const lockedSeats = await this.seatRepo.findSeatsForUpdate(showId, sortedSeats, client);
        this._assertSeatsAvailable(lockedSeats, sortedSeats);

        const totalAmount = show.calculateTotalAmount(sortedSeats.length);
        const holdExpiresAt = new Date(Date.now() + holdDurationSeconds * 1000);

        const reservationEntity = new Reservation({
          showId,
          userId,
          amountPaise: totalAmount,
          seats: sortedSeats,
          status: 'held',
        });
        reservationEntity.holdExpiresAt = holdExpiresAt;

        const createdReservation = await this.resRepo.create(reservationEntity, lockedSeats, client);
        await this.seatRepo.updateSeatsStatus(showId, sortedSeats, 'held', createdReservation.id, holdExpiresAt, userId, client);

        logger.info('Seats placed on temporary hold', {
          correlation_id: correlationId,
          reservation_id: createdReservation.id,
          show_id: showId,
          user_id: userId,
          seats: sortedSeats,
          hold_duration_seconds: holdDurationSeconds,
        });

        return {
          reservation_id: createdReservation.id,
          show_id: showId,
          user_id: userId,
          seats: sortedSeats,
          amount_paise: createdReservation.amount.paise,
          status: 'held',
          hold_expires_at: holdExpiresAt.toISOString(),
          expires_in_seconds: holdDurationSeconds,
        };
      });
    } catch (err) {
      this._handleDatabaseError(err, correlationId);
    }
  }

  async confirmHeldReservation({ reservationId, userId, correlationId = null }) {
    if (!reservationId || !userId) {
      throw new DomainError('reservationId and userId are required', 'INVALID_INPUT', 400);
    }

    const uow = new UnitOfWork(this.pool);
    try {
      return await uow.execute(async (unit) => {
        const client = unit.getClient();
        const reservation = await this.resRepo.findById(reservationId, client);
        if (!reservation) throw new DomainError('Reservation not found', 'RESERVATION_NOT_FOUND', 404);
        if (!reservation.isOwnedBy(userId)) throw new DomainError('Unauthorized', 'FORBIDDEN', 403);

        if (reservation.isConfirmed()) {
          return reservation.toJSON();
        }

        // Check if hold expired
        const lockedSeats = await this.seatRepo.findSeatsForUpdate(reservation.showId, reservation.seats, client);
        const expired = lockedSeats.some((s) => s.status !== 'held' || (s.lockedUntil && new Date(s.lockedUntil) < new Date()));
        if (expired) {
          throw new DomainError('Seat hold has expired. Please select seats again.', 'HOLD_EXPIRED', 409);
        }

        await this.resRepo.confirmHeldReservation(reservationId, client);
        await this.seatRepo.updateSeatsStatus(reservation.showId, reservation.seats, 'confirmed', reservationId, null, userId, client);

        logger.info('Held reservation successfully confirmed following payment', {
          correlation_id: correlationId,
          reservation_id: reservationId,
          user_id: userId,
          seats: reservation.seats,
        });

        return {
          reservation_id: reservationId,
          show_id: reservation.showId,
          user_id: userId,
          seats: reservation.seats,
          amount_paise: reservation.amount.paise,
          status: 'confirmed',
        };
      });
    } catch (err) {
      this._handleDatabaseError(err, correlationId);
    }
  }
}

export const reservationService = new ReservationService();
export default reservationService;
