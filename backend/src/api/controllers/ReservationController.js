import reservationService from '../../services/ReservationService.js';
import cancellationService from '../../services/CancellationService.js';
import holdSweeper from '../../services/HoldSweeper.js';
import metricsCollector from '../../infrastructure/metrics/MetricsCollector.js';
import { DomainError } from '../../domain/errors.js';

export class ReservationController {
  constructor(resService = reservationService, cancelService = cancellationService, sweeper = holdSweeper, metrics = metricsCollector) {
    this.resService = resService;
    this.cancelService = cancelService;
    this.sweeper = sweeper;
    this.metrics = metrics;
  }

  async reserveSeats(req, res, next) {
    const showId = req.params.id;
    try {
      const { seats } = req.body || {};
      if (!Array.isArray(seats) || seats.length === 0) {
        throw new DomainError('seats array with at least one seat number is required', 'INVALID_SEATS', 400);
      }

      const idempotencyKey =
        req.headers['idempotency-key'] ||
        req.headers['x-idempotency-key'] ||
        req.body?.idempotency_key ||
        null;
      const userId = req.user.userId;

      const result = await this.resService.reserveSeats({
        showId,
        seatNumbers: seats,
        userId,
        idempotencyKey,
        correlationId: req.correlationId,
      });

      this.metrics.recordReservationConfirmed(showId);
      return res.status(201).json(result);
    } catch (err) {
      this.metrics.recordReservationDeclined(showId, err.code || 'UNKNOWN');
      next(err);
    }
  }

  async holdSeats(req, res, next) {
    const showId = req.params.id;
    try {
      const { seats, hold_duration_seconds } = req.body || {};
      if (!Array.isArray(seats) || seats.length === 0) {
        throw new DomainError('seats array with at least one seat number is required', 'INVALID_SEATS', 400);
      }

      const userId = req.user.userId;
      const duration = hold_duration_seconds ? parseInt(hold_duration_seconds, 10) : 30;

      const result = await this.resService.holdSeats({
        showId,
        seatNumbers: seats,
        userId,
        holdDurationSeconds: duration,
        correlationId: req.correlationId,
      });

      return res.status(201).json(result);
    } catch (err) {
      this.metrics.recordReservationDeclined(showId, err.code || 'UNKNOWN');
      next(err);
    }
  }

  async confirmReservation(req, res, next) {
    try {
      const reservationId = req.params.id;
      const userId = req.user.userId;

      const result = await this.resService.confirmHeldReservation({
        reservationId,
        userId,
        correlationId: req.correlationId,
      });

      this.metrics.recordReservationConfirmed(result.show_id);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async cancelReservation(req, res, next) {
    try {
      const reservationId = req.params.id;
      const userId = req.user.userId;

      const result = await this.cancelService.cancelReservation({
        reservationId,
        userId,
        correlationId: req.correlationId,
      });

      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async runSweeper(req, res, next) {
    try {
      const reclaimedCount = await this.sweeper.sweep();
      return res.status(200).json({ success: true, reclaimed_count: reclaimedCount });
    } catch (err) {
      next(err);
    }
  }
}

export const reservationController = new ReservationController();
export default reservationController;
