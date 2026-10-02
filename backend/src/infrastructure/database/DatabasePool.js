import pg from 'pg';
import logger from '../logger/Logger.js';
import config from '../config.js';

const { Pool } = pg;

export class DatabasePool {
  constructor(connectionString = config.database.url) {
    this.connectionString = connectionString;
    this.pool = null;
  }

  connect() {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        min: config.database.poolMin,
        max: config.database.poolMax,
        idleTimeoutMillis: config.database.idleTimeoutMs,
        connectionTimeoutMillis: config.database.connectionTimeoutMs,
      });

      this.pool.on('error', (err) => {
        logger.error('Unexpected error on idle PostgreSQL client', { error: err.message, stack: err.stack });
      });

      logger.info('PostgreSQL connection pool initialized', {
        min: process.env.DB_POOL_MIN || 5,
        max: process.env.DB_POOL_MAX || 30,
      });
    }
    return this.pool;
  }

  async getClient() {
    if (!this.pool) {
      this.connect();
    }
    return await this.pool.connect();
  }

  async query(text, params) {
    if (!this.pool) {
      this.connect();
    }
    return await this.pool.query(text, params);
  }

  async checkHealth() {
    try {
      const client = await this.getClient();
      try {
        const start = Date.now();
        await client.query('SELECT 1');
        const durationMs = Date.now() - start;
        return { isHealthy: true, latencyMs: durationMs };
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return { isHealthy: false, error: error.message };
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      logger.info('PostgreSQL connection pool terminated');
      this.pool = null;
    }
  }
}

export const dbPool = new DatabasePool();
export default dbPool;
