import reservationService from '../../services/ReservationService.js';
import cancellationService from '../../services/CancellationService.js';
import metricsCollector from '../../infrastructure/metrics/MetricsCollector.js';
import { DomainError } from '../../domain/errors.js';

export class ReservationController {
  constructor(resService = reservationService, cancelService = cancellationService, metrics = metricsCollector) {
    this.resService = resService;
    this.cancelService = cancelService;
    this.metrics = metrics;
  }

  async reserveSeats(req, res, next) {
    const showId = req.params.id;
    try {
      const { seats } = req.body || {};
      if (!Array.isArray(seats) || seats.length === 0) {
        throw new DomainError('seats array with at least one seat number is required', 'INVALID_SEATS', 400);
      }

      const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
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
}

export const reservationController = new ReservationController();
export default reservationController;
