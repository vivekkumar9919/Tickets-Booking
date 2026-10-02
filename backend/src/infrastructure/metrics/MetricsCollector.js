import client from 'prom-client';

export class MetricsCollector {
  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry, prefix: 'ticket_node_' });

    this.httpRequestsTotal = new client.Counter({
      name: 'ticket_http_requests_total',
      help: 'Total count of incoming HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'ticket_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.reservationsConfirmedTotal = new client.Counter({
      name: 'ticket_reservations_confirmed_total',
      help: 'Total successfully confirmed seat reservations',
      labelNames: ['show_id'],
      registers: [this.registry],
    });

    this.reservationsDeclinedTotal = new client.Counter({
      name: 'ticket_reservations_declined_total',
      help: 'Total declined seat reservation attempts partitioned by reason',
      labelNames: ['show_id', 'reason'],
      registers: [this.registry],
    });

    this.idempotentReplaysTotal = new client.Counter({
      name: 'ticket_idempotent_replays_total',
      help: 'Total requests served from the idempotency cache without DB mutation',
      labelNames: ['show_id'],
      registers: [this.registry],
    });

    this.seatsStatusGauge = new client.Gauge({
      name: 'ticket_seats_status',
      help: 'Instantaneous count of seats in each state (available, held, confirmed)',
      labelNames: ['show_id', 'status'],
      registers: [this.registry],
    });
  }

  recordHttpRequest(method, path, status, durationSeconds) {
    this.httpRequestsTotal.inc({ method, path, status });
    this.httpRequestDuration.observe({ method, path, status }, durationSeconds);
  }

  recordReservationConfirmed(showId) {
    this.reservationsConfirmedTotal.inc({ show_id: showId });
  }

  recordReservationDeclined(showId, reason) {
    this.reservationsDeclinedTotal.inc({ show_id: showId || 'unknown', reason });
  }

  recordIdempotentReplay(showId) {
    this.idempotentReplaysTotal.inc({ show_id: showId });
  }

  setSeatStatusGauge(showId, status, count) {
    this.seatsStatusGauge.set({ show_id: showId, status }, count);
  }

  async getMetrics() {
    return await this.registry.metrics();
  }

  getContentType() {
    return this.registry.contentType;
  }
}

export const metricsCollector = new MetricsCollector();
export default metricsCollector;
