import dbPool from '../../infrastructure/database/DatabasePool.js';

export class HealthController {
  constructor(pool = dbPool) {
    this.pool = pool;
    this.getLiveness = this.getLiveness.bind(this);
    this.getReadiness = this.getReadiness.bind(this);
    this.getDetailedHealth = this.getDetailedHealth.bind(this);
  }

  getLiveness(req, res) {
    return res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  }

  async getReadiness(req, res) {
    try {
      const health = await this.pool.checkHealth();
      if (health.isHealthy) {
        return res.status(200).json({
          status: 'ready',
          database: 'connected',
          latency_ms: health.latencyMs,
          timestamp: new Date().toISOString(),
        });
      }

      req.logger.error('Readiness check failed - database unhealthy', {
        error: health.error,
      });

      return res.status(503).json({
        status: 'not_ready',
        database: 'disconnected',
        error: 'Database connection failed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      req.logger.error('Unexpected error during readiness check', {
        error: error.message,
      });

      return res.status(503).json({
        status: 'not_ready',
        database: 'disconnected',
        error: 'Internal readiness probe error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getDetailedHealth(req, res) {
    try {
      const dbHealth = await this.pool.checkHealth();
      const isSystemHealthy = dbHealth.isHealthy;

      const payload = {
        status: isSystemHealthy ? 'healthy' : 'degraded',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        services: {
          api: { status: 'up' },
          database: {
            status: dbHealth.isHealthy ? 'up' : 'down',
            latency_ms: dbHealth.latencyMs || null,
          },
        },
      };

      const statusCode = isSystemHealthy ? 200 : 503;
      return res.status(statusCode).json(payload);
    } catch (error) {
      req.logger.error('Detailed health check failure', { error: error.message });
      return res.status(503).json({
        status: 'unhealthy',
        error: 'System health probe failure',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const healthController = new HealthController();
export default healthController;

