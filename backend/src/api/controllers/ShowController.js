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
      const { name, total_seats, price_paise, per_user_limit } = req.body || {};
      if (!name || !total_seats || !price_paise) {
        throw new DomainError('name, total_seats, and price_paise are required', 'MISSING_FIELDS', 400);
      }

      const show = await this.service.createShow({
        name,
        totalSeats: Number(total_seats),
        pricePaise: Number(price_paise),
        perUserLimit: per_user_limit ? Number(per_user_limit) : 4,
        correlationId: req.correlationId,
      });

      this.metrics.setSeatStatusGauge(show.id, 'available', show.totalSeats);
      this.metrics.setSeatStatusGauge(show.id, 'held', 0);
      this.metrics.setSeatStatusGauge(show.id, 'confirmed', 0);

      return res.status(201).json(show.toJSON());
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
