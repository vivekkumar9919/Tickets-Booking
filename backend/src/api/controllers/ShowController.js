import showService from '../../services/ShowService.js';
import metricsCollector from '../../infrastructure/metrics/MetricsCollector.js';
import { DomainError } from '../../domain/errors.js';

export class ShowController {
  constructor(service = showService, metrics = metricsCollector) {
    this.service = service;
    this.metrics = metrics;
  }

  async createShow(req, res, next) {
    try {
      const { name, total_seats, seats, price_paise, per_user_limit } = req.body || {};
      const customSeats = Array.isArray(seats) && seats.length > 0 ? seats : null;
      const seatCount = customSeats ? customSeats.length : Number(total_seats);

      if (!name || (!total_seats && !customSeats) || !price_paise) {
        throw new DomainError('name, price_paise, and either total_seats or seats array are required', 'MISSING_FIELDS', 400);
      }

      const show = await this.service.createShow({
        name,
        totalSeats: seatCount,
        seatNumbers: customSeats,
        pricePaise: Number(price_paise),
        perUserLimit: per_user_limit ? Number(per_user_limit) : 4,
        correlationId: req.correlationId,
      });

      this.metrics.setSeatStatusGauge(show.id, 'available', show.total_seats);
      this.metrics.setSeatStatusGauge(show.id, 'held', 0);
      this.metrics.setSeatStatusGauge(show.id, 'confirmed', 0);

      return res.status(201).json(show);
    } catch (err) {
      next(err);
    }
  }

  async getShow(req, res, next) {
    try {
      const showId = req.params.id;
      const state = await this.service.getShowState(showId, req.correlationId);

      this.metrics.setSeatStatusGauge(showId, 'available', state.summary.available);
      this.metrics.setSeatStatusGauge(showId, 'held', state.summary.held);
      this.metrics.setSeatStatusGauge(showId, 'confirmed', state.summary.confirmed);

      return res.status(200).json({
        show: state.show.toJSON(),
        summary: state.summary,
        seats: state.seats.map((s) => s.toJSON()),
      });
    } catch (err) {
      next(err);
    }
  }
}

export const showController = new ShowController();
export default showController;
