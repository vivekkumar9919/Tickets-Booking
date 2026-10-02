import pg from 'pg';
import logger from '../logger/Logger.js';

const { Pool } = pg;

export class DatabasePool {
  constructor(connectionString = process.env.DATABASE_URL) {
    this.connectionString = connectionString || 'postgres://postgres:postgrespassword@localhost:5432/ticket_booking';
    this.pool = null;
  }

  connect() {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        min: parseInt(process.env.DB_POOL_MIN || '5', 10),
        max: parseInt(process.env.DB_POOL_MAX || '30', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
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
